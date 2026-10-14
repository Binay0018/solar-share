import mongoose from "mongoose";

const matchingStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "singleton" },
    lastMatchingRun: { type: Date },
    isRunning: { type: Boolean, default: false },
    startedAt: { type: Date },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model("MatchingState", matchingStateSchema);
