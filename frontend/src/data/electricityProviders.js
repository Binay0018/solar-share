/* ==========================================================================
   Electricity provider directory + verified tariff reference.

   ISOLATED FRONTEND DATA. This module is self-contained: it does not call the
   backend, the chain, or any trading flow, and nothing here changes an offer,
   a trade, a settlement or any API contract. It only describes publicly
   published electricity distribution utilities and the retail tariff figures
   that could be transcribed from an official regulator / licensee document.

   Integrity rules followed when this file was written:
     * A tariff figure is included ONLY when it was read from an official
       source (the state regulator or the licensee) and the exact document is
       recorded in `source`. Nothing is estimated, inferred or invented.
     * Providers whose tariff could not be transcribed carry
       `scheduleId: null` and a note pointing at the official tariff document,
       so the UI can mark the value "Not available" instead of guessing.
     * Every schedule carries its `effectiveFrom` date, so a schedule that has
       since been revised is never presented as the current price without the
       date that qualifies it.
   Reviewed against the sources below on the date in TARIFF_DATA_REVIEWED_ON.
   ========================================================================== */

export const TARIFF_DATA_REVIEWED_ON = "2026-10-15";

export const REGULATORS = {
  MERC: { acronym: "MERC", name: "Maharashtra Electricity Regulatory Commission", website: "https://merc.gov.in/" },
  KERC: { acronym: "KERC", name: "Karnataka Electricity Regulatory Commission", website: "https://karunadu.karnataka.gov.in/kerc/" },
  OERC: { acronym: "OERC", name: "Odisha Electricity Regulatory Commission", website: "https://www.orierc.org/" },
  GERC: { acronym: "GERC", name: "Gujarat Electricity Regulatory Commission", website: "https://www.gercin.org/" },
  KSERC: { acronym: "KSERC", name: "Kerala State Electricity Regulatory Commission", website: "https://erckerala.org/" },
  TGERC: { acronym: "TGERC", name: "Telangana State Electricity Regulatory Commission", website: "https://www.tgerc.telangana.gov.in/" },
  APERC: { acronym: "APERC", name: "Andhra Pradesh Electricity Regulatory Commission", website: "https://aperc.gov.in/" },
  DERC: { acronym: "DERC", name: "Delhi Electricity Regulatory Commission", website: "https://derc.gov.in/" },
  BERC: { acronym: "BERC", name: "Bihar Electricity Regulatory Commission", website: "https://berc.co.in/" }
};

/* --------------------------------------------------------------------------
   Tariff schedules — one record per regulator order actually read.

   slabs[] is ordered by consumption band. upToKWh === null means "all further
   units". energyCharge and wheelingCharge are ₹ per kWh; fixedChargePerMonth
   is ₹ per connection per month where the order prices it that way.
   -------------------------------------------------------------------------- */
