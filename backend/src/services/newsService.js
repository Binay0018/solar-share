/* ---------------------------------------------------------------------------
   Energy news aggregation for the SolarShare News section.

   Design notes
   ------------
   * Feeds are fetched server-side so the browser never talks to a third party
     and no key is ever needed by, or exposed to, the frontend.
   * Timestamps are handled internally as UTC epoch milliseconds. "Today" is
     evaluated in the application timezone, Asia/Kolkata, because every other
     SolarShare screen renders Indian Standard Time.
   * This module is the server-side filter of record. It rejects anything that
     is off-topic, undated, future-dated, duplicated or outside the freshness
     window before the frontend ever sees it. The frontend filters again only
     as a convenience for the category chips.
   ------------------------------------------------------------------------- */

import { createHash } from "node:crypto";

import { parseFeed, plainText } from "./newsParser.js";
import { selectFeeds } from "./newsSources.js";

/* --------------------------------------------------------------------------
   Configuration
   -------------------------------------------------------------------------- */

const numberFromEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const APP_TIMEZONE = "Asia/Kolkata";
export const IST_OFFSET_MS = 330 * 60 * 1000;

export const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Small allowance for feeds whose clock or zone label runs slightly ahead. */
export const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

const CACHE_TTL_MS = numberFromEnv(process.env.NEWS_CACHE_TTL_MS, 10 * 60 * 1000);
const FORCE_MIN_INTERVAL_MS = numberFromEnv(process.env.NEWS_FORCE_MIN_INTERVAL_MS, 60 * 1000);
const FETCH_TIMEOUT_MS = numberFromEnv(process.env.NEWS_FETCH_TIMEOUT_MS, 20 * 1000);
const MIN_TODAY_ARTICLES = numberFromEnv(process.env.NEWS_MIN_TODAY_ARTICLES, 6);
const MAX_PER_SOURCE = numberFromEnv(process.env.NEWS_MAX_PER_SOURCE, 8);
const MAX_ARTICLES = numberFromEnv(process.env.NEWS_MAX_ARTICLES, 60);

const USER_AGENT = "SolarShare/0.1 (energy news aggregation; +http://localhost:5173)";

/* --------------------------------------------------------------------------
   Topic model
   -------------------------------------------------------------------------- */

/* `core: false` groups can describe an article but never make it eligible on
   their own, so a generic climate story cannot pass the relevance gate. */
