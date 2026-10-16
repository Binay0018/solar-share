import { createPublicClient, createWalletClient, custom, decodeEventLog, http, parseAbi, parseUnits } from "viem";
import { sepolia } from "viem/chains";
import { normalizeChainTrade } from "./purchaseQueue.js";

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
export const solarShareAbi = parseAbi([
  "function participants(address) view returns (uint8 role, bool registered)",
  "function registerParticipant(uint8 role)",
  "function createOffer(uint256 kWhAvailable, uint256 pricePerKWh) returns (uint256 offerId)",
  "function purchaseEnergy(uint256 offerId, uint256 kWh) payable returns (uint256 tradeId)",
  "function settleTrade(uint256 tradeId)",
  "function updateOfferPrice(uint256 offerId, uint256 newPricePerKWh)",
  "function offers(uint256) view returns (uint256 id, address seller, uint256 kWhAvailable, uint256 pricePerKWh, uint8 status)",
  "function trades(uint256) view returns (uint256 id, uint256 offerId, address seller, address buyer, uint256 kWhTraded, uint256 totalPrice, uint8 status)",
  "function nextOfferId() view returns (uint256)",
  "function nextTradeId() view returns (uint256)",
  "event OfferCreated(uint256 indexed offerId, address indexed seller, uint256 kWhAvailable, uint256 pricePerKWh)",
  "event TradePurchased(uint256 indexed tradeId, uint256 indexed offerId, address indexed buyer, uint256 kWhTraded, uint256 totalPrice)",
  "event TradeSettled(uint256 indexed tradeId, uint256 indexed offerId, address indexed seller, address buyer, uint256 totalPrice)"
]);

export function kWhToContractUnits(kWh) {
  if (!Number.isInteger(Number(kWh)) || Number(kWh) <= 0) {
    throw new Error("On-chain offers require a positive whole kWh amount, for example 5 instead of 5.5");
  }
  return BigInt(kWh);
}

export function priceToWei(pricePerKWh) {
  const rate = String(pricePerKWh).trim();
  if (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) <= 0) throw new Error("On-chain price must be positive");
  return parseUnits(rate, 10);
}

export function getWalletClient(account) {
  if (!window.ethereum) throw new Error("MetaMask was not found");
  return createWalletClient({ account, chain: sepolia, transport: custom(window.ethereum) });
}

export function getPublicClient() {
  const transport = window.ethereum ? custom(window.ethereum) : http(import.meta.env.VITE_SEPOLIA_RPC_URL);
  return createPublicClient({ chain: sepolia, transport });
}

// The deployed SolarShare contract is large and is not compiled with the Solidity
// optimizer, so calls such as purchaseEnergy consume far more gas than a
// hand-written estimate suggests (about 830,000 gas instead of 300,000).
// Hard-coding a limit makes MetaMask reject the transaction as "likely to fail",
// so every write estimates gas on the live node, keeps a safety margin, and
// checks the wallet can actually pay for value plus gas before prompting.
export async function writeContractWithGas(account, request) {
  const publicClient = getPublicClient();
  const estimate = await publicClient.estimateContractGas({ ...request, account });
  const gas = (estimate * 125n) / 100n;
  const value = request.value ?? 0n;
  const balance = await publicClient.getBalance({ address: account });
  const fees = await publicClient.estimateFeesPerGas().catch(() => null);
  const maxFeePerGas = fees?.maxFeePerGas ?? (await publicClient.getGasPrice());
  const required = value + gas * maxFeePerGas;
  if (balance < required) {
    throw new Error(
      `This wallet (${account}) holds ${Number(balance) / 1e18} ETH but this transaction needs about ${Number(required) / 1e18} ETH including gas. Add Sepolia ETH to this wallet and try again.`
    );
  }
  return getWalletClient(account).writeContract({ ...request, gas });
}

export async function ensureSepoliaNetwork() {
  if (!window.ethereum) throw new Error("MetaMask was not found");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (Number(chainId) !== sepolia.id) throw new Error("Switch MetaMask to the Sepolia network");
}