export const TARIFF_SCHEDULES = [
  {
    id: "merc-aeml-fy2026-27",
    providerIds: ["adani-mumbai"],
    regulatorId: "MERC",
    orderReference: "MERC Multi-Year Tariff Order dated 28 March 2025, Case No. 211 of 2024 (AEML-D), Annexure 3 — tariff for FY 2026-27",
    periodLabel: "FY 2026-27",
    effectiveFrom: "2026-04-01",
    effectiveUntil: "2027-03-31",
    category: "LT-I(B) Residential — telescopic slabs",
    notes: [
      "The variable charge is the sum of the energy charge and the wheeling charge.",
      "Excludes fixed charges, electricity duty, fuel adjustment charges and taxes.",
      "A separate BPL category is billed ₹2.40/kWh energy + ₹2.28/kWh wheeling with a ₹12 monthly fixed charge."
    ],
    source: {
      label: "MERC press note — MYT Order for AEML-D",
      publisher: "Maharashtra Electricity Regulatory Commission (MERC)",
      url: "https://merc.gov.in/wp-content/uploads/2025/03/Press-Note_MYT-Order_AEML_English.pdf"
    },
    slabs: [
      { upToKWh: 100, energyCharge: 2.65, wheelingCharge: 2.28, fixedChargePerMonth: 90 },
      { upToKWh: 300, energyCharge: 5.85, wheelingCharge: 2.28, fixedChargePerMonth: 135 },
      { upToKWh: 500, energyCharge: 7.1, wheelingCharge: 2.28, fixedChargePerMonth: 135 },
      { upToKWh: null, energyCharge: 8.35, wheelingCharge: 2.28, fixedChargePerMonth: 160 }
    ]
  },
  {
    id: "merc-tpcd-fy2026-27",
    providerIds: ["tpc-mumbai"],
    regulatorId: "MERC",
    orderReference: "MERC Multi-Year Tariff Order dated 28 March 2025, Case No. 210 of 2024 (TPC-D), Annexure 3 — tariff for FY 2026-27",
    periodLabel: "FY 2026-27",
    effectiveFrom: "2026-04-01",
    effectiveUntil: "2027-03-31",
    category: "LT-I(B) Residential — telescopic slabs",
    notes: [
      "The variable charge is the sum of the energy charge and the wheeling charge.",
      "Excludes fixed charges, electricity duty, fuel adjustment charges and taxes."
    ],
    source: {
      label: "MERC press note — MYT Order for TPC-D",
      publisher: "Maharashtra Electricity Regulatory Commission (MERC)",
      url: "https://merc.gov.in/wp-content/uploads/2025/03/Press-Note_MYT-Order_TPC_English.pdf"
    },
    slabs: [
      { upToKWh: 100, energyCharge: 1.9, wheelingCharge: 2.4, fixedChargePerMonth: 90 },
      { upToKWh: 300, energyCharge: 4.7, wheelingCharge: 2.4, fixedChargePerMonth: 135 },
      { upToKWh: 500, energyCharge: 9.24, wheelingCharge: 2.4, fixedChargePerMonth: 135 },
      { upToKWh: null, energyCharge: 10.24, wheelingCharge: 2.4, fixedChargePerMonth: 160 }
    ]
  },
  {
    id: "kerc-bescom-fy2026-27",
    providerIds: ["bescom"],
    regulatorId: "KERC",
    orderReference: "KERC tariff order dated 27 March 2025, published by BESCOM as “Electricity Tariff – 2026 to 2028”, Tariff Schedule LT-1 (Domestic)",
    periodLabel: "FY 2026-27",
    effectiveFrom: "2026-04-01",
    effectiveUntil: "2027-03-31",
    category: "LT-1 Domestic — single energy slab",
    notes: [
      "Karnataka moved domestic energy charges to a single slab, so every unit is billed at the same rate.",
      "Excludes fixed charges, electricity tax and other statutory levies.",
      "A ₹25/kW fixed-charge rebate applies to domestic installations with rooftop solar up to 10 kW."
    ],
    source: {
      label: "BESCOM “Electricity Tariff – 2026 to 2028” (KERC order, 27 March 2025)",
      publisher: "Bangalore Electricity Supply Company Ltd (BESCOM)",
      url: "https://bescom.karnataka.gov.in/uploads/media_to_upload1775021662.pdf"
    },
    slabs: [
      { upToKWh: null, energyCharge: 5.8, wheelingCharge: null, fixedChargePerMonth: null, fixedChargeNote: "₹150 per kW of sanctioned load per month" }
    ]
  },
  {
    id: "oerc-odisha-fy2025-26",
    providerIds: ["tpco-odisha", "tpwo-odisha", "tpso-odisha", "tpno-odisha"],
    regulatorId: "OERC",
    orderReference: "OERC common order dated 24 March 2025 — Retail Supply Tariff FY 2025-26 (Case Nos. 50/84/85/86/87, 88-91, 95-98, 99-102 of 2024)",
    periodLabel: "FY 2025-26",
    effectiveFrom: "2025-04-01",
    effectiveUntil: null,
    category: "LT Domestic (excluding Kutir Jyoti) — telescopic slabs",
    notes: [
      "A single OERC order sets this schedule for all four Odisha distribution companies.",
      "Excludes the monthly fixed charge, electricity duty and other statutory levies.",
      "A separate Kutir Jyoti category (up to 30 units a month) is published with the same notification and is not reproduced here."
    ],
    source: {
      label: "OERC retail supply tariff notification for FY 2025-26",
      publisher: "Odisha Electricity Regulatory Commission (OERC)",
      url: "https://www.orierc.org/CuteSoft_Client/writereaddata/upload/DISCOM_Tariff_Notification_FY_2025_26.PDF"
    },
    slabs: [
      { upToKWh: 50, energyCharge: 2.9, wheelingCharge: null, fixedChargePerMonth: null },
      { upToKWh: 200, energyCharge: 4.7, wheelingCharge: null, fixedChargePerMonth: null },
      { upToKWh: 400, energyCharge: 5.7, wheelingCharge: null, fixedChargePerMonth: null },
      { upToKWh: null, energyCharge: 6.1, wheelingCharge: null, fixedChargePerMonth: null }
    ]
  }
];

