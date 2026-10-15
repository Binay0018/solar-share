import assert from "node:assert/strict";
import test from "node:test";

import {
  bucketArticles,
  canonicalUrl,
  collectArticles,
  dedupe,
  evaluateArticle,
  getNews,
  isUsableImage,
  isUsableUrl,
  istDateKey,
  normalizeArticle,
  resetNewsCache,
  titleKey
} from "./newsService.js";

const FEED = { id: "test-feed", name: "Test Energy Desk", homepage: "https://example.com", weight: 3, region: "global" };

const NOW = Date.parse("2026-10-15T16:28:00Z");

const raw = (overrides = {}) => ({
  title: "Solar capacity additions accelerate",
  summary: "Rooftop solar installations grew across the state.",
  url: "https://example.com/solar-capacity",
  publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000",
  source: "Test Energy Desk",
  image: "",
  ...overrides
});

/* -------------------------------------------------------------------------
   Relevance
   ------------------------------------------------------------------------- */

test("accepts energy-market headlines", () => {
  const accepted = [
    "Solar tariff falls to a record low in the latest auction",
    "Wind developer signs grid connection deals",
    "India remains the second-largest market for solar and wind additions",
    "20.4GWh of grid-scale BESS was deployed last month",
    "CERC adopts tariffs for a 600 MW wind power auction",
    "NITI Aayog urges green power tariff and open access for data centres",
    "Tata Power urges Bengal to offer rooftop solar subsidy",
    "Utilities can use AI to solve grid backlogs",
    "Peer-to-peer energy trading pilot expands to three microgrids"
  ];
  for (const title of accepted) {
    assert.equal(evaluateArticle({ title }).accept, true, `expected accepted: ${title}`);
  }
});

test("rejects general, unrelated and off-topic headlines", () => {
  const rejected = [
    "The SUV was an experiment that continues to be one",
    "BYD's electric luxury GT will get a major update for Europe",
    "BMW's new i3 just drove 753 miles on a single charge",
    "Farming's nitrogen future will be built from several technologies",
    "Cricket: India seal the series in the final over",
    "Box office collections fall for the third weekend",
    "Hollywood actress announces engagement",
    "Weekly horoscope: what the stars hold",
    "Shipping emissions rise as trade volumes recover"
  ];
  for (const title of rejected) {
    const verdict = evaluateArticle({ title });
    assert.equal(verdict.accept, false, `expected rejected: ${title}`);
  }
});

test("a battery story about an EV is dropped unless it names real scale", () => {
  assert.equal(evaluateArticle({ title: "New EV battery chemistry promises faster charging" }).accept, false);
  assert.equal(evaluateArticle({ title: "Utility-scale BESS battery storage plant reaches 300MW" }).accept, true);
});

test("categorises accepted articles", () => {
  const cases = [
    ["Rooftop solar installations climb", "solar"],
    ["Offshore wind farm reaches financial close", "renewable"],
    ["Electricity prices spike in the day-ahead market", "markets"],
    ["MNRE announces a new rooftop subsidy scheme", "policy"],
    ["Grid-scale battery storage tender closes", "storage"],
    ["Smart meter rollout accelerates", "grid"],
    ["Blockchain peer-to-peer energy trading pilot launches", "trading"]
  ];
  for (const [title, expected] of cases) {
    assert.equal(evaluateArticle({ title }).category, expected, `category for: ${title}`);
  }
});

test("flags India relevance and market weighting for ranking", () => {
  assert.equal(evaluateArticle({ title: "SECI solar tender oversubscribed" }).india, true);
  assert.equal(evaluateArticle({ title: "Solar farm opens in Chile" }).india, false);
  assert.equal(evaluateArticle({ title: "Electricity tariffs revised for discoms" }).marketWeighted, true);
});

/* -------------------------------------------------------------------------
   URL and duplicate handling
   ------------------------------------------------------------------------- */

test("canonicalUrl removes tracking noise and normalises the host", () => {
  assert.equal(
    canonicalUrl("http://www.Example.com/solar/?utm_source=x&utm_medium=y&b=2&a=1#frag"),
    "https://example.com/solar?a=1&b=2"
  );
  assert.equal(canonicalUrl("https://example.com/solar"), canonicalUrl("https://example.com/solar/"));
  assert.equal(
    canonicalUrl("https://example.com/x?fbclid=abc"),
    canonicalUrl("https://example.com/x")
  );
});

test("isUsableUrl only allows absolute http(s) URLs", () => {
  assert.equal(isUsableUrl("https://example.com/a"), true);
  assert.equal(isUsableUrl("http://example.com/a"), true);
  assert.equal(isUsableUrl("javascript:alert(1)"), false);
  assert.equal(isUsableUrl("mailto:news@example.com"), false);
  assert.equal(isUsableUrl("/relative/path"), false);
  assert.equal(isUsableUrl("https://localhost"), false);
  assert.equal(isUsableUrl(""), false);
  assert.equal(isUsableImage("https://example.com/a.jpg"), true);
  assert.equal(isUsableImage("data:image/png;base64,AAAA"), false);
});

