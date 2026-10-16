import { useId } from "react";
import { revertErrorMessage } from "./revertErrors.js";

/* ---------------------------------------------------------------------------
   Shared presentation components.
   These are visual only: they render whatever the caller passes in and never
   fetch, mutate, or infer business state on their own.
   ------------------------------------------------------------------------- */

export function StatCard({ label, value, detail, tone, icon }) {
  return (
    <article className="flow-stat-card" data-tone={tone}>
      <div className="flow-stat-head">
        {icon && <span className="flow-stat-icon" aria-hidden="true">{icon}</span>}
        <span>{label}</span>
      </div>
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

export function StepProgress({ step, steps, label = "Publishing progress" }) {
  return (
    <ol className="flow-steps" aria-label={label}>
      {steps.map((text, index) => (
        <li className={index < step ? "complete" : index === step ? "active" : ""} key={text}>
          <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>{text}
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
    <button className="flow-wallet-chip" data-connected={address ? "true" : "false"} onClick={onConnect} type="button">
      <span className="flow-wallet-dot" aria-hidden="true" />
      <span>
        {address ? <>{role} · <AddressTag address={address} /></> : "Connect wallet"}
        {address && <small>{chainName} · {balance ?? "—"} ETH</small>}
      </span>
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
  // A contract revert (for example the deployed contract's
  // TradeAlreadySettled, data 0xfd72c0a0) is decoded first so the user is told
  // what the contract refused, instead of a bare selector or "execution
  // reverted". Anything that is not a revert falls through to the checks below.
  const revert = revertErrorMessage(error);
  if (revert) return revert;
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

export function EmptyState({ title, detail, action, icon = "☼" }) {
  return (
    <div className="flow-empty">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div className="flow-skeletons" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, index) => <i key={index} />)}
    </div>
  );
}

export function Panel({ eyebrow, title, actions, children }) {
  const hasHeading = Boolean(eyebrow || title || actions);
  return (
    <section className="flow-panel">
      {hasHeading && (
        <div className="flow-panel-heading">
          <div>
            {eyebrow && <span className="flow-eyebrow">{eyebrow}</span>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="flow-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageIntro({ eyebrow, title, detail }) {
  return (
    <section className="flow-page-intro">
      <span className="flow-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
    </section>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", label = "Search" }) {
  const id = useId();
  return (
    <div className="flow-search">
      <label className="flow-visually-hidden" htmlFor={id}>{label}</label>
      <input id={id} type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function FilterGroup({ value, options, onChange, label }) {
  return (
    <div className="flow-filter" role="group" aria-label={label}>
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          type="button"
          className={optionValue === value ? "active" : ""}
          aria-pressed={optionValue === value}
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

export function SelectField({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div className="flow-inline-field">
      <label htmlFor={id}><span>{label}</span></label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </div>
  );
}

/* Grouped bar chart. `groups` is [{ label, values: number[] }]; the caller
   decides what each series means, so the chart never invents data. */
export function BarChart({ groups, ariaLabel }) {
  const max = Math.max(1, ...groups.flatMap((group) => group.values));
  return (
    <div>
      <div className="flow-bars" role="img" aria-label={ariaLabel}>
        {groups.map((group) => (
          <div key={group.label} title={`${group.label}: ${group.values.join(" / ")}`}>
            {group.values.map((value, index) => (
              <span key={index} style={{ height: `${Math.max(3, (value / max) * 100)}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flow-bars-axis" aria-hidden="true">
        {groups.map((group) => <span key={group.label}>{group.label}</span>)}
      </div>
    </div>
  );
}
