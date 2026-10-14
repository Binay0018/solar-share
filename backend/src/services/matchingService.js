import { isAddress } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";
import { settleMatchOnChain } from "./contractService.js";

// Serializes matching runs so concurrent meter readings, offers, and trade
// requests can never match (and save) the same pair twice.
let matchingInProgress = false;

export async function attemptMatches() {
  if (matchingInProgress) {
    return { attempted: 0, results: [], skipped: "matching already in progress" };
  }
  matchingInProgress = true;

  try {
    // Newest open offers first so live simulator offers match before stale ones
    const offers = await EnergyOffer.find({ status: "open", kWhAvailable: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(50);
    const requests = await TradeRequest.find({ status: "open", kWhNeeded: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(50);
    const results = [];

    for (const offer of offers) {
      for (const tradeRequest of requests) {
        if (offer.status !== "open" || tradeRequest.status !== "open") continue;
        if (offer.sellerId.toLowerCase() === tradeRequest.buyerId.toLowerCase()) continue;
        if (offer.pricePerKWh <= 0) continue; // the contract requires a positive price
        if (offer.pricePerKWh > tradeRequest.maxPricePerKWh) continue;

        const kWhMatched = Number(Math.min(offer.kWhAvailable, tradeRequest.kWhNeeded).toFixed(3));
        if (kWhMatched <= 0) continue;
        const totalPrice = Number((kWhMatched * offer.pricePerKWh).toFixed(2));
        const log = { offerId: offer._id, requestId: tradeRequest._id, kWhMatched, totalPrice };

        const walletSeller = isAddress(offer.sellerId);
        const walletBuyer = isAddress(tradeRequest.buyerId);
        const hasOnChainOffer = Number.isInteger(offer.onChainOfferId);

        try {
          if (hasOnChainOffer) {
            if (walletSeller && walletBuyer) {
              // MetaMask-assisted flow: the buyer signs purchaseEnergy in their wallet,
              // then POST /transactions/confirm-purchase settles it with the seller key.
              await MatchLog.create({ ...log, status: "skipped", reason: "awaiting buyer MetaMask purchase" });
              results.push({ status: "pending", offerId: offer._id, requestId: tradeRequest._id });
              continue;
            }
            // Non-wallet buyer: fall through to backend-assisted on-chain settlement
          }

          // The contract only accepts whole kWh, so only matches of 1 kWh or
          // more can be settled on-chain. Smaller remainders are skipped.
          const onChainKWh = Math.floor(kWhMatched);
          if (onChainKWh < 1) {
            await MatchLog.create({ ...log, status: "skipped", reason: "below 1 kWh minimum for on-chain settlement" });
            continue;
          }
          const settlement = await settleMatchOnChain({ offer, kWhTraded: onChainKWh });

          offer.kWhAvailable = Number((offer.kWhAvailable - onChainKWh).toFixed(3));
          offer.status = offer.kWhAvailable > 0.001 ? "open" : "settled";
          offer.onChainOfferId = settlement.onChainOfferId;
          tradeRequest.kWhNeeded = Number((tradeRequest.kWhNeeded - onChainKWh).toFixed(3));
          tradeRequest.status = tradeRequest.kWhNeeded > 0.001 ? "open" : "settled";
          await Promise.all([offer.save(), tradeRequest.save()]);

          const transaction = await Transaction.create({
            offerId: offer._id,
            requestId: tradeRequest._id,
            kWhTraded: onChainKWh,
            totalPrice: Number((onChainKWh * offer.pricePerKWh).toFixed(2)),
            txHash: settlement.txHash,
            purchaseTxHash: settlement.purchaseTxHash,
            onChainTradeId: settlement.tradeId,
            purchaseGasUsed: settlement.purchaseGasUsed,
            purchaseGasPrice: settlement.purchaseGasPrice,
            settlementGasUsed: settlement.settlementGasUsed,
            settlementGasPrice: settlement.settlementGasPrice,
            settledAt: new Date()
          });

          await MatchLog.create({
            ...log,
            status: "success",
            reason: "settled on-chain",
            txHash: transaction.txHash
          });

          results.push({
            status: "success",
            offerId: offer._id,
            requestId: tradeRequest._id,
            txHash: transaction.txHash,
            onChain: true,
            tradeId: settlement.tradeId
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
  } finally {
    matchingInProgress = false;
  }
}
