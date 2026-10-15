import { createPublicClient, createWalletClient, decodeEventLog, http, isAddress, isHash, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { solarShareAbi } from "./solarShareAbi.js";

export function priceToWei(pricePerKWh) {
  const rate = String(pricePerKWh).trim();
  if (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) <= 0) {
    throw new Error("On-chain price must be a positive decimal rate");
  }
  return parseUnits(rate, 10);
}

function getConfiguration() {
  const { CONTRACT_ADDRESS, SEPOLIA_RPC_URL, BUYER_PRIVATE_KEY, SELLER_PRIVATE_KEY } = process.env;
  if (!CONTRACT_ADDRESS || !SEPOLIA_RPC_URL || !BUYER_PRIVATE_KEY || !SELLER_PRIVATE_KEY) {
    throw new Error("CONTRACT_ADDRESS, SEPOLIA_RPC_URL, BUYER_PRIVATE_KEY, and SELLER_PRIVATE_KEY are required");
  }
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CONTRACT_ADDRESS is invalid");
  if (!BUYER_PRIVATE_KEY.startsWith("0x")) throw new Error("BUYER_PRIVATE_KEY must start with 0x");
  if (!SELLER_PRIVATE_KEY.startsWith("0x")) throw new Error("SELLER_PRIVATE_KEY must start with 0x");
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

function getPublicChainClient() {
  const { CONTRACT_ADDRESS, SEPOLIA_RPC_URL } = process.env;
  if (!CONTRACT_ADDRESS || !SEPOLIA_RPC_URL || !isAddress(CONTRACT_ADDRESS)) {
    throw new Error("A valid CONTRACT_ADDRESS and SEPOLIA_RPC_URL are required");
  }
  return {
    contractAddress: CONTRACT_ADDRESS,
    publicClient: createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) })
  };
}

export function getContractSellerAddress() {
  const { SELLER_PRIVATE_KEY } = process.env;
  if (!SELLER_PRIVATE_KEY) return null;
  return privateKeyToAccount(SELLER_PRIVATE_KEY).address;
}

export function getContractBuyerAddress() {
  const { BUYER_PRIVATE_KEY } = process.env;
  if (!BUYER_PRIVATE_KEY) return null;
  return privateKeyToAccount(BUYER_PRIVATE_KEY).address;
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
  if (participant.registered && (participant.role === role || participant.role === 3)) return;
  if (participant.registered) {
    throw new Error(`wallet is already registered with incompatible role ${participant.role}`);
  }
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "registerParticipant",
    args: [role]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`participant registration (role ${role}) failed`);
}

function decodeEventFromReceipt(receipt, contractAddress, eventName) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: solarShareAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === eventName) return decoded.args;
    } catch {
      // Ignore event signatures not present in the SolarShare ABI.
    }
  }
  throw new Error(`${eventName} event was not found in the transaction receipt`);
}

