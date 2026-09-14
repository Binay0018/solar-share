import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "TradeRequest", required: true },
    kWhTraded: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    txHash: { type: String, trim: true },
    purchaseTxHash: { type: String, trim: true },
    purchaseGasUsed: { type: String, trim: true },
    purchaseGasPrice: { type: String, trim: true },
    settlementGasUsed: { type: String, trim: true },
    settlementGasPrice: { type: String, trim: true },
    settledAt: Date
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);