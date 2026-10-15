import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  EmptyState,
  FilterGroup,
  PageIntro,
  Panel,
  SearchInput,
  SelectField,
  StatCard
} from "./FlowComponents.jsx";
import {
  PROVIDERS,
  TARIFF_DATA_REVIEWED_ON,
  averageVariableRateForKWh,
  liveMarketRates,
  providerStates,
  regulatorFor,
  scheduleForProvider,
  variableCostForKWh,
  verifiedProviderCount
} from "./data/electricityProviders.js";

/* =========================================================================
   Electricity provider directory, tariff reference and price comparison.

   Read-only and isolated: this page only reads the dataset in
   ./data/electricityProviders.js and, optionally, the open solar offers the app
   has already loaded from GET /offers. It never creates, mutates or settles
   anything, and it introduces no API of its own.
   ========================================================================= */

const rupees = (value) => `₹${Number(value ?? 0).toFixed(2)}`;

const formatDate = (value) =>
  value
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "—";

/** Turn [0,100][100,300][300,500][500,∞] into readable band labels. */
function slabBands(slabs) {
  let previous = 0;
  return slabs.map((slab) => {
    const ceiling = slab.upToKWh;
    const label = ceiling == null
      ? `Above ${previous} kWh`
      : previous === 0
        ? `0 – ${ceiling} kWh`
        : `${previous + 1} – ${ceiling} kWh`;
    if (ceiling != null) previous = ceiling;
    return { ...slab, band: label };
  });
}

function TariffStatus({ schedule }) {
  return schedule
    ? <span className="flow-status flow-status-verified">Verified from order</span>
    : <span className="flow-status flow-status-unavailable">Not available</span>;
}

/* -------------------------------------------------------------------------
   Tariff reference — the published slabs for one provider.
   ------------------------------------------------------------------------- */
