import test from "node:test";
import assert from "node:assert/strict";

import {
  ZERO_ADDRESS,
  canSettlePurchase,
  isDirectPurchase,
  normalizeAddress,
  normalizeChainTrade,
  selectBuyerEscrowed,
  selectDirectPurchases,
  selectSellerPendingPurchases,
  selectSellerSettledPurchases,
  selectSellerTransactions
} from "./purchaseQueue.js";

/* Fixtures mirror the shapes the backend really returns (`GET /transactions`
   and `GET /trades`), including the mixed-case seller address that is stored in
   the live database. */

const SELLER = "0x5986b556278c69520D61403c6cb2c3F50D810743";
const SELLER_LOWER = SELLER.toLowerCase();
const BUYER = "0x1CA4c8662E32a3a20C550813d04d760E905Fd2B5";
const OTHER = "0x1111111111111111111111111111111111111111";

const TX = {
  purchaseTxHash: "0xa81d85ff0000000000000000000000000000000000000000000000000000000001",
  txHash: undefined
};

function pendingTrade(overrides = {}) {
  return {
    _id: "tx-pending",
    requestId: "req-direct",
    offerId: "offer-1",
    sellerId: SELLER,
    buyerId: BUYER,
    kWhTraded: 4,
    totalPrice: 28,
    ...TX,
    onChainTradeId: 54,
    settledAt: null,
    chainStatus: "pending",
    ...overrides
  };
}

const DIRECT_REQUEST = {
  _id: "req-direct",
  buyerId: BUYER,
  kWhNeeded: 0,
  maxPricePerKWh: 7,
  status: "filled",
  fills: [
    {
      _id: "fill-direct",
      offerId: "offer-1",
      sellerId: SELLER,
      kWh: 4,
      pricePerKWh: 7,
      status: "purchased",
      purchaseTxHash: TX.purchaseTxHash,
      onChainTradeId: 54
    }
  ]
};

const MATCHED_REQUEST = {
  _id: "req-matched",
  buyerId: BUYER,
  kWhNeeded: 0,
  maxPricePerKWh: 34,
  status: "filled",
  fills: [
    { _id: "f1", sellerId: SELLER, kWh: 5, pricePerKWh: 5, status: "awaiting_seller", onChainTradeId: 52 },
    { _id: "f2", sellerId: SELLER, kWh: 2, pricePerKWh: 8, status: "awaiting_seller", onChainTradeId: 53 },
    { _id: "f3", sellerId: SELLER, kWh: 7, pricePerKWh: 1, status: "awaiting_seller", onChainTradeId: 51 }
  ]
};

test("1. a confirmed purchase awaiting settlement appears in the seller's incoming list", () => {
  const queue = selectSellerPendingPurchases([pendingTrade()], SELLER);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].onChainTradeId, 54);
  assert.equal(queue[0].kWhTraded, 4);
  assert.equal(queue[0].totalPrice, 28);
  assert.equal(queue[0].buyerId, BUYER);
  assert.equal(queue[0].purchaseTxHash, TX.purchaseTxHash);
});

test("2. the correct pending purchase offers a Settle control to its seller only", () => {
  const trade = pendingTrade();
  assert.equal(canSettlePurchase(trade, SELLER), true);
  assert.equal(canSettlePurchase(trade, BUYER), false, "the buyer must never get a settlement control");
  assert.equal(canSettlePurchase(trade, OTHER), false, "another seller must never get a settlement control");
  assert.equal(canSettlePurchase(trade, ""), false, "no connected wallet means no settlement control");
});

test("3. a buyer's purchase panel never mixes in another wallet's purchases", () => {
  const rows = selectDirectPurchases([pendingTrade()], [DIRECT_REQUEST], BUYER);
  assert.equal(rows.length, 1);
  assert.equal(selectDirectPurchases([pendingTrade()], [DIRECT_REQUEST], OTHER).length, 0);
  assert.equal(selectDirectPurchases([pendingTrade()], [DIRECT_REQUEST], "").length, 0);
});