export const TOPIC_GROUPS = Object.freeze([
  {
    id: "solar",
    label: "Solar",
    priority: 0,
    focus: true,
    patterns: [/\bsolar\b/i, /photovoltaic/i, /\bPV\b/]
  },
  {
    id: "renewable",
    label: "Renewable energy",
    priority: 1,
    focus: true,
    patterns: [
      /\brenewables?\b/i,
      /\bwind\b/i,
      /\bhydro(?:electric|electricity|power)?\b/i,
      /\bgeothermal\b/i,
      /\bbiomass\b/i,
      /\btidal\b/i,
      /\bclean energy\b/i,
      /\bgreen (?:energy|power|hydrogen)\b/i,
      /\bhydrogen\b/i
    ]
  },
  {
    id: "markets",
    label: "Energy markets",
    priority: 2,
    patterns: [
      /\belectricity\b/i,
      /\bpower (?:market|markets|price|prices|tariff|tariffs|purchase|trading|exchange|demand|supply|sector|plant|project|utility|utilities|system|cost|costs)\b/i,
      /\btariffs?\b/i,
      /\bdiscoms?\b/i,
      /\bauction(?:s|ed|ing)?\b/i,
      /\btenders?\b/i,
      /\bbidding\b/i,
      /\bPPAs?\b/,
      /\bopen access\b/i,
      /\bmerit order\b/i,
      /\bpower exchange\b/i,
      /\bIEX\b/,
      /\bpeak demand\b/i,
      /\bwholesale (?:market|price|prices)\b/i,
      /\bcapacity additions?\b/i,
      /\b\d+(?:\.\d+)?\s?(?:MW|GW|kW|MWh|GWh|kWh)\b/i,
      /\butilit(?:y|ies)\b/i
    ]
  },
  {
    id: "policy",
    label: "Policy",
    priority: 3,
    patterns: [
      /\bsubsid(?:y|ies|ise|ize|ised|ized|ising|izing)\b/i,
      /\bpolic(?:y|ies)\b/i,
      /\bregulat(?:ion|ions|or|ors|ory)\b/i,
      /\bMNRE\b/,
      /\bSECI\b/,
      /\bCERC\b/,
      /\bSERC\b/,
      /\bNITI Aayog\b/i,
      /\bministry of (?:power|new and renewable energy)\b/i,
      /\bnet metering\b/i,
      /\bfeed-?in tariff\b/i,
      /\bPLI\b/,
      /\bRPO\b/,
      /\bPM Surya Ghar\b/i,
      /\bKUSUM\b/i,
      /\bschemes?\b/i,
      /\bcabinet (?:approves|approval|approve)\b/i
    ]
  },
  {
    id: "storage",
    label: "Storage & batteries",
    priority: 4,
    focus: true,
    patterns: [
      /\bbatter(?:y|ies)\b/i,
      /\bBESS\b/,
      /\benergy storage\b/i,
      /\bstorage (?:project|projects|plant|plants|system|systems|capacity|capacities|tender|tenders|market|markets|sector|site|sites|asset|assets|facility|facilities|unit|units)\b/i,
      /\blithium\b/i,
      /\bLFP\b/,
      /\bsodium-ion\b/i,
      /\bpumped hydro\b/i,
      /\bcompressed (?:air|CO2|carbon dioxide)\b/i,
      /\bflow batter/i
    ]
  },
  {
    id: "grid",
    label: "Grid & smart energy",
    priority: 5,
    focus: true,
    patterns: [
      /\bsmart (?:grid|grids|meter|meters|metering)\b/i,
      /\bmicrogrids?\b/i,
      /\bdistributed (?:energy|generation|resources)\b/i,
      /\bDERs?\b/,
      /\bVPPs?\b/,
      /\bvirtual power plants?\b/i,
      /\bdemand (?:response|side management)\b/i,
      /\bgrids?\b/i,
      /\btransmission\b/i,
      /\bsubstations?\b/i,
      /\bcurtailment\b/i,
      /\binterconnect(?:ion|ions|ed|ing)?\b/i,
      /\btransformers?\b/i,
      /\bdistribution (?:company|companies|utility|utilities|network|networks|grid|grids)\b/i,
      /\bfrequency (?:regulation|response|stability)\b/i,
      /\bIoT\b/,
      /\bsmart energy\b/i,
      /\benergy monitoring\b/i
    ]
  },
  {
    id: "trading",
    label: "P2P trading",
    priority: 6,
    focus: true,
    patterns: [
      /\bpeer-?to-?peer\b/i,
      /\bP2P\b/,
      /\bblockchain\b/i,
      /\benergy trading\b/i,
      /\btrading platform\b/i,
      /\bcommunity (?:energy|solar|power|microgrid|microgrids)\b/i,
      /\benergy shar(?:e|es|ed|ing)\b/i,
      /\btransactive energy\b/i,
      /\btokeni[sz]ed\b/i,
      /\bdecentrali[sz]ed energy\b/i,
      /\benergy markets?\b/i,
      /\bdistributed ledger\b/i
    ]
  },
  {
    id: "climate",
    label: "Sustainability",
    priority: 7,
    core: false,
    patterns: [
      /\bdecarboni[sz]/i,
      /\bnet[- ]zero\b/i,
      /\bcarbon (?:neutral|neutrality|credits?|markets?|emissions?|footprint|intensity)\b/i,
      /\benergy transition\b/i,
      /\bemissions? (?:reduction|reductions|target|targets|trading)\b/i,
      /\bgreenhouse gas/i
    ]
  }
]);

