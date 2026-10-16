/* ---------------------------------------------------------------------------
   Purchase queue selection rules.

   Everything below is pure: it only decides which records that the existing
   REST API already returned belong in which panel. It never fetches, mutates,
   hashes, signs, or invents state, and it never holds a private key. The
   backend and the smart contract stay the single source of truth for whether a
   purchase exists and whether it has been settled.
   --------------------------------------------------------------------------- */

/** 0x addresses must be compared without their letter casing. */
export function normalizeAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True when the backend recorded a confirmed settlement receipt for this purchase. */
export function isSettledPurchase(transaction) {
  return Boolean(transaction?.settledAt);
}

/** True when the chain reports the trade as settled. */
export function isSettledOnChain(transaction) {
  return transaction?.chainStatus === "settled";
}

/** True when `wallet` is the seller of this purchase. */
export function isSellerOf(transaction, wallet) {
  const owner = normalizeAddress(wallet);
  return owner !== "" && normalizeAddress(transaction?.sellerId) === owner;
}

/** True when `wallet` is the buyer of this purchase. */
export function isBuyerOf(transaction, wallet) {
  const owner = normalizeAddress(wallet);
  return owner !== "" && normalizeAddress(transaction?.buyerId) === owner;
}

/** Every on-chain record addressed to this seller, settled or not. */
export function selectSellerTransactions(transactions, wallet) {
  return (transactions ?? []).filter((transaction) => isSellerOf(transaction, wallet));
}

/**
 * The seller's "Awaiting seller settlement" queue: confirmed on-chain purchases
 * of this wallet's offers whose settlement receipt is not recorded yet.
 * A purchase is never hidden just because its purchase transaction is already
 * confirmed — only a recorded (or chain-confirmed) settlement removes it.
 */
export function selectSellerPendingPurchases(transactions, wallet) {
  return selectSellerTransactions(transactions, wallet).filter(
    (transaction) => !isSettledPurchase(transaction) && !isSettledOnChain(transaction)
  );
}

/** The seller's "Confirmed on-chain" earnings history. */
export function selectSellerSettledPurchases(transactions, wallet) {
  return selectSellerTransactions(transactions, wallet).filter(isSettledPurchase);
}

/** Purchases this wallet bought that are still sitting in contract escrow. */
export function selectBuyerEscrowed(transactions, wallet) {
  return (transactions ?? []).filter(
    (transaction) => isBuyerOf(transaction, wallet) && !isSettledPurchase(transaction)
  );
}

/**
 * Whether the Sell page may render a live Settle control for this purchase.
 * Requires all three: the wallet is the seller, the purchase is still awaiting
 * settlement, and a usable on-chain trade id exists. The seller-only rule is
 * enforced again inside SettleButton, so a buyer or another seller can never
 * reach the settlement call.
 */
export function canSettlePurchase(transaction, wallet) {
  return (
    isSellerOf(transaction, wallet) &&
    !isSettledPurchase(transaction) &&
    !isSettledOnChain(transaction) &&
    Number.isSafeInteger(transaction?.onChainTradeId)
  );
}

/* ---------------------------------------------------------------------------
   On-chain trade state.

   `trades(id)` returns a tuple. The contract stores nothing for a trade that was
   never bought and reports it as all zeroes; it also treats `seller == address(0)`
   as "no such trade" (settleTrade reverts OfferUnavailable in that case), so the
   same rule is applied here. This only interprets what the chain returned — a
   trade counts as settled when, and only when, the contract's status says so.
   --------------------------------------------------------------------------- */

/** The address the contract uses to mean "no trade". */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Normalise the raw `trades(id)` tuple into plain, comparable values. */
export function normalizeChainTrade(raw) {
  const [id, offerId, seller, buyer, kWhTraded, totalPriceWei, status] = raw ?? [];
  const sellerAddress = typeof seller === "string" ? seller.trim() : "";
  const exists = sellerAddress !== "" && normalizeAddress(sellerAddress) !== ZERO_ADDRESS;
  return {
    id: Number(id ?? 0),
    offerId: Number(offerId ?? 0),
    seller: sellerAddress,
    buyer: typeof buyer === "string" ? buyer.trim() : "",
    kWhTraded: Number(kWhTraded ?? 0),
    totalPriceWei: totalPriceWei ?? 0n,
    exists,
    settledOnChain: exists && Number(status ?? 0) === 1
  };
}

/** Index TradeRequest documents by `_id` so a transaction can be traced to its request. */
export function indexRequests(requests) {
  const byId = new Map();
  for (const request of requests ?? []) {
    if (request?._id != null) byId.set(String(request._id), request);
  }
  return byId;
}

/**
 * Distinguishes a buyer-signed purchase ("Buy on chain") from a fill the backend
 * matcher bought with the platform buyer wallet.

 * Both flows store a transaction, and both always link it to a TradeRequest, so
 * `requestId` alone cannot tell them apart. The shapes do differ:
 *
 *  - `POST /transactions/confirm-purchase` writes the receipt as a request whose
 *    only fill is the purchase itself and whose maximum price is exactly the rate
 *    the buyer paid on-chain.
 *  - The matcher pushes fills onto a request the buyer submitted earlier, so the
 *    fill rate is at or below the buyer's cap (equal only by coincidence).
 *
 * A failed fill is never treated as a confirmed purchase.
 */
export function isDirectPurchase(transaction, requestsById) {
  if (!transaction?.requestId) return false;
  const request =
    requestsById instanceof Map
      ? requestsById.get(String(transaction.requestId))
      : requestsById?.[transaction.requestId];
  const fills = request?.fills ?? [];
  if (fills.length !== 1) return false;
  const [fill] = fills;
  if (!fill || fill.status === "failed") return false;
  if (
    fill.onChainTradeId != null &&
    transaction.onChainTradeId != null &&
    fill.onChainTradeId !== transaction.onChainTradeId
  ) {
    return false;
  }
  return Number(fill.pricePerKWh) === Number(request.maxPricePerKWh);
}

/** The buyer's "Purchase history": purchases this wallet signed itself. */
export function selectDirectPurchases(transactions, requests, wallet) {
  const requestsById = requests instanceof Map ? requests : indexRequests(requests);
  return (transactions ?? [])
    .filter((transaction) => isBuyerOf(transaction, wallet))
    .filter((transaction) => isDirectPurchase(transaction, requestsById));
}
