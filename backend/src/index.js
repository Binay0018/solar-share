import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import "./env.js";
import meterReadingRoutes from "./routes/meterReadingRoutes.js";
import offerRoutes from "./routes/offerRoutes.js";
import tradeRoutes from "./routes/tradeRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";

import activityRoutes from "./routes/activityRoutes.js";
import metricsRoutes from "./routes/metricsRoutes.js";

dotenv.config();

// Disable buffering so DB errors surface immediately instead of timing out silently
mongoose.set("bufferCommands", false);

export const app = express();
const port = Number(process.env.PORT ?? 3000);
const mongoUri = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  const databaseState = mongoose.connection.readyState;
  response.json({
    service: "solarshare-backend",
    status: "ok",
    database: databaseState === 1 ? "connected" : databaseState === 2 ? "connecting" : "disconnected"
  });
});

app.use(
  ["/meter-readings", "/offers", "/trades", "/transactions", "/activity", "/metrics"],
  (_request, response, next) => {
    if (mongoose.connection.readyState === 1) return next();
    return response.status(503).json({
      error: "Database is not connected yet; retry this request when the database is ready",
      database: mongoose.connection.readyState === 2 ? "connecting" : "disconnected"
    });
  }
);

app.use("/meter-readings", meterReadingRoutes);
app.use("/offers", offerRoutes);
app.use("/trades", tradeRoutes);
app.use("/transactions", transactionRoutes);

app.use("/activity", activityRoutes);
app.use("/metrics", metricsRoutes);

app.use((error, _request, response, _next) => {
  console.error("Backend Route Error:", error);
  response.status(500).json({ error: error?.message || "Internal server error" });
});

export async function start() {
  // Start HTTP server immediately so the port is available right away
  const server = app.listen(port, () => {
    console.log(`SolarShare backend listening on port ${port}`);
  });

  // Connect to MongoDB in the background (non-blocking)
  if (mongoUri) {
    mongoose
      .connect(mongoUri, {
        serverSelectionTimeoutMS: 15000,
        tlsAllowInvalidCertificates: true,
      })
      .then(() => console.log("Connected to MongoDB"))
      .catch((err) => console.error("MongoDB connection failed:", err.message));
  } else {
    console.warn("MONGODB_URI is not configured; database routes require MongoDB");
  }

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start();
}
