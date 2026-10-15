export function StatCard({ label, value, detail }) {
  return (
    <article className="flow-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export function StatusBadge({ status }) {
  const normalizedStatus = String(status ?? "pending").toLowerCase();
  const label = normalizedStatus === "sold_out" ? "Sold out" : normalizedStatus.replaceAll("_", " ");
  return <span className={`flow-status flow-status-${normalizedStatus}`}>{label}</span>;
}

export function StepProgress({ step, steps }) {
  return (
    <ol className="flow-steps" aria-label="Offer publishing progress">
      {steps.map((label, index) => (
        <li className={index < step ? "complete" : index === step ? "active" : ""} key={label}>
          <span>{index < step ? "✓" : index + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

export function TxLink({ hash, label = "View transaction" }) {
  if (!hash) return <span className="flow-muted">No transaction yet</span>;
  return (
    <span className="flow-tx-link">
      <a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
        {label} · {hash.slice(0, 8)}…{hash.slice(-6)}
      </a>
      <button type="button" aria-label="Copy transaction hash" onClick={() => navigator.clipboard?.writeText(hash).catch(() => {})}>
        Copy
      </button>
    </span>
  );
}

export function AddressTag({ address }) {
  if (!address) return <span className="flow-muted">—</span>;
  return <code className="flow-address" title={address}>{address.slice(0, 6)}…{address.slice(-4)}</code>;
}

export function WalletChip({ role, address, chainName, balance, onConnect }) {
  return (
    <button className="flow-wallet-chip" onClick={onConnect} type="button">
      <span className="flow-wallet-dot" />
      <span>{role}: {address ? <AddressTag address={address} /> : "Connect wallet"}</span>
      {address && <small>{chainName} · {balance ?? "—"} ETH</small>}
    </button>
  );
}

export function Toast({ message, onDismiss, error = false }) {
  if (!message) return null;
  const isError = error || /^(❌|error:)/i.test(message);
  return (
    <div className={isError ? "flow-toast flow-error" : "flow-toast"} role={isError ? "alert" : "status"}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

export function userErrorMessage(error) {
  const message = error?.shortMessage || error?.message || String(error);
  if (/user rejected|user denied|rejected the request|4001/i.test(message)) return "The request was cancelled in MetaMask.";
  if (/switch.*sepolia|chain.?id|wrong network/i.test(message)) return "Switch MetaMask to Sepolia and try again.";
  if (/insufficient funds|not enough eth/i.test(message)) return "This wallet needs more Sepolia ETH for the transaction and gas.";
  if (/not registered|incompatible role/i.test(message)) return "This wallet does not have the required on-chain role.";
  if (/wallet does not match|wrong wallet|does not control|must match the wallet|connect the buyer|connect a seller/i.test(message)) return "The connected wallet does not match the buyer or seller for this transaction.";
  if (/does not match|does not contain the expected|not settled for this buyer/i.test(message)) return "The blockchain record did not match this listing, so nothing was saved. Refresh the page and try again.";
  if (/payment|value|price/i.test(message)) return "The payment does not match the on-chain offer. Refresh and try again.";
  return message;
}

export function EmptyState({ title, detail, action }) {
  return (
    <div className="flow-empty">
      <span aria-hidden="true">☼</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="flow-skeletons" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <i key={index} />)}
    </div>
  );
}
