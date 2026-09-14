import mongoose from "mongoose";

const proposalSchema = new mongoose.Schema(
  {
    by: { type: String, required: true, trim: true },
    pricePerKWh: { type: Number, required: true, min: 0 },
    action: { type: String, enum: ["propose", "counter", "accept", "reject"], required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const negotiationSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
    buyerId: { type: String, required: true, trim: true },
    sellerId: { type: String, required: true, trim: true },
    proposedPricePerKWh: { type: Number, required: true, min: 0 },
    agreedPricePerKWh: { type: Number, min: 0 },
    status: { type: String, enum: ["pending", "accepted", "rejected", "countered"], default: "pending" },
    history: { type: [proposalSchema], default: [] }
  },
  { timestamps: true }
);

negotiationSchema.index({ offerId: 1, createdAt: -1 });

export default mongoose.model("Negotiation", negotiationSchema);