test("dedupe collapses the same story by URL and by headline", () => {
  const articles = [
    { title: "Solar tariff hits a record low", url: "https://a.com/story", canonicalUrl: "https://a.com/story", rank: 10 },
    { title: "Solar tariff hits a record low!", url: "https://b.com/story", canonicalUrl: "https://b.com/story", rank: 9 },
    { title: "Different story", url: "https://a.com/story?utm_source=z", canonicalUrl: canonicalUrl("https://a.com/story?utm_source=z"), rank: 8 },
    { title: "Another story", url: "https://c.com/story", canonicalUrl: "https://c.com/story", rank: 7 }
  ];
  const kept = dedupe(articles);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].url, "https://a.com/story");
  assert.equal(kept[1].title, "Another story");
  assert.equal(titleKey("Solar tariff hits a record low!"), "solar tariff hits a record low");
});

/* -------------------------------------------------------------------------
   Normalisation and freshness
   ------------------------------------------------------------------------- */

test("normalizeArticle rejects undated, future-dated and unusable items", () => {
  assert.equal(normalizeArticle(raw(), FEED, NOW).reason, "accepted");
  assert.equal(normalizeArticle(raw({ publishedAt: "" }), FEED, NOW).reason, "date");
  assert.equal(normalizeArticle(raw({ publishedAt: "not a date" }), FEED, NOW).reason, "date");
  assert.equal(normalizeArticle(raw({ url: "javascript:alert(1)" }), FEED, NOW).reason, "url");
  assert.equal(normalizeArticle(raw({ title: "" }), FEED, NOW).reason, "untitled");
  assert.equal(normalizeArticle(raw({ title: "Cricket final ends in a tie" }), FEED, NOW).reason, "noise");
  // 19:34 "GMT" is three hours after NOW, so it is future-dated and dropped.
  assert.equal(
    normalizeArticle(raw({ publishedAt: "Thu, 15 Oct 2026 19:34:32 GMT" }), FEED, NOW).reason,
    "future"
  );
});

test("normalizeArticle keeps provenance and computes a stable id", () => {
  const { article } = normalizeArticle(raw(), FEED, NOW);
  assert.equal(article.source, "Test Energy Desk");
  assert.equal(article.category, "solar");
  assert.equal(article.publishedAt, "2026-10-15T12:00:00.000Z");
  assert.equal(article.id, normalizeArticle(raw({ url: "https://example.com/solar-capacity?utm_source=x" }), FEED, NOW).article.id);
});

test("buckets today in the application timezone, not in UTC", () => {
  assert.equal(istDateKey(NOW), "2026-10-15");

  const make = (iso, hoursAgo) => ({ id: iso, title: iso, publishedAtMs: Date.parse(iso), rank: -hoursAgo });
  const articles = [
    make("2026-10-15T15:00:00Z"), // IST 2026-10-15 20:30 -> today
    make("2026-10-14T18:35:00Z"), // IST 2026-10-15 00:05 -> today
    make("2026-10-14T18:25:00Z"), // IST 2026-10-14 23:55 -> yesterday, still inside 48h
    make("2026-10-13T15:00:00Z"), // 49.5h old -> outside the freshness window
    make("2026-10-15T20:00:00Z")  // IST 2026-10-16 01:30 -> future in IST, excluded
  ];

  const narrow = bucketArticles(articles, NOW, 3);
  assert.deepEqual(narrow.today.map((a) => a.id), ["2026-10-15T15:00:00Z", "2026-10-14T18:35:00Z"]);
  assert.deepEqual(narrow.recent.map((a) => a.id), ["2026-10-14T18:25:00Z"]);
  assert.equal(narrow.expanded, true);
  assert.equal(narrow.todayKey, "2026-10-15");
});

test("the 24-48h fallback is withheld when today already has enough", () => {
  const today = Array.from({ length: 6 }, (_, index) => ({
    id: `t${index}`, title: `today ${index}`, publishedAtMs: NOW - index * 1000, rank: 0
  }));
  const recent = [{ id: "r", title: "older", publishedAtMs: NOW - 30 * 3_600_000, rank: 0 }];

  const wide = bucketArticles([...today, ...recent], NOW, 6);
  assert.equal(wide.expanded, false);
  assert.equal(wide.recent.length, 0);
  assert.equal(wide.today.length, 6);
});

/* -------------------------------------------------------------------------
   Collection, caching and failure semantics
   ------------------------------------------------------------------------- */

