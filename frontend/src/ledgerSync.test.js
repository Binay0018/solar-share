import test from "node:test";
import assert from "node:assert/strict";

import {
  PENDING_SETTLEMENT_PREFIX,
  clearPendingSettlementTx,
  pendingSettlementKey,
  postSettlementToLedger,
  readPendingSettlementTx,
  rememberPendingSettlementTx,
  syncLedgerForTrade
} from "./ledgerSync.js";

/* ---------------------------------------------------------------------------
   Ledger synchronisation of a settlement the contract already performed.

   Nothing here signs or sends a transaction: the seller's own wallet signed
   settleTrade earlier, and the existing backend endpoint records the receipt
   after verifying it. These tests lock down that only a real transaction hash
   is ever sent, that the backend's refusal is surfaced as a failure, and that a
   failed sync stays retryable (including after a page refresh).
   --------------------------------------------------------------------------- */

const HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
const SELLER = "0x5986b556278c69520D61403c6cb2c3F50D810743";

const TRADE = {
  _id: "tx-59",
  onChainTradeId: 59,
  purchaseTxHash: `0x${"ef".repeat(32)}`,
  sellerId: SELLER,
  settledAt: null
};

function memoryStore(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    has: (key) => entries.has(key)
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function recordingFetch(result, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return result;
  };
}

test("ledger sync: the confirmed settlement hash is remembered per trade", () => {
  const store = memoryStore();
  assert.equal(pendingSettlementKey(59), `${PENDING_SETTLEMENT_PREFIX}59`);
  assert.equal(readPendingSettlementTx(59, store), null);

  rememberPendingSettlementTx(59, HASH, store);
  assert.equal(readPendingSettlementTx(59, store), HASH, "the hash survives a page refresh");
  assert.equal(readPendingSettlementTx(58, store), null, "another trade is unaffected");

  clearPendingSettlementTx(59, store);
  assert.equal(readPendingSettlementTx(59, store), null);
});

test("ledger sync: anything that is not a transaction hash is ignored", () => {
  const store = memoryStore({
    [pendingSettlementKey(59)]: "not-a-hash",
    [pendingSettlementKey(58)]: "0x1234",
    [pendingSettlementKey(57)]: HASH
  });
  assert.equal(readPendingSettlementTx(59, store), null);
  assert.equal(readPendingSettlementTx(58, store), null);
  assert.equal(readPendingSettlementTx(57, store), HASH);

  rememberPendingSettlementTx(59, "0xzz", store);
  assert.equal(readPendingSettlementTx(59, store), null, "an invalid hash is never stored");

  // A missing storage (for example a blocked localStorage) must not throw.
  assert.equal(readPendingSettlementTx(59, null), null);
  assert.doesNotThrow(() => rememberPendingSettlementTx(59, HASH, null));
  assert.doesNotThrow(() => clearPendingSettlementTx(59, null));
});

test("ledger sync: the settlement hash is posted to the existing confirm-settlement endpoint", async () => {
  const calls = [];
  const payload = { transaction: { _id: "tx-59", settledAt: "2026-10-16T00:00:00.000Z" } };
  const baseUrl = "http://localhost:3000";

  const result = await postSettlementToLedger(TRADE, HASH, { fetchImpl: recordingFetch(jsonResponse(200, payload), calls), baseUrl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}/transactions/confirm-settlement`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).txHash, HASH);
  assert.equal(JSON.parse(calls[0].options.body).onChainTradeId, 59);
  assert.deepEqual(result, payload);
});

test("ledger sync: a refusal is reported as a failure and never as a settlement", async () => {
  const store = memoryStore();
  rememberPendingSettlementTx(59, HASH, store);
  const calls = [];
  const fetchImpl = recordingFetch(jsonResponse(500, { error: "settlement transaction seller does not match" }), calls);

  await assert.rejects(
    () => syncLedgerForTrade(TRADE, { findOnChain: async () => OTHER_HASH, store, fetchImpl, baseUrl: "http://localhost:3000" }),
    /settlement transaction seller does not match/
  );
  assert.equal(calls.length, 1, "the refusal still came from the real endpoint");
  assert.equal(readPendingSettlementTx(59, store), HASH, "the hash is kept so the retry works after a refresh");
});

test("ledger sync: the hash this browser already signed is used before querying the chain", async () => {
  const store = memoryStore();
  rememberPendingSettlementTx(59, HASH, store);
  const calls = [];
  let chainLookups = 0;

  const { txHash } = await syncLedgerForTrade(TRADE, {
    findOnChain: async () => {
      chainLookups += 1;
      return OTHER_HASH;
    },
    store,
    fetchImpl: recordingFetch(jsonResponse(200, { transaction: {} }), calls),
    baseUrl: "http://localhost:3000"
  });

  assert.equal(chainLookups, 0, "no chain lookup is needed when the hash is known");
  assert.equal(txHash, HASH);
  assert.equal(JSON.parse(calls[0].options.body).txHash, HASH);
  assert.equal(readPendingSettlementTx(59, store), null, "a recorded settlement clears the pending hash");
});

test("ledger sync: without a remembered hash the chain is searched with the purchase as a hint", async () => {
  const store = memoryStore();
  const calls = [];
  const seen = [];

  const { txHash } = await syncLedgerForTrade(TRADE, {
    findOnChain: async (tradeId, options) => {
      seen.push([tradeId, options]);
      return HASH;
    },
    store,
    fetchImpl: recordingFetch(jsonResponse(200, { transaction: {} }), calls),
    baseUrl: "http://localhost:3000"
  });

  assert.deepEqual(seen, [[59, { purchaseTxHash: TRADE.purchaseTxHash }]]);
  assert.equal(txHash, HASH);
});

test("ledger sync: no settlement transaction means an error and no request", async () => {
  const store = memoryStore();
  const calls = [];

  await assert.rejects(
    () => syncLedgerForTrade(TRADE, { findOnChain: async () => null, store, fetchImpl: recordingFetch(jsonResponse(200, {}), calls) }),
    /could not be found on Sepolia/
  );
  assert.equal(calls.length, 0, "nothing is posted when there is no settlement to record");

  await assert.rejects(
    () => syncLedgerForTrade({ onChainTradeId: undefined }, { findOnChain: async () => HASH, store }),
    /no on-chain trade ID/
  );
});
