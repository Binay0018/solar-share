import { Router } from "express";
import EnergyOffer from "../models/EnergyOffer.js";
import MeterReading from "../models/MeterReading.js";
import { attemptMatches } from "../services/matchingService.js";

const router = Router();
const defaultPricePerKWh = Number(process.env.DEFAULT_OFFER_PRICE);

router.post("/", async (request, response, next) => {
  try {
    const { userId, timestamp, generationKWh, consumptionKWh } = request.body;
    if (!userId || !Number.isFinite(generationKWh) || !Number.isFinite(consumptionKWh)) {
      return response.status(400).json({ error: "userId, generationKWh, and consumptionKWh are required" });
    }
    if (generationKWh < 0 || consumptionKWh < 0) {
      return response.status(400).json({ error: "generationKWh and consumptionKWh cannot be negative" });
    }
    if (!Number.isFinite(defaultPricePerKWh) || defaultPricePerKWh <= 0) {
      return response.status(503).json({ error: "DEFAULT_OFFER_PRICE is not configured on the backend" });
    }

    const surplusKWh = Number((generationKWh - consumptionKWh).toFixed(3));
    const reading = await MeterReading.create({
      userId,
      timestamp: timestamp ?? new Date(),
      generationKWh,
      consumptionKWh,
      surplusKWh
    });
    let offer = null;
    if (surplusKWh > 0) {
      offer = await EnergyOffer.create({
        sellerId: userId,
        kWhAvailable: surplusKWh,
        pricePerKWh: defaultPricePerKWh
      });
    }
    const matching = offer ? await attemptMatches() : { attempted: 0, results: [] };
    return response.status(201).json({ reading, offer, matching });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (_request, response, next) => {
  try {
    const readings = await MeterReading.find().sort({ timestamp: -1 }).limit(100);
    return response.json(readings);
  } catch (error) {
    return next(error);
  }
});

export default router;