const UNAVAILABLE_NOTE =
  "The regulator publishes this utility's residential tariff in its own tariff order, but the figures were not transcribed here. Open the official document and confirm before relying on a number.";

/* --------------------------------------------------------------------------
   Provider directory. `officialWebsite` was reachable when the record was
   written; `tariffPageUrl` is the licensee page that links to its own tariff
   documents. A null scheduleId means "tariff value not available here".
   -------------------------------------------------------------------------- */
export const PROVIDERS = [
  {
    id: "msedcl",
    name: "Maharashtra State Electricity Distribution Co. Ltd",
    shortName: "MSEDCL",
    state: "Maharashtra",
    sector: "State-owned",
    officialWebsite: "https://www.mahadiscom.in/",
    tariffPageUrl: "https://www.mahadiscom.in/en/consumer/tariff-details/",
    regulatorId: "MERC",
    scheduleId: null,
    tariffNote: `${UNAVAILABLE_NOTE} The most recent order on the licensee's tariff page is the MYT order in Case No. 75 of 2025.`
  },
  {
    id: "adani-mumbai",
    name: "Adani Electricity Mumbai Ltd",
    shortName: "Adani Electricity",
    state: "Maharashtra",
    sector: "Private",
    officialWebsite: "https://www.adanielectricity.com/",
    tariffPageUrl: "https://www.adanielectricity.com/tariff",
    regulatorId: "MERC",
    scheduleId: "merc-aeml-fy2026-27"
  },
  {
    id: "tpc-mumbai",
    name: "Tata Power Company Ltd — Distribution (Mumbai)",
    shortName: "Tata Power Mumbai",
    state: "Maharashtra",
    sector: "Private",
    officialWebsite: "https://www.tatapower.com/",
    tariffPageUrl: "https://www.tatapower.com/businesses/distribution/mumbai",
    regulatorId: "MERC",
    scheduleId: "merc-tpcd-fy2026-27"
  },
  {
    id: "bescom",
    name: "Bangalore Electricity Supply Company Ltd",
    shortName: "BESCOM",
    state: "Karnataka",
    sector: "State-owned",
    officialWebsite: "https://bescom.karnataka.gov.in/",
    tariffPageUrl: "https://bescom.karnataka.gov.in/62/bescom-tariff/en",
    regulatorId: "KERC",
    scheduleId: "kerc-bescom-fy2026-27"
  },
  {
    id: "tpco-odisha",
    name: "TP Central Odisha Distribution Ltd",
    shortName: "TPCODL",
    state: "Odisha",
    sector: "Joint venture",
    officialWebsite: "https://www.tpcentralodisha.com/",
    tariffPageUrl: null,
    regulatorId: "OERC",
    scheduleId: "oerc-odisha-fy2025-26"
  },
  {
    id: "tpwo-odisha",
    name: "TP Western Odisha Distribution Ltd",
    shortName: "TPWODL",
    state: "Odisha",
    sector: "Joint venture",
    officialWebsite: "https://www.tpwesternodisha.com/",
    tariffPageUrl: null,
    regulatorId: "OERC",
    scheduleId: "oerc-odisha-fy2025-26"
  },
  {
    id: "tpso-odisha",
    name: "TP Southern Odisha Distribution Ltd",
    shortName: "TPSODL",
    state: "Odisha",
    sector: "Joint venture",
    officialWebsite: "https://www.tpsouthernodisha.com/",
    tariffPageUrl: "https://www.tpsouthernodisha.com/Editor_UploadedDocuments/Content/TPSODL_Tariff_Notification_2025-26.pdf",
    regulatorId: "OERC",
    scheduleId: "oerc-odisha-fy2025-26"
  },
  {
    id: "tpno-odisha",
    name: "TP Northern Odisha Distribution Ltd",
    shortName: "TPNODL",
    state: "Odisha",
    sector: "Joint venture",
    officialWebsite: null,
    tariffPageUrl: null,
    regulatorId: "OERC",
    scheduleId: "oerc-odisha-fy2025-26"
  },
  {
    id: "dgvcl",
    name: "Dakshin Gujarat Vij Company Ltd",
    shortName: "DGVCL",
    state: "Gujarat",
    sector: "State-owned",
    officialWebsite: "https://www.dgvcl.com/",
    tariffPageUrl: null,
    regulatorId: "GERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "mgvcl",
    name: "Madhya Gujarat Vij Company Ltd",
    shortName: "MGVCL",
    state: "Gujarat",
    sector: "State-owned",
    officialWebsite: "https://www.mgvcl.com/",
    tariffPageUrl: null,
    regulatorId: "GERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "pgvcl",
    name: "Paschim Gujarat Vij Company Ltd",
    shortName: "PGVCL",
    state: "Gujarat",
    sector: "State-owned",
    officialWebsite: "https://www.pgvcl.com/",
    tariffPageUrl: null,
    regulatorId: "GERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "ugvcl",
    name: "Uttar Gujarat Vij Company Ltd",
    shortName: "UGVCL",
    state: "Gujarat",
    sector: "State-owned",
    officialWebsite: "https://www.ugvcl.com/",
    tariffPageUrl: null,
    regulatorId: "GERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "torrent-power",
    name: "Torrent Power Ltd",
    shortName: "Torrent Power",
    state: "Gujarat",
    sector: "Private",
    officialWebsite: "https://www.torrentpower.com/",
    tariffPageUrl: null,
    regulatorId: "GERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "kseb",
    name: "Kerala State Electricity Board Ltd",
    shortName: "KSEB",
    state: "Kerala",
    sector: "State-owned",
    officialWebsite: "https://kseb.in/",
    tariffPageUrl: null,
    regulatorId: "KSERC",
    scheduleId: null,
    tariffNote: `${UNAVAILABLE_NOTE} Kerala's domestic tariff was revised again during FY 2025-26, so only the regulator's order should be used.`
  },
  {
    id: "tgspdcl",
    name: "Telangana Southern Power Distribution Company Ltd",
    shortName: "TGSPDCL",
    state: "Telangana",
    sector: "State-owned",
    officialWebsite: "https://www.tgsouthernpower.org/",
    tariffPageUrl: null,
    regulatorId: "TGERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "apspdcl",
    name: "Andhra Pradesh Southern Power Distribution Company Ltd",
    shortName: "APSPDCL",
    state: "Andhra Pradesh",
    sector: "State-owned",
    officialWebsite: "https://www.apspdcl.in/",
    tariffPageUrl: null,
    regulatorId: "APERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "apepdcl",
    name: "Andhra Pradesh Eastern Power Distribution Company Ltd",
    shortName: "APEPDCL",
    state: "Andhra Pradesh",
    sector: "State-owned",
    officialWebsite: "https://www.apeasternpower.com/",
    tariffPageUrl: null,
    regulatorId: "APERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "apcpdcl",
    name: "Andhra Pradesh Central Power Distribution Company Ltd",
    shortName: "APCPDCL",
    state: "Andhra Pradesh",
    sector: "State-owned",
    officialWebsite: "https://www.apcpdcl.in/",
    tariffPageUrl: null,
    regulatorId: "APERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "bses-rajdhani",
    name: "BSES Rajdhani Power Ltd",
    shortName: "BSES Rajdhani",
    state: "Delhi",
    sector: "Private",
    officialWebsite: "https://www.bsesdelhi.com/",
    tariffPageUrl: null,
    regulatorId: "DERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "tpddl",
    name: "Tata Power Delhi Distribution Ltd",
    shortName: "Tata Power Delhi",
    state: "Delhi",
    sector: "Joint venture",
    officialWebsite: "https://www.tatapower-ddl.com/",
    tariffPageUrl: null,
    regulatorId: "DERC",
    scheduleId: null,
    tariffNote: UNAVAILABLE_NOTE
  },
  {
    id: "bsphcl",
    name: "Bihar State Power (Holding) Company Ltd",
    shortName: "BSPHCL",
    state: "Bihar",
    sector: "State-owned",
    officialWebsite: "https://www.bsphcl.co.in/",
    tariffPageUrl: null,
    regulatorId: "BERC",
    scheduleId: null,
    tariffNote: `${UNAVAILABLE_NOTE} Distribution in Bihar is carried out through NBPDCL and SBPDCL.`
  }
];

