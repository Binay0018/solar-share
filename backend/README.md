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
DEFAULT_OFFER_PRICE_WEI=1
CONTRACT_ADDRESS=
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
- `GET /transactions` - settlement history

Without `MONGODB_URI`, the health endpoint remains available for local smoke tests, while database-backed routes require a MongoDB connection.

When compatible open offers and requests exist, matching attempts are recorded in `MatchLog`. Live settlement requires the configured buyer and seller keys to control the corresponding wallet addresses and requires an on-chain offer ID. Missing chain configuration is recorded as a failed match rather than silently settling off-chain.
