import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { formatEther } from "viem";
import "./styles.css";
import {
  contractAddress,
  ensureConsumer,
  ensureProsumer,
  getPublicClient,
  solarShareAbi
} from "./contractClient.js";
import { AddressTag, PageIntro, Toast, WalletChip, userErrorMessage } from "./FlowComponents.jsx";
import { BuyPage, HomePage, LedgerPage, MarketPage, NewsPage, SellPage } from "./Pages.jsx";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function apiRequest(path, { optional = false, ...options } = {}) {
  try {
    const response = await fetch(`${apiUrl}${path}`, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const cause = new Error(result.error || `Request failed (${response.status})`);
      cause.status = response.status;
      throw cause;
    }
    return result;
  } catch (cause) {
    if (optional) return null;
    throw cause;
  }
}

const NAV_ITEMS = [
  ["/", "Dashboard"],
  ["/market", "Market"],
  ["/sell", "Sell"],
  ["/buy", "Buy"],
  ["/ledger", "Ledger"],
  ["/news", "News"]
];

function App() {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState("");
  const [participantRole, setParticipantRole] = useState(0);
  const [network, setNetwork] = useState("Checking network…");
  const [rpcOkay, setRpcOkay] = useState(false);
  const [contractReady, setContractReady] = useState(false);
  const [balance, setBalance] = useState("");
  const [offers, setOffers] = useState([]);
  const [trades, setTrades] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [readings, setReadings] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  async function readParticipant(address) {
    if (!address || !contractAddress) {
      setParticipantRole(0);
      return 0;
    }
    const participant = await getPublicClient().readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "participants",
      args: [address]
    });
    const role = participant[1] ? Number(participant[0]) : 0;
    setParticipantRole(role);
    return role;
  }

  async function updateWallet(address) {
    setWallet(address);
    setParticipantRole(0);
    setBalance("");
    if (!address) {
      return;
    }
    try {
      const [role, walletBalance, chainId] = await Promise.all([
        readParticipant(address),
        getPublicClient().getBalance({ address }),
        getPublicClient().getChainId()
      ]);
      setParticipantRole(role);
      setBalance(Number(formatEther(walletBalance)).toFixed(4));
      setNetwork(chainId === 11155111 ? "Sepolia" : `Wrong network · ${chainId}`);
    } catch (cause) {
      setToast(userErrorMessage(cause));
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setToast("MetaMask was not found. Install or unlock it to connect a wallet.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await updateWallet(accounts[0] ?? "");
    } catch (cause) {
      setToast(userErrorMessage(cause));
    }
  }

  async function registerRole(role) {
    if (!wallet) {
      setToast("Connect a wallet before registering an on-chain role.");
      return;
    }
    try {
      setToast(`Registering as ${role === 1 ? "Prosumer" : "Consumer"}. Confirm registration in this wallet.`);
      if (role === 1) await ensureProsumer(wallet);
      else await ensureConsumer(wallet);
      await readParticipant(wallet);
      setToast("On-chain role registration confirmed.");
    } catch (cause) {
      setToast(userErrorMessage(cause));
    }
  }

  async function switchToSepolia() {
    if (!window.ethereum) return setToast("MetaMask was not found.");
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
    } catch (cause) {
      if (cause.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xaa36a7",
              chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: import.meta.env.VITE_SEPOLIA_RPC_URL ? [import.meta.env.VITE_SEPOLIA_RPC_URL] : ["https://ethereum-sepolia-rpc.publicnode.com"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"]
            }]
          });
        } catch (addError) {
          setToast(userErrorMessage(addError));
          return;
        }
      } else {
        setToast(userErrorMessage(cause));
      }
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const [offerData, tradeData, transactionData, readingData, metricData] = await Promise.all([
        apiRequest("/offers"),
        apiRequest("/trades"),
        apiRequest("/transactions"),
        apiRequest("/meter-readings"),
        apiRequest("/metrics", { optional: true })
      ]);
      setOffers(offerData);
      setTrades(tradeData);
      setTransactions(transactionData);
      setReadings(readingData);
      setMetrics(metricData);
      setError("");
    } catch (cause) {
      setError(userErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function probe() {
      try {
        const client = getPublicClient();
        const [chainId, block, code] = await Promise.all([
          client.getChainId(),
          client.getBlockNumber(),
          contractAddress ? client.getCode({ address: contractAddress }) : Promise.resolve(undefined)
        ]);
        if (!active) return;
        setNetwork(chainId === 11155111 ? "Sepolia" : `Wrong network · ${chainId}`);
        setRpcOkay(block > 0n);
        setContractReady(Boolean(code && code !== "0x"));
      } catch {
        if (!active) return;
        setNetwork("RPC unavailable");
        setRpcOkay(false);
        setContractReady(false);
      }
    }
    probe();
    const timer = setInterval(probe, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return undefined;
    const accountsChanged = (accounts) => updateWallet(accounts[0] ?? "");
    provider.on?.("accountsChanged", accountsChanged);
    const chainChanged = () => window.location.reload();
    provider.on?.("chainChanged", chainChanged);
    provider.request({ method: "eth_accounts" }).then((accounts) => {
      if (accounts[0]) updateWallet(accounts[0]);
    }).catch((cause) => console.error("Could not read MetaMask accounts:", cause));
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, []);

  const chainHealthy = network === "Sepolia" && contractReady;

  return (
    <div className="flow-shell">
      <a className="flow-skip" href="#main">Skip to content</a>

      <header className="flow-header">
        <div className="flow-header-inner">
          <NavLink className="flow-brand" to="/" onClick={() => setNavOpen(false)}>
            <span className="flow-brand-mark" aria-hidden="true">☼</span>
            <span className="flow-brand-text">SolarShare<small>P2P solar microgrid</small></span>
          </NavLink>
          <nav className="flow-nav" aria-label="Main navigation">
            {NAV_ITEMS.map(([path, label]) => (
              <NavLink key={path} to={path} end={path === "/"} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>
            ))}
          </nav>
          <div className="flow-header-actions">
            <WalletChip role="Wallet" address={wallet} chainName={network} balance={balance} onConnect={connectWallet} />
            <button
              type="button"
              className="flow-menu-toggle"
              aria-expanded={navOpen}
              aria-controls="mobile-nav"
              onClick={() => setNavOpen((open) => !open)}
            >
              <span aria-hidden="true">{navOpen ? "✕" : "☰"}</span>{navOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>
      </header>

      <div className="flow-mobile-nav" id="mobile-nav" data-open={navOpen ? "true" : "false"}>
        <nav aria-label="Main navigation (mobile)">
          {NAV_ITEMS.map(([path, label]) => (
            <NavLink key={path} to={path} end={path === "/"} onClick={() => setNavOpen(false)} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>
          ))}
        </nav>
      </div>

      <section className="flow-statusbar" role="status">
        <span className="flow-pill-group"><span className={`flow-dot ${chainHealthy ? "good" : "warn"}`} aria-hidden="true" />Network <strong>{network}</strong></span>
        <span className="sep" aria-hidden="true">·</span>
        <span className="flow-pill-group">RPC <strong>{rpcOkay ? "OK" : "unavailable"}</strong></span>
        <span className="sep" aria-hidden="true">·</span>
        <span className="flow-pill-group">Contract {contractAddress ? <><AddressTag address={contractAddress} /> <strong>{contractReady ? "deployed" : "unavailable"}</strong></> : <strong>not configured</strong>}</span>
        {network !== "Sepolia" && <button type="button" onClick={switchToSepolia}>Switch to Sepolia</button>}
      </section>

      <main className="flow-main" id="main">
        <Toast message={toast} onDismiss={() => setToast("")} />
        {error && <div className="flow-error" role="alert"><span>{error}</span><button type="button" onClick={refresh}>Retry</button></div>}

        <Routes>
          <Route path="/" element={<HomePage wallet={wallet} metrics={metrics} offers={offers} trades={trades} transactions={transactions} readings={readings} loading={loading} />} />
          <Route path="/sell" element={<SellPage wallet={wallet} role={participantRole} offers={offers} readings={readings} transactions={transactions} loading={loading} onRegisterRole={registerRole} onRefresh={refresh} onNotice={setToast} />} />
          <Route path="/buy" element={<BuyPage wallet={wallet} role={participantRole} offers={offers} trades={trades} transactions={transactions} loading={loading} onRegisterRole={registerRole} onRefresh={refresh} onNotice={setToast} />} />
          <Route path="/market" element={<MarketPage wallet={wallet} offers={offers} loading={loading} />} />
          <Route path="/ledger" element={<LedgerPage wallet={wallet} transactions={transactions} loading={loading} />} />
          <Route path="/news" element={<NewsPage trades={trades} />} />
          <Route path="*" element={<NotFound navigate={navigate} />} />
        </Routes>
      </main>

      <footer className="flow-footer">
        <span className="flow-footer-group">SolarShare · Sepolia energy trading prototype · Settlements confirmed on-chain only</span>
        <span className="flow-footer-group">Contract {contractAddress ? <><AddressTag address={contractAddress} /> · <a href={`https://sepolia.etherscan.io/address/${contractAddress}`} target="_blank" rel="noreferrer">View on Etherscan</a></> : "not configured"}</span>
      </footer>
    </div>
  );
}

function NotFound({ navigate }) {
  return (
    <div className="flow-page">
      <PageIntro eyebrow="404" title="Page not found" detail="That route does not exist in this prototype." />
      <div className="flow-button-row">
        <button className="flow-primary" type="button" onClick={() => navigate("/")}>Back to dashboard</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>
);
