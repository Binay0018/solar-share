import { createPublicClient, createWalletClient, decodeEventLog, http, isAddress, isHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { solarShareAbi } from "./solarShareAbi.js";

function getConfiguration() {
  const { CONTRACT_ADDRESS, SEPOLIA_RPC_URL, SELLER_PRIVATE_KEY } = process.env;
  if (!CONTRACT_ADDRESS || !SEPOLIA_RPC_URL || !SELLER_PRIVATE_KEY) {
    throw new Error("CONTRACT_ADDRESS, SEPOLIA_RPC_URL, and SELLER_PRIVATE_KEY are required");
  }
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CONTRACT_ADDRESS is invalid");
  if (!SELLER_PRIVATE_KEY.startsWith("0x")) {
    throw new Error("SELLER_PRIVATE_KEY must start with 0x");
  }
  return { contractAddress: CONTRACT_ADDRESS, rpcUrl: SEPOLIA_RPC_URL, sellerKey: SELLER_PRIVATE_KEY };
}

export async function settlePurchasedTrade({ offer, buyerId, purchaseTxHash }) {
  const configuration = getConfiguration();
  if (!isAddress(offer.sellerId) || !isAddress(buyerId) || !Number.isInteger(offer.onChainOfferId) || !isHash(purchaseTxHash)) {
    throw new Error("sellerId and buyerId must be wallet addresses for on-chain settlement");
  }

  const sellerAccount = privateKeyToAccount(configuration.sellerKey);
  if (sellerAccount.address.toLowerCase() !== offer.sellerId.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control the matched seller wallet");
  }
  const transport = http(configuration.rpcUrl);
  const sellerWalletClient = createWalletClient({ account: sellerAccount, chain: sepolia, transport });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const purchaseReceipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTxHash });
  if (purchaseReceipt.status !== "success") throw new Error("purchaseEnergy transaction failed");

  const purchasedLog = purchaseReceipt.logs.find((log) => log.address.toLowerCase() === configuration.contractAddress.toLowerCase());
  if (!purchasedLog) throw new Error("purchaseEnergy receipt did not contain a trade event");
  const decoded = decodeEventLog({ abi: solarShareAbi, data: purchasedLog.data, topics: purchasedLog.topics });
  if (decoded.eventName !== "TradePurchased") throw new Error("unexpected purchase event");
  if (decoded.args.offerId !== BigInt(offer.onChainOfferId) || decoded.args.buyer.toLowerCase() !== buyerId.toLowerCase()) {
    throw new Error("purchase receipt does not match this offer and buyer");
  }
  const settleHash = await sellerWalletClient.writeContract({
    address: configuration.contractAddress,
    abi: solarShareAbi,
    functionName: "settleTrade",
    args: [decoded.args.tradeId]
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
  if (settleReceipt.status !== "success") throw new Error("settleTrade transaction failed");
  return {
    txHash: settleHash,
    purchaseTxHash,
    tradeId: decoded.args.tradeId,
    kWhTraded: Number(decoded.args.kWhTraded),
    totalPriceWei: decoded.args.totalPrice.toString(),
    purchaseGasUsed: purchaseReceipt.gasUsed.toString(),
    purchaseGasPrice: purchaseReceipt.effectiveGasPrice?.toString() ?? null,
    settlementGasUsed: settleReceipt.gasUsed.toString(),
    settlementGasPrice: settleReceipt.effectiveGasPrice?.toString() ?? null
  };
}

export async function updateOnChainOfferPrice({ offerId, pricePerKWh, sellerId }) {
  const configuration = getConfiguration();
  if (!isAddress(sellerId) || !Number.isInteger(offerId) || !Number.isInteger(pricePerKWh) || pricePerKWh <= 0) {
    throw new Error("sellerId, offerId, and pricePerKWh are invalid for on-chain price update");
  }
  const sellerAccount = privateKeyToAccount(configuration.sellerKey);
  if (sellerAccount.address.toLowerCase() !== sellerId.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control the listed seller wallet");
  }
  const transport = http(configuration.rpcUrl);
  const sellerWalletClient = createWalletClient({ account: sellerAccount, chain: sepolia, transport });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const hash = await sellerWalletClient.writeContract({
    address: configuration.contractAddress,
    abi: solarShareAbi,
    functionName: "updateOfferPrice",
    args: [BigInt(offerId), BigInt(pricePerKWh)]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("updateOfferPrice transaction failed");
  return { txHash: hash, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null };
}