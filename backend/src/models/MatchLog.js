import mongoose from "mongoose";

const matchLogSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "TradeRequest", required: true },
    status: { type: String, enum: ["success", "failure", "skipped"], required: true },
    reason: { type: String, required: true },
    kWhMatched: { type: Number, min: 0 },
    totalPrice: { type: Number, min: 0 },
    txHash: String,
    attemptedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

matchLogSchema.index({ attemptedAt: -1 });

export default mongoose.model("MatchLog", matchLogSchema);