const GROUP_BY_ID = new Map(TOPIC_GROUPS.map((group) => [group.id, group]));

/* Never newsworthy for this feed, regardless of keyword matches. */
const NOISE_PATTERNS = [
  /\b(?:cricket|football|soccer|basketball|tennis|olympics?|world cup|premier league|nba|nfl|ipl)\b/i,
  /\b(?:celebrity|celebrities|actor|actress|box office|bollywood|hollywood|kardashian)\b/i,
  /\b(?:horoscope|astrology|zodiac|recipe|recipes|lottery)\b/i,
  /\b(?:obituary|passes away at|dies at)\b/i
];

/* Consumer-vehicle reporting is not energy-market news unless it is really
   about grid-scale capacity, so it is dropped unless a scale marker is present. */
const TRANSPORT_PATTERNS = [
  /\belectric (?:car|cars|vehicle|vehicles|suv|suvs|truck|trucks|bike|bikes|scooter|scooters|bus|buses)\b/i,
  /\bbattery[- ]powered (?:car|cars|vehicle|vehicles|truck|trucks|van|vans|bus|buses|bike|bikes)\b/i,
  /\bEVs?\b/,
  /\b(?:SUVs?|sedans?|hatchback|hatchbacks|pickup|pickups|cybertruck)\b/,
  /\b(?:fleet|delivery) (?:vehicles?|vans?|trucks?|cars?)\b/i,
  /\b(?:test drive|road trip|miles per charge|driving range|dealership|automakers?|car makers?)\b/i
];

const SCALE_PATTERNS = [
  /\b(?:grid-scale|utility-scale|grid scale|utility scale)\b/i,
  /\b(?:GWh|MWh|BESS|GW|MW)\b/,
  /\bstorage (?:project|projects|plant|plants|system|systems|capacity|facility|facilities)\b/i
];

const INDIA_PATTERNS = [
  /\b(?:india|indian)\b/i,
  /\b(?:MNRE|SECI|CERC|SERC|NITI Aayog|PM Surya Ghar|KUSUM|DISCOM|DISCOMs)\b/,
  /\b(?:gujarat|rajasthan|karnataka|tamil nadu|maharashtra|uttar pradesh|telangana|andhra pradesh|madhya pradesh|kerala|punjab|haryana|odisha|west bengal|bengal|bihar|jharkhand|goa|assam)\b/i,
  /₹/,
  /\b(?:crore|lakh)\b/i
];

/* --------------------------------------------------------------------------
   Pure helpers (exported for tests)
   -------------------------------------------------------------------------- */

export function istDateKey(value) {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function matchGroups(text) {
  const hits = new Set();
  if (!text) return hits;
  for (const group of TOPIC_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(text))) hits.add(group.id);
  }
  return hits;
}

const coreOnly = (ids) => ids.filter((id) => GROUP_BY_ID.get(id)?.core !== false);

/**
 * Decide whether an article belongs in an energy feed, and pick the single
 * category label shown on its card.
 *
 * Gate: the headline must carry an energy topic, or the body must carry
 * several. A climate-only story cannot qualify on its own.
 */
