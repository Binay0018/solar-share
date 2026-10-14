import "dotenv/config";
import { createPublicClient, createWalletClient, decodeEventLog, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { solarShareAbi } from "./src/services/solarShareAbi.js";

const contractAddress = process.env.CONTRACT_ADDRESS;
const rpcUrl = process.env.SEPOLIA_RPC_URL;
const buyerKey = process.env.BUYER_PRIVATE_KEY;
const sellerKey = process.env.SELLER_PRIVATE_KEY;

if (!contractAddress || !rpcUrl || !buyerKey || !sellerKey) {
  console.error("Missing required env vars: CONTRACT_ADDRESS, SEPOLIA_RPC_URL, BUYER_PRIVATE_KEY, SELLER_PRIVATE_KEY");
  process.exit(1);
}

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const buyerAccount = privateKeyToAccount(buyerKey);
const sellerAccount = privateKeyToAccount(sellerKey);
const buyerWallet = createWalletClient({ account: buyerAccount, chain: sepolia, transport: http(rpcUrl) });
const sellerWallet = createWalletClient({ account: sellerAccount, chain: sepolia, transport: http(rpcUrl) });

const ETHERSCAN = "https://sepolia.etherscan.io/tx";

console.log("=== SolarShare Chain Check ===\n");

// 1. Chain ID
const chainId = await client.getChainId();
console.log(`Chain ID: ${chainId} ${chainId === 11155111 ? "✓ Sepolia" : "✗ WRONG"}`);

// 2. Block number
const blockNumber = await client.getBlockNumber();
console.log(`RPC: block ${blockNumber} ✓`);

// 3. Registration
const buyerP = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [buyerAccount.address] });
const sellerP = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [sellerAccount.address] });
console.log(`Buyer ${buyerAccount.address.slice(0,10)}... role=${buyerP[0]} reg=${buyerP[1]} ${buyerP[1] ? "✓" : "✗"}`);
console.log(`Seller ${sellerAccount.address.slice(0,10)}... role=${sellerP[0]} reg=${sellerP[1]} ${sellerP[1] ? "✓" : "✗"}`);

// 4. Balances
const buyerBal = await client.getBalance({ address: buyerAccount.address });
const sellerBal = await client.getBalance({ address: sellerAccount.address });
console.log(`Buyer balance: ${(Number(buyerBal)/1e18).toFixed(6)} ETH`);
console.log(`Seller balance: ${(Number(sellerBal)/1e18).toFixed(6)} ETH`);

// 5. Full round trip: create offer → purchase → settle
console.log("\n--- Round Trip ---");

// Create offer
const createHash = await sellerWallet.writeContract({
  address: contractAddress,
  abi: solarShareAbi,
  functionName: "createOffer",
  args: [10n, parseEther("0.000525")]
});
const createReceipt = await client.waitForTransactionReceipt({ hash: createHash });
if (createReceipt.status !== "success") throw new Error("createOffer failed");

// Extract offerId from event - use topics directly for indexed params
const offerCreatedLog = createReceipt.logs.find(
  l => l.address.toLowerCase() === contractAddress.toLowerCase() && l.topics.length === 3
);
if (!offerCreatedLog) throw new Error("OfferCreated event not found in receipt");
const offerId = BigInt(offerCreatedLog.topics[1]);
console.log(`1. createOffer: offerId=${offerId} kWh=10 price=0.000525 ETH`);
console.log(`   tx: ${createHash}`);
console.log(`   ${ETHERSCAN}/${createHash}`);

// Purchase energy
const purchaseHash = await buyerWallet.writeContract({
  address: contractAddress,
  abi: solarShareAbi,
  functionName: "purchaseEnergy",
  args: [offerId, 3n],
  value: parseEther("0.001575")
});
const purchaseReceipt = await client.waitForTransactionReceipt({ hash: purchaseHash });
if (purchaseReceipt.status !== "success") throw new Error("purchaseEnergy failed");

const tradePurchasedLog = purchaseReceipt.logs.find(
  l => l.address.toLowerCase() === contractAddress.toLowerCase() && l.topics.length === 4
);
if (!tradePurchasedLog) throw new Error("TradePurchased event not found in receipt");
const tradeId = BigInt(tradePurchasedLog.topics[1]);
console.log(`2. purchaseEnergy: tradeId=${tradeId} kWh=3 value=0.001575 ETH`);
console.log(`   tx: ${purchaseHash}`);
console.log(`   ${ETHERSCAN}/${purchaseHash}`);

// Settle trade
const settleHash = await sellerWallet.writeContract({
  address: contractAddress,
  abi: solarShareAbi,
  functionName: "settleTrade",
  args: [tradeId]
});
const settleReceipt = await client.waitForTransactionReceipt({ hash: settleHash });
if (settleReceipt.status !== "success") throw new Error("settleTrade failed");
console.log(`3. settleTrade: tradeId=${tradeId}`);
console.log(`   tx: ${settleHash}`);
console.log(`   ${ETHERSCAN}/${settleHash}`);

// Verify final state
const offer = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "offers", args: [offerId] });
const trade = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "trades", args: [tradeId] });
console.log(`\nFinal state:`);
console.log(`  Offer ${offerId}: kWh=${offer[2]} price=${offer[3]} status=${["Open","Matched","Settled"][Number(offer[4])]}`);
console.log(`  Trade ${tradeId}: kWh=${trade[4]} wei=${trade[5]} status=${trade[6]===0n?"Pending":"Settled"}`);

console.log("\n=== Chain Check PASSED ===");
