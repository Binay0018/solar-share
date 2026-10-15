import assert from "node:assert/strict";
import test from "node:test";
import { ineligibleReason, planFills, weiToRupees } from "./matchingEngine.js";

const BUYER = "0x1CA4c8662E32a3a20C550813d04d760E905Fd2B5";
const OTHER_BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x5986b556278c69520D61403c6cb2c3F50D810743";
const OTHER_SELLER = "0x1111111111111111111111111111111111111111";
const context = { configuredBuyer: BUYER, configuredSeller: SELLER };

function offer(overrides = {}) {
  return {
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    sellerId: SELLER,
    onChainOfferId: 1,
    kWhAvailable: 5,
    pricePerKWh: 4,
    status: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides
  };
}

const request = (overrides = {}) => ({ buyerId: BUYER, kWhNeeded: 1, maxPricePerKWh: 10, ...overrides });

test("consumes the cheapest listing first, then the earliest listing at that price", () => {
  const plan = planFills({
    request: request({ kWhNeeded: 9 }),
    offers: [
      offer({ _id: "later-cheap", pricePerKWh: 4, createdAt: new Date("2026-01-02T00:00:00Z"), kWhAvailable: 7 }),
      offer({ _id: "cheapest", pricePerKWh: 2, createdAt: new Date("2026-01-05T00:00:00Z") }),
      offer({ _id: "earlier-cheap", pricePerKWh: 4, createdAt: new Date("2026-01-01T00:00:00Z"), kWhAvailable: 7 })
    ],
    context
  });

  assert.deepEqual(plan.fills.map((fill) => [fill.offerId, fill.kWh]), [["cheapest", 5], ["earlier-cheap", 4]]);
  assert.equal(plan.filledKWh, 9);
  assert.equal(plan.remainingKWh, 0);
});

test("breaks a price and timestamp tie deterministically by listing id", () => {
  const offers = [
    offer({ _id: "zzz", createdAt: new Date("2026-01-01T00:00:00Z") }),
    offer({ _id: "aaa", createdAt: new Date("2026-01-01T00:00:00Z") })
  ];

  const first = planFills({ request: request(), offers, context });
  const reordered = planFills({ request: request(), offers: [...offers].reverse(), context });

  assert.equal(first.fills[0].offerId, "aaa");
  assert.deepEqual(first.fills, reordered.fills);
});

test("skips listings priced above the maximum rate", () => {
  const plan = planFills({
    request: request({ kWhNeeded: 5, maxPricePerKWh: 3 }),
    offers: [offer({ _id: "too-dear", pricePerKWh: 4, kWhAvailable: 5 })],
    context
  });

  assert.equal(plan.fills.length, 0);
  assert.equal(plan.remainingKWh, 5);
  assert.equal(plan.skipped[0].reason, "rate is above the maximum");
});

test("refuses the buyer's own listing", () => {
  assert.equal(ineligibleReason(offer({ sellerId: BUYER, onChainOfferId: 2 }), request(), context), "buyer owns this listing");
});

test("refuses a request that is not the platform buyer wallet", () => {
  assert.equal(ineligibleReason(offer(), request({ buyerId: OTHER_BUYER }), context), "request wallet is not the platform buyer wallet");

  const plan = planFills({ request: request({ kWhNeeded: 5, buyerId: OTHER_BUYER }), offers: [offer()], context });
  assert.equal(plan.fills.length, 0);
});

test("only allows a listing that is not yet on-chain when the configured seller owns it", () => {
  assert.equal(ineligibleReason(offer({ onChainOfferId: undefined, sellerId: OTHER_SELLER }), request(), context), "listing is not published on-chain yet");
  assert.equal(ineligibleReason(offer({ onChainOfferId: undefined, sellerId: SELLER }), request(), context), null);
  assert.equal(ineligibleReason(offer({ onChainOfferId: 12, sellerId: OTHER_SELLER }), request(), context), null);
});

test("takes whole kWh only and reports what is left over", () => {
  const partial = planFills({ request: request({ kWhNeeded: 4 }), offers: [offer({ kWhAvailable: 2.7 })], context });
  assert.equal(partial.fills[0].kWh, 2);
  assert.equal(partial.remainingKWh, 2);
  assert.equal(partial.filledKWh, 2);

  const exact = planFills({ request: request({ kWhNeeded: 3 }), offers: [offer({ kWhAvailable: 10 })], context });
  assert.equal(exact.fills[0].kWh, 3);
  assert.equal(exact.remainingKWh, 0);
});

test("reports the value the contract would actually escrow", () => {
  const plan = planFills({
    request: request({ kWhNeeded: 9 }),
    offers: [
      offer({ _id: "cheap", pricePerKWh: 2, kWhAvailable: 5 }),
      offer({ _id: "dear", pricePerKWh: 4, kWhAvailable: 7 })
    ],
    context
  });

  assert.equal(plan.totalWei, "260000000000");
  assert.equal(plan.totalPrice, 26);
  assert.equal(plan.averageRate, 26 / 9);
});

test("keeps rupee totals exact for rates that do not divide evenly", () => {
  // 3 kWh x Rs 0.333 = Rs 0.999 on-chain. Deriving the value from wei keeps the
  // ledger honest instead of rounding the displayed rate up to Rs 1.00.
  const plan = planFills({ request: request({ kWhNeeded: 3 }), offers: [offer({ pricePerKWh: 0.333 })], context });
  assert.equal(plan.totalWei, "9990000000");
  assert.equal(plan.totalPrice, 0.999);
  assert.equal(weiToRupees(plan.totalWei), 0.999);
});

test("honours the excluded listings a caller has already ruled out", () => {
  const plan = planFills({
    request: request({ kWhNeeded: 5 }),
    offers: [offer({ _id: "first", pricePerKWh: 2, kWhAvailable: 5 }), offer({ _id: "second", pricePerKWh: 3, kWhAvailable: 5 })],
    context,
    excludeOfferIds: ["first"]
  });

  assert.deepEqual(plan.fills.map((fill) => fill.offerId), ["second"]);
});

test("returns an empty plan for a request that is not a positive whole kWh", () => {
  const plan = planFills({ request: request({ kWhNeeded: 0 }), offers: [offer()], context });
  assert.deepEqual(plan.fills, []);
  assert.equal(plan.requestedKWh, 0);
});