/* --------------------------------------------------------------------------
   Read-only lookups and pure arithmetic. No side effects, no network.
   -------------------------------------------------------------------------- */

export const scheduleById = (id) => TARIFF_SCHEDULES.find((schedule) => schedule.id === id) ?? null;

export const scheduleForProvider = (provider) => (provider?.scheduleId ? scheduleById(provider.scheduleId) : null);

export const regulatorFor = (provider) => (provider?.regulatorId ? REGULATORS[provider.regulatorId] ?? null : null);

export const providerStates = () => [...new Set(PROVIDERS.map((provider) => provider.state))].sort();

export const stateCount = () => providerStates().length;

export const verifiedProviderCount = () => PROVIDERS.filter((provider) => scheduleForProvider(provider)).length;

/** Total variable charge in ₹ for `kWh` units, applying each slab to the units
    that fall inside it (telescopic). Returns null when no schedule is given. */
export function variableCostForKWh(schedule, kWh) {
  if (!schedule || !Number.isFinite(kWh) || kWh <= 0) return null;
  let remaining = kWh;
  let previousCeiling = 0;
  let cost = 0;
  for (const slab of schedule.slabs) {
    const ceiling = slab.upToKWh ?? Number.POSITIVE_INFINITY;
    const unitsInSlab = Math.min(remaining, ceiling - previousCeiling);
    if (unitsInSlab > 0) {
      cost += unitsInSlab * ((slab.energyCharge ?? 0) + (slab.wheelingCharge ?? 0));
      remaining -= unitsInSlab;
    }
    previousCeiling = ceiling;
    if (remaining <= 0) break;
  }
  return cost;
}

/** Average variable charge in ₹ per kWh at this consumption level. */
export function averageVariableRateForKWh(schedule, kWh) {
  const cost = variableCostForKWh(schedule, kWh);
  if (cost === null || kWh <= 0) return null;
  return cost / kWh;
}

/** Live SolarShare reference price from the open marketplace offers already
    loaded by the app (/offers). Nothing is fetched or written here. */
export function liveMarketRates(offers = []) {
  const rates = offers
    .filter((offer) => offer?.status === "open" && Number(offer.kWhAvailable) > 0)
    .map((offer) => Number(offer.pricePerKWh))
    .filter((rate) => Number.isFinite(rate) && rate > 0);
  if (!rates.length) return null;
  return {
    count: rates.length,
    lowest: Math.min(...rates),
    average: rates.reduce((total, rate) => total + rate, 0) / rates.length
  };
}
