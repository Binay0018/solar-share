import { createPublicClient, createWalletClient, custom, decodeEventLog, http, parseAbi, parseUnits } from "viem";
import { sepolia } from "viem/chains";

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
