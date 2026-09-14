import { Router } from "express";
import EnergyOffer from "../models/EnergyOffer.js";
import MatchLog from "../models/MatchLog.js";
import Negotiation from "../models/Negotiation.js";
import { updateOnChainOfferPrice } from "../services/contractService.js";

const router = Router();

function validPrice(value) {
  return Number.isFinite(value) && value > 0;
}

router.post("/offers/:id/negotiate", async (request, response, next) => {
  try {
    const { buyerId, proposedPricePerKWh } = request.body;
    const offer = await EnergyOffer.findById(request.params.id);
    if (!offer) return response.status(404).json({ error: "offer not found" });
    if (offer.status !== "open" || offer.kWhAvailable <= 0) {
      return response.status(409).json({ error: "offer is no longer open" });
    }
    if (!buyerId || buyerId === offer.sellerId) return response.status(400).json({ error: "a different buyerId is required" });
    if (!validPrice(proposedPricePerKWh)) return response.status(400).json({ error: "proposedPricePerKWh must be positive" });

    const negotiation = await Negotiation.create({
      offerId: offer._id,
      buyerId,
      sellerId: offer.sellerId,
      proposedPricePerKWh,
      history: [{ by: buyerId, pricePerKWh: proposedPricePerKWh, action: "propose" }]
    });
    await MatchLog.create({ offerId: offer._id, requestId: negotiation._id, status: "skipped", reason: "negotiation proposed", kWhMatched: 0, totalPrice: 0 });
    return response.status(201).json(negotiation);
  } catch (error) {
    return next(error);
  }
});

router.get("/offers/:id/negotiations", async (request, response, next) => {
  try {
    return response.json(await Negotiation.find({ offerId: request.params.id }).sort({ createdAt: 1 }));
  } catch (error) {
    return next(error);
  }
});

router.post("/negotiations/:id/respond", async (request, response, next) => {
  try {
    const { sellerId, action, pricePerKWh } = request.body;
    const negotiation = await Negotiation.findById(request.params.id);
    if (!negotiation) return response.status(404).json({ error: "negotiation not found" });
    if (sellerId !== negotiation.sellerId) return response.status(403).json({ error: "only the listed seller can respond" });
    if (!["accept", "reject", "counter"].includes(action)) return response.status(400).json({ error: "action must be accept, reject, or counter" });

    const offer = await EnergyOffer.findById(negotiation.offerId);
    if (!offer || offer.status !== "open") return response.status(409).json({ error: "offer is no longer open" });
    const responsePrice = action === "accept" ? negotiation.history.at(-1).pricePerKWh : pricePerKWh;
    if (!validPrice(responsePrice)) return response.status(400).json({ error: "pricePerKWh must be positive for a counter" });

    negotiation.status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "countered";
    negotiation.proposedPricePerKWh = responsePrice;
    if (action === "accept") {
      negotiation.agreedPricePerKWh = responsePrice;
      offer.pricePerKWh = responsePrice;
      if (Number.isInteger(offer.onChainOfferId)) {
        await updateOnChainOfferPrice({ offerId: offer.onChainOfferId, pricePerKWh: responsePrice, sellerId: offer.sellerId });
      }
      await offer.save();
    }
    negotiation.history.push({ by: sellerId, pricePerKWh: responsePrice, action });
    await negotiation.save();
    await MatchLog.create({ offerId: offer._id, requestId: negotiation._id, status: "skipped", reason: `negotiation ${negotiation.status}`, kWhMatched: 0, totalPrice: responsePrice });
    return response.json(negotiation);
  } catch (error) {
    return next(error);
  }
});

export default router;
