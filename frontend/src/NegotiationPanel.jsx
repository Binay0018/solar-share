import { useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export default function NegotiationPanel({ offer, wallet, onChanged }) {
  const [negotiations, setNegotiations] = useState([]);
  const [price, setPrice] = useState(String(offer.pricePerKWh));
  const [buyerId, setBuyerId] = useState(wallet || "");
  const [message, setMessage] = useState("");

  async function request(path, options) {
    const response = await fetch(`${apiUrl}${path}`, { headers: { "content-type": "application/json" }, ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function refresh() {
    setNegotiations(await request(`/offers/${offer._id}/negotiations`));
  }

  useEffect(() => { refresh().catch(() => undefined); }, [offer._id]);

  async function propose(event) {
    event.preventDefault();
    try {
      await request(`/offers/${offer._id}/negotiate`, { method: "POST", body: JSON.stringify({ buyerId, proposedPricePerKWh: Number(price) }) });
      setMessage("Proposal sent");
      await refresh();
    } catch (error) { setMessage(error.message); }
  }

  async function respond(negotiationId, action) {
    try {
      await request(`/negotiations/${negotiationId}/respond`, { method: "POST", body: JSON.stringify({ sellerId: offer.sellerId, action, pricePerKWh: Number(price) }) });
      setMessage(`Negotiation ${action}ed`);
      await refresh();
      onChanged?.();
    } catch (error) { setMessage(error.message); }
  }

  return <details className="negotiation-panel"><summary>Negotiate price</summary><form onSubmit={propose}><input aria-label="Buyer ID" value={buyerId} onChange={(event) => setBuyerId(event.target.value)} placeholder="Buyer ID" required /><input aria-label="Proposed price" type="number" min="0.001" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required /><button className="text-button" type="submit">Propose</button></form>{negotiations.map((negotiation) => <div className="negotiation-thread" key={negotiation._id}><span>{negotiation.buyerId}: {negotiation.status} at {negotiation.proposedPricePerKWh}/kWh</span>{negotiation.status === "pending" || negotiation.status === "countered" ? <span className="negotiation-actions"><button className="text-button" onClick={() => respond(negotiation._id, "accept")}>Accept</button><button className="text-button" onClick={() => respond(negotiation._id, "counter")}>Counter</button><button className="text-button" onClick={() => respond(negotiation._id, "reject")}>Reject</button></span> : null}</div>)}{message ? <small>{message}</small> : null}</details>;
}
