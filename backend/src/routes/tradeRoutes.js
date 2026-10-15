import { Router } from "express";
import { isAddress } from "viem";
import TradeRequest from "../models/TradeRequest.js";
import { attemptMatches, previewMatch } from "../services/matchingService.js";
import { getContractBuyerAddress } from "../services/contractService.js";

const router = Router();

router.get("/", async (request, response, next) => {
  try {
    const filter = request.query.status ? { status: request.query.status } : {};
    return response.json(await TradeRequest.find(filter).sort({ createdAt: 1 }));
  } catch (error) {
    return next(error);
  }
});

// Read-only fill preview. Runs the very same matching engine the background
// matcher uses, so what the buyer sees is exactly what the matcher would buy.
router.post("/preview", async (request, response, next) => {
  try {
    const { buyerId, kWhNeeded, maxPricePerKWh } = request.body;
    if (!isAddress(buyerId) || !Number.isFinite(kWhNeeded) || !Number.isFinite(maxPricePerKWh)) {
      return response.status(400).json({ error: "buyerId, kWhNeeded, and maxPricePerKWh are required" });
    }
    if (!Number.isSafeInteger(kWhNeeded) || kWhNeeded < 1 || maxPricePerKWh <= 0) {
      return response.status(400).json({ error: "requested amount must be a positive whole kWh and maximum price must be positive" });
    }
    return response.json(await previewMatch({ buyerId, kWhNeeded, maxPricePerKWh }));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    const { buyerId, kWhNeeded, maxPricePerKWh } = request.body;
    if (!buyerId || !Number.isFinite(kWhNeeded) || !Number.isFinite(maxPricePerKWh)) {
      return response.status(400).json({ error: "buyerId, kWhNeeded, and maxPricePerKWh are required" });
    }
    if (!Number.isSafeInteger(kWhNeeded) || kWhNeeded < 1 || maxPricePerKWh <= 0) {
      return response.status(400).json({ error: "requested amount must be a positive whole kWh and maximum price must be positive" });
    }
    if (!isAddress(buyerId)) {
      return response.status(400).json({ error: "buyerId must be the configured on-chain buyer wallet address" });
    }
    const configuredBuyer = getContractBuyerAddress();
    if (!configuredBuyer) {
      return response.status(503).json({ error: "BUYER_PRIVATE_KEY is required for backend-assisted matching" });
    }
    if (configuredBuyer.toLowerCase() !== buyerId.toLowerCase()) {
      return response.status(403).json({ error: "buyerId must match the wallet controlled by BUYER_PRIVATE_KEY" });
    }
    const tradeRequest = await TradeRequest.create({ buyerId, kWhNeeded, maxPricePerKWh });
    // Run matching in the background — on-chain settlement takes ~40s per match
    attemptMatches().catch((error) => console.error("Background matching error:", error.message));
    return response.status(201).json({ tradeRequest });
  } catch (error) {
    return next(error);
  }
});

export default router;