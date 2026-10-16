import { useState } from "react";
import { contractAddress, ensureSepoliaNetwork, getPublicClient, solarShareAbi, writeContractWithGas } from "./contractClient.js";
import { userErrorMessage } from "./FlowComponents.jsx";
import { normalizeAddress } from "./purchaseQueue.js";

export default function SettleButton({ trade, wallet, onComplete, onSettled }) {
  const [loading, setLoading] = useState(false);
  // A purchase is settled only once a settlement receipt is recorded or the chain
  // reports the trade settled. A confirmed purchase transaction is not a settlement.
  const settled = Boolean(trade?.settledAt) || trade?.chainStatus === "settled";
  const hasTradeId = Number.isSafeInteger(trade?.onChainTradeId);

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

  return (
    <button
      className="flow-primary"
      onClick={settle}
      disabled={loading || settled || !hasTradeId}
      style={{ opacity: loading ? 0.7 : 1, fontWeight: "600", cursor: loading || settled || !hasTradeId ? "not-allowed" : "pointer" }}
      title={hasTradeId ? "Settle this trade on the blockchain" : "This purchase has no on-chain trade ID"}
    >
      {loading ? "Settling..." : settled ? "Settled" : "Settle"}
    </button>
  );
}
