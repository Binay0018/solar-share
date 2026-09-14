import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ["prosumer", "consumer", "both"], required: true },
    name: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

userSchema.index({ walletAddress: 1 }, { unique: true, sparse: true });

export default mongoose.model("User", userSchema);