import "dotenv/config";
import { createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { solarShareAbi } from "./src/services/solarShareAbi.js";

const contractAddress = process.env.CONTRACT_ADDRESS;
const rpcUrl = process.env.SEPOLIA_RPC_URL;
const buyerKey = process.env.BUYER_PRIVATE_KEY;
const sellerKey = process.env.SELLER_PRIVATE_KEY;

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const buyerAccount = privateKeyToAccount(buyerKey);
const sellerAccount = privateKeyToAccount(sellerKey);

console.log("=== SolarShare Blockchain Diagnosis ===\n");

// 1. Chain ID
const chainId = await client.getChainId();
console.log(`1. Chain ID: ${chainId} ${chainId === 11155111 ? "✓ Sepolia" : "✗ WRONG"}`);

// 2. Contract address
console.log(`2. Contract: ${contractAddress} ${isAddress(contractAddress) ? "✓ valid" : "✗ invalid"}`);

// 3. Block number (RPC responding)
const blockNumber = await client.getBlockNumber();
console.log(`3. RPC responding: block ${blockNumber} ✓`);

// 4. Participant registration
const buyerParticipant = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [buyerAccount.address] });
const sellerParticipant = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "participants", args: [sellerAccount.address] });
console.log(`4. Buyer ${buyerAccount.address.slice(0,10)}... role=${buyerParticipant[0]} registered=${buyerParticipant[1]} ${buyerParticipant[1] ? "✓" : "✗ NOT REGISTERED"}`);
console.log(`   Seller ${sellerAccount.address.slice(0,10)}... role=${sellerParticipant[0]} registered=${sellerParticipant[1]} ${sellerParticipant[1] ? "✓" : "✗ NOT REGISTERED"}`);

// 5. Balances
const buyerBalance = await client.getBalance({ address: buyerAccount.address });
const sellerBalance = await client.getBalance({ address: sellerAccount.address });
console.log(`5. Buyer balance: ${(Number(buyerBalance)/1e18).toFixed(6)} ETH ${buyerBalance > 0n ? "✓" : "✗"}`);
console.log(`   Seller balance: ${(Number(sellerBalance)/1e18).toFixed(6)} ETH ${sellerBalance > 0n ? "✓" : "✗"}`);

// 6. Contract state
const nextOfferId = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "nextOfferId" });
const nextTradeId = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "nextTradeId" });
console.log(`6. On-chain state: nextOfferId=${nextOfferId}, nextTradeId=${nextTradeId}`);

// 7. Existing offers
for (let i = 0n; i < nextOfferId && i < 20n; i++) {
  const offer = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "offers", args: [i] });
  console.log(`   Offer ${i}: seller=${offer[1].slice(0,10)}... kWh=${offer[2]} price=${offer[3]} status=${["Open","Matched","Settled"][Number(offer[4])]}`);
}

// 8. Existing trades
for (let i = 0n; i < nextTradeId && i < 20n; i++) {
  const trade = await client.readContract({ address: contractAddress, abi: solarShareAbi, functionName: "trades", args: [i] });
  console.log(`   Trade ${i}: offerId=${trade[1]} seller=${trade[2].slice(0,10)}... buyer=${trade[3].slice(0,10)}... kWh=${trade[4]} wei=${trade[5]} status=${trade[6]===0n?"Pending":"Settled"}`);
}

console.log("\n=== Diagnosis Complete ===");
