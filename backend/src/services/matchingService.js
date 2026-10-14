import { isAddress } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import MatchingState from "../models/MatchingState.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";
import { purchaseMatchOnChain, getContractSellerAddress } from "./contractService.js";

// Serializes matching runs so concurrent meter readings, offers, and trade
// requests can never match (and save) the same pair twice.
let matchingInProgress = false;

export async function attemptMatches() {
  if (matchingInProgress) {
    return { attempted: 0, results: [], skipped: "matching already in progress" };
  }
  matchingInProgress = true;

  try {
    // Acquire persistent lock
    const lockAcquired = await MatchingState.findOneAndUpdate(
      { isRunning: false },
      { $set: { isRunning: true, startedAt: new Date() } },
      { new: true, upsert: true }
    );
    if (!lockAcquired) {
      return { attempted: 0, results: [], skipped: "matching already in progress (persistent lock)" };
    }

    const now = new Date();

    // Recover requests stuck in partially_filled from a crashed run (older than 5 minutes)
    const stuckThreshold = new Date(now.getTime() - 5 * 60 * 1000);
    await TradeRequest.updateMany(
      { status: "partially_filled", updatedAt: { $lt: stuckThreshold } },
      { $set: { status: "open" } }
    );

    // Only process requests created after the last successful matching run
    const state = await MatchingState.findOne({ _id: "singleton" }).lean();
    const requestFilter = { status: "open", kWhNeeded: { $gt: 0 } };
    if (state?.lastMatchingRun) {
      requestFilter.createdAt = { $gt: state.lastMatchingRun };
    }

    // Price-time priority: cheapest first, then earliest
    const offers = await EnergyOffer.find({ status: "open", kWhAvailable: { $gt: 0 } })
      .sort({ pricePerKWh: 1, createdAt: 1 })
      .limit(50)
      .lean();
    const requests = await TradeRequest.find(requestFilter)
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();
    const results = [];

    // Get the configured seller address for backend-assisted settlement
    let backendSellerAddress = null;
    try {
      backendSellerAddress = getContractSellerAddress();
    } catch {
      // Backend keys not configured — skip backend-assisted settlement
    }

    for (const request of requests) {
      // Per-request lock: skip if already being processed
      const locked = await TradeRequest.findOneAndUpdate(
        { _id: request._id, status: "open" },
        { $set: { status: "partially_filled" } },
        { new: true }
      );
      if (!locked) continue;

      let remainingKWh = request.kWhNeeded;
      const fills = [];
      let allSucceeded = true;

      // Greedy selection: iterate offers sorted by price ascending, then time
      for (const offer of offers) {
        if (remainingKWh < 1) break;
        if (offer.status !== "open") continue;
        if (offer.sellerId.toLowerCase() === request.buyerId.toLowerCase()) continue;
        if (offer.pricePerKWh <= 0 || offer.pricePerKWh > request.maxPricePerKWh) continue;

        // Only use backend-assisted settlement if the seller matches SELLER_PRIVATE_KEY
        const canSettle = backendSellerAddress && offer.sellerId.toLowerCase() === backendSellerAddress.toLowerCase();
        if (!canSettle) continue;

        const kWhToTake = Math.min(offer.kWhAvailable, remainingKWh);
        if (kWhToTake < 1) continue;

        // Atomically claim the offer
        const claimed = await EnergyOffer.findOneAndUpdate(
          { _id: offer._id, status: "open", kWhAvailable: { $gte: kWhToTake } },
          { $inc: { kWhAvailable: -kWhToTake } },
          { new: true }
        );
        if (!claimed) {
          allSucceeded = false;
          break;
        }

        const onChainKWh = Math.floor(kWhToTake);
        if (onChainKWh < 1) {
          // Release the claim
          await EnergyOffer.findByIdAndUpdate(offer._id, {
            $inc: { kWhAvailable: kWhToTake }
          });
          continue;
        }

        try {
          const purchase = await purchaseMatchOnChain({ offer: claimed, kWhTraded: onChainKWh });

          // Update offer status
          const newOfferKWh = claimed.kWhAvailable - onChainKWh;
          await EnergyOffer.findByIdAndUpdate(offer._id, {
            kWhAvailable: newOfferKWh,
            status: newOfferKWh > 0.001 ? "open" : "settled",
            onChainOfferId: purchase.onChainOfferId
          });

          // Create transaction record — NO settlement yet, just the purchase
          const transaction = await Transaction.create({
            offerId: offer._id,
            requestId: request._id,
            kWhTraded: onChainKWh,
            totalPrice: Number((onChainKWh * offer.pricePerKWh).toFixed(2)),
            purchaseTxHash: purchase.purchaseTxHash,
            onChainTradeId: purchase.tradeId,
            purchaseGasUsed: purchase.purchaseGasUsed,
            purchaseGasPrice: purchase.purchaseGasPrice,
            settledAt: null  // NOT settled — awaiting seller authorization
          });

          // Add fill to request — status is "awaiting_seller", NOT "settled"
          fills.push({
            offerId: offer._id,
            sellerId: offer.sellerId,
            kWh: onChainKWh,
            pricePerKWh: offer.pricePerKWh,
            status: "awaiting_seller",
            purchaseTxHash: purchase.purchaseTxHash,
            onChainTradeId: purchase.tradeId
          });

          remainingKWh = Number((remainingKWh - onChainKWh).toFixed(3));

          await MatchLog.create({
            offerId: offer._id,
            requestId: request._id,
            status: "success",
            reason: "purchased on-chain — awaiting seller settlement",
            kWhMatched: onChainKWh,
            totalPrice: Number((onChainKWh * offer.pricePerKWh).toFixed(2)),
            txHash: purchase.purchaseTxHash
          });

          results.push({
            status: "awaiting_seller",
            offerId: offer._id,
            requestId: request._id,
            txHash: purchase.purchaseTxHash,
            onChain: true,
            tradeId: purchase.tradeId,
            kWh: onChainKWh,
            sellerId: offer.sellerId
          });
        } catch (error) {
          // Release the offer claim
          await EnergyOffer.findByIdAndUpdate(offer._id, {
            $inc: { kWhAvailable: kWhToTake }
          });

          // Mark fill as failed
          fills.push({
            offerId: offer._id,
            sellerId: offer.sellerId,
            kWh: onChainKWh,
            pricePerKWh: offer.pricePerKWh,
            status: "failed",
            failureReason: error.message
          });

          await MatchLog.create({
            offerId: offer._id,
            requestId: request._id,
            status: "failure",
            reason: error.message,
            kWhMatched: onChainKWh,
            totalPrice: Number((onChainKWh * offer.pricePerKWh).toFixed(2))
          });

          results.push({
            status: "failure",
            offerId: offer._id,
            requestId: request._id,
            reason: error.message
          });

          allSucceeded = false;
          break; // Stop on first failure - keep earlier fills
        }
      }

      // Update request with fills
      const totalFilled = request.kWhNeeded - remainingKWh;
      const finalStatus = allSucceeded && remainingKWh < 0.001 ? "filled" : "partially_filled";

      await TradeRequest.findByIdAndUpdate(request._id, {
        kWhNeeded: remainingKWh,
        status: finalStatus,
        $push: { fills: fills }
      });

      if (fills.length > 0) {
        results.push({
          status: allSucceeded ? "filled" : "partially_filled",
          requestId: request._id,
          totalFilled: Number(totalFilled.toFixed(3)),
          remainingKWh: Number(remainingKWh.toFixed(3)),
          fillCount: fills.length,
          fills: fills.map(f => ({
            sellerId: f.sellerId,
            kWh: f.kWh,
            pricePerKWh: f.pricePerKWh,
            status: f.status,
            txHash: f.txHash
          }))
        });
      }
    }

    // Update persistent state
    await MatchingState.findByIdAndUpdate("singleton", {
      $set: { lastMatchingRun: now, isRunning: false, finishedAt: new Date() }
    }, { upsert: true });

    return { attempted: results.length, results };
  } catch (error) {
    // Release lock on error
    await MatchingState.findByIdAndUpdate("singleton", {
      $set: { isRunning: false, finishedAt: new Date() }
    }, { upsert: true });
    throw error;
  } finally {
    matchingInProgress = false;
  }
}
