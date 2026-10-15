import { useEffect, useMemo, useState } from "react";
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
import { AddressTag, EmptyState, Skeleton, StatCard, StatusBadge, StepProgress, TxLink, userErrorMessage } from "./FlowComponents.jsx";
import announcements from "./announcements.json";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const apiRequest = async (path, options) => {
  const response = await fetch(`${apiUrl}${path}`, { headers: { "content-type": "application/json" }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
};
const istDate = (value) => new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 10);
const isToday = (value) => istDate(value) === istDate(Date.now());
function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

export function HomePage({ stats, loading }) {
  return (
    <div className="flow-page">
      <section className="flow-landing">
        <span className="flow-eyebrow">SOLARSHARE · LOCAL ENERGY, ON-CHAIN SETTLEMENT</span>
        <h1>Clean energy, shared locally.</h1>
        <p>Neighbours trade rooftop solar directly. Offers are published on Sepolia, purchases escrowed, and payment released when the seller settles.</p>
        <div className="flow-landing-actions">
          <Link className="flow-primary" to="/sell">Sell energy</Link>
          <Link className="flow-secondary" to="/buy">Buy energy</Link>
        </div>
      </section>
      <section className="flow-steps-overview" aria-label="How SolarShare works">
        {[["01", "Generate", "Households track solar generation and surplus."], ["02", "Match", "Buyers find offers that fit their price and quantity."], ["03", "Settle on-chain", "The buyer payment is escrowed until the seller settles."]].map(([number, title, detail]) =>
          <article key={number}><span>{number}</span><strong>{title}</strong><p>{detail}</p></article>
        )}
      </section>
      <section className="flow-stat-grid flow-home-stats">
        {loading ? <Skeleton rows={3} /> : <>
          <StatCard label="Energy traded" value={`${stats.kWh.toFixed(2)} kWh`} />
          <StatCard label="Trades settled" value={stats.settled} />
          <StatCard label="Open offers" value={stats.openOffers} />
        </>}
      </section>
      <section className="flow-home-links"><Link to="/market">Browse the market →</Link><Link to="/ledger">View the settled ledger →</Link></section>
    </div>
  );
}

function RoleBanner({ role, wallet, participantRole, onRegister }) {
  const neededRole = role === "seller" ? 1 : 2;
  const allowed = participantRole === neededRole || participantRole === 3;
  if (allowed) return null;
  if (!wallet) return <div className="flow-role-banner">Connect a wallet to check or register the {role === "seller" ? "Prosumer" : "Consumer"} role.</div>;
  const incompatible = participantRole && participantRole !== neededRole && participantRole !== 3;
  return (
    <div className="flow-role-banner">
      <span>{incompatible
        ? `This wallet is registered for the other role. The contract requires ${role === "seller" ? "Prosumer" : "Consumer"} or Both.`
        : `This wallet is not registered as a ${role === "seller" ? "Prosumer" : "Consumer"}.`}</span>
      {!incompatible && <button className="flow-secondary" onClick={() => onRegister(neededRole)}>Register as {role === "seller" ? "Prosumer" : "Consumer"} on Sepolia</button>}
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
    <div className="flow-chart" role="img" aria-label="Hourly solar generation and household consumption">
      {profile.generation.map((value, hour) => <span key={hour} title={`${hour}:00 · ${value.toFixed(2)} kWh generation, ${profile.consumption[hour].toFixed(2)} kWh consumption`} style={{ height: `${Math.max(4, Math.max(value, profile.consumption[hour]) / max * 100)}%` }}><i style={{ height: `${value + profile.consumption[hour] ? value / (value + profile.consumption[hour]) * 100 : 0}%` }} /></span>)}
    </div>
  );
}

export function SellPage({ wallet, role, offers, readings, transactions, loading, onRegisterRole, onRefresh, onNotice }) {
  const [form, setForm] = useState({ kWh: "", price: "" });
  const [publishing, setPublishing] = useState(false);
  const [step, setStep] = useState(-1);
  const [offerHashes, setOfferHashes] = useState({});
  const [error, setError] = useState("");
  const mine = wallet ? offers.filter((offer) => offer.sellerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const sellerTransactions = wallet ? transactions.filter((transaction) => transaction.sellerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const settled = sellerTransactions.filter((transaction) => transaction.settledAt);
  const incoming = sellerTransactions.filter((transaction) => !transaction.settledAt && transaction.chainStatus !== "settled");
  const dailyReadings = readings.filter((reading) => wallet && reading.userId?.toLowerCase() === wallet.toLowerCase() && isToday(reading.timestamp));
  const generation = dailyReadings.reduce((sum, reading) => sum + Number(reading.generationKWh || 0), 0);
  const consumption = dailyReadings.reduce((sum, reading) => sum + Number(reading.consumptionKWh || 0), 0);
  const surplus = dailyReadings.reduce((sum, reading) => sum + Math.max(0, Number(reading.surplusKWh || 0)), 0);
  const earned = settled.reduce((sum, transaction) => sum + Number(transaction.totalPrice || 0), 0);

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
      <PageIntro eyebrow="SELL ENERGY" title="Seller workspace" detail="Publish on-chain offers, monitor available supply, and settle buyer purchases." />
      <RoleBanner role="seller" wallet={wallet} participantRole={role} onRegister={onRegisterRole} />
      <section className="flow-stat-grid">
        <StatCard label="Today's generation" value={`${generation.toFixed(2)} kWh`} detail="Meter readings matched to this wallet" />
        <StatCard label="Today's consumption" value={`${consumption.toFixed(2)} kWh`} />
        <StatCard label="Available surplus" value={`${surplus.toFixed(2)} kWh`} />
        <StatCard label="Open offers" value={mine.filter((offer) => offer.status === "open").length} />
        <StatCard label="Total earned" value={`₹${earned.toFixed(2)}`} detail="Settled trades only" />
      </section>
      <div className="flow-grid-two">
        <section className="flow-panel">
          <PanelTitle eyebrow="PUBLISH OFFER" title="Sell your solar surplus" />
          <p className="flow-copy">The seller signs `createOffer` in MetaMask. The listing is saved only after the on-chain transaction succeeds and the backend verifies it.</p>
          <form className="flow-form" onSubmit={publish}>
            <label>Available energy (whole kWh)<input type="number" min="1" step="1" value={form.kWh} onChange={(event) => setForm({ ...form, kWh: event.target.value })} required /></label>
            <label>Marketplace rate (₹ / kWh)<input type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required /></label>
            <p className="flow-preview">Contract rate preview: {Number(form.price) > 0 ? `${priceToWei(form.price).toString()} wei / kWh (${formatEther(priceToWei(form.price))} ETH / kWh)` : "Enter a rate to preview the integer contract value."}</p>
            {step >= 0 && <StepProgress step={step} steps={["Confirm in wallet", "Creating on-chain", "Registering", "Live"]} />}
            {error && <div className="flow-inline-error" role="alert">{error}</div>}
            <button className="flow-primary" disabled={publishing}>{publishing ? "Publishing…" : "Publish on Sepolia"}</button>
          </form>
        </section>
        <section className="flow-panel">
          <PanelTitle eyebrow="METER DATA" title="Today's generation vs use" />
          {dailyReadings.length ? <><TrendChart readings={dailyReadings} /><div className="flow-legend"><span>Solar generation</span><span>Household consumption</span></div></> : <EmptyState title="No readings for this wallet today" detail="Meter readings are listed only when their user ID matches this wallet address." />}
        </section>
      </div>
      <section className="flow-panel">
        <PanelTitle eyebrow="YOUR LISTINGS" title="My offers" />
        <p className="flow-copy">Offers may be matched automatically against eligible waiting buyer requests. “Sold out” means no kWh remain to buy; it does not mean the buyer's escrow has been released. Check incoming purchases below and settle them from the seller wallet.</p>
        {loading ? <Skeleton /> : mine.length ? <div className="flow-table-wrap"><table><thead><tr><th>kWh left</th><th>Price / kWh</th><th>Status</th><th>On-chain offer ID</th><th>Offer transaction</th></tr></thead><tbody>
          {mine.map((offer) => <tr key={offer._id}><td>{offer.kWhAvailable}</td><td>₹{Number(offer.pricePerKWh).toFixed(2)}</td><td><StatusBadge status={offer.status === "settled" ? "sold_out" : offer.status} /></td><td>{offer.onChainOfferId ?? "Not on-chain"}</td><td>{offerHashes[offer._id] ? <TxLink hash={offerHashes[offer._id]} /> : <a href={`https://sepolia.etherscan.io/address/${contractAddress}`} target="_blank" rel="noreferrer">Contract · #{offer.onChainOfferId ?? "—"}</a>}</td></tr>)}
        </tbody></table></div> : <EmptyState title="No offers published yet" detail="Create an offer to make your on-chain surplus available." />}
      </section>
      <section className="flow-panel">
        <PanelTitle eyebrow="INCOMING PURCHASES" title="Awaiting seller settlement" />
        {loading ? <Skeleton rows={2} /> : incoming.length ? <div className="flow-list">{incoming.map((transaction) => <div className="flow-trade-row" key={transaction._id}>
          <div><strong>{transaction.kWhTraded} kWh · ₹{Number(transaction.totalPrice).toFixed(2)}</strong><p>Buyer <AddressTag address={transaction.buyerId} /> · Trade #{transaction.onChainTradeId}</p><TxLink hash={transaction.purchaseTxHash} label="Purchase" /></div>
          <SettleButton trade={transaction} wallet={wallet} onComplete={onNotice} onSettled={onRefresh} />
        </div>)}</div> : <EmptyState title="No purchases awaiting settlement" detail="The seller wallet connected above must sign settlement to release escrow." />}
      </section>
      <SettledHistory rows={settled} title="Earnings history" />
    </div>
  );
}

export function BuyPage({ wallet, role, offers, trades, transactions, loading, onRegisterRole, onRefresh, onNotice }) {
  const [form, setForm] = useState({ kWh: "", maxPrice: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requests = wallet ? trades.filter((trade) => trade.buyerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const buyerTransactions = wallet ? transactions.filter((transaction) => transaction.buyerId?.toLowerCase() === wallet.toLowerCase()) : [];
  const purchased = buyerTransactions.filter((transaction) => transaction.settledAt);
  const directPurchases = buyerTransactions.filter((transaction) => !transaction.requestId);
  const compatibleOffers = useMemo(() => offers.filter((offer) =>
    offer.status === "open" &&
    Number(offer.kWhAvailable) > 0 &&
    (!wallet || offer.sellerId?.toLowerCase() !== wallet.toLowerCase()) &&
    Number(offer.pricePerKWh) <= (Number(form.maxPrice) || 0)
  ).sort((left, right) => Number(left.pricePerKWh) - Number(right.pricePerKWh)), [offers, wallet, form.maxPrice]);
  const preview = useMemo(() => {
    const requested = Math.floor(Number(form.kWh) || 0);
    let remaining = requested;
    const fills = compatibleOffers.flatMap((offer) => {
      if (!remaining) return [];
      const quantity = Math.min(remaining, Math.floor(Number(offer.kWhAvailable)));
      remaining -= quantity;
      return quantity > 0 ? [{ offer, quantity }] : [];
    });
    const filled = requested - remaining;
    const value = fills.reduce((sum, fill) => sum + fill.quantity * Number(fill.offer.pricePerKWh), 0);
    const wei = fills.reduce((sum, fill) => sum + BigInt(fill.quantity) * priceToWei(fill.offer.pricePerKWh), 0n);
    return { requested, remaining, filled, fills, value, average: filled ? value / filled : 0, eth: formatEther(wei) };
  }, [form.kWh, compatibleOffers]);

  async function submitRequest(event) {
    event.preventDefault();
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

  const otherOffers = offers.filter((offer) =>
    offer.status === "open" &&
    Number(offer.kWhAvailable) > 0 &&
    (!wallet || offer.sellerId?.toLowerCase() !== wallet.toLowerCase())
  );

  return (
    <div className="flow-page">
      <PageIntro eyebrow="BUY ENERGY" title="Buyer workspace" detail="Preview price-priority matching, follow each fill, or purchase a listed on-chain offer directly." />
      <RoleBanner role="buyer" wallet={wallet} participantRole={role} onRegister={onRegisterRole} />
      <section className="flow-stat-grid flow-four-stats">
        <StatCard label="Open requests" value={requests.filter((request) => ["open", "partially_filled"].includes(request.status)).length} />
        <StatCard label="Settled energy bought" value={`${purchased.reduce((sum, tx) => sum + Number(tx.kWhTraded), 0).toFixed(2)} kWh`} />
        <StatCard label="Total spent" value={`₹${purchased.reduce((sum, tx) => sum + Number(tx.totalPrice), 0).toFixed(2)}`} />
        <StatCard label="Average settled rate" value={`₹${(purchased.reduce((sum, tx) => sum + Number(tx.totalPrice), 0) / (purchased.reduce((sum, tx) => sum + Number(tx.kWhTraded), 0) || 1)).toFixed(2)} / kWh`} />
      </section>
      <div className="flow-grid-two">
        <section className="flow-panel">
          <PanelTitle eyebrow="MATCHED REQUEST" title="Request energy" />
          <p className="flow-copy">The fill preview uses the current marketplace listings and is indicative. When you submit, the backend matcher buys the cheapest eligible listings on-chain with the platform buyer wallet (BUYER_PRIVATE_KEY), so the connected wallet must be that buyer wallet. Each seller then settles their own purchase from their own wallet; nothing reaches the ledger before that.</p>
          <form className="flow-form" onSubmit={submitRequest}>
            <label>Energy needed (whole kWh)<input type="number" min="1" step="1" value={form.kWh} onChange={(event) => setForm({ ...form, kWh: event.target.value })} required /></label>
            <label>Maximum rate (₹ / kWh)<input type="number" min="0.01" step="0.01" value={form.maxPrice} onChange={(event) => setForm({ ...form, maxPrice: event.target.value })} required /></label>
            {preview.requested > 0 && <div className="flow-fill-preview">
              <strong>Fill preview · cheapest eligible offers first</strong>
              {preview.fills.length ? preview.fills.map(({ offer, quantity }) => <div key={offer._id}><AddressTag address={offer.sellerId} /> · {quantity} kWh @ ₹{Number(offer.pricePerKWh).toFixed(2)}/kWh</div>) : <p>No offers match this price yet.</p>}
              <div>Average listing rate: ₹{preview.average.toFixed(2)}/kWh · Estimated listing value: ₹{preview.value.toFixed(2)}</div>
              <div>Contract escrow preview: {Number(preview.eth).toExponential(4)} ETH</div>
              {preview.remaining > 0 && <p className="flow-warning">Only {preview.filled} of {preview.requested} kWh is currently available at this price.</p>}
            </div>}
            {error && <div className="flow-inline-error" role="alert">{error}</div>}
            <button className="flow-primary" disabled={submitting}>{submitting ? "Submitting…" : "Submit matched request"}</button>
          </form>
        </section>
        <section className="flow-panel">
          <PanelTitle eyebrow="BUY DIRECTLY" title="On-chain offers" />
          <p className="flow-copy">Direct purchases are signed by your connected MetaMask wallet and escrowed in the contract. The seller must settle.</p>
          {loading ? <Skeleton /> : otherOffers.length ? <div className="flow-list">{otherOffers.sort((a, b) => Number(a.pricePerKWh) - Number(b.pricePerKWh)).map((offer) => <div className="flow-offer-row" key={offer._id}><div><AddressTag address={offer.sellerId} /><p>{offer.kWhAvailable} kWh · ₹{Number(offer.pricePerKWh).toFixed(2)}/kWh</p></div><PurchaseButton offer={offer} wallet={wallet} onComplete={onNotice} onCompletePurchase={onRefresh} /></div>)}</div> : <EmptyState title="No other open offers" detail="New offers appear here when sellers publish them." />}
        </section>
      </div>
      <section className="flow-panel">
        <PanelTitle eyebrow="ORDER PROGRESS" title="Requests and fills" />
        {loading ? <Skeleton rows={3} /> : requests.length ? <div className="flow-list">{requests.map((request) => <article className="flow-order" key={request._id}>
          <div className="flow-panel-heading"><strong>Request · {Number(request.kWhNeeded).toFixed(2)} kWh remaining · max ₹{Number(request.maxPricePerKWh).toFixed(2)}</strong><StatusBadge status={request.status} /></div>
          {request.fills?.length ? request.fills.map((fill) => {
            const tx = transactions.find((transaction) => transaction.onChainTradeId === fill.onChainTradeId);
            const status = fill.status === "awaiting_seller" ? "purchased" : fill.status;
            return <div className="flow-fill-row" key={fill._id ?? fill.onChainTradeId}>
              <div><AddressTag address={fill.sellerId} /><p>{fill.kWh} kWh @ ₹{Number(fill.pricePerKWh).toFixed(2)}/kWh</p></div>
              <StatusBadge status={status} />
              <div className="flow-timeline"><span className="done">Matched</span><span className={["purchased", "settled"].includes(status) ? "done" : ""}>Purchased</span><span className={status === "settled" ? "done" : ""}>Settled</span></div>
              <div><TxLink hash={fill.purchaseTxHash || tx?.purchaseTxHash} label="Purchase" />{(fill.txHash || tx?.txHash) && <TxLink hash={fill.txHash || tx.txHash} label="Settlement" />}</div>
            </div>;
          }) : <p className="flow-muted">Awaiting asynchronous matching.</p>}
        </article>)}</div> : <EmptyState title="No energy requests yet" detail="Your requests and each seller fill will appear here." />}
      </section>
      <section className="flow-panel">
        <PanelTitle eyebrow="DIRECT PURCHASES · ON-CHAIN" title="Purchase history" />
        {loading ? <Skeleton rows={3} /> : directPurchases.length ? <div className="flow-table-wrap"><table><thead><tr><th>Seller</th><th>Energy</th><th>Value</th><th>Status</th><th>Purchase</th><th>Settlement</th></tr></thead><tbody>
          {directPurchases.map((transaction) => <tr key={transaction._id}><td><AddressTag address={transaction.sellerId} /></td><td>{transaction.kWhTraded} kWh</td><td>₹{Number(transaction.totalPrice || 0).toFixed(2)}</td><td><StatusBadge status={transaction.settledAt ? "settled" : "purchased"} /></td><td><TxLink hash={transaction.purchaseTxHash} /></td><td><TxLink hash={transaction.txHash} /></td></tr>)}
        </tbody></table></div> : <EmptyState title="No direct purchases yet" detail="Your direct MetaMask purchases and their settlement status will appear here." />}
      </section>
    </div>
  );
}

export function MarketPage({ wallet, offers, loading }) {
  const openOffers = offers.filter((offer) => offer.status === "open" && Number(offer.kWhAvailable) > 0)
    .sort((a, b) => Number(a.pricePerKWh) - Number(b.pricePerKWh));
  return (
    <div className="flow-page">
      <PageIntro eyebrow="MARKETPLACE" title="Open solar offers" detail="Read-only browsing, sorted by the lowest listed price. Your own offers are identified." />
      <section className="flow-panel">
        <PanelTitle eyebrow="LIVE OFFERS" title="Available supply" />
        {loading ? <Skeleton rows={4} /> : openOffers.length ? <div className="flow-table-wrap"><table><thead><tr><th>Seller</th><th>Available</th><th>Rate</th><th>Status</th><th>On-chain offer</th></tr></thead><tbody>
          {openOffers.map((offer) => <tr key={offer._id}><td><AddressTag address={offer.sellerId} />{wallet && offer.sellerId?.toLowerCase() === wallet.toLowerCase() && <span className="flow-own-offer">Your offer</span>}</td><td>{offer.kWhAvailable} kWh</td><td>₹{Number(offer.pricePerKWh).toFixed(2)}/kWh</td><td><StatusBadge status={offer.status} /></td><td>{offer.onChainOfferId ?? "Off-chain"}</td></tr>)}
        </tbody></table></div> : <EmptyState title="The market is quiet" detail="There are no open offers right now. Check back after a seller publishes supply." action={<Link className="flow-secondary" to="/sell">Go to Sell</Link>} />}
      </section>
    </div>
  );
}

export function LedgerPage({ wallet, transactions, loading }) {
  const [filter, setFilter] = useState("all");
  const settled = transactions.filter((transaction) => transaction.settledAt);
  const rows = filter === "mine" ? settled.filter((transaction) =>
    wallet && (transaction.sellerId?.toLowerCase() === wallet.toLowerCase() || transaction.buyerId?.toLowerCase() === wallet.toLowerCase())
  ) : settled;
  return (
    <div className="flow-page">
      <PageIntro eyebrow="PUBLIC RECORD" title="Settled energy ledger" detail="Transactions appear here after their on-chain settlement has been confirmed." />
      <section className="flow-panel">
        <div className="flow-panel-heading"><PanelTitle eyebrow="SEPOLIA · VERIFIED SETTLEMENTS" title="Trade history" /><div className="flow-filter"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button className={filter === "mine" ? "active" : ""} onClick={() => setFilter("mine")}>Mine</button></div></div>
        {loading ? <Skeleton rows={4} /> : rows.length ? <SettledHistory rows={rows} title="Settled transactions" /> : <EmptyState title={filter === "mine" && !wallet ? "Connect a wallet to filter your trades" : "No settled trades yet"} detail="Pending purchases are intentionally excluded until the seller settles on-chain." />}
      </section>
    </div>
  );
}

export function NewsPage({ trades = [] }) {
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
    <div className="flow-page">
      <PageIntro eyebrow="COMMUNITY UPDATES" title="News and activity" detail="Recent marketplace activity and project announcements." />
      <div className="flow-grid-two">
        <section className="flow-panel"><PanelTitle eyebrow="LIVE · REFRESHES EVERY 10 SECONDS" title="Recent activity" />
          {loading ? <Skeleton rows={4} /> : error ? <div className="flow-inline-error" role="alert">{error}<button onClick={refresh}>Retry</button></div> : activity.length || trades.some((trade) => trade.fills?.length) ? <div className="flow-list">{[
            ...activity,
            ...trades.flatMap((trade) => (trade.fills ?? []).filter((fill) => fill.status !== "pending").map((fill) => ({
              type: "match",
              at: fill.updatedAt ?? trade.updatedAt,
              item: { ...fill, buyerId: trade.buyerId, kWhNeeded: trade.kWhNeeded, _id: fill._id ?? fill.onChainTradeId }
            })))
          ].sort((a, b) => new Date(b.at) - new Date(a.at)).map((entry, index) => {
            const item = entry.item;
            const text = entry.type === "offer"
              ? <><AddressTag address={item.sellerId} /> listed {item.kWhAvailable} kWh · ₹{Number(item.pricePerKWh).toFixed(2)}/kWh</>
              : entry.type === "settlement"
                ? <><AddressTag address={item.sellerId} /> sold {item.kWhTraded} kWh to <AddressTag address={item.buyerId} /></>
                : entry.type === "match"
                  ? <><AddressTag address={item.sellerId} /> matched {item.kWh} kWh for <AddressTag address={item.buyerId} /></>
                  : <><AddressTag address={item.buyerId} /> requested {item.kWhNeeded} kWh</>;
            return <article className="flow-activity" key={`${entry.type}-${item._id}-${index}`}><div><StatusBadge status={entry.type === "match" ? item.status : entry.type} /><p>{text}</p>{entry.type === "settlement" && <TxLink hash={item.txHash} />}{entry.type === "match" && <TxLink hash={item.purchaseTxHash} label="Purchase" />}</div><time>{relativeTime(entry.at)}</time></article>;
          })}</div> : <EmptyState title="No recent activity" detail="Offers, requests, and confirmed settlements will appear here." />}
        </section>
        <section className="flow-panel"><PanelTitle eyebrow="PROJECT ANNOUNCEMENTS" title="SolarShare bulletin" />
          <div className="flow-list">{announcements.map((item) => <article className="flow-announcement" key={item.title}><span className="flow-eyebrow">{item.category}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
        </section>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, detail }) {
  return <section className="flow-page-intro"><span className="flow-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></section>;
}

function PanelTitle({ eyebrow, title }) {
  return <div className="flow-panel-heading"><div><span className="flow-eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>;
}

function SettledHistory({ rows, title }) {
  return <section className="flow-panel"><PanelTitle eyebrow="CONFIRMED ON-CHAIN" title={title} />
    {rows.length ? <div className="flow-table-wrap"><table><thead><tr><th>Seller</th><th>Buyer</th><th>Energy</th><th>Value</th><th>Purchase</th><th>Settlement</th></tr></thead><tbody>
      {rows.map((transaction) => <tr key={transaction._id}><td><AddressTag address={transaction.sellerId} /></td><td><AddressTag address={transaction.buyerId} /></td><td>{transaction.kWhTraded} kWh</td><td>₹{Number(transaction.totalPrice || 0).toFixed(2)}</td><td><TxLink hash={transaction.purchaseTxHash} /></td><td><TxLink hash={transaction.txHash} /></td></tr>)}
    </tbody></table></div> : <EmptyState title="No settled trades yet" detail="Settled transfers and their Sepolia transactions will appear here." />}
  </section>;
}
