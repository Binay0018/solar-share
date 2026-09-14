# Phase 7 Integration Run

The integration runner is `iot-simulator/npm run day`. It posts 24 simulated hours for each configured user to the live backend. Deficit readings also create trade requests, so the run exercises meter ingestion, automatic offer creation, request creation, matching, and persistence.

## Run

```powershell
Push-Location backend; npm start; Pop-Location
Push-Location iot-simulator; npm run day; Pop-Location
```

## Recorded Run

Date: 2026-09-07

- MongoDB connection: connected
- Users: 2
- Simulated hours: 24
- Meter readings: 48
- Offers created: 18
- Trade requests created: 30
- Match attempts: 4,329
- Matching failures: 4,329
- Settled transactions: 0

The matching path ran and persisted its attempts, but on-chain settlement was not completed because `CONTRACT_ADDRESS` was not configured for the backend. The buyer/seller wallet keys and deployed contract offer IDs must be configured before rerunning the day to measure successful settlements. No transaction result is claimed from this run.
