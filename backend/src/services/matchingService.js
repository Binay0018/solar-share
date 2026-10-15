import { formatUnits } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import MatchingState from "../models/MatchingState.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";
import { getContractBuyerAddress, getContractSellerAddress, purchaseMatchOnChain } from "./contractService.js";
import { MAX_CANDIDATE_OFFERS, OFFER_SORT, planFills, weiToRupees } from "./matchingEngine.js";

// Serializes matching runs so concurrent meter readings, offers, and trade
// requests can never match (and save) the same pair twice.
let matchingInProgress = false;

// How many times a single listing may fail on-chain before the run gives up on
// it. Repairs make the listing retryable with corrected data, but this stops a
// listing that keeps changing on-chain from looping forever.
const MAX_ATTEMPTS_PER_OFFER = 2;

// Upper bound on planning passes for one request. Every pass either buys at
// least one kWh or burns one of the per-listing attempts above.
const MAX_PLAN_PASSES = MAX_CANDIDATE_OFFERS * (MAX_ATTEMPTS_PER_OFFER + 1);

function matchingContext() {
  return {
    configuredBuyer: getContractBuyerAddress(),
    configuredSeller: getContractSellerAddress()
  };
}

// Candidate listings for one request, filtered and ordered by the same
// price-time rules the engine applies. Loading this per request (instead of one
// global snapshot) means a request never plans against quantities that an
// earlier request already consumed in the same run.
async function loadCandidateOffers(request) {
  return EnergyOffer.find({
    status: "open",
    kWhAvailable: { $gte: 1 },
    pricePerKWh: { $gt: 0, $lte: Number(request.maxPricePerKWh) }
  })
    .sort(OFFER_SORT)
    .limit(MAX_CANDIDATE_OFFERS)
    .lean();
}

/**
 * The exact fills the matcher would buy right now for this request. Runs the
 * same engine function as attemptMatches, so the buyer preview cannot promise a
 * fill the matcher would refuse. Read-only: nothing is claimed or purchased.
 */
export async function previewMatch({ buyerId, kWhNeeded, maxPricePerKWh }) {
  const request = { buyerId, kWhNeeded, maxPricePerKWh };
  const offers = await loadCandidateOffers(request);
  const plan = planFills({ request, offers, context: matchingContext() });

  return {
    requestedKWh: plan.requestedKWh,
    filledKWh: plan.filledKWh,
    remainingKWh: plan.remainingKWh,
    totalPrice: plan.totalPrice,
    totalWei: plan.totalWei,
    averageRate: plan.averageRate,
    escrowEth: formatUnits(BigInt(plan.totalWei), 18),
    fills: plan.fills.map((fill) => ({
      sellerId: fill.sellerId,
      kWh: fill.kWh,
      pricePerKWh: fill.pricePerKWh,
      totalPrice: weiToRupees(fill.totalWei),
      onChainOfferId: fill.onChainOfferId
    }))
  };
}

// Correct the marketplace record from what the chain actually reports, so a
// stale listing is repaired instead of silently skipped forever.
async function repairOfferFromChainError(offer, error, kWhTraded) {
  const staleQuantity = error.message.match(/On-chain offer has only (\d+) kWh available/);
  if (staleQuantity) {
    const actualAvailable = Number.parseInt(staleQuantity[1], 10);
    await EnergyOffer.findByIdAndUpdate(offer._id, {
      kWhAvailable: actualAvailable,
      status: actualAvailable > 0 ? "open" : "settled"
    });
    return actualAvailable > 0;
  }

  if (Number.isSafeInteger(error.onChainOfferId)) {
    await EnergyOffer.findByIdAndUpdate(offer._id, {
      kWhAvailable: error.createdOfferAvailableKWh,
      status: error.createdOfferAvailableKWh > 0 ? "open" : "settled",
      onChainOfferId: error.onChainOfferId
    });
    return error.createdOfferAvailableKWh > 0;
  }

  // The seller changed the price on-chain. The chain price is what a buyer
  // actually pays, so mirror it and decide again on the next plan pass.
  if (error.onChainPriceWei) {
    await EnergyOffer.findByIdAndUpdate(offer._id, {
      pricePerKWh: Number(formatUnits(BigInt(error.onChainPriceWei), 10))
    });
    return true;
  }

  // Unknown failure: put the claimed quantity back and stop using this listing.
  await EnergyOffer.findByIdAndUpdate(offer._id, { $inc: { kWhAvailable: kWhTraded } });
  return false;
}

