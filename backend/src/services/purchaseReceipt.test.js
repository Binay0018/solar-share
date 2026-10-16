import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import { solarShareAbi } from "./solarShareAbi.js";
import { verifyPurchaseReceipt } from "./contractService.js";

/* ---------------------------------------------------------------------------
   Purchase receipt verification.

   A buyer wallet that MetaMask has upgraded to an EIP-7702 smart account sends
   purchaseEnergy through a delegation/batching contract, so the purchase
   transaction's `to` is not the SolarShare contract even though the contract
   really recorded the purchase. `verifyPurchaseReceipt` therefore proves the
   purchase with the contract's own TradePurchased log instead of the
   transaction target. The buyer read is unchanged: all 32 recorded purchases are
   direct-to-contract today, and this keeps them working if that ever changes.

   The requested cases:
     - a direct transaction passes,
     - a delegated (batched) transaction passes,
     - a TradePurchased event emitted by some other contract fails,
     - a wrong buyer fails.
   --------------------------------------------------------------------------- */

const CONTRACT = "0xd5332E490e251813702bf461CAfED84FF3d0319C";
// Exactly the casing stored in the live ledger row (a valid EIP-55 checksum).
const SELLER = "0x5986b556278c69520D61403c6cb2c3F50D810743";
const BUYER = "0x1ca4c8662e32a3a20c550813d04d760e905fd2b5";
const OTHER_BUYER = "0x1111111111111111111111111111111111111111";

/* The live addresses measured on Sepolia: the DelegationManager handles EIP-7702
   batches and the receipts also carry logs from unrelated contracts. */
const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const UNRELATED_CONTRACT = "0xfffffffffffffffffffffffffffffffffffffffe";
const ATTACKER_CONTRACT = "0x000000000000000000000000000000000000dEaD";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const purchasedEvent = solarShareAbi.find((item) => item.type === "event" && item.name === "TradePurchased");
const nonIndexed = purchasedEvent.inputs.filter((input) => !input.indexed);

function tradePurchasedLog({ address = CONTRACT, tradeId = 61, offerId = 7, buyer = BUYER, kWhTraded = 14, totalPrice = 140000000000n } = {}) {
  const topics = encodeEventTopics({
    abi: solarShareAbi,
    eventName: "TradePurchased",
    args: { tradeId: BigInt(tradeId), offerId: BigInt(offerId), buyer }
  });
  const data = encodeAbiParameters(
    nonIndexed.map((input) => ({ name: input.name, type: input.type })),
    [BigInt(kWhTraded), BigInt(totalPrice)]
  );
  return { address, topics, data };
}

function unrelatedLog(address = UNRELATED_CONTRACT) {
  return { address, topics: [ERC20_TRANSFER_TOPIC, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`], data: "0x" };
}

function purchaseReceipt({ to = CONTRACT, from = BUYER, status = "success", logs = [] } = {}) {
  return { status, from, to, logs };
}

// The stored offer and the buyer id, as confirm-purchase would supply them.
const offer = { onChainOfferId: 7, sellerId: SELLER };
const buyerId = BUYER;

test("purchase: the TradePurchased ABI shape the fixtures encode is unchanged", () => {
  assert.equal(purchasedEvent.name, "TradePurchased");
  assert.deepEqual(purchasedEvent.inputs.filter((input) => input.indexed).map((input) => input.name), ["tradeId", "offerId", "buyer"]);
  assert.deepEqual(nonIndexed.map((input) => input.type), ["uint256", "uint256"]);
});

test("purchase: a direct transaction to the contract passes", () => {
  const receipt = purchaseReceipt({ to: CONTRACT, logs: [tradePurchasedLog()] });
  const purchased = verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId });
  assert.equal(purchased.offerId, 7n);
  assert.equal(purchased.buyer.toLowerCase(), BUYER);
  assert.equal(purchased.totalPrice, 140000000000n);
});

test("purchase: a delegated (EIP-7702 batched) transaction passes and its unrelated logs are ignored", () => {
  const receipt = purchaseReceipt({
    to: DELEGATION_MANAGER,
    logs: [unrelatedLog(), tradePurchasedLog(), unrelatedLog(DELEGATION_MANAGER)]
  });
  const purchased = verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId });
  assert.equal(purchased.offerId, 7n);
  assert.equal(purchased.buyer.toLowerCase(), BUYER);
});

test("purchase: a TradePurchased event emitted by another contract fails", () => {
  const receipt = purchaseReceipt({ to: DELEGATION_MANAGER, logs: [tradePurchasedLog({ address: ATTACKER_CONTRACT })] });
  assert.throws(
    () => verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId }),
    /TradePurchased event was not found/
  );
});

test("purchase: a real contract log for a different offer never records this purchase", () => {
  // The genuine contract event, but for offer 8 while the stored offer is 7.
  const receipt = purchaseReceipt({ to: DELEGATION_MANAGER, logs: [unrelatedLog(), tradePurchasedLog({ offerId: 8 })] });
  assert.throws(
    () => verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId }),
    /does not match this offer and buyer/
  );
});

test("purchase: a contract log naming another buyer never records this purchase", () => {
  const receipt = purchaseReceipt({ to: CONTRACT, logs: [tradePurchasedLog({ buyer: OTHER_BUYER })] });
  assert.throws(
    () => verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId }),
    /does not match this offer and buyer/
  );
});

test("purchase: a transaction signed by another wallet fails even with a valid contract event", () => {
  const receipt = purchaseReceipt({ to: DELEGATION_MANAGER, from: OTHER_BUYER, logs: [tradePurchasedLog()] });
  assert.throws(() => verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId }), /buyer does not match/);
});

test("purchase: a reverted transaction fails", () => {
  const receipt = purchaseReceipt({ status: "reverted", logs: [tradePurchasedLog()] });
  assert.throws(() => verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId }), /purchaseEnergy transaction failed/);
});

test("purchase: address casing never changes the decision", () => {
  // The ledger stores the buyer in two casings; only the lowercase comparison may
  // decide, and the event log may use either casing too.
  const receipt = purchaseReceipt({ to: DELEGATION_MANAGER, from: "0x1CA4c8662E32a3a20C550813d04d760E905Fd2B5", logs: [tradePurchasedLog({ buyer: BUYER })] });
  const purchased = verifyPurchaseReceipt(receipt, CONTRACT.toLowerCase(), { offer, buyerId: BUYER });
  assert.equal(purchased.offerId, 7n);
});

test("purchase: the verifier never inspects the outer transaction envelope", () => {
  // A batched EIP-7702 purchase can forward the ETH inside the delegation, so the
  // outer transaction's value/target are not part of the proof: only the contract's
  // own TradePurchased log is. A receipt whose envelope claims no payment still
  // verifies, and the amount comes from the contract.
  const receipt = purchaseReceipt({ to: DELEGATION_MANAGER, logs: [tradePurchasedLog()] });
  receipt.value = 0n;
  receipt.gasUsed = 21000n;
  const purchased = verifyPurchaseReceipt(receipt, CONTRACT, { offer, buyerId });
  assert.equal(purchased.totalPrice, 140000000000n, "the amount comes from the contract's own event");
});
