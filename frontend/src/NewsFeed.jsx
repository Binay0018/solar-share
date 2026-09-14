import { useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const indiaElectricityNews = [
  { category: "Government", audience: "Policy", date: "Official updates", title: "Ministry of Power", text: "National electricity policy, reforms, schemes, and government announcements.", source: "powermin.gov.in", href: "https://powermin.gov.in/" },
  { category: "Government", audience: "Policy", date: "Official updates", title: "MNRE renewable-energy releases", text: "Solar, rooftop generation, storage, and clean-energy programme updates from the central ministry.", source: "mnre.gov.in", href: "https://mnre.gov.in/" },
  { category: "Government", audience: "Regulation", date: "Official updates", title: "Central Electricity Regulatory Commission", text: "Orders, market rules, tariffs, and regulatory decisions affecting electricity consumers and producers.", source: "cercind.gov.in", href: "https://cercind.gov.in/" },
  { category: "Utilities", audience: "Grid", date: "Utility desks", title: "Power Grid Corporation of India", text: "Transmission projects, grid reliability, and national power-system developments.", source: "powergrid.in", href: "https://www.powergrid.in/" },
  { category: "Utilities", audience: "State grids", date: "Utility desks", title: "State DISCOM updates", text: "Tariffs, outages, net-metering notices, billing changes, and local service announcements.", source: "BESCOM example", href: "https://bescom.karnataka.gov.in/" },
  { category: "Utilities", audience: "Market", date: "Market updates", title: "Indian Energy Exchange", text: "Day-ahead prices, electricity-market activity, and trading signals for the wider power ecosystem.", source: "iexindia.com", href: "https://www.iexindia.com/" },
  { category: "Households", audience: "Consumers", date: "For everyday users", title: "What it means for households", text: "Compare your DISCOM tariff, rooftop-solar export rate, peak usage, and the value of local energy sharing.", source: "SolarShare guide", href: "/" },
  { category: "Households", audience: "Prosumer", date: "For everyday users", title: "Rooftop solar checklist", text: "Track generation, consumption, surplus, net-metering requirements, and safe appliance usage at home.", source: "SolarShare guide", href: "/" }
];

async function loadActivity() {
  const response = await fetch(`${apiUrl}/activity`);
  if (!response.ok) throw new Error("Activity could not be loaded");
  return response.json();
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function activityLabel(entry) {
  if (entry.type === "offer") return `${entry.item.sellerId} listed ${entry.item.kWhAvailable} kWh at ${entry.item.pricePerKWh}/kWh`;
  if (entry.type === "settlement") return `${entry.item.kWhTraded} kWh settled for ${entry.item.totalPrice}`;
  return `${entry.item.buyerId} requested ${entry.item.kWhNeeded} kWh`;
}

export default function NewsFeed() {
  const [activity, setActivity] = useState([]);
  const [newsCategory, setNewsCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setActivity(await loadActivity());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  const visibleNews = newsCategory === "All"
    ? indiaElectricityNews
    : indiaElectricityNews.filter((item) => item.category === newsCategory);

  return (
    <main className="app-shell news-shell">
      <header className="topbar">
        <a className="brand" href="/">☀️ <span>SolarShare <span className="brand-badge-india">India</span></span></a>
        <a className="text-button" href="/">Back to dashboard</a>
      </header>
      <section className="news-header">
        <p className="eyebrow">SolarShare / Live bulletin</p>
        <h1>News & activity</h1>
        <p className="hero-copy">A living record of the neighbourhood marketplace, alongside the ideas shaping cleaner local energy.</p>
      </section>
      <section className="news-grid">
        <article className="panel news-activity">
          <div className="panel-heading"><div><span className="card-label">Marketplace pulse</span><h2>Recent activity</h2></div><span className="live-indicator"><i /> Live</span></div>
          {loading ? <div className="state-block">Loading activity...</div> : error ? <div className="state-block"><strong>{error}</strong><button className="text-button" onClick={refresh}>Retry</button></div> : activity.length === 0 ? <div className="state-block">No marketplace activity yet.</div> : <div className="activity-list">{activity.map((entry, index) => <div className="activity-row" key={`${entry.type}-${entry.item._id}-${index}`}><span className="activity-icon">{entry.type === "settlement" ? "₹" : entry.type === "offer" ? "☀" : "⚡"}</span><div><strong>{activityLabel(entry)}</strong><span>{entry.type}</span></div><time>{relativeTime(entry.at)}</time></div>)}</div>}
        </article>
        <article className="panel news-announcements">
          <div className="panel-heading"><div><span className="card-label">India electricity desk</span><h2>Government to household</h2></div></div>
          <div className="news-filters" role="tablist" aria-label="India electricity news categories">
            {["All", "Government", "Utilities", "Households"].map((category) => <button key={category} className={`text-button ${newsCategory === category ? "active" : ""}`} onClick={() => setNewsCategory(category)}>{category}</button>)}
          </div>
          <div className="announcement-list">{visibleNews.map((item) => <article className="announcement" key={item.title}><div className="announcement-meta"><span>{item.category}</span><time>{item.date}</time></div><h3>{item.title}</h3><p>{item.text}</p><a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel={item.href.startsWith("http") ? "noreferrer" : undefined}>{item.source} ↗</a></article>)}</div>
        </article>
      </section>
    </main>
  );
}
