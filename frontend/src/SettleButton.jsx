import { useState } from "react";
import { contractAddress, contractGasLimit, getPublicClient, getWalletClient, solarShareAbi } from "./contractClient.js";

export default function SettleButton({ trade, wallet, onComplete, onSettled }) {
  const [loading, setLoading] = useState(false);

  async function settle() {
    if (loading) return;
    if (!wallet) {
      onComplete?.("❌ Connect MetaMask wallet to settle this trade");
      return;
    }
    if (trade.seller.toLowerCase() !== wallet.toLowerCase()) {
      onComplete?.("❌ Only the seller can settle this trade");
      return;
    }
    setLoading(true);
    try {
      onComplete?.("Confirm in MetaMask: settle the trade...");
      const hash = await getWalletClient(wallet).writeContract({
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "settleTrade",
        args: [BigInt(trade.onChainTradeId)],
        gas: contractGasLimit
      });
      onComplete?.("Settlement transaction submitted. Waiting for confirmation...");
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Settlement transaction failed");

      // Notify backend to mark as settled
      const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      await fetch(`${apiBase}/transactions/confirm-settlement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: hash, onChainTradeId: trade.onChainTradeId })
      });

      onSettled?.(receipt);
      onComplete?.("✅ Trade settled on-chain! Funds released to seller.");
    } catch (error) {
      onComplete?.(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (!trade) return null;

  return (
    <button
      className="text-button"
      onClick={settle}
      disabled={loading || trade.status === "settled"}
      style={{ opacity: loading ? 0.7 : 1, fontWeight: "600", cursor: loading ? "not-allowed" : "pointer" }}
      title="Settle this trade on the blockchain"
    >
      {loading ? "Settling..." : trade.status === "settled" ? "Settled" : "Settle"}
    </button>
  );
}