// Buy one request's energy, cheapest eligible listing first, re-planning after
// every purchase so later picks always see fresh quantities. A listing that
// fails on-chain is repaired and either retried with its true values or dropped
// for the rest of the run.
async function fillRequest(request, context, results) {
  const attempts = new Map();
  const fills = [];
  let remainingKWh = Math.floor(Number(request.kWhNeeded));
  let guard = 0;

  while (remainingKWh >= 1 && guard < MAX_PLAN_PASSES) {
    guard += 1;

    // Listings that already used up their attempt budget are excluded from the
    // plan entirely, so the greedy fill still reaches the next-best listing
    // instead of stopping short.
    const exhausted = [...attempts.entries()]
      .filter(([, count]) => count >= MAX_ATTEMPTS_PER_OFFER)
      .map(([offerId]) => offerId);

    const offers = await loadCandidateOffers({ ...request, kWhNeeded: remainingKWh });
    const plan = planFills({
      request: { ...request, kWhNeeded: remainingKWh },
      offers,
      context,
      excludeOfferIds: exhausted
    });
    const fill = plan.fills[0];
    if (!fill) break;

    const offer = fill.offer;
    const kWhToTake = fill.kWh;
    const offerKey = String(offer._id);
    attempts.set(offerKey, (attempts.get(offerKey) ?? 0) + 1);

    // Atomically claim the listing so a concurrent run can never oversell it.
    const claimed = await EnergyOffer.findOneAndUpdate(
      { _id: offer._id, status: "open", kWhAvailable: { $gte: kWhToTake } },
      { $inc: { kWhAvailable: -kWhToTake } },
      { new: true }
    );
    if (!claimed) continue;

    try {
      const purchase = await purchaseMatchOnChain({
        offer: claimed,
        buyerId: request.buyerId,
        kWhTraded: kWhToTake
      });

      const newOfferKWh = purchase.availableKWh;
      await EnergyOffer.findByIdAndUpdate(offer._id, {
        kWhAvailable: newOfferKWh,
        status: newOfferKWh > 0 ? "open" : "settled",
        onChainOfferId: purchase.onChainOfferId
      });

      // The rupees recorded in the ledger come from the wei the contract
      // actually escrowed, so the two can never disagree.
      const totalPriceWei = BigInt(purchase.totalPriceWei);
      const totalPrice = weiToRupees(totalPriceWei);

      await Transaction.create({
        offerId: offer._id,
        requestId: request._id,
        sellerId: offer.sellerId,
        buyerId: request.buyerId,
        kWhTraded: kWhToTake,
        totalPrice,
        totalPriceWei: purchase.totalPriceWei,
        purchaseTxHash: purchase.purchaseTxHash,
        onChainTradeId: purchase.tradeId,
        createOfferTxHash: purchase.createOfferTxHash,
        purchaseGasUsed: purchase.purchaseGasUsed,
        purchaseGasPrice: purchase.purchaseGasPrice,
        settledAt: null
      });

      // A fill is "awaiting_seller": the energy is bought and escrowed, but
      // only the seller's own wallet can release the funds.
      fills.push({
        offerId: offer._id,
        sellerId: offer.sellerId,
        kWh: kWhToTake,
        pricePerKWh: offer.pricePerKWh,
        status: "awaiting_seller",
        purchaseTxHash: purchase.purchaseTxHash,
        onChainTradeId: purchase.tradeId
      });

      remainingKWh -= kWhToTake;

      await MatchLog.create({
        offerId: offer._id,
        requestId: request._id,
        status: "success",
        reason: "purchased on-chain — awaiting seller settlement",
        kWhMatched: kWhToTake,
        totalPrice,
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
      const retryable = await repairOfferFromChainError(offer, error, kWhToTake);
      if (!retryable) attempts.set(offerKey, MAX_ATTEMPTS_PER_OFFER);

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
        totalPrice: weiToRupees(fill.totalWei)
      });

      results.push({
        status: "failure",
        offerId: offer._id,
        requestId: request._id,
        reason: error.message
      });
    }
  }

  const totalFilled = Number(request.kWhNeeded) - remainingKWh;
  const finalStatus = remainingKWh < 0.001 ? "filled" : "partially_filled";

  await TradeRequest.findByIdAndUpdate(request._id, {
    kWhNeeded: remainingKWh,
    status: finalStatus,
    $push: { fills }
  });

  if (fills.length > 0) {
    results.push({
      status: finalStatus,
      requestId: request._id,
      totalFilled,
      remainingKWh,
      fillCount: fills.length,
      fills: fills.map((fill) => ({
        sellerId: fill.sellerId,
        kWh: fill.kWh,
        pricePerKWh: fill.pricePerKWh,
        status: fill.status,
        txHash: fill.txHash
      }))
    });
  }
}

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

    const requests = await TradeRequest.find({ status: "open", kWhNeeded: { $gt: 0 } })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();
    const results = [];
    const context = matchingContext();

    for (const request of requests) {
      // Per-request lock: skip if already being processed
      const locked = await TradeRequest.findOneAndUpdate(
        { _id: request._id, status: "open" },
        { $set: { status: "partially_filled" } },
        { new: true }
      );
      if (!locked) continue;

      await fillRequest(request, context, results);
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
