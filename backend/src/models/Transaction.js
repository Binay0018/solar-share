import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    offerId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyOffer", required: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "TradeRequest", required: true },
    sellerId: { type: String, trim: true },
    buyerId: { type: String, trim: true },
    kWhTraded: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    totalPriceWei: { type: String, trim: true },
    txHash: { type: String, trim: true },
    purchaseTxHash: { type: String, trim: true },
    createOfferTxHash: { type: String, trim: true },
    onChainTradeId: { type: Number, min: 0 },
    purchaseGasUsed: { type: String, trim: true },
    purchaseGasPrice: { type: String, trim: true },
    settlementGasUsed: { type: String, trim: true },
    settlementGasPrice: { type: String, trim: true },
    settledAt: Date
  },
  { timestamps: true }
);

transactionSchema.index({ purchaseTxHash: 1 }, { unique: true, sparse: true });
transactionSchema.index({ onChainTradeId: 1 }, { unique: true, sparse: true });

export default mongoose.model("Transaction", transactionSchema);