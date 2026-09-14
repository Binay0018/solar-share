# Evaluation Results

## Measurement

The backend `GET /metrics` endpoint aggregates persisted offers, match logs, and
transactions. Buyer savings use `BASELINE_RATE_PER_KWH`, which defaults to
`7.5` currency units per kWh and can be overridden through the environment.
On-chain gas is calculated from Viem receipt fields (`gasUsed` multiplied by
`effectiveGasPrice`) for `purchaseEnergy` and `settleTrade`; simulated ledger
transactions have no gas receipt and are excluded from those totals.

## Current Validation State

The repository currently has no MongoDB fixture or recorded local Hardhat /
Sepolia integration run, so real Phase 8 aggregate numbers are intentionally
not claimed here. The contract regression suite completed with 4 passing tests,
including the negotiated open-offer price update. A MongoDB-backed simulator run
must populate this table before Phase 8 is marked complete.

| Metric                    | Result                    |
| ------------------------- | ------------------------- |
| Transaction latency       | Pending integration run   |
| `purchaseEnergy` gas      | Pending on-chain receipts |
| `settleTrade` gas         | Pending on-chain receipts |
| Matching success rate     | Pending integration run   |
| Total kWh traded          | Pending integration run   |
| Buyer savings vs baseline | Pending integration run   |
| Seller revenue            | Pending integration run   |
