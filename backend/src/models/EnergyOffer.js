import mongoose from "mongoose";

const energyOfferSchema = new mongoose.Schema(
  {
    sellerId: { type: String, required: true, trim: true },
    onChainOfferId: { type: Number, min: 0 },
    kWhAvailable: { type: Number, required: true, min: 0 },
    pricePerKWh: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["open", "matched", "settled"], default: "open" },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

energyOfferSchema.index({ status: 1, pricePerKWh: 1, createdAt: 1 });
energyOfferSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("EnergyOffer", energyOfferSchema);
