# SolarShare

SolarShare is an academic prototype for peer-to-peer solar energy trading. Households with surplus photovoltaic generation can offer energy to nearby consumers with unmet demand.

This repository connects four layers:

- IoT simulation: synthetic hourly generation and consumption readings
- Matching engine: rule-based off-chain offer/request matching
- Blockchain settlement: Solidity contract deployed with Hardhat Ignition
- Web marketplace: React dashboard backed by an Express API and MongoDB

This is a classroom/demo system, not production trading infrastructure.

## Repository Layout

- `contracts/` - Hardhat v3, Solidity, Ignition, and Viem
- `backend/` - Express API, Mongoose models, matching, and contract services
- `frontend/` - React + Vite dashboards
- `iot-simulator/` - synthetic meter data generator
- `docs/` - evaluation notes and supplied project documentation

## Phase Status

| Phase | Scope                                           | Status   |
| ----- | ----------------------------------------------- | -------- |
| 1     | Repository and project scaffolding              | Complete |
| 2     | SolarShare contract, tests, and Ignition module | Complete |
| 3     | Synthetic IoT meter simulator                   | Complete |
| 4     | Express API and MongoDB persistence             | Complete |
| 5     | Rule-based matching and settlement service      | Complete |
| 6     | Prosumer and consumer dashboards                | Complete |
| 7     | Full-stack integration test                     | Partial  |
| 8     | Metrics and evaluation write-up                 | Planned  |

Phases are documented here for the complete project plan. The status table is intentionally factual: later phases should not be marked complete until their code and validation exist.

## Technology Decisions

- Solidity and Hardhat v3 are used for the contract project.
- Hardhat Ignition is used for deployment; `hardhat-deploy` is not used.
- Viem is used for contract interaction; `ethers.js` is not used.
- Native ETH is the Phase 2 settlement currency. Prices are integer wei per kWh, payment is held by the contract during a pending trade, and the registered seller settles the trade.
- Matching and requests remain off-chain. The backend will select compatible offers and requests, then the buyer confirms `purchaseEnergy` and the seller calls `settleTrade`.
- The frontend and simulator communicate with the backend over REST. The integration phase will use polling unless a later decision documents WebSockets.
- Secrets use Hardhat configuration variables or local environment files. Secrets must never be committed.

## Data Model

The planned off-chain MongoDB model uses these entities:

- `User`: wallet address, role (`prosumer`, `consumer`, or `both`), and name
- `MeterReading`: user, timestamp, generation kWh, consumption kWh, and derived surplus kWh
- `EnergyOffer`: seller, available kWh, price per kWh, status, and creation time
- `TradeRequest`: buyer, required kWh, maximum price per kWh, and status
- `Transaction`: offer, request, traded kWh, total price, transaction hash, and settlement time
- `MatchLog`: match attempts, outcome, reason, and evaluation metadata

## Quick Start

Install each project independently:

```powershell
Push-Location contracts; npm install; Pop-Location
Push-Location backend; npm install; Pop-Location
Push-Location frontend; npm install; Pop-Location
```

Run the Phase 1 services:

```powershell
Push-Location backend; npm start; Pop-Location
Push-Location frontend; npm run dev; Pop-Location
Push-Location iot-simulator; npm run once; Pop-Location
```

The simulator posts to `http://localhost:3000/meter-readings` by default. Configure `MONGODB_URI` before starting the backend to persist readings and automatically create offers.

## Contracts

From `contracts/`:

```powershell
npm run build
npm test
npm run deploy:local
```

The local tests cover participant registration, offer creation, ETH-funded purchase, seller-only settlement, incorrect payment rejection, and self-purchase rejection.

For Sepolia, configure `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` through Hardhat configuration variables, then deploy with:

```powershell
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npx hardhat ignition deploy --network sepolia ignition/modules/SolarShare.ts
```

Etherscan verification is a deployment follow-up and requires an `ETHERSCAN_API_KEY`. Never place that key in source control.

## IoT Simulator

From `iot-simulator/`:

```powershell
npm start
npm run once
```

Configuration is documented in [iot-simulator/README.md](iot-simulator/README.md). One interval represents one simulated hour; PV is zero overnight and peaks around midday, while household demand has morning and evening peaks.

## Backend API

The Phase 4 backend provides:

- `POST /meter-readings`
- `GET /meter-readings`
- `GET /offers` and `POST /offers`
- `GET /trades` and `POST /trades`
- `GET /transactions`
- `GET /health`

`POST /meter-readings` computes surplus on the server and creates an open offer when surplus is positive. Phase 5 matching runs when new offers or requests arrive, chooses earliest-open compatible offers, and records successful or failed attempts in `MatchLog`. Live Viem settlement requires configured buyer and seller wallet keys.

## Evaluation

Phase 6 provides responsive prosumer and consumer views with REST polling, MetaMask connection, loading/error/empty states, live trend visualization, and offer/request actions. Phase 8 will record transaction latency, gas cost by transaction type, matching success rate, total kWh traded, buyer savings, and seller revenue compared with a flat-rate baseline. Results belong in [docs/evaluation-results.md](docs/evaluation-results.md).

See each sub-project's README for local commands. Secrets belong in local configuration only; never commit `.env` files.

d42b3f08cf487296e9bdb72f7c4eadc2f052066dfe11b8402bbabedd8d3bfab6