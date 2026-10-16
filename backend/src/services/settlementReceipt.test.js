import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import { solarShareAbi } from "./solarShareAbi.js";
import { verifySettlementReceipt } from "./contractService.js";

/* ---------------------------------------------------------------------------
   Settlement receipt verification.

   A seller wallet that MetaMask has upgraded to an EIP-7702 smart account sends
   settleTrade through a delegation/batching contract, so the settlement
   transaction's `to` is not the SolarShare contract even though the contract
   really settled the trade. `verifySettlementReceipt` therefore proves the
   settlement with the contract's own TradeSettled log instead of the
   transaction target.

   The three cases requested:
     - a direct transaction passes,
     - a delegated (batched) transaction passes,
     - a TradeSettled event that was emitted by some other contract fails.
   --------------------------------------------------------------------------- */

const CONTRACT = "0xd5332E490e251813702bf461CAfED84FF3d0319C";
// Exactly the casing stored in the live ledger row (a valid EIP-55 checksum).
const SELLER = "0x5986b556278c69520D61403c6cb2c3F50D810743";
const BUYER = "0x1ca4c8662e32a3a20c550813d04d760e905fd2b5";

/* The live addresses measured on Sepolia: the seller's delegated wallet sent the
   out-of-sync settlements through MetaMask's DelegationManager, and the receipts
   also carry logs from unrelated contracts. */
const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const UNRELATED_CONTRACT = "0xfffffffffffffffffffffffffffffffffffffffe";
const ATTACKER_CONTRACT = "0x000000000000000000000000000000000000dEaD";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const settledEvent = solarShareAbi.find((item) => item.type === "event" && item.name === "TradeSettled");
const nonIndexed = settledEvent.inputs.filter((input) => !input.indexed);

function tradeSettledLog({ address = CONTRACT, tradeId = 33, offerId = 10, seller = SELLER, buyer = BUYER, totalPrice = 280000000000n } = {}) {
  const topics = encodeEventTopics({
    abi: solarShareAbi,
    eventName: "TradeSettled",
    args: { tradeId: BigInt(tradeId), offerId: BigInt(offerId), seller }
  });
  const data = encodeAbiParameters(
    nonIndexed.map((input) => ({ name: input.name, type: input.type })),
    [buyer, BigInt(totalPrice)]
  );
  return { address, topics, data };
}

function unrelatedLog(address = UNRELATED_CONTRACT) {
  return { address, topics: [ERC20_TRANSFER_TOPIC, `0x${"0".repeat(64)}`, `0x${"0".repeat(64)}`], data: "0x" };
}

function settlementReceipt({ to = CONTRACT, from = SELLER, status = "success", logs = [] } = {}) {
  return { status, from, to, logs };
}

// The stored ledger row for trade #33, as confirm-settlement would supply it.
const storedTrade = { onChainTradeId: 33, sellerId: SELLER };

test("settlement: the TradeSettled ABI shape the fixtures encode is unchanged", () => {
  assert.equal(settledEvent.name, "TradeSettled");
  assert.deepEqual(settledEvent.inputs.filter((input) => input.indexed).map((input) => input.name), ["tradeId", "offerId", "seller"]);
  assert.deepEqual(nonIndexed.map((input) => input.type), ["address", "uint256"]);
});

test("settlement: a direct transaction to the contract passes", () => {
  const receipt = settlementReceipt({ to: CONTRACT, logs: [tradeSettledLog()] });
  const settled = verifySettlementReceipt(receipt, CONTRACT, storedTrade);
  assert.equal(settled.tradeId, 33n);
  assert.equal(settled.seller, SELLER);
});

test("settlement: a delegated (EIP-7702 batched) transaction passes and its unrelated logs are ignored", () => {
  const receipt = settlementReceipt({
    to: DELEGATION_MANAGER,
    logs: [unrelatedLog(), tradeSettledLog(), unrelatedLog(DELEGATION_MANAGER)]
  });
  const settled = verifySettlementReceipt(receipt, CONTRACT, storedTrade);
  assert.equal(settled.tradeId, 33n);
  assert.equal(settled.buyer.toLowerCase(), BUYER);
});

test("settlement: a TradeSettled event emitted by another contract fails", () => {
  const receipt = settlementReceipt({ to: DELEGATION_MANAGER, logs: [tradeSettledLog({ address: ATTACKER_CONTRACT })] });
  assert.throws(
    () => verifySettlementReceipt(receipt, CONTRACT, storedTrade),
    /TradeSettled event was not found/
  );
});

test("settlement: a real contract log for a different trade never settles this row", () => {
  // The genuine contract event, but for trade 34 while the stored row is trade 33.
  const receipt = settlementReceipt({ to: DELEGATION_MANAGER, logs: [unrelatedLog(), tradeSettledLog({ tradeId: 34 })] });
  assert.throws(
    () => verifySettlementReceipt(receipt, CONTRACT, storedTrade),
    /does not contain the expected TradeSettled event/
  );
});

test("settlement: a contract log naming another seller never settles this row", () => {
  const receipt = settlementReceipt({ to: CONTRACT, logs: [tradeSettledLog({ seller: BUYER })] });
  assert.throws(
    () => verifySettlementReceipt(receipt, CONTRACT, storedTrade),
    /does not contain the expected TradeSettled event/
  );
});

test("settlement: a transaction signed by another wallet fails even with a valid contract event", () => {
  const receipt = settlementReceipt({ to: CONTRACT, from: BUYER, logs: [tradeSettledLog()] });
  assert.throws(() => verifySettlementReceipt(receipt, CONTRACT, storedTrade), /seller does not match/);
});

test("settlement: a reverted transaction fails", () => {
  const receipt = settlementReceipt({ status: "reverted", logs: [tradeSettledLog()] });
  assert.throws(() => verifySettlementReceipt(receipt, CONTRACT, storedTrade), /settlement transaction failed/);
});

test("settlement: address casing never changes the decision", () => {
  const receipt = settlementReceipt({ to: DELEGATION_MANAGER, from: SELLER.toLowerCase(), logs: [tradeSettledLog({ seller: SELLER.toLowerCase() })] });
  const settled = verifySettlementReceipt(receipt, CONTRACT.toLowerCase(), { onChainTradeId: 33, sellerId: SELLER });
  assert.equal(settled.tradeId, 33n);
});
