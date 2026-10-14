import { createPublicClient, createWalletClient, decodeEventLog, http, isAddress, isHash, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { solarShareAbi } from "./solarShareAbi.js";

// Mirror of the frontend conversion so off-chain ₹/kWh and on-chain wei/kWh stay consistent
export function priceToWei(pricePerKWh) {
  if (!Number.isFinite(Number(pricePerKWh)) || Number(pricePerKWh) <= 0) {
    throw new Error("On-chain price must be positive");
  }
  const ethRate = Math.max(0.0001, Number((Number(pricePerKWh) * 0.0001).toFixed(6)));
  return parseEther(String(ethRate));
}

function getConfiguration() {
  const { CONTRACT_ADDRESS, SEPOLIA_RPC_URL, BUYER_PRIVATE_KEY, SELLER_PRIVATE_KEY } = process.env;
  if (!CONTRACT_ADDRESS || !SEPOLIA_RPC_URL || !BUYER_PRIVATE_KEY || !SELLER_PRIVATE_KEY) {
    throw new Error("CONTRACT_ADDRESS, SEPOLIA_RPC_URL, BUYER_PRIVATE_KEY, and SELLER_PRIVATE_KEY are required");
  }
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CONTRACT_ADDRESS is invalid");
  for (const [label, key] of [["BUYER_PRIVATE_KEY", BUYER_PRIVATE_KEY], ["SELLER_PRIVATE_KEY", SELLER_PRIVATE_KEY]]) {
    if (!key.startsWith("0x")) throw new Error(`${label} must start with 0x`);
  }
  return { contractAddress: CONTRACT_ADDRESS, rpcUrl: SEPOLIA_RPC_URL, buyerKey: BUYER_PRIVATE_KEY, sellerKey: SELLER_PRIVATE_KEY };
}

function getClients() {
  const configuration = getConfiguration();
  const sellerAccount = privateKeyToAccount(configuration.sellerKey);
  const buyerAccount = privateKeyToAccount(configuration.buyerKey);
  const transport = http(configuration.rpcUrl);
  return {
    contractAddress: configuration.contractAddress,
    sellerAccount,
    buyerAccount,
    sellerWallet: createWalletClient({ account: sellerAccount, chain: sepolia, transport }),
    buyerWallet: createWalletClient({ account: buyerAccount, chain: sepolia, transport }),
    publicClient: createPublicClient({ chain: sepolia, transport })
  };
}

// Returns the address controlled by SELLER_PRIVATE_KEY, or null if not configured.
// The backend can only settle trades for this address — it cannot sign for arbitrary MetaMask accounts.
export function getContractSellerAddress() {
  const { SELLER_PRIVATE_KEY } = process.env;
  if (!SELLER_PRIVATE_KEY || !SELLER_PRIVATE_KEY.startsWith("0x")) return null;
  return privateKeyToAccount(SELLER_PRIVATE_KEY).address;
}

async function readParticipant(publicClient, contractAddress, address) {
  const participant = await publicClient.readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "participants",
    args: [address]
  });
  return { role: Number(participant[0]), registered: Boolean(participant[1]) };
}

async function ensureRole(walletClient, publicClient, contractAddress, address, role) {
  const participant = await readParticipant(publicClient, contractAddress, address);
  // Role 3 (Both) satisfies either Prosumer (1) or Consumer (2) requirements
  if (participant.registered && (participant.role === role || participant.role === 3)) return null;
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "registerParticipant",
    args: [role]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`participant registration (role ${role}) failed`);
  return hash;
}

function decodeEventFromReceipt(receipt, contractAddress, eventName) {
  const log = receipt.logs.find((entry) => entry.address.toLowerCase() === contractAddress.toLowerCase());
  if (!log) throw new Error(`${eventName} event was not found in the transaction receipt`);
  const decoded = decodeEventLog({ abi: solarShareAbi, data: log.data, topics: log.topics });
  if (decoded.eventName !== eventName) throw new Error(`unexpected contract event: ${decoded.eventName}`);
  return decoded.args;
}