export async function ensureProsumer(account) {
  const publicClient = getPublicClient();
  const participant = await publicClient.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [account] });
  const role = Number(participant[0]);
  if (participant[1] && (role === 1 || role === 3)) return;
  const hash = await writeContractWithGas(account, { address: contractAddress, abi: solarShareAbi, functionName: "registerParticipant", args: [1] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Seller registration failed");
}

export async function ensureConsumer(account) {
  const publicClient = getPublicClient();
  const participant = await publicClient.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [account] });
  const role = Number(participant[0]);
  if (participant[1] && (role === 2 || role === 3)) return;
  const hash = await writeContractWithGas(account, { address: contractAddress, abi: solarShareAbi, functionName: "registerParticipant", args: [2] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Buyer registration failed");
}

/**
 * Read-only view of one trade straight from the contract. The Sell page uses it
 * to avoid offering a settlement the contract would reject (a trade that is
 * already settled on-chain reverts with TradeAlreadySettled). It never signs
 * anything and returns `undefined` when there is nothing to read.
 */
export async function readTradeOnChain(tradeId) {
  if (!contractAddress || !Number.isSafeInteger(tradeId)) return undefined;
  const raw = await getPublicClient().readContract({
    address: contractAddress,
    abi: solarShareAbi,
    functionName: "trades",
    args: [BigInt(tradeId)]
  });
  return normalizeChainTrade(raw);
}

/**
 * Read several `trades(id)` entries in one pass for a caller's row list.
 * Read-only: it never signs or sends anything. An id that cannot be read is
 * simply absent from the result, so an RPC hiccup can never turn a row into a
 * settled one.
 */
export async function readTradesOnChain(tradeIds) {
  const ids = [...new Set((tradeIds ?? []).filter((tradeId) => Number.isSafeInteger(tradeId)))];
  const entries = await Promise.all(
    ids.map(async (tradeId) => [tradeId, await readTradeOnChain(tradeId).catch(() => undefined)])
  );
  return Object.fromEntries(entries.filter(([, trade]) => trade !== undefined));
}

/**
 * Find the transaction that settled one trade, so the marketplace ledger can be
 * synchronised without signing anything.
 *
 * A trade status only moves Pending -> Settled, so the settlement block is found
 * by bisecting `trades(id).status` between the purchase block and the head of the
 * chain (about 20 read-only calls), and the contract's own TradeSettled log is
 * then read from that single block. Only the contract's event is returned; when
 * the trade is not settled on-chain, or the event cannot be read, the result is
 * null rather than a guess.
 */
export async function findSettlementTxHash(tradeId, { purchaseTxHash } = {}) {
  if (!contractAddress || !Number.isSafeInteger(tradeId)) {
    throw new Error("An on-chain trade ID is required to look up a settlement transaction");
  }
  const publicClient = getPublicClient();
  const isSettledAt = async (blockNumber) => {
    const raw = await publicClient.readContract({
      address: contractAddress,
      abi: solarShareAbi,
      functionName: "trades",
      args: [BigInt(tradeId)],
      blockNumber
    });
    return normalizeChainTrade(raw).settledOnChain;
  };

  const latest = await publicClient.getBlockNumber();
  let low = 0n;
  // A settlement can only happen after the purchase, so the purchase block is a
  // safe lower bound and keeps the search short.
  if (typeof purchaseTxHash === "string" && purchaseTxHash.length === 66) {
    const purchase = await publicClient.getTransactionReceipt({ hash: purchaseTxHash }).catch(() => null);
    if (typeof purchase?.blockNumber === "bigint") low = purchase.blockNumber;
  }
  if (low > latest) low = latest;
  if (!(await isSettledAt(latest))) return null;

  let high = latest;
  while (low < high) {
    const mid = low + (high - low) / 2n;
    if (await isSettledAt(mid)) high = mid;
    else low = mid + 1n;
  }

  const logs = await publicClient.getContractEvents({
    address: contractAddress,
    abi: solarShareAbi,
    eventName: "TradeSettled",
    args: { tradeId: BigInt(tradeId) },
    fromBlock: low,
    toBlock: low
  });
  return logs[0]?.transactionHash ?? null;
}

export function decodeContractEvent(receipt, eventName) {
  const logs = receipt.logs.filter((entry) => entry.address.toLowerCase() === contractAddress.toLowerCase());
  if (logs.length === 0) throw new Error(`${eventName} event was not found in the transaction receipt`);
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: solarShareAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === eventName) return decoded.args;
    } catch {
      // Not the right event, try next log
    }
  }
  throw new Error(`${eventName} event was not found in the transaction receipt`);
}
