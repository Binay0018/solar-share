import mongoose from "mongoose";

const tradeRequestSchema = new mongoose.Schema(
  {
    buyerId: { type: String, required: true, trim: true },
    kWhNeeded: { type: Number, required: true, min: 0 },
    maxPricePerKWh: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["open", "matched", "settled"], default: "open" }
  },
  { timestamps: true }
);

tradeRequestSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("TradeRequest", tradeRequestSchema);