import { Router } from "express";
import { isHash, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import Transaction from "../models/Transaction.js";
import EnergyOffer from "../models/EnergyOffer.js";
import TradeRequest from "../models/TradeRequest.js";
import { settlePurchasedTrade, getContractSellerAddress } from "../services/contractService.js";
import { solarShareAbi } from "../services/solarShareAbi.js";

const router = Router();

router.get("/", async (_request, response, next) => {
  try {
    return response.json(await Transaction.find({ txHash: { $regex: /^0x/ } }).sort({ settledAt: -1, createdAt: -1 }).limit(100));
  } catch (error) {
    return next(error);
  }
});

router.post("/confirm-purchase", async (request, response, next) => {
  try {
    const { offerId, requestId, buyerId, purchaseTxHash } = request.body;
    const [offer, tradeRequest] = await Promise.all([EnergyOffer.findById(offerId), TradeRequest.findById(requestId)]);
    if (!offer || !tradeRequest) return response.status(404).json({ error: "offer or trade request not found" });
    if (tradeRequest.buyerId.toLowerCase() !== String(buyerId).toLowerCase()) return response.status(403).json({ error: "buyer does not match the trade request" });
    if (offer.status !== "open" || tradeRequest.status !== "open") return response.status(409).json({ error: "offer or request is no longer open" });

    // Idempotency: check if this purchase was already confirmed
    const existingTx = await Transaction.findOne({ purchaseTxHash });
    if (existingTx) {
      return response.json({ transaction: existingTx, idempotent: true });
    }

    const settlement = await settlePurchasedTrade({ offer, buyerId, purchaseTxHash });
    const kWhTraded = Number(settlement.kWhTraded ?? Math.min(offer.kWhAvailable, tradeRequest.kWhNeeded));
    const totalPrice = Number((kWhTraded * offer.pricePerKWh).toFixed(2));
    offer.kWhAvailable = Number((offer.kWhAvailable - kWhTraded).toFixed(3));
    offer.status = offer.kWhAvailable > 0.001 ? "open" : "settled";
    tradeRequest.kWhNeeded = Number((tradeRequest.kWhNeeded - kWhTraded).toFixed(3));
    tradeRequest.status = tradeRequest.kWhNeeded > 0.001 ? "open" : "settled";
    await Promise.all([offer.save(), tradeRequest.save()]);
    const transaction = await Transaction.create({ offerId, requestId, kWhTraded, totalPrice, ...settlement, settledAt: new Date() });
    return response.status(201).json({ transaction });
  } catch (error) {
    return next(error);
  }
});

router.post("/confirm-settlement", async (request, response, next) => {
  try {
    const { txHash, onChainTradeId } = request.body;
    if (!isHash(txHash) || !Number.isInteger(onChainTradeId)) {
      return response.status(400).json({ error: "txHash and onChainTradeId are required" });
    }

    // Find the transaction record
    const transaction = await Transaction.findOne({ onChainTradeId });
    if (!transaction) {
      return response.status(404).json({ error: "transaction not found" });
    }
    if (transaction.txHash) {
      return response.json({ transaction, idempotent: true });
    }

    // Verify the settlement actually happened on-chain
    const { CONTRACT_ADDRESS, SEPOLIA_RPC_URL } = process.env;
    if (!CONTRACT_ADDRESS || !SEPOLIA_RPC_URL) {
      return response.status(500).json({ error: "contract configuration missing" });
    }

    const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (!receipt) {
      return response.status(404).json({ error: "transaction receipt not found on-chain" });
    }
    if (receipt.status !== "success") {
      return response.status(400).json({ error: "transaction was not successful on-chain" });
    }

    // Verify the receipt contains a TradeSettled event for this trade
    const settledLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()
    );
    if (!settledLog) {
      return response.status(400).json({ error: "no contract event found in receipt" });
    }

    // Update the transaction record
    transaction.txHash = txHash;
    transaction.settledAt = new Date();
    await transaction.save();

    return response.json({ transaction });
  } catch (error) {
    return next(error);
  }
});

export default router;
