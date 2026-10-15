import { useState } from "react";
import { contractAddress, contractGasLimit, decodeContractEvent, ensureConsumer, ensureSepoliaNetwork, getPublicClient, getWalletClient, priceToWei, solarShareAbi } from "./contractClient.js";
import { userErrorMessage } from "./FlowComponents.jsx";

export default function PurchaseButton({ offer, wallet, onComplete, onCompletePurchase }) {
  const [loading, setLoading] = useState(false);
  const hasOnChainOffer = Boolean(
    Number.isSafeInteger(offer.onChainOfferId) &&
    /^0x[0-9a-fA-F]{40}$/.test(offer.sellerId)
  );

  async function purchase() {
    if (loading) return;
    setLoading(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      if (!wallet) throw new Error("Connect the buyer's MetaMask wallet before purchasing");
      if (!contractAddress || !Number.isSafeInteger(offer.onChainOfferId) || !/^0x[0-9a-fA-F]{40}$/.test(offer.sellerId)) {
        throw new Error("This offer is not connected to an on-chain seller and offer");
      }
      await ensureSepoliaNetwork();

      const publicClient = getPublicClient();
      const chainOffer = await publicClient.readContract({
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "offers",
        args: [BigInt(offer.onChainOfferId)]
      });
      if (chainOffer[1].toLowerCase() !== offer.sellerId.toLowerCase()) {
        throw new Error("On-chain seller does not match this marketplace offer");
      }
      const availableOnChain = Number(chainOffer[2]);
      const availableInMarketplace = Math.floor(Number(offer.kWhAvailable));
      const kWhToBuy = Math.min(availableInMarketplace, availableOnChain);
      if (!Number.isSafeInteger(availableOnChain) || kWhToBuy < 1) {
        throw new Error("This offer has no whole kWh remaining on-chain");
      }

      const priceWei = chainOffer[3];
      if (priceWei !== priceToWei(offer.pricePerKWh)) {
        throw new Error("The on-chain price differs from the marketplace listing; refresh and try again");
      }

      onComplete?.("Confirm in MetaMask: register as a consumer if needed...");
      await ensureConsumer(wallet);
      onComplete?.("Confirm in MetaMask: purchase energy on-chain...");
      const hash = await getWalletClient(wallet).writeContract({
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "purchaseEnergy",
        args: [BigInt(offer.onChainOfferId), BigInt(kWhToBuy)],
        value: BigInt(kWhToBuy) * priceWei,
        gas: contractGasLimit
      });
      onComplete?.("Purchase submitted. Waiting for Sepolia confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Purchase transaction failed on-chain");
      decodeContractEvent(receipt, "TradePurchased");

      const response = await fetch(`${apiBase}/transactions/confirm-purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerId: offer._id, buyerId: wallet, purchaseTxHash: hash })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(`${result.error || "Purchase was confirmed on-chain, but ledger sync failed"} (tx: ${hash})`);
      }
      onCompletePurchase?.(result);
      onComplete?.(`✅ ${kWhToBuy} kWh purchased and escrowed. The seller must settle the trade to release payment.`);
    } catch (error) {
      onComplete?.(`❌ ${userErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="flow-secondary"
      onClick={purchase}
      disabled={loading || !hasOnChainOffer}
      style={{ opacity: loading || !hasOnChainOffer ? 0.7 : 1, fontWeight: "600", cursor: loading || !hasOnChainOffer ? "not-allowed" : "pointer" }}
      title={hasOnChainOffer ? "Purchase this offer on the blockchain" : "This offer has not been published on-chain"}
    >
      {loading ? "Trading..." : hasOnChainOffer ? "Buy On-Chain" : "Off-chain"}
    </button>
  );
}
