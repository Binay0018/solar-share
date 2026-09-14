import { contractAddress, contractGasLimit, decodeContractEvent, getPublicClient, getWalletClient, kWhToContractUnits, priceToWei, solarShareAbi } from "./contractClient.js";

export default function PurchaseButton({ offer, wallet, requestId, onComplete, onCompletePurchase }) {
  async function purchase() {
    if (!wallet || !window.ethereum || !contractAddress || offer.onChainOfferId === undefined) return;
    try {
      if (!requestId) throw new Error("Submit a matching consumer request before purchasing");
      const kWh = kWhToContractUnits(Math.floor(offer.kWhAvailable));
      const value = kWh * priceToWei(offer.pricePerKWh);
      const hash = await getWalletClient(wallet).writeContract({ address: contractAddress, abi: solarShareAbi, functionName: "purchaseEnergy", args: [BigInt(offer.onChainOfferId), kWh], value, gas: contractGasLimit });
      onComplete?.("Purchase transaction submitted. Waiting for confirmation...");
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Purchase transaction failed");
      const event = decodeContractEvent(receipt, "TradePurchased");
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/transactions/confirm-purchase`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId: offer._id, requestId, buyerId: wallet, purchaseTxHash: hash }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Settlement could not be completed");
      onCompletePurchase?.(event);
      onComplete?.("Trade settled. The transaction is now in the ledger.");
    } catch (error) {
      onComplete?.(error.message);
    }
  }

  if (offer.onChainOfferId === undefined) return null;
  return <button className="text-button" onClick={purchase} disabled={!wallet} title={!wallet ? "Connect MetaMask first" : "Purchase this on-chain offer"}>Buy on-chain</button>;
}
