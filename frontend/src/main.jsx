import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { isAddress } from "viem";
import "./styles.css";
import NewsFeed from "./NewsFeed.jsx";
import NegotiationPanel from "./NegotiationPanel.jsx";
import PurchaseButton from "./PurchaseButton.jsx";
import { contractAddress, contractGasLimit, decodeContractEvent, ensureProsumer, getPublicClient, getWalletClient, kWhToContractUnits, priceToWei, solarShareAbi } from "./contractClient.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Reference table of state DISCOM tariffs. There is no public tariff API for
// these boards, so the rates are maintained here as reference data in ₹/kWh.
const INDIAN_DISCOMS = [
  { id: "bescom", name: "BESCOM (Bengaluru / Karnataka)", stateEn: "Karnataka", stateHi: "कर्नाटक", gridRatePerKWh: 7.5, feedInPerKWh: 4.1 },
  { id: "tangedco", name: "TANGEDCO (Tamil Nadu)", stateEn: "Tamil Nadu", stateHi: "तमिलनाडु", gridRatePerKWh: 6.8, feedInPerKWh: 3.8 },
  { id: "mahadiscom", name: "MSEDCL / Mahavitaran (Maharashtra)", stateEn: "Maharashtra", stateHi: "महाराष्ट्र", gridRatePerKWh: 8.2, feedInPerKWh: 4.5 },
  { id: "brpl", name: "BSES Rajdhani (Delhi NCR)", stateEn: "Delhi", stateHi: "दिल्ली", gridRatePerKWh: 6.5, feedInPerKWh: 3.95 },
  { id: "ugvcl", name: "UGVCL / GUVNL (Gujarat)", stateEn: "Gujarat", stateHi: "गुजरात", gridRatePerKWh: 6.2, feedInPerKWh: 4.25 },
  { id: "tsspdcl", name: "TSSPDCL (Telangana)", stateEn: "Telangana", stateHi: "तेलंगाना", gridRatePerKWh: 7.2, feedInPerKWh: 4.0 },
  { id: "wbsetcl", name: "WBSEDCL (West Bengal)", stateEn: "West Bengal", stateHi: "पश्चिम बंगाल", gridRatePerKWh: 7.4, feedInPerKWh: 3.75 },
  { id: "uppcl", name: "UPPCL (Uttar Pradesh)", stateEn: "Uttar Pradesh", stateHi: "उत्तर प्रदेश", gridRatePerKWh: 6.9, feedInPerKWh: 3.6 },
];

