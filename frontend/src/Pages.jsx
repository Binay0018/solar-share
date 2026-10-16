import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther } from "viem";
import {
  contractAddress,
  decodeContractEvent,
  ensureProsumer,
  ensureSepoliaNetwork,
  getPublicClient,
  kWhToContractUnits,
  priceToWei,
  solarShareAbi,
  writeContractWithGas
} from "./contractClient.js";
import PurchaseButton from "./PurchaseButton.jsx";
import SettleButton from "./SettleButton.jsx";
import {
  canSettlePurchase,
  selectBuyerEscrowed,
  selectDirectPurchases,
  selectSellerPendingPurchases,
  selectSellerSettledPurchases
} from "./purchaseQueue.js";
import {
  AddressTag,
  BarChart,
  EmptyState,
  FilterGroup,
  PageIntro,
  Panel,
  SearchInput,
  SelectField,
  Skeleton,
  StatCard,
  StatusBadge,
  StepProgress,
  TxLink,
  userErrorMessage
} from "./FlowComponents.jsx";
import announcements from "./announcements.json";
import { demoMeterReadings } from "./mock/demoMeterData.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Dashboard demo fallback for the "Generation vs consumption" card. On by
// default; set VITE_USE_DEMO_METER_DATA=false in .env to show the empty state
// again. The live /meter-readings call is untouched — real readings always win.
const USE_DEMO_METER_DATA = import.meta.env.VITE_USE_DEMO_METER_DATA !== "false";
const apiRequest = async (path, options) => {
  const response = await fetch(`${apiUrl}${path}`, { headers: { "content-type": "application/json" }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
};
const istDate = (value) => new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 10);
const isToday = (value) => istDate(value) === istDate(Date.now());
const DAY = 86400000;

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatWhen(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function formatTableDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function sum(rows, pick) {
  return rows.reduce((total, row) => total + Number(pick(row) || 0), 0);
}

const isOpenOffer = (offer) => offer.status === "open" && Number(offer.kWhAvailable) > 0;
const rupees = (value) => `₹${Number(value || 0).toFixed(2)}`;

/* =========================================================================
   Dashboard
   ========================================================================= */

export function HomePage({ wallet, metrics, offers, trades, transactions, readings, loading }) {
  const openOffers = offers.filter(isOpenOffer);
  const availableKWh = sum(openOffers, (offer) => offer.kWhAvailable);
  const openRequests = trades.filter((trade) => ["open", "partially_filled"].includes(trade.status));
  const pendingSettlements = transactions.filter((transaction) => !transaction.settledAt);
  const settled = transactions.filter((transaction) => transaction.settledAt);
  const settledKWh = sum(settled, (transaction) => transaction.kWhTraded);
  const settledValue = sum(settled, (transaction) => transaction.totalPrice);
  const averageRate = settledKWh ? settledValue / settledKWh : 0;
  const rates = openOffers.map((offer) => Number(offer.pricePerKWh) || 0);

  const todaysReadings = readings.filter((reading) => isToday(reading.timestamp));
  // Demo fallback: live readings always take priority; the hard-coded series is
  // only used when the API returned nothing for today and the flag is enabled.
  const demoActive = USE_DEMO_METER_DATA && todaysReadings.length === 0;
  const displayReadings = demoActive ? demoMeterReadings() : todaysReadings;
  const generationToday = sum(displayReadings, (reading) => reading.generationKWh);
  const consumptionToday = sum(displayReadings, (reading) => reading.consumptionKWh);
  const surplusToday = generationToday - consumptionToday;

  const activity = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const at = new Date(Date.now() - (6 - index) * DAY);
      return { key: istDate(at), label: new Date(at.getTime() + 330 * 60000).toISOString().slice(8, 10) };
    });
    const collect = (rows, field) => {
      const totals = days.map(() => 0);
      for (const row of rows) {
        const at = row[field];
        if (!at) continue;
        const index = days.findIndex((day) => day.key === istDate(at));
        if (index >= 0) totals[index] += 1;
      }
      return totals;
    };
    const offerSeries = collect(offers, "createdAt");
    const requestSeries = collect(trades, "createdAt");
    const settlementSeries = collect(transactions, "settledAt");
    return days.map((day, index) => ({
      label: day.label,
      values: [offerSeries[index], requestSeries[index], settlementSeries[index]]
    }));
  }, [offers, trades, transactions]);

  const activityTotal = activity.reduce((total, day) => total + day.values.reduce((a, b) => a + b, 0), 0);
  const recentSettlements = [...settled].sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt)).slice(0, 5);
  const gas = metrics?.gas;

  return (
    <div className="flow-page">
      <section className="flow-hero">
        <span className="flow-eyebrow">SOLARSHARE · LOCAL ENERGY, ON-CHAIN SETTLEMENT</span>
        <h1>Clean energy, shared with your neighbours.</h1>
        <p>Rooftop solar prosumers publish offers on Sepolia, buyers purchase into contract escrow, and value moves only when the seller signs <code>settleTrade</code>. Everything on this dashboard comes from the live marketplace and the chain.</p>
        <div className="flow-hero-actions">
          <Link className="flow-primary" to="/sell">Sell energy</Link>
          <Link className="flow-secondary" to="/buy">Buy energy</Link>
          <Link className="flow-secondary" to="/market">Browse market</Link>
        </div>
      </section>

      {loading ? <Skeleton rows={2} /> : (
        <section className="flow-stat-grid" aria-label="Marketplace headline figures">
          <StatCard tone="sun" icon="☼" label="Energy available" value={`${availableKWh.toFixed(2)} kWh`} detail={`${openOffers.length} open offer${openOffers.length === 1 ? "" : "s"} · ${rates.length ? `from ${rupees(Math.min(...rates))}/kWh` : "no live price"}`} />
          <StatCard tone="blue" icon="⇄" label="Active requests" value={openRequests.length} detail="Open or partly filled buyer requests" />
          <StatCard tone="amber" icon="⧗" label="Awaiting settlement" value={pendingSettlements.length} detail="Escrowed purchases still to be settled by their seller" />
          <StatCard tone="green" icon="✓" label="Settled trades" value={settled.length} detail={`${settledKWh.toFixed(2)} kWh delivered on-chain`} />
        </section>
      )}

      {!loading && (
        <section className="flow-stat-grid" aria-label="Ledger and matching analytics">
          <StatCard label="Settled value" value={rupees(settledValue)} detail={settledKWh ? `Average ${rupees(averageRate)} / kWh` : "No settlement yet"} />
          <StatCard
            label="Buyer savings vs baseline"
            value={metrics ? rupees(metrics.buyerSavingsVsBaseline) : "—"}
            detail={metrics ? `Baseline ₹${Number(metrics.baselineRatePerKWh).toFixed(2)} / kWh` : "Metrics unavailable"}
          />
          <StatCard
            label="Matching success rate"
            value={metrics ? `${(Number(metrics.matchingSuccessRate) * 100).toFixed(1)}%` : "—"}
            detail={metrics ? `${metrics.successfulMatches} successful of ${metrics.matchAttempts} attempts` : "Metrics unavailable"}
          />
          <StatCard
            label="Offer → settlement"
            value={metrics ? formatDuration(Number(metrics.averageOfferToSettlementLatencyMs)) : "—"}
            detail={metrics ? `Observed across ${metrics.observedOffers} offers` : "Metrics unavailable"}
          />
        </section>
      )}

      <div className="flow-grid-side">
        <Panel eyebrow="LAST 7 DAYS" title="Marketplace activity">
          {loading ? <Skeleton rows={3} /> : activityTotal ? (
            <>
              <BarChart groups={activity} ariaLabel="Offers created, requests created and settlements per day over the last seven days" />
              <div className="flow-legend">
                <span className="bars-offers">Offers created</span>
                <span className="bars-requests">Requests created</span>
                <span className="bars-settlements">Settlements confirmed</span>
              </div>
            </>
          ) : (
            <EmptyState icon="◷" title="No marketplace activity in the last 7 days" detail="New offers, requests and confirmed settlements will be charted here." />
          )}
        </Panel>

        <div className="flow-list">
          <Panel eyebrow="RIGHT NOW" title="Open market snapshot">
            {openOffers.length ? (
              <div className="flow-list">
                <div className="flow-fill-row"><div><p>Lowest listed rate</p></div><strong>{rupees(Math.min(...rates))} / kWh</strong></div>
                <div className="flow-fill-row"><div><p>Highest listed rate</p></div><strong>{rupees(Math.max(...rates))} / kWh</strong></div>
                <div className="flow-fill-row"><div><p>Average listed rate</p></div><strong>{rupees(rates.reduce((a, b) => a + b, 0) / rates.length)} / kWh</strong></div>
                <div className="flow-fill-row"><div><p>Total supply on offer</p></div><strong>{availableKWh.toFixed(2)} kWh</strong></div>
              </div>
            ) : (
              <EmptyState icon="◌" title="No open offers" detail="The market has no live supply right now." action={<Link className="flow-secondary" to="/sell">Publish an offer</Link>} />
            )}
          </Panel>

          <Panel
            eyebrow="GRID SIGNAL · TODAY"
            title="Generation vs consumption"
            actions={demoActive ? <span className="flow-status">Demo data</span> : null}
          >
            {displayReadings.length ? (
              <>
                <div className="flow-list">
                  <div className="flow-fill-row"><div><p>Total generated</p></div><strong>{generationToday.toFixed(2)} kWh</strong></div>
                  <div className="flow-fill-row"><div><p>Total consumed</p></div><strong>{consumptionToday.toFixed(2)} kWh</strong></div>
                  <div className="flow-fill-row"><div><p>Surplus available to sell</p></div><strong>{surplusToday.toFixed(2)} kWh</strong></div>
                </div>
                <TrendChart readings={displayReadings} />
              </>
            ) : (
              <EmptyState icon="⌁" title="No meter readings today" detail="Readings appear when they are recorded against a participant wallet." />
            )}
          </Panel>
        </div>
      </div>

      <Panel eyebrow="CONFIRMED ON-CHAIN" title="Latest settlements" actions={<Link className="flow-secondary" to="/ledger">Open full ledger</Link>}>
        {loading ? <Skeleton rows={3} /> : recentSettlements.length ? (
          <SettlementTable rows={recentSettlements} />
        ) : (
          <EmptyState icon="◷" title="No settlements confirmed yet" detail="A purchase only appears here after the seller's settlement is verified on-chain." />
        )}
      </Panel>

      <Panel eyebrow="HOW IT WORKS" title="From sunlight to settled payment">
        <div className="flow-process">
          {[
            ["01", "Publish supply", "A prosumer signs createOffer and the listing is mirrored to MongoDB only after the receipt is confirmed."],
            ["02", "Match & escrow", "The matcher buys the cheapest eligible listings on-chain, so the buyer's payment is held in contract escrow."],
            ["03", "Seller settles", "Only the seller's own MetaMask wallet can call settleTrade, which releases escrow and writes the ledger row."]
          ].map(([number, title, detail]) => (
            <article key={number}><span>{number}</span><strong>{title}</strong><p>{detail}</p></article>
          ))}
        </div>
        {gas && (
          <div className="flow-note">
            <span>
              <strong>Observed on-chain gas.</strong> Purchase ≈ {formatEther(BigInt(gas.purchaseEnergyWei))} ETH · Settlement ≈ {formatEther(BigInt(gas.settleTradeWei))} ETH. Quoted live from the deployed contract; the app never hard-codes a gas limit.
            </span>
          </div>
        )}
      </Panel>

      {wallet ? null : <div className="flow-role-banner"><span>Connect MetaMask to buy, sell, or settle trades with your own wallet.</span></div>}
    </div>
  );
}