test("4. a different seller sees neither the purchase nor its settlement control", () => {
  const trade = pendingTrade();
  assert.equal(selectSellerTransactions([trade], OTHER).length, 0);
  assert.equal(selectSellerPendingPurchases([trade], OTHER).length, 0);
  assert.equal(selectSellerSettledPurchases([trade], OTHER).length, 0);
  assert.equal(canSettlePurchase(trade, OTHER), false);
});

test("5. wallet-address capitalization never changes the result", () => {
  assert.equal(normalizeAddress(SELLER), SELLER_LOWER);
  const mixed = pendingTrade({ sellerId: SELLER_LOWER });
  assert.equal(selectSellerPendingPurchases([mixed], SELLER).length, 1);
  assert.equal(selectSellerPendingPurchases([pendingTrade()], SELLER_LOWER).length, 1);
  assert.equal(canSettlePurchase(mixed, SELLER), true);
  assert.equal(selectDirectPurchases([pendingTrade({ buyerId: BUYER })], [DIRECT_REQUEST], BUYER.toLowerCase()).length, 1);
  // The original casing is preserved for display and for the contract call.
  assert.equal(selectSellerPendingPurchases([pendingTrade()], SELLER)[0].sellerId, SELLER);
});

test("6. a settled trade is never shown as pending", () => {
  const settledReceipt = pendingTrade({ _id: "tx-settled", settledAt: "2026-10-15T15:34:21.194Z", chainStatus: "settled" });
  const settledOnChain = pendingTrade({ _id: "tx-chain-settled", onChainTradeId: 50, settledAt: null, chainStatus: "settled" });
  const stillPending = pendingTrade({ _id: "tx-pending" });

  // Neither a recorded receipt nor a chain-settled trade may stay in the pending queue…
  assert.equal(selectSellerPendingPurchases([settledReceipt], SELLER).length, 0);
  assert.equal(selectSellerPendingPurchases([settledOnChain], SELLER).length, 0);
  assert.equal(selectSellerPendingPurchases([settledReceipt, settledOnChain, stillPending], SELLER).length, 1);
  // …and neither may offer a Settle control.
  assert.equal(canSettlePurchase(settledReceipt, SELLER), false);
  assert.equal(canSettlePurchase(settledOnChain, SELLER), false);

  // The earnings history stays driven by the recorded settlement receipt, as before.
  const earnings = selectSellerSettledPurchases([settledReceipt, settledOnChain, stillPending], SELLER);
  assert.deepEqual(earnings.map((row) => row._id), ["tx-settled"]);
});

test("7. a failed or unconfirmed purchase is not shown as a confirmed purchase", () => {
  const failedRequest = {
    _id: "req-failed",
    buyerId: BUYER,
    kWhNeeded: 0,
    maxPricePerKWh: 5,
    status: "failed",
    fills: [{ _id: "f", kWh: 5, pricePerKWh: 5, status: "failed", onChainTradeId: null }]
  };
  // A failed fill has no confirmed transaction, so it is not a direct purchase…
  assert.equal(isDirectPurchase({ requestId: "req-failed", onChainTradeId: null }, new Map([["req-failed", failedRequest]])), false);
  assert.equal(selectDirectPurchases([], [failedRequest], BUYER).length, 0);
  // …and it never reaches the seller queue either, because that queue is built
  // only from transactions the backend created after verifying a receipt.
  assert.equal(selectSellerPendingPurchases([], SELLER).length, 0);
});

test("8. reopening or refreshing the seller page simply re-reads the latest records", () => {
  const first = [pendingTrade()];
  assert.equal(selectSellerPendingPurchases(first, SELLER).length, 1);

  const afterRefresh = [...first, pendingTrade({ _id: "tx-new", onChainTradeId: 56, requestId: "req-new", kWhTraded: 6, totalPrice: 42 })];
  const queue = selectSellerPendingPurchases(afterRefresh, SELLER);
  assert.equal(queue.length, 2, "a purchase confirmed after the last load must appear on the next refresh");
  assert.equal(queue[queue.length - 1].onChainTradeId, 56);
});