function TariffReference({ provider }) {
  const schedule = scheduleForProvider(provider);
  const regulator = regulatorFor(provider);

  if (!schedule) {
    return (
      <div className="flow-tariff-unavailable" role="status">
        <strong>Residential tariff not transcribed for {provider.shortName}.</strong>
        <p>{provider.tariffNote}</p>
        <p className="flow-muted">
          Regulator: {regulator ? `${regulator.name} (${regulator.acronym})` : "—"}
        </p>
        {provider.tariffPageUrl && (
          <a className="flow-secondary" href={provider.tariffPageUrl} target="_blank" rel="noreferrer noopener">
            Open the licensee's tariff documents<span aria-hidden="true"> ↗</span>
          </a>
        )}
      </div>
    );
  }

  const bands = slabBands(schedule.slabs);

  return (
    <div className="flow-tariff-reference">
      <dl className="flow-tariff-facts">
        <div><dt>Category</dt><dd>{schedule.category}</dd></div>
        <div><dt>Tariff period</dt><dd>{schedule.periodLabel} · effective {formatDate(schedule.effectiveFrom)}{schedule.effectiveUntil ? ` to ${formatDate(schedule.effectiveUntil)}` : ""}</dd></div>
        <div><dt>Regulator</dt><dd>{regulator ? `${regulator.name} (${regulator.acronym})` : "—"}</dd></div>
        <div><dt>Order</dt><dd>{schedule.orderReference}</dd></div>
      </dl>

      <div className="flow-table-wrap flow-table-wrap-tariff">
        <table>
          <caption>{provider.shortName} — {schedule.category} · {schedule.periodLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Consumption band</th>
              <th scope="col">Energy charge</th>
              <th scope="col">Wheeling charge</th>
              <th scope="col">Variable charge</th>
              <th scope="col">Fixed charge</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band) => (
              <tr key={band.band}>
                <td className="num">{band.band}</td>
                <td className="num">{rupees(band.energyCharge)} / kWh</td>
                <td className="num">{band.wheelingCharge == null ? "—" : `${rupees(band.wheelingCharge)} / kWh`}</td>
                <td className="num">{rupees((band.energyCharge ?? 0) + (band.wheelingCharge ?? 0))} / kWh</td>
                <td className="num">{band.fixedChargePerMonth != null ? `${rupees(band.fixedChargePerMonth)} / month` : band.fixedChargeNote ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flow-tariff-notes">
        {schedule.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>

      <p className="flow-muted flow-tariff-source">
        Source: <a href={schedule.source.url} target="_blank" rel="noreferrer noopener">{schedule.source.label}<span aria-hidden="true"> ↗</span></a> · {schedule.source.publisher}. Transcribed on {formatDate(TARIFF_DATA_REVIEWED_ON)}.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Price comparison + monthly cost calculator.
   ------------------------------------------------------------------------- */
function TariffCalculator({ providersWithTariff, selectedProvider, onSelectProvider, market }) {
  const [kWh, setKWh] = useState("300");
  const [rate, setRate] = useState("");
  const [rateEdited, setRateEdited] = useState(false);

  useEffect(() => {
    if (!rateEdited && market) setRate(market.average.toFixed(2));
  }, [market, rateEdited]);

  const schedule = scheduleForProvider(selectedProvider);
  const consumption = Number(kWh);
  const consumptionValid = Number.isFinite(consumption) && consumption > 0;
  const p2pRate = Number(rate);
  const p2pValid = Number.isFinite(p2pRate) && p2pRate > 0;

  const gridCost = schedule && consumptionValid ? variableCostForKWh(schedule, consumption) : null;
  const gridRate = schedule && consumptionValid ? averageVariableRateForKWh(schedule, consumption) : null;
  const p2pCost = consumptionValid && p2pValid ? consumption * p2pRate : null;
  const difference = gridCost !== null && p2pCost !== null ? p2pCost - gridCost : null;

  return (
    <Panel eyebrow="PRICE COMPARISON" title="Compare the grid tariff with SolarShare">
      <p className="flow-copy">
        Pick a utility whose published residential tariff is transcribed above, enter a monthly consumption, and compare
        the grid&apos;s variable charge with buying the same energy on SolarShare at the live marketplace rate.
        The estimate covers <strong>energy and wheeling charges only</strong> — fixed charges, electricity duty,
        fuel adjustment charges and taxes are excluded, so treat it as a like-for-like unit comparison, not a bill.
      </p>

      <div className="flow-tariff-calc">
        <div className="flow-tariff-inputs">
          <label className="flow-field">
            <span>Utility<em>verified tariff</em></span>
            <select value={selectedProvider?.id ?? ""} onChange={(event) => onSelectProvider(event.target.value)}>
              {providersWithTariff.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.shortName} · {provider.state}</option>
              ))}
            </select>
          </label>
          <label className="flow-field">
            <span>Monthly consumption<em>kWh</em></span>
            <input type="number" min="1" step="1" value={kWh} onChange={(event) => setKWh(event.target.value)} />
          </label>
          <label className="flow-field">
            <span>SolarShare rate<em>₹ per kWh</em></span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={rate}
              onChange={(event) => { setRateEdited(true); setRate(event.target.value); }}
            />
            <small>
              {market
                ? `Prefilled from ${market.count} open offer${market.count === 1 ? "" : "s"} on the live marketplace (average ${rupees(market.average)}/kWh, lowest ${rupees(market.lowest)}/kWh).`
                : "No open offers are listed right now — enter a rate to compare."}
            </small>
          </label>
        </div>

        <div className="flow-tariff-results" role="status" aria-live="polite">
          {!schedule ? (
            <p className="flow-muted">No verified tariff is available for this utility, so no comparison is calculated.</p>
          ) : !consumptionValid ? (
            <p className="flow-muted">Enter a monthly consumption of at least 1 kWh to calculate the comparison.</p>
          ) : (
            <>
              <div className="flow-fill-preview">
                <strong>{selectedProvider.shortName} · impact at {consumption.toLocaleString("en-IN")} kWh / month</strong>
                <div>Grid variable charge: <strong>{rupees(gridRate)}/kWh</strong> · <strong>{rupees(gridCost)}</strong> for the month</div>
                <div>SolarShare at {rupees(p2pRate)}/kWh: <strong>{p2pValid ? rupees(p2pCost) : "enter a rate"}</strong></div>
                {difference !== null && (
                  <div className="total">
                    {difference >= 0
                      ? <>Saving versus the grid: <strong>{rupees(difference)}</strong> ({((difference / gridCost) * 100).toFixed(1)}%)</>
                      : <>Paying <strong>{rupees(Math.abs(difference))}</strong> more than the grid at this rate</>}
                  </div>
                )}
              </div>

              {p2pValid && (
                <>
                  <div className="flow-tariff-chart">
                    <BarChart
                      ariaLabel={`Grid variable charge ${rupees(gridRate)} per kWh compared with a SolarShare rate of ${rupees(p2pRate)} per kWh`}
                      groups={[
                        { label: "Grid ₹/kWh", values: [gridRate] },
                        { label: "SolarShare ₹/kWh", values: [p2pRate] }
                      ]}
                    />
                  </div>
                  <div className="flow-legend">
                    <span className="tariff-grid">Grid variable charge</span>
                    <span className="tariff-p2p">SolarShare rate</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------
   Page
   ------------------------------------------------------------------------- */
export function TariffPage({ offers = [] }) {
  const firstVerifiedId = useMemo(
    () => PROVIDERS.find((provider) => scheduleForProvider(provider))?.id ?? PROVIDERS[0]?.id,
    []
  );
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [scope, setScope] = useState("all");
  const [referenceId, setReferenceId] = useState(firstVerifiedId);
  const [calcId, setCalcId] = useState(firstVerifiedId);

  const market = useMemo(() => liveMarketRates(offers), [offers]);
  const states = useMemo(() => providerStates(), []);

  const referenceProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.id === referenceId) ?? PROVIDERS[0],
    [referenceId]
  );

  const calcProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.id === calcId) ?? PROVIDERS[0],
    [calcId]
  );

  const providersWithTariff = useMemo(() => PROVIDERS.filter((provider) => scheduleForProvider(provider)), []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PROVIDERS.filter((provider) => {
      if (stateFilter !== "all" && provider.state !== stateFilter) return false;
      if (scope === "verified" && !scheduleForProvider(provider)) return false;
      if (!needle) return true;
      return `${provider.name} ${provider.shortName} ${provider.state} ${provider.sector}`.toLowerCase().includes(needle);
    });
  }, [query, stateFilter, scope]);

  const stateOptions = useMemo(
    () => [["all", `All states (${states.length})`], ...states.map((state) => [state, state])],
    [states]
  );

  return (
    <div className="flow-page">
      <PageIntro
        eyebrow="TARIFF REFERENCE"
        title="Electricity providers, tariffs & price comparison"
        detail="A directory of Indian distribution utilities with the residential tariff figures that could be transcribed from an official regulator or licensee document, and a calculator that compares them with the SolarShare marketplace."
      />

      <div className="flow-note">
        <span>
          <strong>Where these numbers come from.</strong> A tariff appears here only when it was read from an official
          order published by the state regulator or the licensee, and the exact document is linked with each schedule.
          Utilities whose tariff could not be transcribed are listed as <strong>Not available</strong> rather than
          filled with an estimate. Grid bills also include fixed charges, electricity duty and fuel adjustment
          charges that are not part of the figures below — always confirm against the linked order.
        </span>
      </div>

      <section className="flow-stat-grid" aria-label="Directory summary">
        <StatCard icon="☰" tone="sun" label="Utilities listed" value={PROVIDERS.length} detail={`${states.length} states and union territories`} />
        <StatCard icon="✓" tone="green" label="Residential tariffs verified" value={verifiedProviderCount()} detail="Transcribed from an official order" />
        <StatCard icon="⚡" label="Open market offers" value={market ? market.count : 0} detail={market ? `Lowest ${rupees(market.lowest)}/kWh on the marketplace` : "No open offers listed right now"} />
        <StatCard icon="◷" label="Data reviewed" value={formatDate(TARIFF_DATA_REVIEWED_ON)} detail="Date the linked orders were last read" />
      </section>

      <TariffCalculator
        providersWithTariff={providersWithTariff}
        selectedProvider={calcProvider}
        onSelectProvider={setCalcId}
        market={market}
      />

      <Panel
        eyebrow="ELECTRICITY PROVIDER DIRECTORY"
        title="Distribution utilities"
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Search utility or state" label="Search utilities by name or state" />
            <SelectField label="Filter by state" value={stateFilter} onChange={setStateFilter} options={stateOptions} />
            <FilterGroup
              label="Filter by tariff availability"
              value={scope}
              onChange={setScope}
              options={[["all", "All"], ["verified", "Verified tariff"]]}
            />
          </>
        }
      >
        {visible.length ? (
          <div className="flow-table-wrap flow-table-wrap-tariff">
            <table>
              <caption>{visible.length} of {PROVIDERS.length} utilities shown</caption>
              <thead>
                <tr>
                  <th scope="col">Utility</th>
                  <th scope="col">State</th>
                  <th scope="col">Regulator</th>
                  <th scope="col">Residential tariff</th>
                  <th scope="col">Official site</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((provider) => {
                  const schedule = scheduleForProvider(provider);
                  const regulator = regulatorFor(provider);
                  return (
                    <tr key={provider.id}>
                      <td>
                        <strong className="flow-tariff-name">{provider.shortName}</strong>
                        <span className="flow-muted flow-tariff-fullname">{provider.name} · {provider.sector}</span>
                      </td>
                      <td>{provider.state}</td>
                      <td>{regulator ? regulator.acronym : "—"}</td>
                      <td>
                        <TariffStatus schedule={schedule} />
                        {schedule && <span className="flow-muted flow-tariff-period">{schedule.periodLabel}</span>}
                      </td>
                      <td>
                        {provider.officialWebsite
                          ? <a href={provider.officialWebsite} target="_blank" rel="noreferrer noopener">Visit<span className="flow-visually-hidden"> {provider.name} website (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a>
                          : <span className="flow-muted">Not verified</span>}
                      </td>
                      <td>
                        {schedule ? (
                          <button
                            type="button"
                            className="flow-secondary"
                            aria-pressed={provider.id === calcId && provider.id === referenceId}
                            onClick={() => { setCalcId(provider.id); setReferenceId(provider.id); }}
                          >
                            {provider.id === calcId && provider.id === referenceId ? "Selected" : "Compare"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="flow-secondary"
                            aria-pressed={provider.id === referenceId}
                            onClick={() => setReferenceId(provider.id)}
                          >
                            {provider.id === referenceId ? "Selected" : "Details"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="◌"
            title="No utilities match this view"
            detail="Clear the search or widen the state and tariff filters."
            action={<button type="button" className="flow-secondary" onClick={() => { setQuery(""); setStateFilter("all"); setScope("all"); }}>Reset filters</button>}
          />
        )}
      </Panel>

      <Panel
        eyebrow="TARIFF REFERENCE"
        title={referenceProvider ? `${referenceProvider.shortName} · residential tariff` : "Residential tariff"}
      >
        {referenceProvider && <TariffReference provider={referenceProvider} />}
      </Panel>
    </div>
  );
}
