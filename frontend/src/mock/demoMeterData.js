/* ---------------------------------------------------------------------------
   Hard-coded demo meter readings for the dashboard "Generation vs
   consumption" card.

   This is a FALLBACK only. The live `GET /meter-readings` call is untouched:
   as soon as the API returns readings for today, they are used instead, and
   the whole file is ignored. It is also gated by VITE_USE_DEMO_METER_DATA so it
   can be switched off from .env without a code change.

   The shape matches MeterReading exactly (backend/src/models/MeterReading.js)
   so the chart and the summary rows keep working unchanged:
     { _id, userId, timestamp, generationKWh, consumptionKWh, surplusKWh }

   Timestamps are rebuilt for "today" in IST on every call, so the card always
   reads as today's data.
   --------------------------------------------------------------------------- */

/** Demo prosumer wallet — the same address the seller workspace uses. */
export const DEMO_WALLET_ADDRESS = "0x5986b556278c69520D61403c6cb2c3F50D810743";

const IST_OFFSET_MS = 330 * 60000; // UTC+5:30

// Hourly solar generation (kWh) for a clear-sky day: near zero at dawn and dusk,
// peaking just after solar noon.
const GENERATION_BY_HOUR = {
  6: 0.05,
  7: 0.35,
  8: 1.2,
  9: 2.4,
  10: 3.6,
  11: 4.6,
  12: 5.25,
  13: 5.1,
  14: 4.25,
  15: 3.1,
  16: 1.9,
  17: 0.95,
  18: 0.3,
  19: 0.05
};

// Household load (kWh) stays fairly flat, with a morning and an evening bump.
const CONSUMPTION_BY_HOUR = {
  6: 0.9,
  7: 1.3,
  8: 1.95,
  9: 2.1,
  10: 1.4,
  11: 1.25,
  12: 1.35,
  13: 1.55,
  14: 1.3,
  15: 1.2,
  16: 1.15,
  17: 1.45,
  18: 1.9,
  19: 2.05
};

const DEMO_HOURS = Object.keys(GENERATION_BY_HOUR).map(Number);

const round2 = (value) => Math.round(value * 100) / 100;

/** Small deterministic ±4% wobble so the series looks measured, not ideal.
    Multiplicative, so a value never flips negative or leaves its intended band. */
function variation(hour, salt) {
  return (((hour * 31 + salt * 17) % 7) - 3) * 0.013;
}

/** The UTC instant that is `hour`:00 IST on the given IST calendar day. */
function istHourInstant(year, monthIndex, day, hour) {
  return new Date(Date.UTC(year, monthIndex, day, hour) - IST_OFFSET_MS).toISOString();
}

/**
 * Demo readings for today (IST), one per hour from 06:00 to 19:00.
 * @param {Date} [now] injectable clock; defaults to the current time.
 */
export function demoMeterReadings(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const monthIndex = ist.getUTCMonth();
  const day = ist.getUTCDate();

  return DEMO_HOURS.map((hour) => {
    const generationKWh = round2(GENERATION_BY_HOUR[hour] * (1 + variation(hour, 1)));
    const consumptionKWh = round2(CONSUMPTION_BY_HOUR[hour] * (1 + variation(hour, 2)));

    return {
      _id: `demo-meter-${hour}`,
      userId: DEMO_WALLET_ADDRESS,
      timestamp: istHourInstant(year, monthIndex, day, hour),
      generationKWh,
      consumptionKWh,
      surplusKWh: round2(generationKWh - consumptionKWh)
    };
  });
}
