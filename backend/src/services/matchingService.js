import { isAddress } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";

export async function attemptMatches() {
  // Limit to top open offers and requests to avoid O(N*M) heavy processing
  const offers = await EnergyOffer.find({ status: "open", kWhAvailable: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .limit(20);
  const requests = await TradeRequest.find({ status: "open", kWhNeeded: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .limit(20);
  const results = [];

  for (const offer of offers) {
    for (const tradeRequest of requests) {
      if (offer.sellerId === tradeRequest.buyerId) continue;
      if (offer.status !== "open" || tradeRequest.status !== "open") continue;
      if (offer.pricePerKWh > tradeRequest.maxPricePerKWh) continue;

      const kWhMatched = Number(Math.min(offer.kWhAvailable, tradeRequest.kWhNeeded).toFixed(3));
      if (kWhMatched <= 0) continue;
      const totalPrice = Number((kWhMatched * offer.pricePerKWh).toFixed(2));
      const log = {
        offerId: offer._id,
        requestId: tradeRequest._id,
        kWhMatched,
        totalPrice
      };

      const isOnChain =
        isAddress(offer.sellerId) &&
        isAddress(tradeRequest.buyerId) &&
        Number.isInteger(offer.onChainOfferId);

      try {
        let txHash = null;
        let settlementDetails = {};
        if (isOnChain) {
          await MatchLog.create({ ...log, status: "skipped", reason: "awaiting buyer MetaMask purchase" });
          results.push({ status: "pending", offerId: offer._id, requestId: tradeRequest._id });
          continue;
        } else {
          // Off-chain / simulated ledger settlement
          txHash = `0xsim_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
        }

        offer.kWhAvailable = Number((offer.kWhAvailable - kWhMatched).toFixed(3));
        offer.status = offer.kWhAvailable > 0.001 ? "open" : "settled";
        tradeRequest.kWhNeeded = Number((tradeRequest.kWhNeeded - kWhMatched).toFixed(3));
        tradeRequest.status = tradeRequest.kWhNeeded > 0.001 ? "open" : "settled";

        await Promise.all([offer.save(), tradeRequest.save()]);

        await Transaction.create({
          offerId: offer._id,
          requestId: tradeRequest._id,
          kWhTraded: kWhMatched,
          totalPrice,
          txHash,
          ...settlementDetails,
          settledAt: new Date()
        });

        await MatchLog.create({
          ...log,
          status: "success",
          reason: isOnChain ? "settled on-chain" : "settled local peer-to-peer ledger",
          txHash
        });

        results.push({
          status: "success",
          offerId: offer._id,
          requestId: tradeRequest._id,
          txHash
        });
      } catch (error) {
        await MatchLog.create({ ...log, status: "failure", reason: error.message });
        results.push({
          status: "failure",
          offerId: offer._id,
          requestId: tradeRequest._id,
          reason: error.message
        });
      }
    }
  }

  return { attempted: results.length, results };
}