const formatRate = (value) => `₹${Number(value).toFixed(2)}/unit`;
const generateId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// Complete English & Hindi dictionary
const translations = {
  en: {
    brandBadge: "India",
    discomLabel: "DISCOM Grid:",
    liveGrid: "Live Microgrid (IST)",
    connectWallet: "Connect Web3 Wallet",
    eyebrowPrefix: "National Solar Mission",
    gridSuffix: "Grid",
    heroTitle1: "Good energy,",
    heroTitle2: "shared locally.",
    heroDesc: "A peer-to-peer decentralized smart grid. Sell surplus rooftop solar directly to neighbours — cheaper than DISCOM grid tariffs, more profitable than feed-in export.",
    schemeBadge: "🇮🇳 PM Surya Ghar: Muft Bijli Yojana Compatible",
    producerTab: "☀️ I produce power (Prosumer)",
    consumerTab: "⚡ I need power (Consumer)",
    surplusLabel: "Current Solar Surplus",
    demandLabel: "Current Power Demand",
    unitSuffix: " Units (kWh)",
    surplusSub: "↑ ₹{amount}/hr estimated earnings",
    demandSub: "↓ ₹{amount} saved vs DISCOM",
    genTodayLabel: "Today's Total Generation",
    genTodaySub: "Peak output at {peakHour} IST",
    communityValLabel: "Local Community Value",
    communityValSub: "total savings vs DISCOM slab",
    networkActLabel: "Live Network Activity",
    activeOffersSub: "active offers",
    settledTradesSub: "settled trades on ledger",
    tariffGridTitle: "DISCOM Grid Tariff",
    tariffP2pTitle: "SolarShare P2P Rate",
    tariffFeedInTitle: "DISCOM Feed-in Rate",
    tariffBadge: "Prosumers earn +{uplift}% more • Consumers save {savings}% on electricity",
    chartHeading: "Rooftop Generation Profile",
    chartSub: "24-Hour Solar Energy Curve",
    chartChip: "IST Timezone (UTC+5:30)",
    chartLegendGen: "Solar Generation (kWh)",
    chartLegendCons: "Household Consumption (kWh)",
    activityHeading: "Smart Grid Ledger",
    activitySub: "Live P2P Settlements",
    refreshBtn: "Refresh ↻",
    loadingActivity: "Loading ledger transactions...",
    noTradesTitle: "No settled trades yet",
    noTradesDesc: "Activity will appear here as the IoT matching engine executes.",
    energySettled: "Energy settled on-chain",
    tradedSuffix: "units traded",
    totalVal: "Total Value:",
    marketplaceHeading: "Energy Marketplace",
    marketplaceSub: "Open Solar Offers",
    availableOffers: "available",
    loadingOffers: "Loading marketplace offers...",
    quietMarketTitle: "Marketplace is quiet",
    quietMarketDesc: "New neighbourhood rooftop offers will appear here.",
    localProsumer: "Local Prosumer",
    quickActionHeading: "Quick Action",
    offerFormHeading: "Sell Rooftop Solar Surplus",
    requestFormHeading: "Request Clean Neighbourhood Power",
    sellerIdLabel: "Seller / Rooftop ID",
    sellerIdPlaceholder: "e.g. solar-home-01",
    availUnitsLabel: "Available Units (kWh)",
    ratePerUnitLabel: "Rate per Unit (₹ / kWh)",
    recommendedRate: "Recommended: ₹{low} - ₹{high}/unit (cheaper than DISCOM ₹{grid})",
    publishOfferBtn: "Publish Solar Offer",
    buyerIdLabel: "Buyer / Household ID",
    buyerIdPlaceholder: "e.g. flat-302-koramangala",
    neededUnitsLabel: "Needed Units (kWh)",
    maxRateLabel: "Max Rate (₹ / kWh)",
    estSavingsPrefix: "Est. savings vs grid: ₹",
    requestPowerBtn: "Submit Energy Request",
    footerTitle: "SolarShare India • Decentralized Peer-to-Peer Solar Microgrid",
    footerPolicy: "Aligned with CEA (Central Electricity Authority) & SERC Open Access regulations",
    footerRefresh: "Real-time refresh every 10s",
    statusOpen: "Open",
    statusMatched: "Matched",
    statusSettled: "Settled",
    dismiss: "Dismiss ✕",
    retry: "Retry ↻",
    backendError: "Local backend is connecting. Start MongoDB and backend to view live ledger.",
    walletSuccess: "Wallet connected successfully: ",
    walletCancelled: "Wallet connection was cancelled.",
    noMetaMask: "MetaMask not found. Please install MetaMask to connect Web3 wallet.",
    offerSuccess: "Solar offer published! ",
    offerError: "Could not publish offer. Please check details and try again.",
    tradeSuccess: "Power request submitted! ",
    tradeError: "Could not submit energy request. Please try again."
  },
  hi: {
    brandBadge: "भारत",
    discomLabel: "डिस्कॉम ग्रिड:",
    liveGrid: "लाइव माइक्रो-ग्रिड (IST)",
    connectWallet: "वेब3 वॉलेट जोड़ें",
    eyebrowPrefix: "राष्ट्रीय सौर ऊर्जा मिशन",
    gridSuffix: "ग्रिड",
    heroTitle1: "अपनी छत की सौर ऊर्जा,",
    heroTitle2: "पड़ोस में साझा करें।",
    heroDesc: "पीयर-टू-पीयर (P2P) डिसेंट्रलाइज्ड स्मार्ट ग्रिड। सीधे अपने पड़ोसियों को सोलर बिजली बेचें — डिस्कॉम (DISCOM) रेट से सस्ती, नेट-मीटरिंग एक्सपोर्ट से अधिक लाभदायक।",
    schemeBadge: "🇮🇳 पीएम सूर्य घर: मुफ्त बिजली योजना संगत",
    producerTab: "☀️ मैं ऊर्जा उत्पादक हूँ (Prosumer)",
    consumerTab: "⚡ मुझे बिजली चाहिए (Consumer)",
    surplusLabel: "अतिरिक्त सौर ऊर्जा (Surplus)",
    demandLabel: "वर्तमान बिजली मांग (Demand)",
    unitSuffix: " यूनिट्स (kWh)",
    surplusSub: "↑ ₹{amount} प्रति घंटा संभावित आय",
    demandSub: "↓ ₹{amount} डिस्कॉम से सीधी बचत",
    genTodayLabel: "आज का कुल सौर उत्पादन",
    genTodaySub: "{peakHour} IST पर पीक उत्पादन",
    communityValLabel: "स्थानीय समुदाय मूल्य",
    communityValSub: "कुल बचत (DISCOM स्लैब की तुलना में)",
    networkActLabel: "सक्रिय नेटवर्क गतिविधि",
    activeOffersSub: "सक्रिय ऑफर्स",
    settledTradesSub: "सफल ट्रेड ऑन-चेन",
    tariffGridTitle: "सरकारी ग्रिड दर",
    tariffP2pTitle: "SolarShare P2P विनिमय दर",
    tariffFeedInTitle: "DISCOM सोलर एक्सपोर्ट दर",
    tariffBadge: "उत्पादक को +{uplift}% अधिक फायदा • उपभोक्ता को {savings}% सस्ती बिजली",
    chartHeading: "रूफटॉप जनरेशन प्रोफाइल",
    chartSub: "दिनभर की सौर ऊर्जा (24 घंटे)",
    chartChip: "IST टाइमज़ोन (UTC+5:30)",
    chartLegendGen: "सोलर उत्पादन (kWh)",
    chartLegendCons: "घरेलू खपत (kWh)",
    activityHeading: "स्मार्ट ग्रिड लेजर",
    activitySub: "ताज़ा लेन-देन (Live Settlements)",
    refreshBtn: "रिफ्रेश ↻",
    loadingActivity: "नेटवर्क गतिविधि लोड हो रही है...",
    noTradesTitle: "अभी कोई ट्रेड दर्ज नहीं है",
    noTradesDesc: "जैसे ही IoT सिमुलेटर मैच करेगा, ब्लॉकचेन सेटलमेंट यहाँ दिखेगा।",
    energySettled: "ऊर्जा निपटान संपन्न",
    tradedSuffix: "यूनिट्स ट्रेड हुई",
    totalVal: "कुल मूल्य:",
    marketplaceHeading: "ऊर्जा बाज़ार (Marketplace)",
    marketplaceSub: "सक्रिय सोलर ऑफर",
    availableOffers: "उपलब्ध",
    loadingOffers: "ऑफर लोड हो रहे हैं...",
    quietMarketTitle: "बाज़ार अभी शांत है",
    quietMarketDesc: "नए रूफटॉप सोलर ऑफर जल्द यहाँ दिखाई देंगे।",
    localProsumer: "स्थानीय सौर उत्पादक",
    quickActionHeading: "त्वरित कार्रवाई",
    offerFormHeading: "अतिरिक्त सौर ऊर्जा बेचें",
    requestFormHeading: "पड़ोस से हरित बिजली खरीदें",
    sellerIdLabel: "विक्रेता आईडी (Seller ID)",
    sellerIdPlaceholder: "उदा. solar-home-01",
    availUnitsLabel: "उपलब्ध यूनिट्स (kWh)",
    ratePerUnitLabel: "दर प्रति यूनिट (₹ / kWh)",
    recommendedRate: "अनुशंसित दर: ₹{low} - ₹{high}/यूनिट (डिस्कॉम से सस्ती ₹{grid})",
    publishOfferBtn: "ऑफर प्रकाशित करें",
    buyerIdLabel: "उपभोक्ता आईडी (Buyer ID)",
    buyerIdPlaceholder: "उदा. consumer-flat-302",
    neededUnitsLabel: "आवश्यक यूनिट्स (kWh)",
    maxRateLabel: "अधिकतम दर (Max ₹ / kWh)",
    estSavingsPrefix: "स्थानीय ग्रिड से अनुमानित बचत: ₹",
    requestPowerBtn: "बिजली अनुरोध भेजें",
    footerTitle: "SolarShare भारत • विकेन्द्रीकृत सहकर्मी सौर ग्रिड (P2P Solar Microgrid)",
    footerPolicy: "केंद्रीय विद्युत प्राधिकरण (CEA) एवं राज्य विद्युत नियामक आयोग (SERC) दिशानिर्देश संगत",
    footerRefresh: "हर 10 सेकंड में रीयल-टाइम रिफ्रेश",
    statusOpen: "सक्रिय / Open",
    statusMatched: "मेल मिला / Matched",
    statusSettled: "संपन्न / Settled",
    dismiss: "बन्द करें ✕",
    retry: "पुनः प्रयास ↻",
    backendError: "लोकल बैकएंड कनेक्ट हो रहा है। रीयल-टाइम लेजर हेतु बैकएंड और MongoDB चालू करें।",
    walletSuccess: "वॉलेट सफलतापूर्वक जुड़ गया: ",
    walletCancelled: "वॉलेट कनेक्शन रद्द कर दिया गया।",
    noMetaMask: "MetaMask उपलब्ध नहीं है। कृपया ब्राउज़र एक्सटेंशन इंस्टॉल करें।",
    offerSuccess: "सौर ऊर्जा ऑफर प्रकाशित! ",
    offerError: "ऑफर प्रकाशित नहीं हो सका। कृपया विवरण जांचें।",
    tradeSuccess: "बिजली खरीद अनुरोध जमा किया गया! ",
    tradeError: "अनुरोध जमा नहीं हो सका। कृपया पुनः प्रयास करें।"
  }
};

