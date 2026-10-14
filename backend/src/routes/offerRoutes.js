import { Router } from "express";
import EnergyOffer from "../models/EnergyOffer.js";
import { attemptMatches } from "../services/matchingService.js";

const router = Router();

router.get("/", async (request, response, next) => {
  try {
    const filter = {};
    if (request.query.status) filter.status = request.query.status;
    if (request.query.onChain === "true") filter.onChainOfferId = { $exists: true, $ne: null };
    return response.json(await EnergyOffer.find(filter).sort({ createdAt: -1 }));
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    const { sellerId, onChainOfferId, kWhAvailable, pricePerKWh } = request.body;
    if (!sellerId || !Number.isFinite(kWhAvailable) || !Number.isFinite(pricePerKWh)) {
      return response.status(400).json({ error: "sellerId, kWhAvailable, and pricePerKWh are required" });
    }
    if (kWhAvailable <= 0 || pricePerKWh < 0) {
      return response.status(400).json({ error: "offer amount must be positive and price cannot be negative" });
    }
    if (onChainOfferId !== undefined && (!Number.isInteger(onChainOfferId) || onChainOfferId < 0)) {
      return response.status(400).json({ error: "onChainOfferId must be a non-negative integer" });
    }
    const offer = await EnergyOffer.create({ sellerId, onChainOfferId, kWhAvailable, pricePerKWh });
    // Run matching in the background — on-chain settlement takes ~40s per match,
    // and the frontend polls for updates every 10s anyway.
    attemptMatches().catch((error) => console.error("Background matching error:", error.message));
    return response.status(201).json({ offer });
  } catch (error) {
    return next(error);
  }
});

export default router;