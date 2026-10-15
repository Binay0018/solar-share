import { isAddress } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import MatchingState from "../models/MatchingState.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";
import { getContractBuyerAddress, getContractSellerAddress, purchaseMatchOnChain } from "./contractService.js";

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

    // Process open requests that still need energy
    const requestFilter = { status: "open", kWhNeeded: { $gt: 0 } };

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
    const configuredBuyer = getContractBuyerAddress();
    const configuredSeller = getContractSellerAddress();

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
      let anyFailed = false;

      // Greedy selection: iterate offers sorted by price ascending, then time
      for (const offer of offers) {
        if (remainingKWh < 1) break;
        if (offer.status !== "open") continue;
        if (offer.sellerId.toLowerCase() === request.buyerId.toLowerCase()) continue;
        if (offer.pricePerKWh <= 0 || offer.pricePerKWh > request.maxPricePerKWh) continue;
        if (
          !configuredBuyer ||
          !isAddress(request.buyerId) ||
          request.buyerId.toLowerCase() !== configuredBuyer.toLowerCase()
        ) {
          continue;
        }

        // The backend signs purchases from its own buyer wallet, so it can buy
        // any listing that already exists on-chain. A listing that only exists
        // in MongoDB must first be created on-chain, which needs the configured
        // seller key, so those are only eligible when the seller key owns them.
        const offerIsOnChain = Number.isInteger(offer.onChainOfferId);
        const sellerIsConfigured =
          isAddress(offer.sellerId) &&
          Boolean(configuredSeller) &&
          offer.sellerId.toLowerCase() === configuredSeller.toLowerCase();
        if (!offerIsOnChain && !sellerIsConfigured) continue;

        const kWhToTake = Math.floor(Math.min(offer.kWhAvailable, remainingKWh));
        if (kWhToTake < 1) continue;

        // Atomically claim the offer
        const claimed = await EnergyOffer.findOneAndUpdate(
          { _id: offer._id, status: "open", kWhAvailable: { $gte: kWhToTake } },
          { $inc: { kWhAvailable: -kWhToTake } },
          { new: true }
        );
        if (!claimed) {
          continue;
        }

        try {
          const purchase = await purchaseMatchOnChain({ offer: claimed, buyerId: request.buyerId, kWhTraded: kWhToTake });

          const newOfferKWh = purchase.availableKWh;
          await EnergyOffer.findByIdAndUpdate(offer._id, {
            kWhAvailable: newOfferKWh,
            status: newOfferKWh > 0 ? "open" : "settled",
            onChainOfferId: purchase.onChainOfferId
          });

          // Create transaction record — NO settlement yet, just the purchase
          const transaction = await Transaction.create({
            offerId: offer._id,
            requestId: request._id,
            sellerId: offer.sellerId,
            buyerId: request.buyerId,
            kWhTraded: kWhToTake,
            totalPrice: Number((kWhToTake * offer.pricePerKWh).toFixed(2)),
            totalPriceWei: purchase.totalPriceWei,
            purchaseTxHash: purchase.purchaseTxHash,
            onChainTradeId: purchase.tradeId,
            createOfferTxHash: purchase.createOfferTxHash,
            purchaseGasUsed: purchase.purchaseGasUsed,
            purchaseGasPrice: purchase.purchaseGasPrice,
            settledAt: null
          });

          // Add fill to request — status is "awaiting_seller", NOT "settled"
          fills.push({
            offerId: offer._id,
            sellerId: offer.sellerId,
            kWh: kWhToTake,
            pricePerKWh: offer.pricePerKWh,
            status: "awaiting_seller",
            purchaseTxHash: purchase.purchaseTxHash,
            onChainTradeId: purchase.tradeId
          });

          remainingKWh = Number((remainingKWh - kWhToTake).toFixed(3));

          await MatchLog.create({
            offerId: offer._id,
            requestId: request._id,
            status: "success",
            reason: "purchased on-chain — awaiting seller settlement",
            kWhMatched: kWhToTake,
            totalPrice: Number((kWhToTake * offer.pricePerKWh).toFixed(2)),
            txHash: purchase.purchaseTxHash
          });

          results.push({
            status: "awaiting_seller",
            offerId: offer._id,
            requestId: request._id,
            txHash: purchase.purchaseTxHash,
            onChain: true,
            tradeId: purchase.tradeId,
            kWh: kWhToTake,
            sellerId: offer.sellerId
          });
        } catch (error) {
          // Check if offer was stale on-chain (e.g. 0 kWh remaining)
          const staleMatch = error.message.match(/On-chain offer has only (\d+) kWh available/);
          if (staleMatch) {
            const actualAvailable = parseInt(staleMatch[1], 10);
            await EnergyOffer.findByIdAndUpdate(offer._id, {
              kWhAvailable: actualAvailable,
              status: actualAvailable > 0 ? "open" : "settled"
            });
          } else if (Number.isSafeInteger(error.onChainOfferId)) {
            await EnergyOffer.findByIdAndUpdate(offer._id, {
              kWhAvailable: error.createdOfferAvailableKWh,
              status: error.createdOfferAvailableKWh > 0 ? "open" : "settled",
              onChainOfferId: error.onChainOfferId
            });
          } else {
            // Release the offer claim for non-stale errors
            await EnergyOffer.findByIdAndUpdate(offer._id, {
              $inc: { kWhAvailable: kWhToTake }
            });
          }

          // Mark fill as failed
          fills.push({
            offerId: offer._id,
            sellerId: offer.sellerId,
            kWh: kWhToTake,
            pricePerKWh: offer.pricePerKWh,
            status: "failed",
            failureReason: error.message
          });

          await MatchLog.create({
            offerId: offer._id,
            requestId: request._id,
            status: "failure",
            reason: error.message,
            kWhMatched: kWhToTake,
            totalPrice: Number((kWhToTake * offer.pricePerKWh).toFixed(2))
          });

          results.push({
            status: "failure",
            offerId: offer._id,
            requestId: request._id,
            reason: error.message
          });

          anyFailed = true;
          // Continue to next available offer instead of aborting the whole request
          continue;
        }
      }

      // Update request with fills
      const totalFilled = request.kWhNeeded - remainingKWh;
      const allSucceeded = !anyFailed;
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
