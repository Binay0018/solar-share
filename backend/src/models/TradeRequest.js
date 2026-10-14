import mongoose from "mongoose";

const fillSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
    sellerId: { type: String, required: true },
    kWh: { type: Number, required: true, min: 0 },
    pricePerKWh: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "purchased", "settled", "failed"], default: "pending" },
    txHash: { type: String },
    purchaseTxHash: { type: String },
    onChainTradeId: { type: Number },
    failureReason: { type: String }
  },
  { _id: true, timestamps: true }
);

const tradeRequestSchema = new mongoose.Schema(
  {
    buyerId: { type: String, required: true, trim: true },
    kWhNeeded: { type: Number, required: true, min: 0 },
    maxPricePerKWh: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["open", "partially_filled", "filled", "settled", "failed"],
      default: "open"
    },
    fills: { type: [fillSchema], default: [] }
  },
  { timestamps: true }
);

tradeRequestSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("TradeRequest", tradeRequestSchema);
