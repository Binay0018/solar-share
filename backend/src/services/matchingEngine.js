import { formatUnits, isAddress } from "viem";
import { priceToWei } from "./contractService.js";

// Price-time priority, made fully deterministic: cheapest rate first, then the
// earliest listing, then the database id. The id tie-break matters because two
// listings can legitimately share a rate and a timestamp, and without it the
// order (and therefore which listing is partially filled) could differ between
// the buyer preview and the matcher run.
export const OFFER_SORT = { pricePerKWh: 1, createdAt: 1, _id: 1 };

// Ceiling on how many candidate listings one request is planned against.
export const MAX_CANDIDATE_OFFERS = 200;

/**
 * Fiat value of a wei amount. The chain value is the authority, so ledger rupee
 * totals are converted from wei instead of being re-derived with float maths
 * from the displayed rate (which can drift by paise on repeating decimals).
 */
export function weiToRupees(wei) {
  return Number(formatUnits(BigInt(wei), 10));
}

function offerIdentity(offer) {
  return String(offer?._id ?? offer?.onChainOfferId ?? "");
}

/**
 * The single definition of "may this request consume this listing".
 *
 * Both the buyer preview and the background matcher call this, so they can never
 * disagree about which listings are eligible. Returns null when the listing is
 * eligible, otherwise a short reason.
 */
export function ineligibleReason(offer, request, context) {
  if (!offer || offer.status !== "open") return "listing is not open";

  const available = Number(offer.kWhAvailable);
  if (!Number.isFinite(available) || Math.floor(available) < 1) return "no whole kWh left";

  const price = Number(offer.pricePerKWh);
  if (!Number.isFinite(price) || price <= 0) return "rate is not valid";

  const maxPrice = Number(request.maxPricePerKWh);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return "maximum rate is not valid";
  if (price > maxPrice) return "rate is above the maximum";

  const buyerId = request.buyerId;
  if (!isAddress(offer.sellerId)) return "seller wallet is not valid";
  if (!isAddress(buyerId)) return "buyer wallet is not valid";
  if (offer.sellerId.toLowerCase() === buyerId.toLowerCase()) return "buyer owns this listing";

  // The platform signs every matched purchase from its own buyer wallet, so a
  // request can only be filled when it comes from that wallet.
  if (!context.configuredBuyer || buyerId.toLowerCase() !== context.configuredBuyer.toLowerCase()) {
    return "request wallet is not the platform buyer wallet";
  }

  // A listing that only exists in MongoDB still has to be created on-chain,
  // which requires the configured seller key. Anything else is not buyable.
  if (!Number.isInteger(offer.onChainOfferId)) {
    const sellerIsConfigured =
      Boolean(context.configuredSeller) &&
      offer.sellerId.toLowerCase() === context.configuredSeller.toLowerCase();
    if (!sellerIsConfigured) return "listing is not published on-chain yet";
  }

  return null;
}

export function compareOffers(left, right) {
  const byPrice = Number(left.pricePerKWh) - Number(right.pricePerKWh);
  if (byPrice !== 0) return byPrice;

  const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
  const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
  if (leftTime !== rightTime) return leftTime - rightTime;

  return offerIdentity(left).localeCompare(offerIdentity(right));
}

function emptyPlan(requestedKWh) {
  return {
    requestedKWh,
    filledKWh: 0,
    remainingKWh: requestedKWh,
    fills: [],
    skipped: [],
    totalWei: "0",
    totalPrice: 0,
    averageRate: 0
  };
}

/**
 * Greedy price-time plan for one request. Pure: it reads nothing and writes
 * nothing, so the preview and the matcher produce the same plan from the same
 * listing snapshot.
 */
export function planFills({ request, offers, context, excludeOfferIds = [] }) {
  const requestedKWh = Math.floor(Number(request.kWhNeeded));
  if (!Number.isSafeInteger(requestedKWh) || requestedKWh < 1) return emptyPlan(0);

  const excluded = new Set([...excludeOfferIds].map(String));
  let remainingKWh = requestedKWh;
  const fills = [];
  const skipped = [];

  for (const offer of [...offers].sort(compareOffers)) {
    if (remainingKWh < 1) break;
    if (excluded.has(offerIdentity(offer))) continue;

    const reason = ineligibleReason(offer, request, context);
    if (reason) {
      skipped.push({
        offerId: offer._id ?? null,
        sellerId: offer.sellerId ?? null,
        kWhAvailable: Number(offer.kWhAvailable) || 0,
        pricePerKWh: Number(offer.pricePerKWh) || 0,
        reason
      });
      continue;
    }

    const kWh = Math.min(Math.floor(Number(offer.kWhAvailable)), remainingKWh);
    if (kWh < 1) continue;

    const priceWei = priceToWei(offer.pricePerKWh);
    fills.push({
      offerId: offer._id ?? null,
      offer,
      sellerId: offer.sellerId,
      kWh,
      pricePerKWh: Number(offer.pricePerKWh),
      priceWei: priceWei.toString(),
      totalWei: (BigInt(kWh) * priceWei).toString(),
      onChainOfferId: Number.isInteger(offer.onChainOfferId) ? offer.onChainOfferId : null
    });
    remainingKWh -= kWh;
  }

  const totalWei = fills.reduce((sum, fill) => sum + BigInt(fill.totalWei), 0n);
  const filledKWh = requestedKWh - remainingKWh;
  const totalPrice = weiToRupees(totalWei);

  return {
    requestedKWh,
    filledKWh,
    remainingKWh,
    fills,
    skipped,
    totalWei: totalWei.toString(),
    totalPrice,
    averageRate: filledKWh ? totalPrice / filledKWh : 0
  };
}