export async function purchaseMatchOnChain({ offer, buyerId, kWhTraded }) {
  const { contractAddress, sellerAccount, buyerAccount, sellerWallet, buyerWallet, publicClient } = getClients();
  if (!Number.isSafeInteger(kWhTraded) || kWhTraded <= 0) throw new Error("on-chain purchase quantity must be a positive whole kWh");
  if (buyerAccount.address.toLowerCase() === sellerAccount.address.toLowerCase()) {
    throw new Error("buyer and seller configuration wallets must be different");
  }
  if (!isAddress(offer.sellerId)) {
    throw new Error("the matched offer must have a valid seller wallet address");
  }
  // When the offer is already on-chain the backend only needs the buyer key to
  // purchase it, so the seller can be any wallet (for example a MetaMask user).
  // Only offers that still need to be created on-chain require the seller key.
  if (
    !Number.isInteger(offer.onChainOfferId) &&
    offer.sellerId.toLowerCase() !== sellerAccount.address.toLowerCase()
  ) {
    throw new Error("only an offer owned by SELLER_PRIVATE_KEY can be published on-chain by the backend");
  }
  if (!isAddress(buyerId) || buyerId.toLowerCase() !== buyerAccount.address.toLowerCase()) {
    throw new Error("BUYER_PRIVATE_KEY must control the buyer address on the trade request");
  }

  let onChainCapacity;
  const priceWei = Number.isInteger(offer.onChainOfferId)
    ? await publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "offers",
      args: [BigInt(offer.onChainOfferId)]
    }).then((chainOffer) => {
      if (chainOffer[1].toLowerCase() !== offer.sellerId.toLowerCase()) {
        throw new Error("on-chain offer seller does not match the marketplace seller");
      }
      if (Number(chainOffer[2]) < kWhTraded) {
        throw new Error(`On-chain offer has only ${chainOffer[2]} kWh available`);
      }
      onChainCapacity = Number(chainOffer[2]);
      if (chainOffer[3] !== priceToWei(offer.pricePerKWh)) {
        throw new Error("on-chain offer price no longer matches the marketplace price");
      }
      return chainOffer[3];
    })
    : priceToWei(offer.pricePerKWh);
  const value = BigInt(kWhTraded) * priceWei;
  const buyerBalance = await publicClient.getBalance({ address: buyerAccount.address });
  if (buyerBalance < value) {
    throw new Error(`buyer wallet ${buyerAccount.address} has insufficient Sepolia ETH for the purchase value`);
  }

  await ensureRole(sellerWallet, publicClient, contractAddress, sellerAccount.address, 1);
  await ensureRole(buyerWallet, publicClient, contractAddress, buyerAccount.address, 2);

  let onChainOfferId = BigInt(offer.onChainOfferId ?? 0);
  let createOfferTxHash = null;
  if (!Number.isInteger(offer.onChainOfferId)) {
    onChainCapacity = Math.floor(Number(offer.kWhAvailable)) + kWhTraded;
    if (!Number.isSafeInteger(onChainCapacity) || onChainCapacity < kWhTraded) {
      throw new Error("marketplace quantity exceeds the supported on-chain range");
    }
    createOfferTxHash = await sellerWallet.writeContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "createOffer",
      args: [BigInt(onChainCapacity), priceWei]
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createOfferTxHash });
    if (createReceipt.status !== "success") throw new Error("createOffer transaction failed");
    onChainOfferId = decodeEventFromReceipt(createReceipt, contractAddress, "OfferCreated").offerId;
  }

  try {
    const purchaseTxHash = await buyerWallet.writeContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "purchaseEnergy",
      args: [onChainOfferId, BigInt(kWhTraded)],
      value
    });
    const purchaseReceipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTxHash });
    if (purchaseReceipt.status !== "success") throw new Error("purchaseEnergy transaction failed");
    const purchased = decodeEventFromReceipt(purchaseReceipt, contractAddress, "TradePurchased");
    const remaining = await publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "offers",
      args: [onChainOfferId]
    });
    return {
      onChainOfferId: Number(onChainOfferId),
      tradeId: Number(purchased.tradeId),
      kWhTraded,
      availableKWh: Number(remaining[2]),
      totalPriceWei: value.toString(),
      purchaseTxHash,
      createOfferTxHash,
      purchaseGasUsed: purchaseReceipt.gasUsed.toString(),
      purchaseGasPrice: purchaseReceipt.effectiveGasPrice?.toString() ?? null
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (createOfferTxHash) {
      failure.onChainOfferId = Number(onChainOfferId);
      failure.createOfferTxHash = createOfferTxHash;
      failure.createdOfferAvailableKWh = onChainCapacity;
    }
    throw failure;
  }
}

export async function settleTradeOnChain({ tradeId, sellerAddress }) {
  const { contractAddress, publicClient } = getPublicChainClient();
  if (!isAddress(sellerAddress) || !Number.isSafeInteger(tradeId) || tradeId < 0) {
    throw new Error("sellerAddress and tradeId are required");
  }
  const trade = await publicClient.readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "trades",
    args: [BigInt(tradeId)]
  });
  if (trade[2].toLowerCase() !== sellerAddress.toLowerCase()) throw new Error("Only the seller can settle this trade");
  if (Number(trade[6]) === 1) throw new Error("Trade is already settled");
  return {
    tradeId,
    seller: trade[2],
    buyer: trade[3],
    kWhTraded: Number(trade[4]),
    totalPriceWei: trade[5].toString(),
    status: "Pending"
  };
}