export function evaluateArticle({ title = "", summary = "" } = {}) {
  const combined = `${title} ${summary}`;

  if (NOISE_PATTERNS.some((pattern) => pattern.test(title))) {
    return { accept: false, reason: "noise", category: null, categoryLabel: null, relevance: 0, india: false, marketWeighted: false };
  }
  if (TRANSPORT_PATTERNS.some((pattern) => pattern.test(combined)) && !SCALE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { accept: false, reason: "transport", category: null, categoryLabel: null, relevance: 0, india: false, marketWeighted: false };
  }

  const titleHits = matchGroups(title);
  const textHits = matchGroups(combined);
  const titleCore = coreOnly([...titleHits]);
  const textCore = coreOnly([...textHits]);

  const accept = titleCore.length >= 1
    || (titleHits.size >= 1 && textCore.length >= 1)
    || textCore.length >= 3;

  if (!accept) {
    return { accept: false, reason: "off-topic", category: null, categoryLabel: null, relevance: 0, india: false, marketWeighted: false };
  }

  let category = null;
  let best = -1;
  for (const id of textHits) {
    const group = GROUP_BY_ID.get(id);
    if (!group) continue;
    // Weight the number of distinct signals, not just presence, so a headline
    // that names "battery storage" beats one that merely mentions "tender".
    // Topic groups outrank context groups, so "250 MW solar park" is Solar
    // rather than Energy markets.
    const inTitle = group.patterns.filter((pattern) => pattern.test(title)).length;
    const inText = group.patterns.filter((pattern) => pattern.test(combined)).length;
    const score = inTitle * 4 + inText + (group.focus ? 2 : 0);
    if (score > best || (score === best && group.priority < GROUP_BY_ID.get(category).priority)) {
      best = score;
      category = id;
    }
  }

  const india = INDIA_PATTERNS.some((pattern) => pattern.test(combined));
  const marketWeighted = textHits.has("markets") || textHits.has("trading");
  const relevance = titleCore.length * 3 + textCore.length + (titleHits.size - titleCore.length);

  return {
    accept: true,
    reason: "accepted",
    category,
    categoryLabel: GROUP_BY_ID.get(category)?.label ?? null,
    relevance: Math.max(1, relevance),
    india,
    marketWeighted
  };
}

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_name",
  "utm_reader", "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid",
  "ref", "ref_src", "ref_url", "_hsenc", "_hsmi", "cmpid", "campid", "spm", "s_kwcid", "oc",
  "hl", "gl", "ceid", "at_medium", "at_campaign", "wt_mc", "wt_zmc"
]);

/** Normalise a URL so the same story from two sources collapses to one key. */
export function canonicalUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !TRACKING_PARAMS.has(lower) && !lower.startsWith("utm_");
      })
      .sort(([left], [right]) => left.localeCompare(right));
    for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
    for (const [key, entryValue] of kept) url.searchParams.append(key, entryValue);
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(value ?? "").trim().toLowerCase();
  }
}