test("9. a missing transaction hash or trade id is handled safely", () => {
  // No trade id: the row stays visible and honest, but nothing settleable is offered.
  const noTradeId = pendingTrade({ onChainTradeId: undefined, purchaseTxHash: undefined });
  const queue = selectSellerPendingPurchases([noTradeId], SELLER);
  assert.equal(queue.length, 1, "the purchase itself must not be hidden");
  assert.equal(canSettlePurchase(noTradeId, SELLER), false, "without a trade id there is nothing safe to settle");

  // A transaction whose request or fill can no longer be found is simply not a direct purchase.
  assert.equal(isDirectPurchase({ requestId: "missing" }, new Map()), false);
  assert.equal(isDirectPurchase({}, new Map([["req-direct", DIRECT_REQUEST]])), false);
  assert.equal(isDirectPurchase({ requestId: "req-direct" }, new Map([["req-direct", { fills: [] }]])), false);
  assert.equal(isDirectPurchase(pendingTrade(), undefined), false);
});

test("10. the existing matched-purchase flow keeps working", () => {
  const matched = pendingTrade({ _id: "tx-matched", requestId: "req-matched", onChainTradeId: 52, kWhTraded: 5, totalPrice: 25 });
  assert.equal(selectSellerPendingPurchases([matched], SELLER).length, 1);
  assert.equal(canSettlePurchase(matched, SELLER), true);

  const escrowed = selectBuyerEscrowed([matched], BUYER);
  assert.equal(escrowed.length, 1);
  assert.equal(selectBuyerEscrowed([pendingTrade({ settledAt: "2026-10-15T15:34:21.194Z" })], BUYER).length, 0);
});

test("a matched fill is not mistaken for a direct purchase (live-data regression)", () => {
  const requests = [DIRECT_REQUEST, MATCHED_REQUEST];
  const byId = new Map(requests.map((request) => [request._id, request]));

  assert.equal(isDirectPurchase({ requestId: "req-direct", onChainTradeId: 54 }, byId), true);
  assert.equal(isDirectPurchase({ requestId: "req-matched", onChainTradeId: 52 }, byId), false);
  assert.equal(isDirectPurchase({ requestId: "req-matched", onChainTradeId: 51 }, byId), false);

  // The real live rows measured on 16 Oct 2026: the five buyer-signed purchases
  // are recognised, and none of the matched fills are (their rate is below the cap).
  const live = [
    ["req-direct", 54, 1, 0, 7, 7, "purchased", true],
    ["req-direct", 55, 1, 0, 14, 14, "purchased", true],
    ["req-direct", 50, 1, 0, 7, 7, "settled", true],
    ["req-direct", 46, 1, 0, 8, 8, "purchased", true],
    ["req-direct", 45, 1, 0, 2, 2, "purchased", true],
    ["req-matched", 53, 3, 0, 34, 8, "awaiting_seller", false],
    ["req-matched", 52, 3, 0, 34, 5, "awaiting_seller", false],
    ["req-matched", 51, 3, 0, 34, 1, "awaiting_seller", false],
    ["req-matched", 48, 1, 0, 6, 4, "awaiting_seller", false],
    ["req-matched", 37, 1, 0, 7.01, 6, "awaiting_seller", false],
    ["req-matched", 29, 1, 0, 6, 5, "awaiting_seller", false]
  ];
  for (const [requestId, tradeId, fillCount, kWhNeeded, maxPrice, fillPrice, fillStatus, expected] of live) {
    const request = {
      _id: requestId,
      buyerId: BUYER,
      kWhNeeded,
      maxPricePerKWh: maxPrice,
      status: "filled",
      fills: Array.from({ length: fillCount }, (_, index) => ({
        pricePerKWh: index === 0 ? fillPrice : fillPrice + index,
        status: fillStatus,
        onChainTradeId: index === 0 ? tradeId : tradeId + index
      }))
    };
    const actual = isDirectPurchase({ requestId, onChainTradeId: tradeId }, new Map([[requestId, request]]));
    assert.equal(actual, expected, `trade ${tradeId} direct purchase should be ${expected}`);
  }
});