export async function settleMatchOnChain({ offer, kWhTraded }) {
  const { buyerAccount, sellerWallet, publicClient, contractAddress } = getClients();
  const purchase = await purchaseMatchOnChain({ offer, buyerId: buyerAccount.address, kWhTraded });
  const settleHash = await sellerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "settleTrade",
    args: [BigInt(purchase.tradeId)]
  });
  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });
  if (settleReceipt.status !== "success") throw new Error("settleTrade transaction failed");
  return {
    ...purchase,
    txHash: settleHash,
    settlementGasUsed: settleReceipt.gasUsed.toString(),
    settlementGasPrice: settleReceipt.effectiveGasPrice?.toString() ?? null
  };
}

export async function verifyWalletPurchase({ offer, buyerId, purchaseTxHash }) {
  const { contractAddress, publicClient } = getPublicChainClient();
  if (!isAddress(buyerId) || !Number.isSafeInteger(offer.onChainOfferId) || !isHash(purchaseTxHash)) {
    throw new Error("buyerId, onChainOfferId, and purchaseTxHash are required");
  }
  if (!isAddress(offer.sellerId)) throw new Error("the marketplace seller must be a wallet address");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: purchaseTxHash });
  if (receipt.status !== "success") throw new Error("purchaseEnergy transaction failed");
  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase() || receipt.from.toLowerCase() !== buyerId.toLowerCase()) {
    throw new Error("purchase transaction contract or buyer does not match");
  }
  const transaction = await publicClient.getTransaction({ hash: purchaseTxHash });
  const purchased = decodeEventFromReceipt(receipt, contractAddress, "TradePurchased");
  if (purchased.offerId !== BigInt(offer.onChainOfferId) || purchased.buyer.toLowerCase() !== buyerId.toLowerCase()) {
    throw new Error("purchase receipt does not match this offer and buyer");
  }

  const [chainOffer, chainTrade] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "offers",
      args: [purchased.offerId]
    }),
    publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "trades",
      args: [purchased.tradeId]
    })
  ]);
  const expectedValue = purchased.kWhTraded * chainOffer[3];
  if (
    chainOffer[1].toLowerCase() !== offer.sellerId.toLowerCase() ||
    chainTrade[1] !== purchased.offerId ||
    chainTrade[2].toLowerCase() !== offer.sellerId.toLowerCase() ||
    chainTrade[3].toLowerCase() !== buyerId.toLowerCase() ||
    chainTrade[4] !== purchased.kWhTraded ||
    chainTrade[5] !== purchased.totalPrice ||
    Number(chainTrade[6]) !== 0 ||
    transaction.value !== expectedValue ||
    purchased.totalPrice !== expectedValue
  ) {
    throw new Error("purchase transaction does not match the on-chain offer and pending trade");
  }

  const tradeId = Number(purchased.tradeId);
  const kWhTraded = Number(purchased.kWhTraded);
  const availableKWh = Number(chainOffer[2]);
  if (![tradeId, kWhTraded, availableKWh].every(Number.isSafeInteger)) {
    throw new Error("on-chain trade values exceed the supported range");
  }
  return {
    tradeId,
    sellerId: chainTrade[2],
    buyerId: chainTrade[3],
    kWhTraded,
    totalPriceWei: purchased.totalPrice.toString(),
    pricePerKWhWei: chainOffer[3],
    availableKWh,
    purchaseTxHash,
    purchaseGasUsed: receipt.gasUsed.toString(),
    purchaseGasPrice: receipt.effectiveGasPrice?.toString() ?? null
  };
}