export function titleKey(value) {
  return plainText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isUsableUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function summarise(value, limit = 240) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? clipped.slice(0, lastSpace) : clipped).trim()}…`;
}

export function isUsableImage(value) {
  return isUsableUrl(value);
}

/**
 * Turn one raw feed item into a publishable article, or explain the rejection.
 * Every rejection carries a machine-readable reason so /news can report why a
 * feed's items were dropped.
 */
export function normalizeArticle(raw, feed, now = Date.now()) {
  const title = plainText(raw?.title).slice(0, 300);
  const summary = summarise(raw?.summary);
  const url = String(raw?.url ?? "").trim();

  if (title === "") return { article: null, reason: "untitled" };
  if (!isUsableUrl(url)) return { article: null, reason: "url" };

  const publishedAtMs = Date.parse(raw?.publishedAt ?? "");
  if (!Number.isFinite(publishedAtMs)) return { article: null, reason: "date" };
  if (publishedAtMs - now > FUTURE_TOLERANCE_MS) return { article: null, reason: "future" };

  const verdict = evaluateArticle({ title, summary });
  if (!verdict.accept) return { article: null, reason: verdict.reason };

  const canonical = canonicalUrl(url);
  const ageHours = Math.max(0, (now - publishedAtMs) / 3_600_000);
  const rank = verdict.relevance * 20
    + Math.max(0, 48 - ageHours) * 1.5
    + (feed.weight ?? 1) * 2
    + (verdict.india ? 4 : 0)
    + (verdict.marketWeighted ? 3 : 0);

  return {
    article: {
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      title,
      summary,
      url,
      canonicalUrl: canonical,
      source: plainText(raw?.source) || feed.name,
      sourceId: feed.id,
      category: verdict.category,
      categoryLabel: verdict.categoryLabel,
      publishedAt: new Date(publishedAtMs).toISOString(),
      publishedAtMs,
      image: isUsableImage(raw?.image) ? String(raw.image).trim() : "",
      relevance: verdict.relevance,
      india: verdict.india,
      rank
    },
    reason: "accepted"
  };
}

/** Remove duplicates, keeping the highest-ranked copy of each story. */
export function dedupe(articles) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const kept = [];
  for (const article of articles) {
    const urlKey = article.canonicalUrl ?? canonicalUrl(article.url);
    const key = titleKey(article.title);
    if (seenUrls.has(urlKey)) continue;
    if (key !== "" && seenTitles.has(key)) continue;
    seenUrls.add(urlKey);
    if (key !== "") seenTitles.add(key);
    kept.push(article);
  }
  return kept;
}

function capPerSource(articles, max) {
  const counts = new Map();
  return articles.filter((article) => {
    const used = counts.get(article.sourceId) ?? 0;
    if (used >= max) return false;
    counts.set(article.sourceId, used + 1);
    return true;
  });
}

/**
 * Split articles into "published today in the app timezone" and "the previous
 * 48 hours". The second bucket is only exposed when today is thin.
 */
export function bucketArticles(articles, now = Date.now(), minToday = MIN_TODAY_ARTICLES) {
  const todayKey = istDateKey(now);
  const today = [];
  const recent = [];
  for (const article of articles) {
    const age = now - article.publishedAtMs;
    if (age < -FUTURE_TOLERANCE_MS) continue;
    if (age > FRESHNESS_WINDOW_MS) continue;
    (istDateKey(article.publishedAtMs) === todayKey ? today : recent).push(article);
  }
  const expanded = today.length < minToday;
  return {
    todayKey,
    today,
    recent: expanded ? recent : [],
    expanded,
    minToday
  };
}

/* --------------------------------------------------------------------------
   Collection
   -------------------------------------------------------------------------- */

/**
 * Fetch and normalise every configured feed.
 * `fetcher` is injectable so this can be exercised without network access.
 */
export async function collectArticles({ now = Date.now(), fetcher = globalThis.fetch, feeds = selectFeeds() } = {}) {
  const outcomes = await Promise.all(feeds.map(async (feed) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(feed.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5"
        }
      });
      if (!response.ok) {
        return { feed, ok: false, error: `HTTP ${response.status}`, articles: [], rejected: {}, items: 0 };
      }
      const items = parseFeed(await response.text(), { feedName: feed.name });
      const articles = [];
      const rejected = {};
      for (const item of items) {
        const { article, reason } = normalizeArticle(item, feed, now);
        if (article) articles.push(article);
        else rejected[reason] = (rejected[reason] ?? 0) + 1;
      }
      return { feed, ok: true, error: null, articles, rejected, items: items.length };
    } catch (error) {
      return {
        feed,
        ok: false,
        error: error?.name === "AbortError" ? `Timed out after ${FETCH_TIMEOUT_MS} ms` : String(error?.message ?? error),
        articles: [],
        rejected: {},
        items: 0
      };
    } finally {
      clearTimeout(timer);
    }
  }));

  const all = outcomes.flatMap((outcome) => outcome.articles);
  const accepted = dedupe(all.sort((a, b) => b.rank - a.rank || b.publishedAtMs - a.publishedAtMs));
  const articles = capPerSource(accepted, MAX_PER_SOURCE).slice(0, MAX_ARTICLES);

  const rejected = outcomes.reduce((totals, outcome) => {
    for (const [reason, count] of Object.entries(outcome.rejected ?? {})) {
      totals[reason] = (totals[reason] ?? 0) + count;
    }
    return totals;
  }, {});

  return {
    articles,
    sources: outcomes.map((outcome) => ({
      id: outcome.feed.id,
      name: outcome.feed.name,
      homepage: outcome.feed.homepage,
      ok: outcome.ok,
      error: outcome.error,
      items: outcome.items,
      accepted: outcome.articles.length
    })),
    counts: {
      items: outcomes.reduce((total, outcome) => total + outcome.items, 0),
      accepted: articles.length,
      passedFilters: accepted.length,
      duplicatesRemoved: all.length - accepted.length,
      rejected
    }
  };
}

/* --------------------------------------------------------------------------
   Cache
   -------------------------------------------------------------------------- */

const cache = {
  fetchedAt: 0,
  articles: [],
  sources: [],
  counts: null,
  error: null,
  partial: false
};

let inflight = null;

async function refresh({ now, fetcher }) {
  const { articles, sources, counts } = await collectArticles({ now, fetcher });
  const reachable = sources.filter((source) => source.ok).length;

  if (reachable === 0 && sources.length > 0) {
    // Keep whatever we already had, but say so rather than pretending it is current.
    cache.error = `None of the ${sources.length} configured news sources could be reached.`;
    cache.sources = sources;
    cache.partial = false;
    return;
  }

  cache.fetchedAt = now;
  cache.articles = articles;
  cache.sources = sources;
  cache.counts = counts;
  cache.error = null;
  cache.partial = sources.some((source) => !source.ok);
}

function present({ now, cached }) {
  const { todayKey, today, recent, expanded, minToday } = bucketArticles(cache.articles, now);
  const articles = [
    ...today.map((article) => ({ ...article, bucket: "today" })),
    ...recent.map((article) => ({ ...article, bucket: "recent" }))
  ];

  const countsByCategory = {};
  for (const article of articles) {
    countsByCategory[article.category] = (countsByCategory[article.category] ?? 0) + 1;
  }

  const hasData = cache.articles.length > 0;
  const failed = Boolean(cache.error);

  return {
    generatedAt: new Date(now).toISOString(),
    fetchedAt: cache.fetchedAt > 0 ? new Date(cache.fetchedAt).toISOString() : null,
    timezone: APP_TIMEZONE,
    today: todayKey,
    fresh: !failed && !cached,
    cached: cached && !failed,
    stale: failed && hasData,
    partial: !failed && cache.partial,
    error: cache.error,
    expanded,
    minTodayArticles: minToday,
    counts: {
      ...(cache.counts ?? {}),
      today: today.length,
      recent: recent.length,
      shown: articles.length,
      feedsOk: cache.sources.filter((source) => source.ok).length,
      feedsTotal: cache.sources.length
    },
    categories: TOPIC_GROUPS
      .map((group) => ({ id: group.id, label: group.label, count: countsByCategory[group.id] ?? 0 }))
      .filter((group) => group.count > 0),
    sources: cache.sources,
    articles
  };
}

/**
 * Read the news feed, refreshing from the publishers when the cache is cold.
 * A forced refresh is rate limited so a refresh button cannot hammer a source.
 */
export async function getNews({ force = false, now = Date.now(), fetcher } = {}) {
  const hasData = cache.articles.length > 0;
  const age = now - cache.fetchedAt;
  const freshEnough = hasData && age < (force ? FORCE_MIN_INTERVAL_MS : CACHE_TTL_MS);

  if (!freshEnough) {
    inflight = inflight ?? refresh({ now, fetcher });
    try {
      await inflight;
    } finally {
      inflight = null;
    }
    return present({ now, cached: false });
  }

  return present({ now, cached: true });
}

/** Test seam: drop cached state and re-read configuration. */
export function resetNewsCache() {
  cache.fetchedAt = 0;
  cache.articles = [];
  cache.sources = [];
  cache.counts = null;
  cache.error = null;
  cache.partial = false;
  inflight = null;
}

export const newsConfig = Object.freeze({
  cacheTtlMs: CACHE_TTL_MS,
  forceMinIntervalMs: FORCE_MIN_INTERVAL_MS,
  fetchTimeoutMs: FETCH_TIMEOUT_MS,
  minTodayArticles: MIN_TODAY_ARTICLES,
  maxPerSource: MAX_PER_SOURCE,
  maxArticles: MAX_ARTICLES
});
