import test from "node:test";
import assert from "node:assert/strict";
import { encodeErrorResult } from "viem";

import {
  CONTRACT_ERROR_MESSAGES,
  contractErrorAbi,
  decodeContractError,
  extractRevertData,
  revertErrorMessage
} from "./revertErrors.js";

/* `0xfd72c0a0` is the revert data the deployed Sepolia contract really returned
   for a repeat `settleTrade` on an already-settled trade, observed with a
   read-only eth_call. The first test locks that observation to this ABI. */

test("the error ABI encodes TradeAlreadySettled() as the observed selector 0xfd72c0a0", () => {
  assert.equal(encodeErrorResult({ abi: contractErrorAbi, errorName: "TradeAlreadySettled" }), "0xfd72c0a0");
});

test("every ABI error has a message, and no message claims a call succeeded", () => {
  for (const item of contractErrorAbi) {
    assert.ok(CONTRACT_ERROR_MESSAGES[item.name], `${item.name} has no user-facing message`);
  }
  for (const message of Object.values(CONTRACT_ERROR_MESSAGES)) {
    assert.ok(!/success/i.test(message), `a failure message must not mention success: ${message}`);
  }
});

test("decodes the MetaMask error shape (code 3 + data)", () => {
  const decoded = decodeContractError({ code: 3, message: "execution reverted", data: "0xfd72c0a0" });
  assert.equal(decoded.name, "TradeAlreadySettled");
  assert.equal(decoded.selector, "0xfd72c0a0");
  assert.match(decoded.message, /already settled/i);
  assert.match(decoded.message, /ledger has not recorded/i);
});

test("decodes the viem wrap (shortMessage + cause.data)", () => {
  const decoded = decodeContractError({
    name: "CallExecutionError",
    shortMessage: "execution reverted",
    cause: { code: 3, data: "0xfd72c0a0" }
  });
  assert.equal(decoded.name, "TradeAlreadySettled");
});

test("decodes the real viem error shape: raw bytes plus an undecodable signature", () => {
  // Measured against the live contract: viem raises ContractFunctionRevertedError
  // with shortMessage 'The contract function "settleTrade" reverted with the
  // following signature:\n0xfd72c0a0', raw = the revert bytes, and the selector
  // also on the nested AbiErrorSignatureNotFoundError.
  const viemError = {
    name: "ContractFunctionRevertedError",
    shortMessage: 'The contract function "settleTrade" reverted with the following signature:\n0xfd72c0a0',
    raw: "0xfd72c0a0",
    signature: "0xfd72c0a0",
    cause: { name: "AbiErrorSignatureNotFoundError", signature: "0xfd72c0a0" }
  };
  assert.equal(decodeContractError(viemError).name, "TradeAlreadySettled");
  assert.equal(revertErrorMessage(viemError), CONTRACT_ERROR_MESSAGES.TradeAlreadySettled);
  // …and even with only the nested signature available.
  assert.equal(
    decodeContractError({ cause: { name: "AbiErrorSignatureNotFoundError", signature: "0xfd72c0a0" } }).name,
    "TradeAlreadySettled"
  );
});

test("decodes nested info.error.data and deep cause chains", () => {
  assert.equal(decodeContractError({ info: { error: { data: "0xfd72c0a0" } } }).name, "TradeAlreadySettled");
  assert.equal(
    decodeContractError({ cause: { cause: { cause: { data: "0xfd72c0a0" } } } }).name,
    "TradeAlreadySettled"
  );
});

test("decodes NotSeller so an unauthorised wallet gets a real reason", () => {
  const decoded = decodeContractError({ data: encodeErrorResult({ abi: contractErrorAbi, errorName: "NotSeller" }) });
  assert.equal(decoded.name, "NotSeller");
  assert.match(decoded.message, /only the seller/i);
});

test("reports an unknown selector instead of inventing a reason", () => {
  const decoded = decodeContractError({ data: "0xdeadbeef" + "00".repeat(32) });
  assert.equal(decoded.name, undefined);
  assert.match(decoded.message, /0xdeadbeef/);
});

test("decodes standard Error(string) reverts", () => {
  const abi = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }];
  const data = encodeErrorResult({ abi, errorName: "Error", args: ["not allowed here"] });
  const decoded = decodeContractError({ data });
  assert.match(decoded.message, /not allowed here/);
});

test("extractRevertData ignores non-hex and too-short values", () => {
  assert.equal(extractRevertData(undefined), undefined);
  assert.equal(extractRevertData({ data: "execution reverted" }), undefined);
  assert.equal(extractRevertData({ data: "0x" }), undefined);
  assert.equal(extractRevertData({ data: null, cause: { data: "0xfd72c0a0" } }), "0xfd72c0a0");
});

test("a revert with no data gives an honest refresh hint, never a success message", () => {
  assert.equal(decodeContractError({ shortMessage: "execution reverted" }), undefined);
  const message = revertErrorMessage({ shortMessage: "execution reverted" });
  assert.match(message, /changed nothing on-chain/i);
  assert.ok(!/success/i.test(message));
});

test("non-revert errors fall through untouched (wallet rejection, network)", () => {
  const rejected = { code: 4001, message: "MetaMask - RPC Error: User rejected the request." };
  assert.equal(revertErrorMessage(rejected), undefined);
  assert.equal(revertErrorMessage(new Error("Failed to fetch")), undefined);
  assert.equal(decodeContractError(new Error("Failed to fetch")), undefined);
});

test("the decoded message is what the shared error formatter returns", () => {
  const message = revertErrorMessage({ code: 3, message: "execution reverted", data: "0xfd72c0a0" });
  assert.equal(message, CONTRACT_ERROR_MESSAGES.TradeAlreadySettled);
});