/* =========================================================================
   Shared building blocks
   ========================================================================= */

function RoleBanner({ role, wallet, participantRole, onRegister }) {
  const neededRole = role === "seller" ? 1 : 2;
  const allowed = participantRole === neededRole || participantRole === 3;
  if (allowed) return null;
  if (!wallet) return <div className="flow-role-banner"><span>Connect a wallet to check or register the {role === "seller" ? "Prosumer" : "Consumer"} role.</span></div>;
  const incompatible = participantRole && participantRole !== neededRole && participantRole !== 3;
  return (
    <div className="flow-role-banner">
      <span>{incompatible
        ? `This wallet is registered for the other role. The contract requires ${role === "seller" ? "Prosumer" : "Consumer"} or Both.`
        : `This wallet is not registered as a ${role === "seller" ? "Prosumer" : "Consumer"}.`}</span>
      {!incompatible && <button className="flow-secondary" type="button" onClick={() => onRegister(neededRole)}>Register as {role === "seller" ? "Prosumer" : "Consumer"} on Sepolia</button>}
    </div>
  );
}

function TrendChart({ readings }) {
  const profile = useMemo(() => {
    const generation = Array(24).fill(0);
    const consumption = Array(24).fill(0);
    for (const reading of readings) {
      const hour = new Date(new Date(reading.timestamp).getTime() + 330 * 60000).getUTCHours();
      generation[hour] += Number(reading.generationKWh || 0);
      consumption[hour] += Number(reading.consumptionKWh || 0);
    }
    return { generation, consumption };
  }, [readings]);
  const max = Math.max(1, ...profile.generation, ...profile.consumption);
  return (
    <>
      <div className="flow-chart" role="img" aria-label="Hourly solar generation and household consumption">
        {profile.generation.map((value, hour) => (
          <span key={hour} title={`${hour}:00 · ${value.toFixed(2)} kWh generation, ${profile.consumption[hour].toFixed(2)} kWh consumption`} style={{ height: `${Math.max(4, (Math.max(value, profile.consumption[hour]) / max) * 100)}%` }}>
            <i style={{ height: `${value + profile.consumption[hour] ? (value / (value + profile.consumption[hour])) * 100 : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="flow-chart-axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
      <div className="flow-legend"><span>Solar generation</span><span>Household consumption</span></div>
    </>
  );
}

function OnChainTag({ offer }) {
  const onChain = Number.isSafeInteger(offer.onChainOfferId);
  return <span className="flow-onchain-tag" data-onchain={onChain ? "true" : "false"}>{onChain ? `On-chain #${offer.onChainOfferId}` : "Off-chain (MongoDB)"}</span>;
}

function SettlementTable({ rows, emptyTitle = "No settled trades yet", emptyDetail = "Settled transfers and their Sepolia transactions will appear here." }) {
  if (!rows.length) return <EmptyState icon="◷" title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="flow-table-wrap">
      <table>
        <caption>Every row below has a confirmed on-chain settlement receipt. Pending purchases are excluded.</caption>
        <thead>
          <tr>
            <th scope="col">Settled (IST)</th>
            <th scope="col">Seller</th>
            <th scope="col">Buyer</th>
            <th scope="col">Energy</th>
            <th scope="col">Value</th>
            <th scope="col">Transactions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((transaction) => (
            <tr key={transaction._id}>
              <td className="num">{formatTableDate(transaction.settledAt)}</td>
              <td><AddressTag address={transaction.sellerId} /></td>
              <td><AddressTag address={transaction.buyerId} /></td>
              <td className="num">{transaction.kWhTraded} kWh</td>
              <td className="num">{rupees(transaction.totalPrice)}</td>
              <td>
                <div className="flow-txstack">
                  <TxLink hash={transaction.purchaseTxHash} label="Purchase" />
                  <TxLink hash={transaction.txHash} label="Settlement" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================================
   Seller workspace
   ========================================================================= */

export function SellPage({ wallet, role, offers, readings, transactions, loading, onRegisterRole, onRefresh, onNotice }) {
  const [form, setForm] = useState({ kWh: "", price: "" });
  const [publishing, setPublishing] = useState(false);
  const [step, setStep] = useState(-1);
  const [offerHashes, setOfferHashes] = useState({});
  const [error, setError] = useState("");
  const mine = wallet ? offers.filter((offer) => offer.sellerId?.toLowerCase() === wallet.toLowerCase()) : [];
  // A confirmed purchase transaction is not a settlement: it stays in the pending
  // queue until a settlement receipt is recorded (or the chain reports the trade
  // settled). Addresses are compared without letter casing.
  const settled = selectSellerSettledPurchases(transactions, wallet);
  const incoming = selectSellerPendingPurchases(transactions, wallet);
  const dailyReadings = readings.filter((reading) => wallet && reading.userId?.toLowerCase() === wallet.toLowerCase() && isToday(reading.timestamp));
  const generation = sum(dailyReadings, (reading) => reading.generationKWh);
  const consumption = sum(dailyReadings, (reading) => reading.consumptionKWh);
  const surplus = dailyReadings.reduce((total, reading) => total + Math.max(0, Number(reading.surplusKWh || 0)), 0);
  const earned = sum(settled, (transaction) => transaction.totalPrice);
  const waitingValue = sum(incoming, (transaction) => transaction.totalPrice);

  async function publish(event) {
    event.preventDefault();
    if (publishing) return;
    setPublishing(true);
    setStep(0);
    setError("");
    try {
      if (!wallet) throw new Error("Connect a seller wallet before publishing an offer.");
      await ensureSepoliaNetwork();
      const kWh = Number(form.kWh);
      const price = Number(form.price);
      if (!Number.isSafeInteger(kWh) || kWh < 1) throw new Error("Enter a positive whole-kWh quantity.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a positive listing price.");
      const priceWei = priceToWei(price);
      await ensureProsumer(wallet);
      onNotice("Confirm the offer transaction in the seller's MetaMask wallet.");
      const hash = await writeContractWithGas(wallet, {
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "createOffer",
        args: [kWhToContractUnits(kWh), priceWei]
      });
      setStep(1);
      onNotice("Offer submitted by MetaMask. Waiting for its Sepolia receipt.");
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The offer transaction failed on-chain.");
      const { offerId } = decodeContractEvent(receipt, "OfferCreated");
      setStep(2);
      onNotice(`Offer #${offerId} confirmed. Registering its marketplace listing.`);
      const response = await apiRequest("/offers", {
        method: "POST",
        body: JSON.stringify({ sellerId: wallet, kWhAvailable: kWh, pricePerKWh: price, onChainOfferId: Number(offerId) })
      });
      setOfferHashes((previous) => ({ ...previous, [response.offer._id]: hash }));
      setStep(3);
      setForm({ kWh: "", price: "" });
      onNotice(`Offer #${offerId} is live. A waiting buyer request may match it automatically; any purchase remains escrowed until you settle it. Create transaction: ${hash}`);
      await onRefresh();
    } catch (cause) {
      setError(userErrorMessage(cause));
      onNotice("");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flow-page">
      <PageIntro eyebrow="SELL ENERGY" title="Seller workspace" detail="Publish on-chain offers, monitor available supply, and settle buyer purchases from your own wallet." />
      <RoleBanner role="seller" wallet={wallet} participantRole={role} onRegister={onRegisterRole} />

      <section className="flow-stat-grid" aria-label="Seller activity">
        <StatCard icon="☼" tone="sun" label="Today's generation" value={`${generation.toFixed(2)} kWh`} detail={`Consumption ${consumption.toFixed(2)} kWh today`} />
        <StatCard icon="↥" label="Available surplus" value={`${surplus.toFixed(2)} kWh`} detail="Surplus recorded in today's readings" />
        <StatCard icon="☰" label="Open offers" value={mine.filter((offer) => offer.status === "open").length} detail={`${mine.length} published in total`} />
        <StatCard icon="₹" tone="green" label="Total earned" value={rupees(earned)} detail="Settled trades only" />
      </section>

      <div className="flow-grid-two">
        <Panel eyebrow="PUBLISH OFFER" title="Sell your solar surplus">
          <p className="flow-copy">The seller signs <code>createOffer</code> in MetaMask. The marketplace listing is saved only after the on-chain transaction succeeds and the backend verifies it.</p>
          <form className="flow-form" onSubmit={publish} aria-busy={publishing}>
            <label className="flow-field">
              <span>Available energy<em>whole kWh</em></span>
              <input type="number" min="1" step="1" value={form.kWh} onChange={(event) => setForm({ ...form, kWh: event.target.value })} required />
            </label>
            <label className="flow-field">
              <span>Marketplace rate<em>₹ per kWh</em></span>
              <input type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
            </label>
            <p className="flow-preview">
              <strong>Contract rate preview</strong>
              {Number(form.price) > 0 ? `${priceToWei(form.price).toString()} wei / kWh (${formatEther(priceToWei(form.price))} ETH / kWh)` : "Enter a rate to preview the integer contract value."}
            </p>
            {step >= 0 && <StepProgress step={step} steps={["Confirm in wallet", "Creating on-chain", "Registering", "Live"]} />}
            {error && <div className="flow-inline-error" role="alert">{error}</div>}
            <button className="flow-primary" type="submit" disabled={publishing}>{publishing ? "Publishing…" : "Publish on Sepolia"}</button>
          </form>
        </Panel>

        <Panel eyebrow="METER DATA" title="Today's generation vs use">
          {dailyReadings.length ? <TrendChart readings={dailyReadings} /> : <EmptyState icon="⌁" title="No readings for this wallet today" detail="Meter readings are listed only when their user ID matches this wallet address." />}
        </Panel>
      </div>

      <Panel eyebrow="YOUR LISTINGS" title="My offers">
        <p className="flow-copy">Offers may be matched automatically against eligible waiting buyer requests. “Sold out” means no kWh remain to buy; it does not mean the buyer's escrow has been released. Check incoming purchases below and settle them from the seller wallet.</p>
        {loading ? <Skeleton /> : mine.length ? (
          <div className="flow-table-wrap">
            <table>
              <caption>Offers published by the connected wallet.</caption>
              <thead>
                <tr>
                  <th scope="col">kWh left</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Status</th>
                  <th scope="col">Listing source</th>
                  <th scope="col">Offer transaction</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((offer) => (
                  <tr key={offer._id}>
                    <td className="num">{offer.kWhAvailable}</td>
                    <td className="num">{rupees(offer.pricePerKWh)} / kWh</td>
                    <td><StatusBadge status={offer.status === "settled" ? "sold_out" : offer.status} /></td>
                    <td><OnChainTag offer={offer} /></td>
                    <td>{offerHashes[offer._id] ? <TxLink hash={offerHashes[offer._id]} label="Create offer" /> : <a href={`https://sepolia.etherscan.io/address/${contractAddress}`} target="_blank" rel="noreferrer">Contract · #{offer.onChainOfferId ?? "—"}</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="☰" title="No offers published yet" detail="Create an offer to make your on-chain surplus available to buyers." action={<Link className="flow-secondary" to="/market">See what's for sale</Link>} />}
      </Panel>

      <Panel
        eyebrow="INCOMING PURCHASES"
        title="Awaiting seller settlement"
        actions={incoming.length ? <span className="flow-status flow-status-awaiting_seller">{incoming.length} trade{incoming.length === 1 ? "" : "s"} · {rupees(waitingValue)} escrowed</span> : null}
      >
        <p className="flow-copy">Only your own MetaMask wallet can sign <code>settleTrade</code> for these purchases. The backend never settles on a seller's behalf.</p>
        {loading ? <Skeleton rows={2} /> : incoming.length ? (
          <div className="flow-list">
            {incoming.map((transaction) => (
              <div className="flow-trade-row" key={transaction._id}>
                <div>
                  <strong>{transaction.kWhTraded} kWh · {rupees(transaction.totalPrice)}</strong>
                  <p>Buyer <AddressTag address={transaction.buyerId} /> · Trade #{transaction.onChainTradeId}</p>
                  <TxLink hash={transaction.purchaseTxHash} label="Purchase" />
                </div>
                {canSettlePurchase(transaction, wallet) ? (
                  <SettleButton trade={transaction} wallet={wallet} onComplete={onNotice} onSettled={onRefresh} />
                ) : (
                  <span className="flow-muted">No on-chain trade ID — nothing can be settled for this purchase.</span>
                )}
              </div>
            ))}
          </div>
        ) : <EmptyState icon="✓" title="No purchases awaiting settlement" detail="The seller wallet connected above must sign settlement to release escrow." />}
      </Panel>

      <Panel eyebrow="CONFIRMED ON-CHAIN" title="Earnings history">
        {loading ? <Skeleton rows={3} /> : (
          <>
            <div className="flow-fill-preview">
              <div>Confirmed settlements: <strong>{settled.length}</strong></div>
              <div>Energy delivered: <strong>{sum(settled, (transaction) => transaction.kWhTraded).toFixed(2)} kWh</strong></div>
              <div className="total">Total released from escrow: <strong>{rupees(earned)}</strong></div>
            </div>
            <SettlementTable rows={settled} emptyTitle="No settled sales yet" emptyDetail="Purchases of your offers appear here once you settle them on-chain." />
          </>
        )}
      </Panel>
    </div>
  );
}

/* =========================================================================
   Buyer workspace
   ========================================================================= */

export function BuyPage({ wallet, role, offers, trades, transactions, loading, onRegisterRole, onRefresh, onNotice }) {
  const [form, setForm] = useState({ kWh: "", maxPrice: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const requests = wallet ? trades.filter((trade) => trade.buyerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const buyerTransactions = wallet ? transactions.filter((transaction) => transaction.buyerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const purchased = buyerTransactions.filter((transaction) => transaction.settledAt);
  // A buyer-signed purchase ("Buy on chain") is linked to a request too, so the
  // backend record — not the presence of a requestId — decides what belongs here.
  const directPurchases = selectDirectPurchases(transactions, trades, wallet);
  const escrowed = selectBuyerEscrowed(transactions, wallet);
  const purchasedKWh = sum(purchased, (transaction) => transaction.kWhTraded);
  const spent = sum(purchased, (transaction) => transaction.totalPrice);

  // Ask the backend for the plan instead of re-implementing the matcher here, so
  // the preview can never promise a fill the matcher would refuse.
  useEffect(() => {
    const kWhNeeded = Number(form.kWh);
    const maxPricePerKWh = Number(form.maxPrice);
    if (!wallet || !Number.isSafeInteger(kWhNeeded) || kWhNeeded < 1 || !Number.isFinite(maxPricePerKWh) || maxPricePerKWh <= 0) {
      setPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest("/trades/preview", {
        method: "POST",
        body: JSON.stringify({ buyerId: wallet, kWhNeeded, maxPricePerKWh }),
        signal: controller.signal
      }).then(setPreview).catch((cause) => {
        if (cause?.name !== "AbortError") setPreview(null);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [wallet, form.kWh, form.maxPrice, offers]);

  async function submitRequest(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (!wallet) throw new Error("Connect the wallet configured as the backend buyer before requesting a matched fill.");
      const kWhNeeded = Number(form.kWh);
      const maxPricePerKWh = Number(form.maxPrice);
      if (!Number.isSafeInteger(kWhNeeded) || kWhNeeded < 1) throw new Error("Enter a positive whole-kWh request.");
      if (!Number.isFinite(maxPricePerKWh) || maxPricePerKWh <= 0) throw new Error("Enter a positive maximum rate.");
      await apiRequest("/trades", { method: "POST", body: JSON.stringify({ buyerId: wallet, kWhNeeded, maxPricePerKWh }) });
      onNotice("Request accepted. The backend is buying the matched listings on-chain with BUYER_PRIVATE_KEY. Each seller settles their own trade, so nothing appears in the ledger until a seller settles.");
      setForm({ kWh: "", maxPrice: "" });
      await onRefresh();
    } catch (cause) {
      const message = userErrorMessage(cause);
      setError(/403|BUYER_PRIVATE_KEY|buyerId must match/i.test(message)
        ? "This request can only use the buyer wallet controlled by the backend's BUYER_PRIVATE_KEY."
        : message);
    } finally {
      setSubmitting(false);
    }
  }

  const otherOffers = offers
    .filter((offer) => isOpenOffer(offer) && (!wallet || offer.sellerId?.toLowerCase() !== wallet.toLowerCase()))
    .sort((a, b) => Number(a.pricePerKWh) - Number(b.pricePerKWh));

  return (
    <div className="flow-page">
      <PageIntro eyebrow="BUY ENERGY" title="Buyer workspace" detail="Preview price-priority matching, follow each fill through to settlement, or purchase a listed on-chain offer directly." />
      <RoleBanner role="buyer" wallet={wallet} participantRole={role} onRegister={onRegisterRole} />

      <section className="flow-stat-grid" aria-label="Buyer activity">
        <StatCard icon="⇄" tone="blue" label="Open requests" value={requests.filter((request) => ["open", "partially_filled"].includes(request.status)).length} />
        <StatCard icon="⧗" tone="amber" label="In escrow" value={escrowed.length} detail={`${rupees(sum(escrowed, (transaction) => transaction.totalPrice))} awaiting seller settlement`} />
        <StatCard icon="✓" tone="green" label="Settled energy bought" value={`${purchasedKWh.toFixed(2)} kWh`} detail={`${rupees(spent)} spent in total`} />
        <StatCard icon="≈" label="Average settled rate" value={purchasedKWh ? `${rupees(spent / purchasedKWh)} / kWh` : "—"} detail="Across settled purchases only" />
      </section>

      <div className="flow-grid-two">
        <Panel eyebrow="MATCHED REQUEST" title="Request energy">
          <p className="flow-copy">The fill preview is produced by the matcher itself — the same price-time engine that runs when you submit — so it shows exactly which listings would be bought. On submit the backend buys the cheapest eligible listings on-chain with the platform buyer wallet (BUYER_PRIVATE_KEY), so the connected wallet must be that buyer wallet. Each seller then settles their own purchase from their own wallet; nothing reaches the ledger before that.</p>
          <form className="flow-form" onSubmit={submitRequest} aria-busy={submitting}>
            <label className="flow-field">
              <span>Energy needed<em>whole kWh</em></span>
              <input type="number" min="1" step="1" value={form.kWh} onChange={(event) => setForm({ ...form, kWh: event.target.value })} required />
            </label>
            <label className="flow-field">
              <span>Maximum rate<em>₹ per kWh</em></span>
              <input type="number" min="0.01" step="0.01" value={form.maxPrice} onChange={(event) => setForm({ ...form, maxPrice: event.target.value })} required />
            </label>
            {preview && preview.requestedKWh > 0 && (
              <div className="flow-fill-preview">
                <strong>Fill preview · cheapest eligible listings first</strong>
                {preview.fills.length
                  ? preview.fills.map((fill, index) => (
                    <div key={`${fill.sellerId}-${fill.onChainOfferId ?? "pending"}-${index}`}>
                      <AddressTag address={fill.sellerId} /> · {fill.kWh} kWh @ {rupees(fill.pricePerKWh)}/kWh
                    </div>
                  ))
                  : <p>No eligible listings match this price yet.</p>}
                <div>Average matched rate: <strong>{rupees(preview.averageRate)}/kWh</strong> · Matched value: <strong>{rupees(preview.totalPrice)}</strong></div>
                <div className="total">Contract escrow: <strong>{Number(preview.escrowEth).toExponential(4)} ETH</strong></div>
                {preview.remainingKWh > 0 && <p className="flow-warning">Only {preview.filledKWh} of {preview.requestedKWh} kWh can be matched right now.</p>}
              </div>
            )}
            {error && <div className="flow-inline-error" role="alert">{error}</div>}
            <button className="flow-primary" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit matched request"}</button>
          </form>
        </Panel>

        <Panel eyebrow="BUY DIRECTLY" title="On-chain offers" actions={otherOffers.length ? <span className="flow-onchain-tag" data-onchain="true">{otherOffers.length} live</span> : null}>
          <p className="flow-copy">Direct purchases are signed by your connected MetaMask wallet and held in contract escrow until the seller settles.</p>
          {loading ? <Skeleton /> : otherOffers.length ? (
            <div className="flow-list">
              {otherOffers.map((offer) => (
                <div className="flow-offer-row" key={offer._id}>
                  <div>
                    <AddressTag address={offer.sellerId} />
                    <p>{offer.kWhAvailable} kWh · {rupees(offer.pricePerKWh)}/kWh</p>
                    <OnChainTag offer={offer} />
                  </div>
                  <PurchaseButton offer={offer} wallet={wallet} onComplete={onNotice} onCompletePurchase={onRefresh} />
                </div>
              ))}
            </div>
          ) : <EmptyState icon="◌" title="No other open offers" detail="New offers appear here when sellers publish them." />}
        </Panel>
      </div>

      <Panel eyebrow="ORDER PROGRESS" title="Requests and fills">
        <p className="flow-copy">A matched fill is shown as <strong>purchased</strong> while the buyer's payment sits in escrow. It becomes <strong>settled</strong> only after the seller's settlement is verified on-chain.</p>
        {loading ? <Skeleton rows={3} /> : requests.length ? (
          <div className="flow-list">
            {requests.map((request) => (
              <article className="flow-order" key={request._id}>
                <div className="flow-panel-heading">
                  <div>
                    <span className="flow-eyebrow">REQUEST · CREATED {formatWhen(request.createdAt)}</span>
                    <strong>{Number(request.kWhNeeded).toFixed(2)} kWh remaining · max {rupees(request.maxPricePerKWh)}</strong>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
                {request.fills?.length ? request.fills.map((fill) => {
                  const tx = transactions.find((transaction) => transaction.onChainTradeId === fill.onChainTradeId);
                  const status = fill.status === "awaiting_seller" ? "purchased" : fill.status;
                  return (
                    <div className="flow-fill-row" key={fill._id ?? fill.onChainTradeId}>
                      <div>
                        <AddressTag address={fill.sellerId} />
                        <p>{fill.kWh} kWh @ {rupees(fill.pricePerKWh)}/kWh</p>
                      </div>
                      <StatusBadge status={status} />
                      <div className="flow-timeline">
                        <span className="done">Matched</span>
                        <span className={["purchased", "settled"].includes(status) ? "done" : ""}>Purchased</span>
                        <span className={status === "settled" ? "done" : ""}>Settled</span>
                      </div>
                      <div>
                        <TxLink hash={fill.purchaseTxHash || tx?.purchaseTxHash} label="Purchase" />
                        {(fill.txHash || tx?.txHash) && <TxLink hash={fill.txHash || tx.txHash} label="Settlement" />}
                      </div>
                    </div>
                  );
                }) : <p className="flow-muted">Awaiting asynchronous matching.</p>}
              </article>
            ))}
          </div>
        ) : <EmptyState icon="⇄" title="No energy requests yet" detail="Your requests and each seller fill will appear here." />}
      </Panel>

      <Panel eyebrow="DIRECT PURCHASES · ON-CHAIN" title="Purchase history">
        {loading ? <Skeleton rows={3} /> : directPurchases.length ? (
          <div className="flow-table-wrap">
            <table>
              <caption>Purchases you signed directly. A row is only “settled” once the receipt is verified.</caption>
              <thead>
                <tr>
                  <th scope="col">Created (IST)</th>
                  <th scope="col">Seller</th>
                  <th scope="col">Energy</th>
                  <th scope="col">Value</th>
                  <th scope="col">Status</th>
                  <th scope="col">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {directPurchases.map((transaction) => (
                  <tr key={transaction._id}>
                    <td className="num">{formatTableDate(transaction.createdAt)}</td>
                    <td><AddressTag address={transaction.sellerId} /></td>
                    <td className="num">{transaction.kWhTraded} kWh</td>
                    <td className="num">{rupees(transaction.totalPrice)}</td>
                    <td><StatusBadge status={transaction.settledAt ? "settled" : "purchased"} /></td>
                    <td>
                      <div className="flow-txstack">
                        <TxLink hash={transaction.purchaseTxHash} label="Purchase" />
                        <TxLink hash={transaction.txHash} label="Settlement" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="◌" title="No direct purchases yet" detail="Your direct MetaMask purchases and their settlement status will appear here." />}
      </Panel>
    </div>
  );
}

/* =========================================================================
   Marketplace
   ========================================================================= */

export function MarketPage({ wallet, offers, loading }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("price-asc");
  const [scope, setScope] = useState("all");

  const openOffers = offers.filter(isOpenOffer);
  const searched = openOffers.filter((offer) => !query.trim() || offer.sellerId?.toLowerCase().includes(query.trim().toLowerCase()));
  const scoped = scope === "mine" && wallet ? searched.filter((offer) => offer.sellerId?.toLowerCase() === wallet.toLowerCase()) : searched;
  const rows = [...scoped].sort((a, b) => {
    if (sort === "price-desc") return Number(b.pricePerKWh) - Number(a.pricePerKWh);
    if (sort === "size-desc") return Number(b.kWhAvailable) - Number(a.kWhAvailable);
    if (sort === "newest") return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
    return Number(a.pricePerKWh) - Number(b.pricePerKWh);
  });

  const rates = openOffers.map((offer) => Number(offer.pricePerKWh) || 0);
  const availableKWh = sum(openOffers, (offer) => offer.kWhAvailable);
  const onChainCount = openOffers.filter((offer) => Number.isSafeInteger(offer.onChainOfferId)).length;

  return (
    <div className="flow-page">
      <PageIntro eyebrow="MARKETPLACE" title="Open solar offers" detail="Every listing visible to the matcher, sorted cheapest first by default. Your own offers are identified." />

      <section className="flow-stat-grid" aria-label="Marketplace summary">
        <StatCard icon="☰" tone="sun" label="Open offers" value={openOffers.length} detail={`${onChainCount} backed by an on-chain offer`} />
        <StatCard icon="⚡" label="Available supply" value={`${availableKWh.toFixed(2)} kWh`} />
        <StatCard icon="↓" tone="green" label="Lowest rate" value={rates.length ? `${rupees(Math.min(...rates))} / kWh` : "—"} />
        <StatCard icon="≈" label="Average rate" value={rates.length ? `${rupees(rates.reduce((a, b) => a + b, 0) / rates.length)} / kWh` : "—"} />
      </section>

      <Panel
        eyebrow="LIVE OFFERS"
        title="Available supply"
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Search seller address" label="Search offers by seller address" />
            <FilterGroup label="Offer scope" value={scope} onChange={setScope} options={[["all", "All"], ["mine", "Mine"]]} />
            <SelectField
              label="Sort offers"
              value={sort}
              onChange={setSort}
              options={[["price-asc", "Price ↑"], ["price-desc", "Price ↓"], ["size-desc", "kWh ↓"], ["newest", "Newest"]]}
            />
          </>
        }
      >
        <div className="flow-note">
          <span><strong>On-chain vs off-chain.</strong> Offers marked <strong>On-chain</strong> have a contract offer ID and can be purchased or matched directly. Offers marked <strong>Off-chain</strong> exist only in MongoDB and cannot be settled until they are published to the contract.</span>
        </div>
        {loading ? <Skeleton rows={5} /> : rows.length ? (
          <div className="flow-table-wrap">
            <table>
              <caption>{rows.length} open offer{rows.length === 1 ? "" : "s"}{query.trim() ? ` matching “${query.trim()}”` : ""}{scope === "mine" ? " from your wallet" : ""}.</caption>
              <thead>
                <tr>
                  <th scope="col">Seller</th>
                  <th scope="col">Available</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Listing source</th>
                  <th scope="col">Published</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((offer) => {
                  const own = wallet && offer.sellerId?.toLowerCase() === wallet.toLowerCase();
                  return (
                    <tr key={offer._id}>
                      <td><AddressTag address={offer.sellerId} />{own && <span className="flow-own-offer">Your offer</span>}</td>
                      <td className="num">{offer.kWhAvailable} kWh</td>
                      <td className="num">{rupees(offer.pricePerKWh)} / kWh</td>
                      <td><OnChainTag offer={offer} /></td>
                      <td>{offer.createdAt ? relativeTime(offer.createdAt) : "—"}</td>
                      <td><StatusBadge status={offer.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="◌"
            title={query.trim() || scope === "mine" ? "No offers match this view" : "The market is quiet"}
            detail={query.trim() || scope === "mine" ? "Clear the search or switch back to all offers." : "There are no open offers right now. Check back after a seller publishes supply."}
            action={<Link className="flow-secondary" to="/sell">Go to Sell</Link>}
          />
        )}
      </Panel>
    </div>
  );
}

/* =========================================================================
   Ledger
   ========================================================================= */

export function LedgerPage({ wallet, transactions, loading }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const settled = transactions.filter((transaction) => transaction.settledAt);
  const mine = settled.filter((transaction) => wallet && (
    transaction.sellerId?.toLowerCase() === wallet.toLowerCase() ||
    transaction.buyerId?.toLowerCase() === wallet.toLowerCase()
  ));
  const scoped = filter === "mine" ? mine : settled;
  const rows = [...scoped]
    .filter((transaction) => !query.trim() || `${transaction.txHash ?? ""} ${transaction.purchaseTxHash ?? ""} ${transaction.sellerId ?? ""} ${transaction.buyerId ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));

  const kWh = sum(rows, (transaction) => transaction.kWhTraded);
  const value = sum(rows, (transaction) => transaction.totalPrice);
  const pending = transactions.filter((transaction) => !transaction.settledAt).length;

  return (
    <div className="flow-page">
      <PageIntro eyebrow="PUBLIC RECORD" title="Settled energy ledger" detail="A row appears here only after its on-chain settlement receipt has been verified by the backend." />

      <section className="flow-stat-grid" aria-label="Ledger summary">
        <StatCard icon="✓" tone="green" label="Settled trades" value={rows.length} detail={filter === "mine" ? "Settlements involving your wallet" : "All confirmed settlements"} />
        <StatCard icon="⚡" label="Energy settled" value={`${kWh.toFixed(2)} kWh`} />
        <StatCard icon="₹" label="Value transferred" value={rupees(value)} detail={kWh ? `Average ${rupees(value / kWh)} / kWh` : "No settlement yet"} />
        <StatCard icon="⧗" tone="amber" label="Still pending" value={pending} detail="Purchases in escrow, excluded from the ledger" />
      </section>

      <Panel
        eyebrow="SEPOLIA · VERIFIED SETTLEMENTS"
        title="Trade history"
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Search tx hash or address" label="Search settled transactions" />
            <FilterGroup label="Ledger scope" value={filter} onChange={setFilter} options={[["all", "All trades"], ["mine", "My trades"]]} />
          </>
        }
      >
        <div className="flow-note">
          <span><strong>Pending activity is excluded on purpose.</strong> Escrowed purchases and matched-but-unsettled trades are not ledger entries — a successful <code>purchaseEnergy()</code> alone is not a settlement.</span>
        </div>
        {loading ? <Skeleton rows={4} /> : (
          <SettlementTable
            rows={rows}
            emptyTitle={query.trim() ? "No settlements match this search" : filter === "mine" && !wallet ? "Connect a wallet to filter your trades" : "No settled trades yet"}
            emptyDetail="Pending purchases are intentionally excluded until the seller settles on-chain."
          />
        )}
      </Panel>
    </div>
  );
}

/* =========================================================================
   Energy news
   ========================================================================= */

const NEWS_SYNC_MS = 5 * 60 * 1000;

/* Every timestamp is rendered in IST, matching the rest of the application.
   The server decides which articles count as "today" in the same timezone. */
function formatIst(value) {
  if (!value) return "—";
  return `${new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  })} IST`;
}

/* Thumbnails come from the publisher. If one fails to load the card simply
   renders without it rather than showing a broken image. */
function NewsThumb({ src }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className="flow-news-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function NewsCard({ article }) {
  return (
    <article className="flow-news-card">
      <NewsThumb src={article.image} />
      <div className="flow-news-body">
        <p className="flow-news-meta">
          {article.categoryLabel && <span className="flow-news-tag">{article.categoryLabel}</span>}
          <span className="flow-news-source">{article.source}</span>
        </p>
        <h3 className="flow-news-title">
          <a href={article.url} target="_blank" rel="noreferrer noopener">{article.title}</a>
        </h3>
        {article.summary && <p className="flow-news-summary">{article.summary}</p>}
        <p className="flow-news-foot">
          <time dateTime={article.publishedAt} title={article.publishedAt}>{formatIst(article.publishedAt)}</time>
          <span className="flow-news-age">{relativeTime(article.publishedAt)}</span>
          <a className="flow-news-read" href={article.url} target="_blank" rel="noreferrer noopener">
            Read article<span aria-hidden="true"> ↗</span>
          </a>
        </p>
      </div>
    </article>
  );
}

/* Existing SolarShare functionality, unchanged: the live marketplace feed is
   kept as its own panel below the news so the page still shows platform
   activity, but it is never presented as news. */
function MarketplaceActivity({ trades }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setActivity(await apiRequest("/activity"));
      setError("");
    } catch (cause) {
      setError(cause.message || "Activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setInterval(refresh, 10000);
    refresh();
    return () => clearInterval(timer);
  }, []);

  return (
    <Panel eyebrow="LIVE FEED" title="Marketplace activity">
      {loading ? <Skeleton rows={4} /> : error ? (
        <div className="flow-inline-error" role="alert">{error} <button type="button" onClick={refresh}>Retry</button></div>
      ) : activity.length || trades.some((trade) => trade.fills?.length) ? (
        <div>
          {[
            ...activity,
            ...trades.flatMap((trade) => (trade.fills ?? []).filter((fill) => fill.status !== "pending").map((fill) => ({
              type: "match",
              at: fill.updatedAt ?? trade.updatedAt,
              item: { ...fill, buyerId: trade.buyerId, kWhNeeded: trade.kWhNeeded, _id: fill._id ?? fill.onChainTradeId }
            })))
          ].sort((a, b) => new Date(b.at) - new Date(a.at)).map((entry, index) => {
            const item = entry.item;
            const text = entry.type === "offer"
              ? <><AddressTag address={item.sellerId} /> listed {item.kWhAvailable} kWh · {rupees(item.pricePerKWh)}/kWh</>
              : entry.type === "settlement"
                ? <><AddressTag address={item.sellerId} /> sold {item.kWhTraded} kWh to <AddressTag address={item.buyerId} /> for {rupees(item.totalPrice)}</>
                : entry.type === "match"
                  ? <><AddressTag address={item.sellerId} /> matched {item.kWh} kWh for <AddressTag address={item.buyerId} /></>
                  : <><AddressTag address={item.buyerId} /> requested {item.kWhNeeded} kWh</>;
            return (
              <article className="flow-activity" key={`${entry.type}-${item._id}-${index}`}>
                <div>
                  <StatusBadge status={entry.type === "match" ? item.status : entry.type} />
                  <p>{text}</p>
                  {entry.type === "settlement" && <TxLink hash={item.txHash} label="Settlement" />}
                  {entry.type === "match" && <TxLink hash={item.purchaseTxHash} label="Purchase" />}
                </div>
                <time dateTime={entry.at}>{relativeTime(entry.at)}</time>
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon="◷" title="No recent activity" detail="Offers, requests, and confirmed settlements will appear here." />}
    </Panel>
  );
}

export function NewsPage({ trades = [] }) {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      setFeed(await apiRequest(`/news${force ? "?refresh=1" : ""}`));
      setError("");
    } catch (cause) {
      setError(cause.message || "The news feed could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), NEWS_SYNC_MS);
    return () => clearInterval(timer);
  }, [load]);

  const articles = feed?.articles ?? [];
  const groups = feed?.categories ?? [];
  const options = useMemo(
    () => [["all", `All (${articles.length})`], ...groups.map((group) => [group.id, `${group.label} (${group.count})`])],
    [articles.length, groups]
  );
  const visible = category === "all" ? articles : articles.filter((article) => article.category === category);
  const today = visible.filter((article) => article.bucket === "today");
  const earlier = visible.filter((article) => article.bucket === "recent");
  const sources = feed?.sources ?? [];
  const okSources = sources.filter((source) => source.ok);
  const failedSources = sources.filter((source) => !source.ok);
  const updatedAt = feed?.fetchedAt ? formatIst(feed.fetchedAt) : null;
  const activeLabel = groups.find((group) => group.id === category)?.label ?? "this category";
  const showError = Boolean(error) && articles.length === 0;

  return (
    <div className="flow-page">
      <PageIntro
        eyebrow="ENERGY NEWS"
        title="Latest energy news"
        detail="Solar, renewables, electricity markets, storage, grids and peer-to-peer trading, gathered from specialist energy publishers. Publication times are shown in IST and today's stories are listed first."
      />

      <section className="flow-news-toolbar" aria-label="News feed controls">
        <div className="flow-news-status">
          {feed?.stale ? (
            <span className="flow-news-flag" data-tone="warn" role="status">
              Live refresh failed. Showing the last successful update{updatedAt ? ` from ${updatedAt}` : ""}.
            </span>
          ) : updatedAt ? (
            <span className="flow-news-flag" role="status">Updated at {updatedAt}</span>
          ) : null}
          {failedSources.length > 0 && (
            <span className="flow-news-flag" data-tone="warn">
              {failedSources.length} of {sources.length} sources unavailable
            </span>
          )}
        </div>
        <button className="flow-secondary" type="button" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {articles.length > 0 && (
        <FilterGroup value={category} options={options} onChange={setCategory} label="Filter news by category" />
      )}

      {loading ? <Skeleton rows={6} /> : showError ? (
        <Panel eyebrow="FEED UNAVAILABLE" title="Could not load energy news">
          <div className="flow-inline-error" role="alert">
            {error} <button type="button" onClick={() => load(true)}>Retry</button>
          </div>
        </Panel>
      ) : articles.length === 0 ? (
        <Panel>
          <EmptyState
            icon="⚡"
            title="No new energy-related news available right now"
            detail="Please check again later."
            action={<button className="flow-secondary" type="button" onClick={() => load(true)}>Check again</button>}
          />
        </Panel>
      ) : (
        <>
          {feed.expanded && (
            <p className="flow-news-callout">
              Only {feed.counts.today} energy {feed.counts.today === 1 ? "story has" : "stories have"} been published today, so relevant
              headlines from the previous 48 hours are included below with their original publication times.
            </p>
          )}

          {today.length > 0 && (
            <section className="flow-news-group" aria-labelledby="news-group-today">
              <h2 id="news-group-today">Today <span>{today.length}</span></h2>
              <div className="flow-news-grid">{today.map((article) => <NewsCard article={article} key={article.id} />)}</div>
            </section>
          )}

          {earlier.length > 0 && (
            <section className="flow-news-group" aria-labelledby="news-group-earlier">
              <h2 id="news-group-earlier">Earlier · previous 48 hours <span>{earlier.length}</span></h2>
              <div className="flow-news-grid">{earlier.map((article) => <NewsCard article={article} key={article.id} />)}</div>
            </section>
          )}

          {visible.length === 0 && (
            <Panel>
              <EmptyState
                icon="◷"
                title={`No headlines in ${activeLabel} right now`}
                detail="Choose another category, or refresh to pull the latest headlines."
                action={<button className="flow-secondary" type="button" onClick={() => setCategory("all")}>Show all news</button>}
              />
            </Panel>
          )}

          {sources.length > 0 && (
            <p className="flow-news-sources">
              {okSources.length > 0 && <>Sources: {okSources.map((source) => source.name).join(", ")}</>}
              {okSources.length > 0 && failedSources.length > 0 && " · "}
              {failedSources.length > 0 && <>unavailable: {failedSources.map((source) => source.name).join(", ")}</>}
            </p>
          )}
        </>
      )}

      <div className="flow-grid-two">
        <MarketplaceActivity trades={trades} />
        <Panel eyebrow="HOW THE PLATFORM WORKS" title="SolarShare bulletin">
          <div className="flow-list">
            {announcements.map((item) => (
              <article className="flow-announcement" key={item.title}>
                <span className="flow-eyebrow">{item.category}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
