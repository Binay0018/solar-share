import { Router } from "express";
import { formatUnits, isAddress, isHash } from "viem";
import Transaction from "../models/Transaction.js";
import EnergyOffer from "../models/EnergyOffer.js";
import TradeRequest from "../models/TradeRequest.js";
import { getOnChainTradeDetails, verifyWalletPurchase, verifyWalletSettlement } from "../services/contractService.js";

const router = Router();

router.get("/", async (_request, response, next) => {
  try {
    const records = await Transaction.find({
      purchaseTxHash: { $regex: /^0x/ },
      onChainTradeId: { $exists: true, $ne: null }
    }).sort({ settledAt: -1, createdAt: -1 }).limit(100).lean();
    const transactions = await Promise.all(records.map(async (record) => {
      if (record.sellerId && record.buyerId && record.totalPriceWei) {
        return { ...record, chainStatus: record.settledAt ? "settled" : "pending" };
      }
      const chainTrade = await getOnChainTradeDetails(record.onChainTradeId);
      await Transaction.updateOne(
        { _id: record._id },
        { $set: {
          sellerId: chainTrade.sellerId,
          buyerId: chainTrade.buyerId,
          totalPriceWei: chainTrade.totalPriceWei,
          kWhTraded: chainTrade.kWhTraded
        } }
      );
      return { ...record, ...chainTrade, chainStatus: chainTrade.status };
    }));
    return response.json(transactions);
  } catch (error) {
    return next(error);
  }
});

router.post("/confirm-purchase", async (request, response, next) => {
  try {
    const { offerId, buyerId, purchaseTxHash } = request.body;
    if (!isAddress(buyerId) || !isHash(purchaseTxHash)) {
      return response.status(400).json({ error: "buyerId must be a wallet address and purchaseTxHash must be a transaction hash" });
    }

    const existingTx = await Transaction.findOne({ purchaseTxHash });
    if (existingTx) return response.json({ transaction: existingTx, idempotent: true });

    const offer = await EnergyOffer.findById(offerId);
    if (!offer) return response.status(404).json({ error: "offer not found" });
    if (!Number.isSafeInteger(offer.onChainOfferId) || !isAddress(offer.sellerId)) {
      return response.status(400).json({ error: "offer is not linked to an on-chain seller and offer ID" });
    }

    const purchase = await verifyWalletPurchase({ offer, buyerId, purchaseTxHash });
    const pricePerKWh = Number(formatUnits(purchase.pricePerKWhWei, 10));
    const totalPrice = Number(formatUnits(BigInt(purchase.totalPriceWei), 10));
    const tradeRequest = await TradeRequest.create({
      buyerId,
      kWhNeeded: 0,
      maxPricePerKWh: pricePerKWh,
      status: "filled",
      fills: [{
        offerId: offer._id,
        sellerId: purchase.sellerId,
        kWh: purchase.kWhTraded,
        pricePerKWh,
        status: "purchased",
        purchaseTxHash,
        onChainTradeId: purchase.tradeId
      }]
    });

    offer.kWhAvailable = purchase.availableKWh;
    offer.pricePerKWh = pricePerKWh;
    offer.status = purchase.availableKWh > 0 ? "open" : "settled";
    await offer.save();

    const transaction = await Transaction.create({
      offerId: offer._id,
      requestId: tradeRequest._id,
      sellerId: purchase.sellerId,
      buyerId: purchase.buyerId,
      kWhTraded: purchase.kWhTraded,
      totalPrice,
      totalPriceWei: purchase.totalPriceWei,
      purchaseTxHash,
      onChainTradeId: purchase.tradeId,
      purchaseGasUsed: purchase.purchaseGasUsed,
      purchaseGasPrice: purchase.purchaseGasPrice,
      settledAt: null
    });
    return response.status(201).json({ transaction });
  } catch (error) {
    if (error.code === 11000 && request.body.purchaseTxHash) {
      const existingTx = await Transaction.findOne({ purchaseTxHash: request.body.purchaseTxHash });
      if (existingTx) return response.json({ transaction: existingTx, idempotent: true });
    }
    return next(error);
  }
});

router.post("/confirm-settlement", async (request, response, next) => {
  try {
    const { txHash, onChainTradeId } = request.body;
    if (!isHash(txHash) || !Number.isSafeInteger(onChainTradeId) || onChainTradeId < 0) {
      return response.status(400).json({ error: "txHash and a non-negative onChainTradeId are required" });
    }

    const transaction = await Transaction.findOne({ onChainTradeId });
    if (!transaction) return response.status(404).json({ error: "pending transaction not found" });
    if (transaction.txHash) {
      if (transaction.txHash !== txHash) return response.status(409).json({ error: "trade was already settled by a different transaction" });
      return response.json({ transaction, idempotent: true });
    }

    const settlement = await verifyWalletSettlement({ transaction, txHash });
    transaction.txHash = settlement.txHash;
    transaction.settlementGasUsed = settlement.gasUsed;
    transaction.settlementGasPrice = settlement.effectiveGasPrice;
    transaction.settledAt = new Date();
    await transaction.save();

    await TradeRequest.updateOne(
      { _id: transaction.requestId, "fills.onChainTradeId": onChainTradeId },
      { $set: { "fills.$.status": "settled", "fills.$.txHash": txHash } }
    );

    return response.json({ transaction });
  } catch (error) {
    return next(error);
  }
});

export default router;
