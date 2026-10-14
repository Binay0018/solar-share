import { createPublicClient, createWalletClient, custom, decodeEventLog, http, parseAbi, parseEther } from "viem";
import { sepolia } from "viem/chains";

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
export const contractGasLimit = 300000n;
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
  if (!Number.isFinite(Number(pricePerKWh)) || Number(pricePerKWh) <= 0) throw new Error("On-chain price must be positive");
  // Scale INR unit rate (e.g. ₹5.25) to 0.0001 ETH/unit for testnet affordability
  const ethRate = Math.max(0.0001, Number((Number(pricePerKWh) * 0.0001).toFixed(6)));
  return parseEther(String(ethRate));
}

export function getWalletClient(account) {
  if (!window.ethereum) throw new Error("MetaMask was not found");
  return createWalletClient({ account, chain: sepolia, transport: custom(window.ethereum) });
}

export function getPublicClient() {
  const transport = window.ethereum ? custom(window.ethereum) : http(import.meta.env.VITE_SEPOLIA_RPC_URL);
  return createPublicClient({ chain: sepolia, transport });
}

export async function ensureProsumer(account) {
  const publicClient = getPublicClient();
  const participant = await publicClient.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [account] });
  const role = Number(participant[0]);
  if (participant[1] && (role === 1 || role === 3)) return;
  const hash = await getWalletClient(account).writeContract({ address: contractAddress, abi: solarShareAbi, functionName: "registerParticipant", args: [1], gas: contractGasLimit });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Seller registration failed");
}

export async function ensureConsumer(account) {
  const publicClient = getPublicClient();
  const participant = await publicClient.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [account] });
  const role = Number(participant[0]);
  if (participant[1] && (role === 2 || role === 3)) return;
  const hash = await getWalletClient(account).writeContract({ address: contractAddress, abi: solarShareAbi, functionName: "registerParticipant", args: [2], gas: contractGasLimit });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Buyer registration failed");
}

export function decodeContractEvent(receipt, eventName) {
  const log = receipt.logs.find((entry) => entry.address.toLowerCase() === contractAddress.toLowerCase());
  if (!log) throw new Error(`${eventName} event was not found in the transaction receipt`);
  const decoded = decodeEventLog({ abi: solarShareAbi, data: log.data, topics: log.topics });
  if (decoded.eventName !== eventName) throw new Error(`Unexpected contract event: ${decoded.eventName}`);
  return decoded.args;
}
