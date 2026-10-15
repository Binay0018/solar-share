import { Router } from "express";
import { isAddress } from "viem";
import EnergyOffer from "../models/EnergyOffer.js";
import { attemptMatches } from "../services/matchingService.js";
import { verifyOnChainOffer } from "../services/contractService.js";

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
    if (kWhAvailable <= 0 || pricePerKWh <= 0) {
      return response.status(400).json({ error: "offer amount and price must be positive" });
    }
    if (onChainOfferId !== undefined && (!Number.isInteger(onChainOfferId) || onChainOfferId < 0)) {
      return response.status(400).json({ error: "onChainOfferId must be a non-negative integer" });
    }
    let mirroredKWh = kWhAvailable;
    let status = "open";
    if (onChainOfferId !== undefined) {
      if (!isAddress(sellerId)) {
        return response.status(400).json({ error: "sellerId must be the seller wallet for an on-chain offer" });
      }
      const chainState = await verifyOnChainOffer({ offerId: onChainOfferId, sellerId, pricePerKWh });
      mirroredKWh = chainState.availableKWh;
      status = chainState.status;
    }
    const offer = await EnergyOffer.create({
      sellerId,
      onChainOfferId,
      kWhAvailable: mirroredKWh,
      pricePerKWh,
      status
    });
    // Run matching in the background — on-chain settlement takes ~40s per match,
    // and the frontend polls for updates every 10s anyway.
    attemptMatches().catch((error) => console.error("Background matching error:", error.message));
    return response.status(201).json({ offer });
  } catch (error) {
    return next(error);
  }
});

export default router;