export async function verifyWalletSettlement({ transaction, txHash }) {
  const { contractAddress, publicClient } = getPublicChainClient();
  if (!Number.isSafeInteger(transaction.onChainTradeId) || !isHash(txHash) || !isAddress(transaction.sellerId)) {
    throw new Error("settlement transaction details are incomplete");
  }
  const trade = await publicClient.readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "trades",
    args: [BigInt(transaction.onChainTradeId)]
  });
  if (
    trade[2].toLowerCase() !== transaction.sellerId.toLowerCase() ||
    (transaction.buyerId && trade[3].toLowerCase() !== transaction.buyerId.toLowerCase()) ||
    (transaction.totalPriceWei && trade[5] !== BigInt(transaction.totalPriceWei))
  ) {
    throw new Error("stored transaction does not match the on-chain trade");
  }
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("settlement transaction failed");
  if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase() || receipt.from.toLowerCase() !== transaction.sellerId.toLowerCase()) {
    throw new Error("settlement transaction contract or seller does not match");
  }
  const settled = decodeEventFromReceipt(receipt, contractAddress, "TradeSettled");
  if (
    settled.tradeId !== BigInt(transaction.onChainTradeId) ||
    settled.seller.toLowerCase() !== transaction.sellerId.toLowerCase()
  ) {
    throw new Error("settlement receipt does not contain the expected TradeSettled event");
  }

  if (
    trade[2].toLowerCase() !== transaction.sellerId.toLowerCase() ||
    (transaction.buyerId && trade[3].toLowerCase() !== transaction.buyerId.toLowerCase()) ||
    Number(trade[6]) !== 1
  ) {
    throw new Error("on-chain trade is not settled for this buyer and seller");
  }
  return {
    txHash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null
  };
}

export async function getOnChainTradeDetails(tradeId) {
  const { contractAddress, publicClient } = getPublicChainClient();
  if (!Number.isSafeInteger(tradeId) || tradeId < 0) throw new Error("on-chain trade ID is invalid");
  const trade = await publicClient.readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "trades",
    args: [BigInt(tradeId)]
  });
  const kWhTraded = Number(trade[4]);
  if (!Number.isSafeInteger(kWhTraded)) throw new Error("on-chain trade quantity exceeds the supported range");
  return {
    sellerId: trade[2],
    buyerId: trade[3],
    kWhTraded,
    totalPriceWei: trade[5].toString(),
    status: Number(trade[6]) === 1 ? "settled" : "pending"
  };
}

export async function verifyOnChainOffer({ offerId, sellerId, pricePerKWh }) {
  const { contractAddress, publicClient } = getPublicChainClient();
  if (!Number.isSafeInteger(offerId) || offerId < 0 || !isAddress(sellerId)) {
    throw new Error("on-chain offer ID and seller wallet are required");
  }
  const offer = await publicClient.readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "offers",
    args: [BigInt(offerId)]
  });
  const availableKWh = Number(offer[2]);
  if (offer[1] === "0x0000000000000000000000000000000000000000") {
    throw new Error("on-chain offer does not exist");
  }
  if (offer[1].toLowerCase() !== sellerId.toLowerCase()) {
    throw new Error("on-chain offer seller does not match the submitted seller wallet");
  }
  if (offer[3] !== priceToWei(pricePerKWh)) {
    throw new Error("on-chain offer price does not match the submitted marketplace price");
  }
  if (!Number.isSafeInteger(availableKWh)) throw new Error("on-chain offer quantity exceeds the supported range");
  return {
    availableKWh,
    status: availableKWh > 0 ? "open" : "settled"
  };
}

export async function updateOnChainOfferPrice({ offerId, pricePerKWh, sellerId }) {
  const { contractAddress, sellerAccount, sellerWallet, publicClient } = getClients();
  if (!isAddress(sellerId) || !Number.isSafeInteger(offerId) || offerId < 0) {
    throw new Error("sellerId and offerId are invalid for on-chain price update");
  }
  if (sellerAccount.address.toLowerCase() !== sellerId.toLowerCase()) {
    throw new Error("SELLER_PRIVATE_KEY does not control the listed seller wallet");
  }
  const hash = await sellerWallet.writeContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "updateOfferPrice",
    args: [BigInt(offerId), priceToWei(pricePerKWh)]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("updateOfferPrice transaction failed");
  return {
    txHash: hash,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null
  };
}
