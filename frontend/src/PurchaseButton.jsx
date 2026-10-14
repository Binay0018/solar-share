import { useState } from "react";
import { contractAddress, contractGasLimit, decodeContractEvent, ensureConsumer, getPublicClient, getWalletClient, priceToWei, solarShareAbi } from "./contractClient.js";

export default function PurchaseButton({ offer, wallet, onComplete, onCompletePurchase }) {
  const [loading, setLoading] = useState(false);

  async function purchase() {
    if (loading) return;
    setLoading(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      const kWhAvailable = Math.floor(Number(offer.kWhAvailable));
      if (kWhAvailable < 1) {
        onComplete?.("❌ This offer has less than 1 kWh available — too small for an on-chain trade.");
        return;
      }

      const buyerId = wallet || `consumer-${Math.random().toString(36).slice(2, 8)}`;

      // Create a trade request first — this triggers the matching engine
      onComplete?.("Creating trade request...");
      const tradeResponse = await fetch(`${apiBase}/trades`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerId,
          kWhNeeded: kWhAvailable,
          maxPricePerKWh: offer.pricePerKWh
        })
      });
      const tradeData = await tradeResponse.json();
      if (!tradeResponse.ok) throw new Error(tradeData.error || "Trade request failed");

      const pending = tradeData.matching?.results?.find((r) => r.status === "pending");
      const success = tradeData.matching?.results?.find((r) => r.status === "success");

      if (wallet && window.ethereum && contractAddress && pending) {
        // MetaMask-assisted flow: buyer signs purchaseEnergy, backend settles
        onComplete?.("Confirm in MetaMask: register wallet as consumer if needed...");
        await ensureConsumer(wallet);
        onComplete?.("Confirm in MetaMask: purchase energy on-chain...");

        // Read the on-chain offer to get the exact available kWh
        const onChainOffer = await getPublicClient().readContract({
          address: contractAddress,
          abi: solarShareAbi,
          functionName: "offers",
          args: [BigInt(offer.onChainOfferId)]
        });
        const onChainKWh = Number(onChainOffer[2]);
        const kWhToBuy = Math.min(kWhAvailable, onChainKWh);
        if (kWhToBuy < 1) throw new Error("On-chain offer has no available kWh");

        const value = kWhToBuy * priceToWei(offer.pricePerKWh);
        const hash = await getWalletClient(wallet).writeContract({
          address: contractAddress,
          abi: solarShareAbi,
          functionName: "purchaseEnergy",
          args: [BigInt(offer.onChainOfferId), BigInt(kWhToBuy)],
          value,
          gas: contractGasLimit
        });
        onComplete?.("Purchase transaction submitted. Waiting for confirmation...");
        const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Purchase transaction failed");
        decodeContractEvent(receipt, "TradePurchased");

        const response = await fetch(`${apiBase}/transactions/confirm-purchase`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offerId: offer._id, requestId: pending.requestId, buyerId: wallet, purchaseTxHash: hash })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Settlement could not be completed");
        onCompletePurchase?.(result);
        onComplete?.("✅ Trade settled on-chain! Transaction added to ledger.");
      } else if (success) {
        // Backend-assisted flow: matching engine already settled on-chain
        onCompletePurchase?.(tradeData);
        onComplete?.(`✅ Trade settled on-chain! Traded ${success.kWhMatched ?? kWhAvailable} kWh @ ₹${offer.pricePerKWh}/unit with ${offer.sellerId}.`);
      } else {
        // Seller is not the backend's SELLER_PRIVATE_KEY — they need to settle via MetaMask
        onComplete?.("Trade request created. The seller must settle this trade via MetaMask using the Settle button.");
        onCompletePurchase?.(tradeData);
      }
    } catch (error) {
      onComplete?.(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="text-button"
      onClick={purchase}
      disabled={loading}
      style={{ opacity: loading ? 0.7 : 1, fontWeight: "600", cursor: loading ? "not-allowed" : "pointer" }}
      title="Purchase this offer on the blockchain"
    >
      {loading ? "Trading..." : "Buy On-Chain"}
    </button>
  );
}
