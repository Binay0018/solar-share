import { useEffect, useState } from "react";
import { contractAddress, ensureSepoliaNetwork, getPublicClient, readTradeOnChain, solarShareAbi, writeContractWithGas } from "./contractClient.js";
import { decodeContractError } from "./revertErrors.js";
import { userErrorMessage } from "./FlowComponents.jsx";
import { normalizeAddress } from "./purchaseQueue.js";

export default function SettleButton({ trade, wallet, onComplete, onSettled }) {
  const [loading, setLoading] = useState(false);
  // What the contract itself says about this trade. The chain is the source of
  // truth for whether a settlement can still succeed, so a trade that is already
  // settled on-chain must not offer a Settle action the contract will reject.
  const [chainSettled, setChainSettled] = useState(false);

  const tradeId = trade?.onChainTradeId;
  const hasTradeId = Number.isSafeInteger(tradeId);
  // A purchase is settled only once a settlement receipt is recorded or the chain
  // reports the trade settled. A confirmed purchase transaction is not a settlement.
  const ledgerSettled = Boolean(trade?.settledAt) || trade?.chainStatus === "settled";
  const settled = ledgerSettled || chainSettled;

  useEffect(() => {
    if (!hasTradeId) return undefined;
    let active = true;
    readTradeOnChain(tradeId)
      .then((onChain) => {
        if (!active || !onChain?.exists || !onChain.settledOnChain) return;
        // Only honour a trade that still names this row's seller.
        if (normalizeAddress(onChain.seller) !== normalizeAddress(trade?.sellerId)) return;
        setChainSettled(true);
      })
      .catch(() => {
        // A read that fails must never hide a legitimate Settle button.
      });
    return () => {
      active = false;
    };
  }, [hasTradeId, tradeId, trade?.sellerId]);

  async function settle() {
    if (loading) return;
    if (!wallet) {
      onComplete?.("❌ Connect MetaMask wallet to settle this trade");
      return;
    }
    // Enforced here as well as in the Sell page: only the seller of this trade,
    // signing with their own MetaMask wallet, can reach settleTrade.
    if (!trade || normalizeAddress(trade.sellerId) !== normalizeAddress(wallet)) {
      onComplete?.("❌ Only the seller can settle this trade");
      return;
    }
    if (!hasTradeId) {
      onComplete?.("❌ This purchase has no on-chain trade ID to settle");
      return;
    }
    setLoading(true);
    try {
      await ensureSepoliaNetwork();

      // Simulate the settlement first. This is a read-only eth_call and never
      // opens MetaMask, so a call the contract would reject is explained instead
      // of being sent and failing. The authorization rules are unchanged: the
      // simulation runs as the connected seller and the real transaction below is
      // still signed by that same wallet.
      try {
        await getPublicClient().simulateContract({
          address: contractAddress,
          abi: solarShareAbi,
          functionName: "settleTrade",
          args: [BigInt(trade.onChainTradeId)],
          account: wallet
        });
      } catch (error) {
        const decoded = decodeContractError(error);
        if (decoded?.name === "TradeAlreadySettled") {
          // The chain already settled this trade; nothing is left to sign.
          setChainSettled(true);
          onComplete?.(`ℹ️ ${decoded.message}`);
        } else {
          onComplete?.(`❌ ${decoded ? decoded.message : userErrorMessage(error)}`);
        }
        return;
      }

      onComplete?.("Confirm in MetaMask: settle the trade...");
      const hash = await writeContractWithGas(wallet, {
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "settleTrade",
        args: [BigInt(trade.onChainTradeId)]
      });
      onComplete?.("Settlement transaction submitted. Waiting for confirmation...");
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Settlement transaction failed");

      // Notify backend to mark as settled
      const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      const response = await fetch(`${apiBase}/transactions/confirm-settlement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: hash, onChainTradeId: trade.onChainTradeId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Settlement succeeded on-chain but ledger sync failed");

      onSettled?.(receipt);
      onComplete?.("✅ Trade settled on-chain! Funds released to seller.");
    } catch (error) {
      onComplete?.(`❌ ${userErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  if (!trade) return null;

  const label = loading ? "Settling..." : ledgerSettled ? "Settled" : chainSettled ? "Settled on-chain" : "Settle";
  const title = !hasTradeId
    ? "This purchase has no on-chain trade ID"
    : chainSettled && !ledgerSettled
      ? "The blockchain already settled this trade and released the funds; the marketplace ledger has not recorded that settlement yet"
      : settled
        ? "This trade is already settled on the blockchain"
        : "Settle this trade on the blockchain";

  return (
    <button
      className="flow-primary"
      onClick={settle}
      disabled={loading || settled || !hasTradeId}
      style={{ opacity: loading ? 0.7 : 1, fontWeight: "600", cursor: loading || settled || !hasTradeId ? "not-allowed" : "pointer" }}
      title={title}
    >
      {label}
    </button>
  );
}