/* ---------------------------------------------------------------------------
   On-chain trade state (`trades(id)`), used by the Settle control so a seller is
   never offered a settlement the contract must reject.
   --------------------------------------------------------------------------- */

function chainTradeTuple(tradeId, status, overrides = {}) {
  return [
    BigInt(tradeId), BigInt(10), overrides.seller ?? SELLER, overrides.buyer ?? BUYER,
    BigInt(overrides.kWhTraded ?? 4), BigInt(overrides.totalPriceWei ?? 28n), status
  ];
}

test("11. the contract's trade status is read exactly: 1 means settled, 0 means pending", () => {
  const settled = normalizeChainTrade(chainTradeTuple(57, 1));
  assert.equal(settled.exists, true);
  assert.equal(settled.settledOnChain, true);
  assert.equal(settled.id, 57);
  assert.equal(settled.offerId, 10);
  assert.equal(settled.kWhTraded, 4);
  assert.equal(settled.seller, SELLER);

  const pending = normalizeChainTrade(chainTradeTuple(55, 0));
  assert.equal(pending.exists, true);
  assert.equal(pending.settledOnChain, false);
  // A bigint status (as some RPC decoders return) is handled too.
  assert.equal(normalizeChainTrade(chainTradeTuple(55, 1n)).settledOnChain, true);
});

test("12. a trade the contract does not know is never reported as settled", () => {
  const zeroes = [0n, 0n, ZERO_ADDRESS, ZERO_ADDRESS, 0n, 0n, 0n];
  const missing = normalizeChainTrade(zeroes);
  assert.equal(missing.exists, false);
  assert.equal(missing.settledOnChain, false);
  // Missing data must not be turned into a settled state either.
  assert.equal(normalizeChainTrade(undefined).settledOnChain, false);
  assert.equal(normalizeChainTrade([]).exists, false);
});

test("13. live Sepolia regression: the six trades settled on-chain while the ledger still says pending", () => {
  // `eth_call trades(id)` on 0xd5332E490e251813702bf461CAfED84FF3d0319C returned
  // status 1 (Settled) for these ids and status 0 for the ids below.
  const settledOnChain = [33, 35, 52, 53, 58, 59];
  const stillPending = [29, 30, 31, 37, 38, 39, 42, 44, 45, 46, 48, 51, 54, 55];
  for (const id of settledOnChain) {
    assert.equal(normalizeChainTrade(chainTradeTuple(id, 1)).settledOnChain, true, `trade ${id} is settled on-chain`);
  }
  for (const id of stillPending) {
    assert.equal(normalizeChainTrade(chainTradeTuple(id, 0)).settledOnChain, false, `trade ${id} is still pending on-chain`);
  }
});

test("14. the seller on the chain trade is compared with case-insensitive addresses", () => {
  const lower = normalizeChainTrade(chainTradeTuple(57, 1, { seller: SELLER_LOWER }));
  assert.equal(normalizeChainTrade(chainTradeTuple(57, 1, { seller: SELLER_LOWER })).seller, SELLER_LOWER);
  assert.equal(normalizeAddress(lower.seller), SELLER_LOWER);
  // Only the row's own seller may treat a chain-settled trade as settled.
  assert.equal(normalizeAddress(lower.seller) === normalizeAddress(SELLER), true);
  assert.equal(normalizeAddress(lower.seller) === normalizeAddress(OTHER), false);
});
