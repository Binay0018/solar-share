import mongoose from "mongoose";
import "dotenv/config";
import EnergyOffer from "./src/models/EnergyOffer.js";
import TradeRequest from "./src/models/TradeRequest.js";
import MatchLog from "./src/models/MatchLog.js";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000, tlsAllowInvalidCertificates: true });
console.log("Connected to MongoDB\n");

async function cleanup() {
  await EnergyOffer.deleteMany({});
  await TradeRequest.deleteMany({});
  await MatchLog.deleteMany({});
}

async function generateData(offerCount, requestCount) {
  const offers = [];
  const requests = [];
  for (let i = 0; i < offerCount; i++) {
    offers.push({
      sellerId: `seller-${i}`,
      kWhAvailable: Math.floor(Math.random() * 10) + 1,
      pricePerKWh: Math.random() * 5 + 3,
      status: "open",
      createdAt: new Date(Date.now() - Math.random() * 86400000)
    });
  }
  for (let i = 0; i < requestCount; i++) {
    requests.push({
      buyerId: `buyer-${i}`,
      kWhNeeded: Math.floor(Math.random() * 10) + 1,
      maxPricePerKWh: Math.random() * 5 + 5,
      status: "open"
    });
  }
  await EnergyOffer.insertMany(offers);
  await TradeRequest.insertMany(requests);
}

// Measure query performance only (no on-chain settlement)
async function benchmarkQueries(label, offerCount, requestCount) {
  await cleanup();
  await generateData(offerCount, requestCount);

  // Measure indexed query performance
  const startQuery = performance.now();
  const offers = await EnergyOffer.find({ status: "open", kWhAvailable: { $gt: 0 } })
    .sort({ pricePerKWh: 1, createdAt: 1 })
    .limit(50)
    .lean();
  const requests = await TradeRequest.find({ status: "open", kWhNeeded: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .limit(50)
    .lean();
  const queryTime = (performance.now() - startQuery).toFixed(2);

  // Measure matching logic (without on-chain settlement)
  const startMatch = performance.now();
  let matchCount = 0;
  for (const request of requests) {
    let remaining = request.kWhNeeded;
    for (const offer of offers) {
      if (remaining < 1) break;
      if (offer.status !== "open") continue;
      if (offer.sellerId.toLowerCase() === request.buyerId.toLowerCase()) continue;
      if (offer.pricePerKWh <= 0 || offer.pricePerKWh > request.maxPricePerKWh) continue;
      const kWh = Math.min(offer.kWhAvailable, remaining);
      if (kWh < 1) continue;
      remaining -= Math.floor(kWh);
      matchCount++;
    }
  }
  const matchTime = (performance.now() - startMatch).toFixed(2);

  console.log(`${label}:`);
  console.log(`  Query time: ${queryTime}ms (${offers.length} offers, ${requests.length} requests)`);
  console.log(`  Match logic: ${matchTime}ms (${matchCount} matches)`);
  console.log(`  Total: ${(parseFloat(queryTime) + parseFloat(matchTime)).toFixed(2)}ms`);
  console.log("");

  return { label, offerCount, requestCount, queryTime: parseFloat(queryTime), matchTime: parseFloat(matchTime), matches: matchCount };
}

console.log("=== Matching Benchmark (Query Performance) ===\n");

const results = [];
results.push(await benchmarkQueries("1k offers, 100 requests", 1000, 100));
results.push(await benchmarkQueries("10k offers, 100 requests", 10000, 100));

console.log("=== Summary ===");
for (const r of results) {
  console.log(`${r.label}: query=${r.queryTime}ms, match=${r.matchTime}ms, total=${(r.queryTime + r.matchTime).toFixed(2)}ms`);
}

await cleanup();
await mongoose.disconnect();
process.exit(0);
