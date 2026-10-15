import { Router } from "express";
import MatchLog from "../models/MatchLog.js";
import Transaction from "../models/Transaction.js";
import EnergyOffer from "../models/EnergyOffer.js";

export const BASELINE_RATE_PER_KWH = Number(process.env.BASELINE_RATE_PER_KWH);
const router = Router();

router.get("/", async (_request, response, next) => {
  try {
    if (!Number.isFinite(BASELINE_RATE_PER_KWH) || BASELINE_RATE_PER_KWH <= 0) {
      throw new Error("BASELINE_RATE_PER_KWH is not configured");
    }
    const [transactions, matchAttempts, offers] = await Promise.all([
      Transaction.find({ settledAt: { $ne: null } }).populate("offerId").lean(),
      MatchLog.countDocuments({ status: { $in: ["success", "failure"] } }),
      EnergyOffer.find().select("createdAt").lean()
    ]);
    const successfulMatches = await MatchLog.countDocuments({ status: "success" });
    const totalKWh = transactions.reduce((sum, item) => sum + item.kWhTraded, 0);
    const totalP2PValue = transactions.reduce((sum, item) => sum + item.totalPrice, 0);
    const buyerBaseline = totalKWh * BASELINE_RATE_PER_KWH;
    const latencyMs = transactions.length && transactions.every((item) => item.offerId?.createdAt && item.settledAt)
      ? transactions.reduce((sum, item) => sum + Math.max(0, new Date(item.settledAt).getTime() - new Date(item.offerId.createdAt).getTime()), 0) / transactions.length
      : null;
    const gasCost = (gasUsedField, gasPriceField) => transactions.reduce((sum, item) => {
      if (!item[gasUsedField] || !item[gasPriceField]) return sum;
      return sum + BigInt(item[gasUsedField]) * BigInt(item[gasPriceField]);
    }, 0n).toString();
    return response.json({
      baselineRatePerKWh: BASELINE_RATE_PER_KWH,
      transactionCount: transactions.length,
      totalKWhTraded: Number(totalKWh.toFixed(3)),
      buyerSavingsVsBaseline: Number((buyerBaseline - totalP2PValue).toFixed(2)),
      sellerRevenue: Number(totalP2PValue.toFixed(2)),
      matchingSuccessRate: matchAttempts ? Number((successfulMatches / matchAttempts).toFixed(4)) : null,
      matchAttempts,
      successfulMatches,
      averageOfferToSettlementLatencyMs: latencyMs === null ? null : Math.round(latencyMs),
      gas: {
        purchaseEnergyWei: gasCost("purchaseGasUsed", "purchaseGasPrice"),
        settleTradeWei: gasCost("settlementGasUsed", "settlementGasPrice")
      },
      observedOffers: offers.length
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