// Backend-assisted on-chain settlement (README "Option B"):
// the configured seller key publishes the offer, the configured buyer key purchases it
// with exact ETH payment, and the seller key settles the trade to release the funds.
export async function settleMatchOnChain({ offer, kWhTraded }) {
  const { contractAddress, sellerAccount, buyerAccount, sellerWallet, buyerWallet, publicClient } = getClients();

  if (buyerAccount.address.toLowerCase() === sellerAccount.address.toLowerCase()) {
    throw new Error("buyer and seller configuration wallets must be different");
  }

  let onChainOfferId;
  let priceWei;

  if (Number.isInteger(offer.onChainOfferId)) {
    // Purchase from an existing on-chain offer
    onChainOfferId = BigInt(offer.onChainOfferId);
    const onChainOffer = await publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "offers",
      args: [onChainOfferId]
    });
    const onChainKWh = Number(onChainOffer[2]);
    if (onChainKWh < kWhTraded) {
      throw new Error(`On-chain offer has only ${onChainKWh} kWh available`);
    }
    priceWei = onChainOffer[3];
  } else {
    // Publish a new on-chain offer as the seller
    priceWei = priceToWei(offer.pricePerKWh);
    const createHash = await sellerWallet.writeContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "createOffer",
      args: [BigInt(kWhTraded), priceWei]
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    if (createReceipt.status !== "success") throw new Error("createOffer transaction failed");
    const created = decodeEventFromReceipt(createReceipt, contractAddress, "OfferCreated");
    onChainOfferId = created.offerId;
  }

  const value = BigInt(kWhTraded) * priceWei;

  const buyerBalance = await publicClient.getBalance({ address: buyerAccount.address });
  if (buyerBalance < value) {
    throw new Error(`buyer wallet ${buyerAccount.address} has insufficient Sepolia ETH for the ${(Number(value) / 1e18).toFixed(6)} ETH purchase`);
  }

  // 1. Register both participants if needed (seller = Prosumer, buyer = Consumer)
  await ensureRole(sellerWallet, publicClient, contractAddress, sellerAccount.address, 1);
  await ensureRole(buyerWallet, publicClient, contractAddress, buyerAccount.address, 2);

  // 2. Buyer purchases the energy; payment is held by the contract in a pending trade
  const purchaseHash = await buyerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "purchaseEnergy",
    args: [onChainOfferId, BigInt(kWhTraded)],
    value
  });
  const purchaseReceipt = await publicClient.waitForTransactionReceipt({ hash: purchaseHash });
  if (purchaseReceipt.status !== "success") throw new Error("purchaseEnergy transaction failed");
  const purchased = decodeEventFromReceipt(purchaseReceipt, contractAddress, "TradePurchased");
  const tradeId = purchased.tradeId;

  // 3. Seller settles the trade, releasing the locked payment
  const settleHash = await sellerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "settleTrade",
    args: [tradeId]
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
  if (settleReceipt.status !== "success") throw new Error("settleTrade transaction failed");

  return {
    onChainOfferId: Number(onChainOfferId),
    tradeId: Number(tradeId),
    kWhTraded,
    totalPriceWei: value.toString(),
    txHash: settleHash,
    purchaseTxHash: purchaseHash,
    purchaseGasUsed: purchaseReceipt.gasUsed.toString(),
    purchaseGasPrice: purchaseReceipt.effectiveGasPrice?.toString() ?? null,
    settlementGasUsed: settleReceipt.gasUsed.toString(),
    settlementGasPrice: settleReceipt.effectiveGasPrice?.toString() ?? null
  };
}

// MetaMask-assisted flow: the buyer already signed purchaseEnergy in their wallet,
// the backend verifies the receipt and settles with the configured seller key.
export async function settlePurchasedTrade({ offer, buyerId, purchaseTxHash }) {
  const { contractAddress, sellerAccount, sellerWallet, publicClient } = getClients();
  if (!isAddress(offer.sellerId) || !isAddress(buyerId) || !Number.isInteger(offer.onChainOfferId) || !isHash(purchaseTxHash)) {
    throw new Error("sellerId and buyerId must be wallet addresses for on-chain settlement");
  }

  if (sellerAccount.address.toLowerCase() !== offer.sellerId.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control the matched seller wallet");
  }

  const purchaseReceipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTxHash });
  if (purchaseReceipt.status !== "success") throw new Error("purchaseEnergy transaction failed");

  const purchasedLog = purchaseReceipt.logs.find((log) => log.address.toLowerCase() === contractAddress.toLowerCase());
  if (!purchasedLog) throw new Error("purchaseEnergy receipt did not contain a trade event");
  const decoded = decodeEventLog({ abi: solarShareAbi, data: purchasedLog.data, topics: purchasedLog.topics });
  if (decoded.eventName !== "TradePurchased") throw new Error("unexpected purchase event");
  if (decoded.args.offerId !== BigInt(offer.onChainOfferId) || decoded.args.buyer.toLowerCase() !== buyerId.toLowerCase()) {
    throw new Error("purchase receipt does not match this offer and buyer");
  }
  const settleHash = await sellerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "settleTrade",
    args: [decoded.args.tradeId]
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
  if (settleReceipt.status !== "success") throw new Error("settleTrade transaction failed");
  return {
    txHash: settleHash,
    purchaseTxHash,
    tradeId: Number(decoded.args.tradeId),
    kWhTraded: Number(decoded.args.kWhTraded),
    totalPriceWei: decoded.args.totalPrice.toString(),
    purchaseGasUsed: purchaseReceipt.gasUsed.toString(),
    purchaseGasPrice: purchaseReceipt.effectiveGasPrice?.toString() ?? null,
    settlementGasUsed: settleReceipt.gasUsed.toString(),
    settlementGasPrice: settleReceipt.effectiveGasPrice?.toString() ?? null
  };
}

export async function updateOnChainOfferPrice({ offerId, pricePerKWh, sellerId }) {
  const { contractAddress, sellerAccount, sellerWallet, publicClient } = getClients();
  if (!isAddress(sellerId) || !Number.isInteger(offerId) || !Number.isFinite(pricePerKWh) || pricePerKWh <= 0) {
    throw new Error("sellerId, offerId, and pricePerKWh are invalid for on-chain price update");
  }
  if (sellerAccount.address.toLowerCase() !== sellerId.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control the listed seller wallet");
  }
  const priceWei = priceToWei(pricePerKWh);
  const hash = await sellerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "updateOfferPrice",
    args: [BigInt(offerId), priceWei]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("updateOfferPrice transaction failed");
  return { txHash: hash, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null };
}
