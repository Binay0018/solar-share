import { useState } from "react";
import {
  contractAddress,
  decodeContractEvent,
  ensureSepoliaNetwork,
  findSettlementTxHash,
  getPublicClient,
  solarShareAbi,
  writeContractWithGas
} from "./contractClient.js";
import { decodeContractError } from "./revertErrors.js";
import { userErrorMessage } from "./FlowComponents.jsx";
import {
  clearPendingSettlementTx,
  postSettlementToLedger,
  rememberPendingSettlementTx,
  syncLedgerForTrade
} from "./ledgerSync.js";
import { normalizeAddress } from "./purchaseQueue.js";

export default function SettleButton({ trade, wallet, chainSettled = false, onComplete, onSettled, onSynced, onRecheckChain }) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // The chain read belongs to the Sell page, but a settlement can also be
  // discovered here (the contract answered TradeAlreadySettled, or a settlement
  // receipt could not be recorded). Keeping that locally flips this row to the
  // ledger-sync state immediately instead of offering a Settle call that reverts.
  const [localChainSettled, setLocalChainSettled] = useState(false);

  const tradeId = trade?.onChainTradeId;
  const hasTradeId = Number.isSafeInteger(tradeId);
  // A purchase is settled only once a settlement receipt is recorded or the chain
  // reports the trade settled. A confirmed purchase transaction is not a settlement.
  const ledgerSettled = Boolean(trade?.settledAt) || trade?.chainStatus === "settled";
  const settledOnChain = Boolean(chainSettled) || localChainSettled;
  const settled = ledgerSettled || settledOnChain;
  // The contract already settled this trade and released the funds; only the
  // marketplace ledger record is missing, so nothing can or should be signed.
  const needsLedgerSync = settledOnChain && !ledgerSettled;

  async function settle() {
    if (loading) return;
    if (!wallet) {
      onComplete?.("❌ Connect MetaMask wallet to settle this trade");
      return;
    }
    // Enforced here as well as in the Sell page: only the seller of this trade,
    // signing with their own MetaMask wallet, can reach settleTrade.
    if (!trade || normalizeAddress(trade.sellerId) !== normalizeAddress(wallet)) {
      onComplete?.("❌ Only the seller can settle this trade");
      return;
    }
    if (!hasTradeId) {
      onComplete?.("❌ This purchase has no on-chain trade ID to settle");
      return;
    }
    setLoading(true);
    try {
      await ensureSepoliaNetwork();

      // Simulate the settlement first. This is a read-only eth_call and never
      // opens MetaMask, so a call the contract would reject is explained instead
      // of being sent and failing. The authorization rules are unchanged: the
      // simulation runs as the connected seller and the real transaction below is
      // still signed by that same wallet.
      try {
        await getPublicClient().simulateContract({
          address: contractAddress,
          abi: solarShareAbi,
          functionName: "settleTrade",
          args: [BigInt(trade.onChainTradeId)],
          account: wallet
        });
      } catch (error) {
        const decoded = decodeContractError(error);
        if (decoded?.name === "TradeAlreadySettled") {
          // The chain already settled this trade; nothing is left to sign. The
          // ledger record can still be missing, which is what the sync action is for.
          setLocalChainSettled(true);
          onRecheckChain?.();
          onComplete?.(`ℹ️ ${decoded.message}`);
        } else {
          onComplete?.(`❌ ${decoded ? decoded.message : userErrorMessage(error)}`);
        }
        return;
      }

      onComplete?.("Confirm in MetaMask: settle the trade...");
      const hash = await writeContractWithGas(wallet, {
        address: contractAddress,
        abi: solarShareAbi,
        functionName: "settleTrade",
        args: [BigInt(trade.onChainTradeId)]
      });
      onComplete?.("Settlement transaction submitted. Waiting for confirmation...");
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Settlement transaction failed");

      // A receipt only counts when the contract itself emitted TradeSettled for
      // this trade. A purchase receipt, or any other transaction, cannot pass here.
      const settledEvent = decodeContractEvent(receipt, "TradeSettled");
      if (Number(settledEvent.tradeId) !== trade.onChainTradeId) {
        throw new Error("The confirmed transaction did not settle this trade");
      }

      // The trade is settled on-chain. Recording it in the ledger can still fail,
      // so the signed hash is kept for this trade and the seller is told plainly
      // that only the ledger record is missing. Nothing is signed or sent again.
      rememberPendingSettlementTx(trade.onChainTradeId, hash);
      try {
        await postSettlementToLedger(trade, hash);
      } catch (syncError) {
        setLocalChainSettled(true);
        onRecheckChain?.();
        onNoticeSettlementLag(userErrorMessage(syncError));
        return;
      }
      clearPendingSettlementTx(trade.onChainTradeId);
      onSettled?.(receipt);
      onComplete?.("✅ Trade settled on-chain! Funds released to seller.");
    } catch (error) {
      onComplete?.(`❌ ${userErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function onNoticeSettlementLag(detail) {
    onComplete?.(`⚠️ Settled on-chain, ledger sync failed: ${detail}. Click Sync ledger to retry.`);
  }

  /**
   * Record a settlement the contract already performed. This reuses the existing
   * backend endpoint, sends no transaction, and is a no-op when the ledger has
   * already recorded the settlement.
   */
  async function syncLedger() {
    if (syncing || !trade) return;
    if (ledgerSettled) return;
    if (normalizeAddress(trade.sellerId) !== normalizeAddress(wallet)) {
      onComplete?.("❌ Only the seller can synchronise this settlement");
      return;
    }
    setSyncing(true);
    try {
      await syncLedgerForTrade(trade, { findOnChain: findSettlementTxHash });
      onComplete?.("✅ The on-chain settlement is now recorded in the marketplace ledger.");
      onSynced?.();
    } catch (error) {
      onComplete?.(`❌ ${userErrorMessage(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  if (!trade) return null;

  const label = loading ? "Settling..." : ledgerSettled ? "Settled" : settledOnChain ? "Settled on-chain" : "Settle";
  const title = !hasTradeId
    ? "This purchase has no on-chain trade ID"
    : needsLedgerSync
      ? "The blockchain already settled this trade and released the funds; the marketplace ledger has not recorded that settlement yet"
      : settled
        ? "This trade is already settled on the blockchain"
        : "Settle this trade on the blockchain";
  const disabled = loading || settled || !hasTradeId;

  return (
    <span
      className="flow-settle-actions"
      data-tip={title}
      tabIndex={disabled ? 0 : -1}
      title={title}
      aria-label={title}
    >
      <button
        className="flow-primary"
        type="button"
        onClick={settle}
        disabled={disabled}
        aria-label={title}
        style={{ opacity: loading ? 0.7 : 1, fontWeight: "600", cursor: disabled ? "not-allowed" : "pointer" }}
      >
        {label}
      </button>
      {needsLedgerSync ? (
        <>
          <span className="flow-status" aria-hidden="true">Awaiting ledger sync</span>
          <button
            className="flow-secondary"
            type="button"
            onClick={syncLedger}
            disabled={syncing}
            aria-label={`Record the on-chain settlement of trade #${tradeId} in the marketplace ledger`}
            title="Ask the backend to record the settlement receipt it verifies on-chain. This sends no transaction."
          >
            {syncing ? "Syncing..." : "Sync ledger"}
          </button>
        </>
      ) : null}
    </span>
  );
}
