import { Router } from "express";
import TradeRequest from "../models/TradeRequest.js";
import { attemptMatches } from "../services/matchingService.js";

const router = Router();

router.get("/", async (request, response, next) => {
  try {
    const filter = request.query.status ? { status: request.query.status } : {};
    return response.json(await TradeRequest.find(filter).sort({ createdAt: 1 }));
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
    if (kWhNeeded <= 0 || maxPricePerKWh < 0) {
      return response.status(400).json({ error: "requested amount must be positive and maximum price cannot be negative" });
    }
    const tradeRequest = await TradeRequest.create({ buyerId, kWhNeeded, maxPricePerKWh });
    return response.status(201).json({ tradeRequest, matching: await attemptMatches() });
  } catch (error) {
    return next(error);
  }
});

export default router;