const feedXml = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${items.map((item) => `
  <item>
    <title>${item.title}</title>
    <link>${item.url}</link>
    <description><![CDATA[${item.summary ?? ""}]]></description>
    <pubDate>${item.publishedAt}</pubDate>
  </item>`).join("")}</channel></rss>`;

const respondingFetcher = (xml) => async () => ({ ok: true, status: 200, text: async () => xml });

test("collectArticles filters, dedupes and reports per-source outcomes", async () => {
  const xml = feedXml([
    { title: "Solar auction clears at a record low tariff", url: "https://example.com/a", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" },
    { title: "Solar auction clears at a record low tariff", url: "https://example.com/a?utm_source=news", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" },
    { title: "Cricket final ends in a tie", url: "https://example.com/b", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" },
    { title: "Wind farm reaches financial close", url: "https://example.com/c", publishedAt: "Thu, 15 Oct 2026 11:00:00 +0000" }
  ]);
  const result = await collectArticles({ now: NOW, fetcher: respondingFetcher(xml), feeds: [FEED] });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].ok, true);
  assert.equal(result.sources[0].items, 4);
  assert.equal(result.counts.items, 4);
  assert.equal(result.articles.length, 2);
  assert.equal(result.counts.duplicatesRemoved, 1);
  assert.equal(result.counts.rejected.noise, 1);
  assert.ok(result.articles.every((article) => article.url.startsWith("https://example.com/")));
});

test("collectArticles survives a feed that fails or times out", async () => {
  const fetcher = async (url) => {
    if (url.includes("bad")) throw new Error("socket hang up");
    if (url.includes("slow")) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return { ok: true, status: 200, text: async () => feedXml([{ title: "Solar tender oversubscribed", url: "https://example.com/ok", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" }]) };
  };
  const feeds = [
    { id: "ok", name: "OK", homepage: "https://ok.example", weight: 3 },
    { id: "bad", name: "Bad", url: "https://bad.example/feed", homepage: "https://bad.example", weight: 3 },
    { id: "slow", name: "Slow", url: "https://slow.example/feed", homepage: "https://slow.example", weight: 3 }
  ];
  const result = await collectArticles({ now: NOW, fetcher, feeds: feeds.map((feed) => ({ ...feed, url: feed.url ?? "https://ok.example/feed" })) });

  assert.equal(result.articles.length, 1);
  const byId = Object.fromEntries(result.sources.map((source) => [source.id, source]));
  assert.equal(byId.ok.ok, true);
  assert.equal(byId.bad.ok, false);
  assert.match(byId.bad.error, /socket hang up/);
  assert.match(byId.slow.error, /Timed out/);
});

test("a total source outage keeps the previous articles and marks them stale", async () => {
  resetNewsCache();

  const working = respondingFetcher(feedXml([
    { title: "Solar tariff falls to a record low", url: "https://example.com/a", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" }
  ]));

  const first = await getNews({ now: NOW, fetcher: working });
  assert.equal(first.fresh, true);
  assert.equal(first.stale, false);
  assert.equal(first.error, null);
  assert.equal(first.articles.length, 1);
  assert.equal(first.articles[0].bucket, "today");
  assert.equal(first.counts.feedsOk, 8);

  const broken = async () => { throw new Error("dns failure"); };
  const second = await getNews({ force: true, now: NOW + 120_000, fetcher: broken });

  assert.equal(second.fresh, false);
  assert.equal(second.stale, true);
  assert.match(second.error, /could be reached/);
  assert.equal(second.articles.length, 1, "cached articles are still served");
  assert.equal(second.fetchedAt, new Date(NOW).toISOString(), "timestamp still reflects the last success");
  assert.ok(second.sources.every((source) => source.ok === false));
  assert.equal(second.counts.feedsOk, 0);

  resetNewsCache();
});

test("a failed first refresh reports an error instead of an empty success", async () => {
  resetNewsCache();
  const broken = async () => ({ ok: false, status: 503, text: async () => "" });
  const payload = await getNews({ now: NOW, fetcher: broken });

  assert.equal(payload.fresh, false);
  assert.equal(payload.stale, false);
  assert.equal(payload.fetchedAt, null);
  assert.deepEqual(payload.articles, []);
  assert.match(payload.error, /could be reached/);
  assert.equal(payload.counts.feedsTotal, 8);

  resetNewsCache();
});

test("cached payloads are reused inside the TTL window", async () => {
  resetNewsCache();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: true, status: 200, text: async () => feedXml([{ title: "Solar tender oversubscribed", url: "https://example.com/a", publishedAt: "Thu, 15 Oct 2026 12:00:00 +0000" }]) };
  };

  await getNews({ now: NOW, fetcher });
  const cached = await getNews({ now: NOW + 60_000, fetcher });
  assert.equal(calls, 8, "one request per configured feed, then cached");
  assert.equal(cached.cached, true);
  assert.equal(cached.fresh, false);
  assert.equal(cached.articles.length, 1);

  resetNewsCache();
});
