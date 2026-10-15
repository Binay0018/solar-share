/* ---------------------------------------------------------------------------
   News source catalogue.

   Every source below was reachable and returned parseable RSS (or Atom) with
   a real per-article publication timestamp at the time this was written, and
   none of them requires an API key. Keeping the list to energy-specific
   publishers means the relevance filter starts from an on-topic corpus.

   `weight` is the source-reliability input used by the ranking step (trade
   press and specialist energy desks rank above broad clean-tech blogs).
   `region` lets India-relevant coverage be surfaced a little higher, matching
   the rest of the product (rupee pricing, IST timestamps).

   Set NEWS_FEEDS to a comma-separated list of ids to run a subset, for
   example NEWS_FEEDS=pvtech,mercom-india.
   ------------------------------------------------------------------------- */

export const FEED_CATALOGUE = Object.freeze([
  {
    id: "pvtech",
    name: "PV Tech",
    url: "https://www.pv-tech.org/feed/",
    homepage: "https://www.pv-tech.org/",
    weight: 3,
    region: "global"
  },
  {
    id: "pv-magazine",
    name: "pv magazine",
    url: "https://www.pv-magazine.com/feed/",
    homepage: "https://www.pv-magazine.com/",
    weight: 3,
    region: "global"
  },
  {
    id: "energy-storage-news",
    name: "Energy-Storage.news",
    url: "https://www.energy-storage.news/feed/",
    homepage: "https://www.energy-storage.news/",
    weight: 3,
    region: "global"
  },
  {
    id: "mercom-india",
    name: "Mercom India",
    url: "https://mercomindia.com/feed/",
    homepage: "https://mercomindia.com/",
    weight: 3,
    region: "india"
  },
  {
    id: "et-energy",
    name: "ET EnergyWorld",
    url: "https://energy.economictimes.indiatimes.com/rss/topstories",
    homepage: "https://energy.economictimes.indiatimes.com/",
    weight: 3,
    region: "india"
  },
  {
    id: "utility-dive",
    name: "Utility Dive",
    url: "https://www.utilitydive.com/feeds/news/",
    homepage: "https://www.utilitydive.com/",
    weight: 2,
    region: "global"
  },
  {
    id: "reneweconomy",
    name: "RenewEconomy",
    url: "https://reneweconomy.com.au/feed/",
    homepage: "https://reneweconomy.com.au/",
    weight: 2,
    region: "global"
  },
  {
    id: "cleantechnica",
    name: "CleanTechnica",
    url: "https://cleantechnica.com/feed/",
    homepage: "https://cleantechnica.com/",
    weight: 1,
    region: "global"
  }
]);

/** Resolve the active feed list, honouring the optional NEWS_FEEDS subset. */
export function selectFeeds(configured = process.env.NEWS_FEEDS) {
  const requested = String(configured ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0) return FEED_CATALOGUE;
  const selected = FEED_CATALOGUE.filter((feed) => requested.includes(feed.id));
  return selected.length > 0 ? selected : FEED_CATALOGUE;
}
