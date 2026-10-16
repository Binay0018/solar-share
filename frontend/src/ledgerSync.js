/* ---------------------------------------------------------------------------
   Ledger synchronisation for settlements that already happened on-chain.

   The seller's own MetaMask wallet signs settleTrade; this module only records
   the resulting receipt in the marketplace ledger through the existing
   `POST /transactions/confirm-settlement` endpoint, which re-verifies the
   receipt (contract event, seller and trade status) before it writes anything.
   Nothing here signs, sends, simulates or retries a transaction, and a failure
   is always reported as a failure.
   --------------------------------------------------------------------------- */

/** Where a confirmed settlement transaction is remembered until the ledger accepts it. */
export const PENDING_SETTLEMENT_PREFIX = "solarshare:settlementTx:";

export function apiBase() {
  return import.meta.env?.VITE_API_URL ?? "http://localhost:3000";
}

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function pendingSettlementKey(tradeId) {
  return `${PENDING_SETTLEMENT_PREFIX}${tradeId}`;
}

/** A settlement transaction hash this browser already signed for the trade, if any. */
export function readPendingSettlementTx(tradeId, store = defaultStore()) {
  if (!store || !Number.isSafeInteger(tradeId)) return null;
  const value = store.getItem(pendingSettlementKey(tradeId));
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

export function rememberPendingSettlementTx(tradeId, txHash, store = defaultStore()) {
  if (!store || !Number.isSafeInteger(tradeId)) return;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return;
  store.setItem(pendingSettlementKey(tradeId), txHash);
}

export function clearPendingSettlementTx(tradeId, store = defaultStore()) {
  if (!store || !Number.isSafeInteger(tradeId)) return;
  store.removeItem(pendingSettlementKey(tradeId));
}

/**
 * Record one already-signed settlement in the marketplace ledger. The backend
 * re-verifies the receipt and decides whether the trade really settled, so this
 * function never reports success on its own; a refusal is thrown with the
 * backend's own message.
 */
export async function postSettlementToLedger(trade, txHash, { fetchImpl = globalThis.fetch, baseUrl = apiBase() } = {}) {
  const response = await fetchImpl(`${baseUrl}/transactions/confirm-settlement`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash, onChainTradeId: trade?.onChainTradeId })
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `The marketplace ledger refused the settlement (HTTP ${response.status})`);
  }
  return payload;
}

/**
 * Synchronise one chain-settled trade with the ledger:
 *   1. reuse the settlement transaction this browser signed, if it still knows it;
 *   2. otherwise locate the contract's TradeSettled transaction for this trade.
 * The existing backend endpoint then records it after verifying the receipt.
 * Nothing is signed or sent.
 */
export async function syncLedgerForTrade(trade, { findOnChain, store = defaultStore(), fetchImpl = globalThis.fetch, baseUrl = apiBase() } = {}) {
  const tradeId = trade?.onChainTradeId;
  if (!Number.isSafeInteger(tradeId)) {
    throw new Error("This purchase has no on-chain trade ID, so its settlement cannot be found");
  }
  let txHash = readPendingSettlementTx(tradeId, store);
  if (!txHash) {
    if (typeof findOnChain !== "function") throw new Error("No way to look up the settlement transaction was provided");
    txHash = await findOnChain(tradeId, { purchaseTxHash: trade?.purchaseTxHash });
  }
  if (!txHash) throw new Error("The settlement transaction for this trade could not be found on Sepolia");
  const result = await postSettlementToLedger(trade, txHash, { fetchImpl, baseUrl });
  clearPendingSettlementTx(tradeId, store);
  return { txHash, result };
}
