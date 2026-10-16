/* ---------------------------------------------------------------------------
   Revert decoding for the SolarShare contract.

   `contractClient.js` declares only the functions and events the app calls, so a
   contract revert reaches the UI as a bare 4-byte selector, for example:

     MetaMask - RPC Error: execution reverted   { code: 3, data: "0xfd72c0a0" }

   This module adds the errors declared by contracts/contracts/SolarShare.sol for
   decoding only, so a failed call can be explained instead of hidden. It makes no
   chain calls, changes nothing, holds no key, and every message it produces says
   that the call failed and nothing was written.
   --------------------------------------------------------------------------- */
import { decodeErrorResult, parseAbi } from "viem";

/** The custom errors declared by contracts/contracts/SolarShare.sol. */
export const contractErrorAbi = parseAbi([
  "error InvalidRole()",
  "error AlreadyRegistered()",
  "error NotRegistered()",
  "error NotProsumer()",
  "error NotConsumer()",
  "error InvalidAmount()",
  "error OfferUnavailable()",
  "error CannotBuyOwnOffer()",
  "error IncorrectPayment()",
  "error NotSeller()",
  "error NotBuyer()",
  "error TradeAlreadySettled()",
  "error TransferFailed()",
  "error OfferAlreadyMatched()"
]);

/** Standard Solidity reverts, so `require`-style and panic reverts also decode. */
const standardErrorAbi = [
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] }
];

const decodeAbi = [...contractErrorAbi, ...standardErrorAbi];

/** What each contract error means for the wallet looking at the screen. */
export const CONTRACT_ERROR_MESSAGES = {
  TradeAlreadySettled:
    "This trade is already settled on the blockchain, so the contract rejected the repeat settlement. The escrowed ETH was released to the seller by that earlier settlement — only the marketplace ledger has not recorded it yet.",
  NotSeller: "Only the seller of this trade can settle it, and only by signing with the seller's own wallet.",
  NotBuyer: "This wallet is not the buyer of this trade.",
  OfferUnavailable: "The contract has no such trade or offer, so there is nothing to settle here.",
  NotRegistered: "This wallet is not registered with the SolarShare contract.",
  NotProsumer: "This wallet is not registered as a prosumer (seller) on the contract.",
  NotConsumer: "This wallet is not registered as a consumer (buyer) on the contract.",
  InvalidRole: "The contract rejected this participant role.",
  AlreadyRegistered: "This wallet is already registered with the SolarShare contract.",
  InvalidAmount: "The contract rejected this amount: an offer needs a whole positive kWh count and a rate above zero.",
  CannotBuyOwnOffer: "The seller of an offer cannot buy it back.",
  IncorrectPayment: "The ETH sent did not match the on-chain price, so the purchase was rejected.",
  TransferFailed: "The contract could not release the escrowed ETH to the seller.",
  OfferAlreadyMatched: "This offer is already matched or settled, so its price can no longer change."
};

const HEX_DATA = /^0x[0-9a-fA-F]{8,}$/;

/**
 * Pull the raw revert data out of whichever shape the provider produced.
 * MetaMask reports `{ code: 3, data }`, viem keeps the raw bytes on `raw` and
 * the undecodable selector on `signature`, and both nest the provider error
 * under `cause` or `info.error`.
 */
export function extractRevertData(error) {
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth += 1) {
    for (const value of [current.data, current.raw, current.signature, current.info?.error?.data, current.originalError?.data]) {
      if (typeof value === "string" && HEX_DATA.test(value)) return value;
    }
    current = current.cause ?? current.error ?? undefined;
  }
  return undefined;
}

function standardMessage(name, args) {
  if (name === "Error") return `The contract rejected this call: ${args[0]}.`;
  if (name === "Panic") return `The contract hit an internal error (panic code ${args[0]}) and changed nothing.`;
  return undefined;
}

/**
 * Decode a contract revert.
 * @returns {{name?: string, selector: string, message: string, data: string}|undefined}
 *          `undefined` when the error carries no revert data at all.
 */
export function decodeContractError(error) {
  const data = extractRevertData(error);
  if (!data) return undefined;
  const selector = data.slice(0, 10);
  try {
    const decoded = decodeErrorResult({ abi: decodeAbi, data });
    const name = decoded.errorName;
    const args = decoded.args ?? [];
    return {
      name,
      selector,
      data,
      message:
        CONTRACT_ERROR_MESSAGES[name] ??
        standardMessage(name, args) ??
        `The contract rejected this call (${name}).`
    };
  } catch {
    // Unknown selector: report it instead of inventing a reason.
    return {
      name: undefined,
      selector,
      data,
      message: `The contract rejected this call (revert data ${data}).`
    };
  }
}

/**
 * A user-facing message for a failed contract call, or `undefined` when the error
 * is not a contract revert, so the caller can keep its own handling (a wallet
 * rejection, a network problem, and so on).
 */
export function revertErrorMessage(error) {
  const decoded = decodeContractError(error);
  if (decoded) return decoded.message;
  const message = error?.shortMessage || error?.message || "";
  if (/execution reverted/i.test(message)) {
    return "The contract rejected this call and changed nothing on-chain. Refresh the page — the on-chain state no longer matches what is shown here.";
  }
  return undefined;
}