async function apiRequest(path, options) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    let errMsg = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return response.json();
}

function formatWallet(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

function formatINR(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function StatusPill({ status, lang }) {
  const t = translations[lang];
  const label = status === "open" ? t.statusOpen : status === "matched" ? t.statusMatched : status === "settled" ? t.statusSettled : status;
  return <span className={`status status-${status}`}>{label}</span>;
}

function TrendChart({ generation, consumption }) {
  const maxVal = Math.max(0.001, ...generation, ...consumption);
  const toPoints = (values) =>
    values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 340;
        const y = 90 - (value / maxVal) * 75;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const generationPoints = toPoints(generation);
  const consumptionPoints = toPoints(consumption);

  return (
    <div className="trend-chart" aria-label="Solar rooftop generation curve across Indian daytime hours">
      <svg viewBox="0 0 340 100" role="img">
        <defs>
          <linearGradient id="solarGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2ba49" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f2ba49" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,90 ${generationPoints} 340,90`} fill="url(#solarGradient)" />
        <polyline points={generationPoints} fill="none" stroke="#f2ba49" strokeWidth="2.5" />
        <polyline points={consumptionPoints} fill="none" stroke="#7dd3fc" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
      <div className="chart-labels">
        <span>00 IST</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23 IST</span>
      </div>
    </div>
  );
}

function App() {
  const [lang, setLang] = useState("en"); // 'en' (English) or 'hi' (हिंदी)
  const [mode, setMode] = useState("prosumer"); // 'prosumer' or 'consumer'
  const [wallet, setWallet] = useState("");
  const [selectedDiscom, setSelectedDiscom] = useState(INDIAN_DISCOMS.find((discom) => discom.id === "mahadiscom"));
  const [offers, setOffers] = useState([]);
  const [trades, setTrades] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [readings, setReadings] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const t = translations[lang];

  const [offerForm, setOfferForm] = useState({
    sellerId: "",
    kWhAvailable: "",
    pricePerKWh: "",
  });
  const [tradeForm, setTradeForm] = useState({
    buyerId: "",
    kWhNeeded: "",
    maxPricePerKWh: "",
  });

  async function refresh() {
    setLoading(true);
    try {
      const [offerData, tradeData, transactionData, readingData, metricsData] = await Promise.all([
        apiRequest("/offers?status=open"),
        apiRequest("/trades"),
        apiRequest("/transactions"),
        apiRequest("/meter-readings").catch(() => []),
        apiRequest("/metrics").catch(() => null),
      ]);
      setOffers(offerData);
      setTrades(tradeData);
      setTransactions(transactionData);
      setReadings(readingData);
      setMetrics(metricsData);
      setError("");
    } catch {
      setError(t.backendError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice(t.noMetaMask);
      return;
    }
    try {
      const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setWallet(address);
      setNotice(t.walletSuccess + formatWallet(address));
    } catch {
      setNotice(t.walletCancelled);
    }
  }

  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [submittingTrade, setSubmittingTrade] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState(null);

  async function createOffer(event) {
    if (event) event.preventDefault();
    if (submittingOffer) return;
    setSubmittingOffer(true);
    setNotice("");
    try {
      const sellerId = wallet || offerForm.sellerId.trim() || generateId("prosumer");
      const payload = {
        sellerId,
        kWhAvailable: Number(offerForm.kWhAvailable),
        pricePerKWh: Number(offerForm.pricePerKWh),
      };

      if (!payload.kWhAvailable || payload.kWhAvailable <= 0) {
        throw new Error(lang === "hi" ? "कृपया मान्य यूनिट्स (kWh > 0) दर्ज करें" : "Please enter valid units (kWh > 0)");
      }
      if (isNaN(payload.pricePerKWh) || payload.pricePerKWh < 0) {
        throw new Error(lang === "hi" ? "कृपया मान्य दर (₹ >= 0) दर्ज करें" : "Please enter valid rate (₹ >= 0)");
      }

      if (wallet) {
        if (!Number.isInteger(payload.kWhAvailable)) {
          throw new Error(lang === "hi" ? "ऑन-चेन ऑफर के लिए पूर्ण kWh संख्या दर्ज करें, जैसे 5" : "Enter a whole kWh amount for an on-chain offer, for example 5");
        }
        setNotice("Confirm in MetaMask: register this wallet as a prosumer if requested...");
        await ensureProsumer(wallet);
        setNotice("Confirm in MetaMask: create the offer on-chain...");
        const walletClient = getWalletClient(wallet);
        const createHash = await walletClient.writeContract({
          address: contractAddress,
          abi: solarShareAbi,
          functionName: "createOffer",
          args: [kWhToContractUnits(payload.kWhAvailable), priceToWei(payload.pricePerKWh)],
          gas: contractGasLimit
        });
        setNotice("Creating offer on-chain...");
        const receipt = await getPublicClient().waitForTransactionReceipt({ hash: createHash });
        if (receipt.status !== "success") throw new Error("The on-chain offer transaction failed");
        const { offerId } = decodeContractEvent(receipt, "OfferCreated");
        setNotice("Registering offer...");
        await apiRequest("/offers", {
          method: "POST",
          body: JSON.stringify({ ...payload, onChainOfferId: Number(offerId) }),
        });
      } else {
        await apiRequest("/offers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setNotice(`✅ ${t.offerSuccess}${payload.kWhAvailable} kWh @ ₹${payload.pricePerKWh}/unit`);
      await refresh();
    } catch (err) {
      console.error("Create offer error:", err);
      setNotice(`❌ ${t.offerError} (${err.message})`);
    } finally {
      setSubmittingOffer(false);
    }
  }

  async function createTradeRequest(event) {
    if (event) event.preventDefault();
    if (submittingTrade) return;
    setSubmittingTrade(true);
    setNotice("");
    try {
      const payload = {
        buyerId: tradeForm.buyerId.trim() || generateId("consumer"),
        kWhNeeded: Number(tradeForm.kWhNeeded),
        maxPricePerKWh: Number(tradeForm.maxPricePerKWh),
      };

      if (isAddress(payload.buyerId) && (!wallet || payload.buyerId.toLowerCase() !== wallet.toLowerCase())) {
        throw new Error("The buyer ID must match the connected MetaMask wallet");
      }

      if (!payload.kWhNeeded || payload.kWhNeeded <= 0) {
        throw new Error(lang === "hi" ? "कृपया मान्य यूनिट्स (kWh > 0) दर्ज करें" : "Please enter valid units (kWh > 0)");
      }
      if (isNaN(payload.maxPricePerKWh) || payload.maxPricePerKWh < 0) {
        throw new Error(lang === "hi" ? "कृपया मान्य दर (₹ >= 0) दर्ज करें" : "Please enter valid rate (₹ >= 0)");
      }

      const response = await apiRequest("/trades", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const pending = response.matching?.results?.find((result) => result.status === "pending");
      setPendingPurchase(pending ? { ...pending, buyerId: payload.buyerId } : null);

      setNotice(`✅ ${t.tradeSuccess}${payload.kWhNeeded} kWh @ max ₹${payload.maxPricePerKWh}`);
      await refresh();
    } catch (err) {
      console.error("Create trade error:", err);
      setNotice(`❌ ${t.tradeError} (${err.message})`);
    } finally {
      setSubmittingTrade(false);
    }
  }

  const currentDate = new Date().toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const totalUnitsTraded = transactions.reduce((sum, tx) => sum + (tx.kWhTraded || 0), 0);
  const totalRupeesValue = transactions.reduce((sum, tx) => sum + (tx.totalPrice || 0), 0);

  // Live P2P price range derived from the open marketplace offers
  const p2pPrices = offers.map((offer) => Number(offer.pricePerKWh)).filter((price) => Number.isFinite(price) && price > 0);
  const p2pMin = p2pPrices.length ? Math.min(...p2pPrices) : null;
  const p2pMax = p2pPrices.length ? Math.max(...p2pPrices) : null;
  const p2pRate = p2pMin === null ? null : (p2pMin + p2pMax) / 2;

  const gridRate = Number(selectedDiscom.gridRatePerKWh);
  const feedInRate = Number(selectedDiscom.feedInPerKWh);

  // Compute real KPI values from actual meter readings, live offers, and backend metrics
  const latestReading = readings.length > 0 ? readings[0] : null;
  const currentSurplus = latestReading ? Math.max(0, latestReading.surplusKWh || 0).toFixed(2) : "0.00";
  const currentDemand = latestReading ? Math.max(0, latestReading.consumptionKWh || 0).toFixed(2) : "0.00";
  const totalGenToday = readings.reduce((sum, r) => sum + (r.generationKWh || 0), 0).toFixed(1);
  const surplusEarnings = latestReading && p2pRate !== null ? (latestReading.surplusKWh || 0) * p2pRate : 0;
  const demandSavings = latestReading && p2pRate !== null ? (latestReading.consumptionKWh || 0) * Math.max(0, gridRate - p2pRate) : 0;
  const communitySavings = metrics?.buyerSavingsVsBaseline ?? 0;
  const upliftPct = p2pRate !== null && feedInRate > 0 ? Math.max(0, Math.round((p2pRate / feedInRate - 1) * 100)) : 0;
  const savingsPct = p2pRate !== null && gridRate > 0 ? Math.max(0, Math.round((1 - p2pRate / gridRate) * 100)) : 0;

  // 24-hour generation/consumption profile averaged from real meter readings (IST hours)
  const hourlyProfile = useMemo(() => {
    const generationSum = new Array(24).fill(0);
    const consumptionSum = new Array(24).fill(0);
    const hourCount = new Array(24).fill(0);
    for (const reading of readings) {
      const timestamp = new Date(reading.timestamp).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const istHour = new Date(timestamp + 330 * 60000).getUTCHours();
      generationSum[istHour] += Number(reading.generationKWh) || 0;
      consumptionSum[istHour] += Number(reading.consumptionKWh) || 0;
      hourCount[istHour] += 1;
    }
    const average = (sums) => sums.map((sum, hour) => (hourCount[hour] ? Number((sum / hourCount[hour]).toFixed(3)) : 0));
    const generation = average(generationSum);
    const consumption = average(consumptionSum);
    const peakHour = generation.indexOf(Math.max(...generation));
    return { generation, consumption, sampleCount: hourCount.reduce((total, count) => total + count, 0), peakHour };
  }, [readings]);

  return (
    <main className="app-shell">
      {/* Top Navigation */}
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">☀️</span>
          <span>
            SolarShare <span className="brand-badge-india">{t.brandBadge}</span>
          </span>
        </a>

        <div className="topbar-actions">
          {/* Language Toggle Switch */}
          <div className="lang-switcher" role="group" aria-label="Language Selector">
            <button
              className={`lang-btn ${lang === "en" ? "active" : ""}`}
              onClick={() => setLang("en")}
              title="Switch to English"
            >
              English
            </button>
            <button
              className={`lang-btn ${lang === "hi" ? "active" : ""}`}
              onClick={() => setLang("hi")}
              title="हिंदी में देखें"
            >
              हिंदी
            </button>
          </div>

          {/* DISCOM Dropdown */}
          <div className="discom-selector-wrap">
            <span className="discom-label">{t.discomLabel}</span>
            <select
              className="discom-select"
              value={selectedDiscom.id}
              onChange={(e) => {
                const found = INDIAN_DISCOMS.find((d) => d.id === e.target.value);
                if (found) setSelectedDiscom(found);
              }}
            >
              {INDIAN_DISCOMS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <a className="text-button" href="/news">News</a>
          <span className="live-indicator">
            <i /> {t.liveGrid}
          </span>

          <button className="wallet-button" onClick={connectWallet}>
            {wallet ? formatWallet(wallet) : t.connectWallet}
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-row">
        <div>
          <p className="eyebrow">
            {t.eyebrowPrefix} • {currentDate} • {lang === "hi" ? selectedDiscom.stateHi : selectedDiscom.stateEn} {t.gridSuffix}
          </p>
          <h1>
            {t.heroTitle1}
            <br />
            <em>{t.heroTitle2}</em>
          </h1>
          <p className="hero-copy">{t.heroDesc}</p>
          <div className="scheme-tag">
            <span>{t.schemeBadge}</span>
          </div>
        </div>

        <div className="mode-switcher" role="tablist" aria-label="Dashboard mode">
          <button
            className={mode === "prosumer" ? "active" : ""}
            onClick={() => setMode("prosumer")}
          >
            {t.producerTab}
          </button>
          <button
            className={mode === "consumer" ? "active" : ""}
            onClick={() => setMode("consumer")}
          >
            {t.consumerTab}
          </button>
        </div>
      </section>

      {/* Notices */}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>{t.dismiss}</button>
        </div>
      )}
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={refresh}>{t.retry}</button>
        </div>
      )}

      {/* KPI Metrics */}
      <section className="metric-grid">
        <article className="metric-card accent-card">
          <span className="card-label">
            {mode === "prosumer" ? t.surplusLabel : t.demandLabel}
          </span>
          <strong>
            {mode === "prosumer" ? currentSurplus : currentDemand}
            <small>{t.unitSuffix}</small>
          </strong>
          <span className="metric-delta">
            {mode === "prosumer"
              ? t.surplusSub.replace("{amount}", surplusEarnings.toFixed(2))
              : t.demandSub.replace("{amount}", demandSavings.toFixed(2))}
          </span>
        </article>

        <article className="metric-card">
          <span className="card-label">{t.genTodayLabel}</span>
          <strong>
            {totalGenToday}<small>{t.unitSuffix}</small>
          </strong>
          <span className="metric-delta neutral">{t.genTodaySub.replace("{peakHour}", hourlyProfile.sampleCount ? `${String(hourlyProfile.peakHour).padStart(2, "0")}:00` : "—")}</span>
        </article>

        <article className="metric-card">
          <span className="card-label">{t.communityValLabel}</span>
          <strong>{formatINR(totalRupeesValue)}</strong>
          <span className="metric-delta">
            +₹{communitySavings.toFixed(0)} {t.communityValSub}
          </span>
        </article>

        <article className="metric-card">
          <span className="card-label">{t.networkActLabel}</span>
          <strong>
            {offers.length}
            <small> {t.activeOffersSub}</small>
          </strong>
          <span className="metric-delta neutral">
            {transactions.length} {t.settledTradesSub}
          </span>
        </article>
      </section>

      {/* DISCOM Tariff Strip */}
      <section className="tariff-banner">
        <div className="tariff-item">
          <span className="tariff-title">
            {t.tariffGridTitle} ({selectedDiscom.name.split(" ")[0]}):
          </span>
          <span className="tariff-val danger">{formatRate(gridRate)}</span>
        </div>
        <div className="tariff-item">
          <span className="tariff-title">{t.tariffP2pTitle}:</span>
          <span className="tariff-val success">{p2pMin === null ? "—" : `₹${p2pMin.toFixed(2)} - ₹${p2pMax.toFixed(2)}/unit`}</span>
        </div>
        <div className="tariff-item">
          <span className="tariff-title">{t.tariffFeedInTitle}:</span>
          <span className="tariff-val warning">{formatRate(feedInRate)}</span>
        </div>
        <div className="tariff-badge">
          <span>{t.tariffBadge.replace("{uplift}", upliftPct).replace("{savings}", savingsPct)}</span>
        </div>
      </section>

      {/* Generation Chart & Activity */}
      <section className="content-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="card-label">{t.chartHeading}</span>
              <h2>{t.chartSub}</h2>
            </div>
            <span className="range-chip">{t.chartChip}</span>
          </div>
          {hourlyProfile.sampleCount === 0 ? (
            <div className="state-block">
              <span className="state-icon">📡</span>
              <strong>{lang === "hi" ? "आईओटी मीटर रीडिंग की प्रतीक्षा में" : "Waiting for IoT meter readings"}</strong>
              <span>{lang === "hi" ? "सिम्युलेटर डेटा भेजने के बाद सौर जनरेशन प्रोफाइल यहाँ दिखाई देगा" : "The solar generation profile will appear once the simulator posts meter data."}</span>
            </div>
          ) : (
            <TrendChart generation={hourlyProfile.generation} consumption={hourlyProfile.consumption} />
          )}
          <div className="chart-legend">
            <span>
              <i className="legend-generation" /> {t.chartLegendGen}
            </span>
            <span>
              <i className="legend-consumption" /> {t.chartLegendCons}
            </span>
          </div>
        </article>

        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <span className="card-label">{t.activityHeading}</span>
              <h2>{t.activitySub}</h2>
            </div>
            <button className="text-button" onClick={refresh}>
              {t.refreshBtn}
            </button>
          </div>
          {loading ? (
            <div className="state-block">{t.loadingActivity}</div>
          ) : transactions.length === 0 ? (
            <div className="state-block">
              <span className="state-icon">⚡</span>
              <strong>{t.noTradesTitle}</strong>
              <span>{t.noTradesDesc}</span>
            </div>
          ) : (
            <div className="activity-list">
              {transactions.slice(0, 5).map((transaction) => (
                <div className="activity-row" key={transaction._id}>
                  <span className="activity-icon">₹</span>
                  <div>
                    <strong>
                      {transaction.kWhTraded} {t.tradedSuffix}
                    </strong>
                    <span>
                      {t.totalVal} {formatINR(transaction.totalPrice)} • Tx:{" "}
                      {transaction.txHash ? `${transaction.txHash.slice(0, 10)}...` : "Smart Contract"}
                    </span>
                  </div>
                  <time>Now</time>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {/* Marketplace & Action Forms */}
      <section className="lower-grid">
        <article className="panel table-panel">
          <div className="panel-heading">
            <div>
              <span className="card-label">{t.marketplaceHeading}</span>
              <h2>{t.marketplaceSub}</h2>
            </div>
            <span className="count-badge">{offers.length} {t.availableOffers}</span>
          </div>
          {loading ? (
            <div className="state-block">{t.loadingOffers}</div>
          ) : offers.length === 0 ? (
            <div className="state-block compact">
              <strong>{t.quietMarketTitle}</strong>
              <span>{t.quietMarketDesc}</span>
            </div>
          ) : (
            <div className="offer-list">
              {offers.slice(0, 6).map((offer) => (
                <div className="offer-row" key={offer._id}>
                  <div className="avatar">{offer.sellerId?.slice(0, 1).toUpperCase() || "S"}</div>
                  <div className="offer-name">
                    <strong>{offer.sellerId}</strong>
                    <span>
                      {t.localProsumer} ({lang === "hi" ? selectedDiscom.stateHi : selectedDiscom.stateEn})
                    </span>
                  </div>
                  <strong>
                    {offer.kWhAvailable} <small>{t.unitSuffix}</small>
                  </strong>
                  <span>₹{offer.pricePerKWh}/unit</span>
                  <div className="offer-actions">
                    <StatusPill status={offer.status} lang={lang} />
                    <PurchaseButton
                      offer={offer}
                      wallet={wallet}
                      onComplete={setNotice}
                      onCompletePurchase={() => {
                        setPendingPurchase(null);
                        refresh();
                      }}
                    />
                  </div>
                  <NegotiationPanel offer={offer} wallet={wallet} onChanged={refresh} />
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel form-panel">
          <div className="panel-heading">
            <div>
              <span className="card-label">{t.quickActionHeading}</span>
              <h2>{mode === "prosumer" ? t.offerFormHeading : t.requestFormHeading}</h2>
            </div>
          </div>
          {mode === "prosumer" ? (
            <form onSubmit={createOffer}>
              <label>
                {t.sellerIdLabel}
                <input
                  value={offerForm.sellerId}
                  onChange={(e) => setOfferForm({ ...offerForm, sellerId: e.target.value })}
                  placeholder={t.sellerIdPlaceholder}
                  required
                />
              </label>
              <div className="input-row">
                <label>
                  {t.availUnitsLabel}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={offerForm.kWhAvailable}
                    onChange={(e) => setOfferForm({ ...offerForm, kWhAvailable: e.target.value })}
                    required
                  />
                </label>
                <label>
                  {t.ratePerUnitLabel}
                  <input
                    type="number"
                    min="0"
                    step="0.05"
                    value={offerForm.pricePerKWh}
                    onChange={(e) => setOfferForm({ ...offerForm, pricePerKWh: e.target.value })}
                    required
                  />
                </label>
              </div>
              <div className="form-helper">
                {t.recommendedRate
                  .replace("{low}", feedInRate.toFixed(2))
                  .replace("{high}", gridRate.toFixed(2))
                  .replace("{grid}", gridRate.toFixed(2))}
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={submittingOffer}
                style={{ opacity: submittingOffer ? 0.7 : 1, cursor: submittingOffer ? "not-allowed" : "pointer" }}
              >
                {submittingOffer
                  ? (lang === "hi" ? "प्रकाशित हो रहा है... (Publishing...)" : "Publishing Offer...")
                  : t.publishOfferBtn}{" "}
                <span>{submittingOffer ? "⏳" : "→"}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={createTradeRequest}>
              <label>
                {t.buyerIdLabel}
                <input
                  value={tradeForm.buyerId}
                  onChange={(e) => setTradeForm({ ...tradeForm, buyerId: e.target.value })}
                  placeholder={t.buyerIdPlaceholder}
                  required
                />
              </label>
              <div className="input-row">
                <label>
                  {t.neededUnitsLabel}
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={tradeForm.kWhNeeded}
                    onChange={(e) => setTradeForm({ ...tradeForm, kWhNeeded: e.target.value })}
                    required
                  />
                </label>
                <label>
                  {t.maxRateLabel}
                  <input
                    type="number"
                    min="0"
                    step="0.05"
                    value={tradeForm.maxPricePerKWh}
                    onChange={(e) => setTradeForm({ ...tradeForm, maxPricePerKWh: e.target.value })}
                    required
                  />
                </label>
              </div>
              <div className="form-helper">
                {t.estSavingsPrefix}{(Number(tradeForm.kWhNeeded) * Math.max(0, gridRate - (p2pRate ?? gridRate))).toFixed(1)}
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={submittingTrade}
                style={{ opacity: submittingTrade ? 0.7 : 1, cursor: submittingTrade ? "not-allowed" : "pointer" }}
              >
                {submittingTrade
                  ? (lang === "hi" ? "अनुरोध भेजा जा रहा है..." : "Submitting Request...")
                  : t.requestPowerBtn}{" "}
                <span>{submittingTrade ? "⏳" : "→"}</span>
              </button>
            </form>
          )}
        </article>
      </section>

      {/* Consumer Request Fills */}
      {mode === "consumer" && trades.length > 0 && (
        <section className="consumer-fills">
          <h2>My Request Fills</h2>
          {trades.filter(tr => tr.fills && tr.fills.length > 0).map(tr => {
            const totalKWh = tr.fills.reduce((s, f) => s + f.kWh, 0);
            const avgPrice = totalKWh > 0 ? tr.fills.reduce((s, f) => s + f.kWh * f.pricePerKWh, 0) / totalKWh : 0;
            return (
              <div key={tr._id} className="fill-card">
                <div className="fill-header">
                  <span>Request: {tr.kWhNeeded} kWh @ max ₹{tr.maxPricePerKWh}/unit</span>
                  <span className={`status-pill ${tr.status}`}>{tr.status}</span>
                </div>
                <div className="fill-summary">
                  Total filled: {totalKWh.toFixed(1)} kWh @ avg ₹{avgPrice.toFixed(2)}/unit
                </div>
                {tr.fills.map((fill, idx) => (
                  <div key={idx} className="fill-row">
                    <span>{fill.sellerId.slice(0, 15)}...</span>
                    <span>{fill.kWh} kWh @ ₹{fill.pricePerKWh}/unit</span>
                    <span className={`status-pill ${fill.status}`}>{fill.status}</span>
                    {fill.txHash && (
                      <a href={`https://sepolia.etherscan.io/tx/${fill.txHash}`} target="_blank" rel="noreferrer">
                        View tx
                      </a>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}

      {/* Footer */}
      <footer>
        <div>
          <span>{t.footerTitle}</span>
          <div className="footer-subtext">
            <span>{t.footerPolicy}</span>
          </div>
        </div>
        <div className="footer-right">
          <span>{t.footerRefresh}</span>
          <i className="footer-dot" />
        </div>
      </footer>
    </main>
  );
}
// thats right
createRoot(document.getElementById("root")).render(
  <StrictMode>
    {window.location.pathname === "/news" ? <NewsFeed /> : <App />}
  </StrictMode>
);
