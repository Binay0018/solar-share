import { createPublicClient, createWalletClient, custom, decodeEventLog, http, parseAbi, parseEther } from "viem";
import { sepolia } from "viem/chains";

export const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS ?? "0xd5332E490e251813702bf461CAfED84FF3d0319C";
export const contractGasLimit = 300000n;
export const solarShareAbi = parseAbi([
  "function participants(address) view returns (uint8 role, bool registered)",
  "function registerParticipant(uint8 role)",
  "function createOffer(uint256 kWhAvailable, uint256 pricePerKWh) returns (uint256 offerId)",
  "function purchaseEnergy(uint256 offerId, uint256 kWh) payable returns (uint256 tradeId)",
  "event OfferCreated(uint256 indexed offerId, address indexed seller, uint256 kWhAvailable, uint256 pricePerKWh)",
  "event TradePurchased(uint256 indexed tradeId, uint256 indexed offerId, address indexed buyer, uint256 kWhTraded, uint256 totalPrice)"
]);

export function kWhToContractUnits(kWh) {
  if (!Number.isInteger(Number(kWh)) || Number(kWh) <= 0) {
    throw new Error("On-chain offers require a positive whole kWh amount, for example 5 instead of 5.5");
  }
  return BigInt(kWh);
}

export function priceToWei(pricePerKWh) {
  if (!Number.isFinite(Number(pricePerKWh)) || Number(pricePerKWh) <= 0) throw new Error("On-chain price must be positive");
  return parseEther(String(pricePerKWh));
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

export function decodeContractEvent(receipt, eventName) {
  const log = receipt.logs.find((entry) => entry.address.toLowerCase() === contractAddress.toLowerCase());
  if (!log) throw new Error(`${eventName} event was not found in the transaction receipt`);
  const decoded = decodeEventLog({ abi: solarShareAbi, data: log.data, topics: log.topics });
  if (decoded.eventName !== eventName) throw new Error(`Unexpected contract event: ${decoded.eventName}`);
  return decoded.args;
}
