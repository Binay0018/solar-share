# SolarShare Backend

Express API with Mongoose persistence for meter readings, users, offers, trade requests, transactions, match logs, and Viem-based settlement.

```bash
npm install
npm start
```

Set `MONGODB_URI` in a local `.env` file before starting the API:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/solarshare
PORT=3000
DEFAULT_OFFER_PRICE=5.25
BASELINE_RATE_PER_KWH=7.5
CONTRACT_ADDRESS=0xd5332E490e251813702bf461CAfED84FF3d0319C
SEPOLIA_RPC_URL=
BUYER_PRIVATE_KEY=
SELLER_PRIVATE_KEY=
```

Routes:

- `GET /health` - service and database status
- `POST /meter-readings` - stores a reading and creates an offer for positive surplus
- `GET /meter-readings` - latest readings
- `GET /offers`, `POST /offers` - marketplace offers; on-chain offers may include `onChainOfferId`
- `GET /trades`, `POST /trades` - consumer trade requests
- `GET /transactions` - on-chain purchases, including pending trades; only settled trades appear in the public activity and metrics totals
- `POST /transactions/confirm-purchase` - verifies a buyer-signed Sepolia purchase and mirrors it as pending
- `POST /transactions/confirm-settlement` - verifies a seller-signed Sepolia settlement and updates the ledger

The health endpoint remains available while MongoDB is connecting. It reports the database as `connecting`, `connected`, or `disconnected`. Database-backed routes return HTTP 503 with a retry message until MongoDB is connected, rather than surfacing Mongoose connection errors.

Marketplace purchases are signed directly by the connected buyer's MetaMask wallet. The offer must already have an on-chain offer ID; after purchase, the offer's registered seller must sign settlement from MetaMask to release escrow. A purchase can remain pending indefinitely because the contract has no refund or cancellation path.

Backend-assisted matching requires `BUYER_PRIVATE_KEY` to control the request's buyer address and `SELLER_PRIVATE_KEY` to control every matched seller address. It purchases on-chain and waits for the seller to settle; it does not settle automatically. Matching requests use whole kWh amounts. Missing chain configuration is recorded as a failed match rather than silently settling off-chain. Never commit `.env` or disclose private keys.
