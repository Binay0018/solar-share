import mongoose from "mongoose";

const meterReadingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true },
    generationKWh: { type: Number, required: true, min: 0 },
    consumptionKWh: { type: Number, required: true, min: 0 },
    surplusKWh: { type: Number, required: true }
  },
  { timestamps: true }
);

meterReadingSchema.index({ userId: 1, timestamp: -1 });

export default mongoose.model("MeterReading", meterReadingSchema);