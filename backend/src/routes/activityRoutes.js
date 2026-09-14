import { Router } from "express";
import EnergyOffer from "../models/EnergyOffer.js";
import TradeRequest from "../models/TradeRequest.js";
import Transaction from "../models/Transaction.js";

const router = Router();

router.get("/", async (_request, response, next) => {
  try {
    const [offers, requests, transactions] = await Promise.all([
      EnergyOffer.find().sort({ createdAt: -1 }).limit(20).lean(),
      TradeRequest.find().sort({ createdAt: -1 }).limit(20).lean(),
      Transaction.find().sort({ settledAt: -1, createdAt: -1 }).limit(20).lean()
    ]);
    const activity = [
      ...offers.map((item) => ({ type: "offer", at: item.createdAt, item })),
      ...requests.map((item) => ({ type: "request", at: item.createdAt, item })),
      ...transactions.map((item) => ({ type: "settlement", at: item.settledAt ?? item.createdAt, item }))
    ].sort((left, right) => new Date(right.at) - new Date(left.at)).slice(0, 50);
    return response.json(activity);
  } catch (error) {
    return next(error);
  }
});

export default router;
