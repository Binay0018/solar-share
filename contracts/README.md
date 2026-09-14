# SolarShare Contracts

Hardhat v3 project using Ignition for deployment and Viem-compatible tooling.

```bash
npm install
npm run build
npm test
npm run node
npm run deploy:local
```

The contract uses native ETH as the settlement currency. Prices are integer wei per kWh, payments are held by the contract during a pending trade, and the registered seller finalizes the trade with `settleTrade`.

Buyer/request matching is intentionally off-chain for this prototype. The backend matching engine will choose compatible offers and requests, then the buyer confirms `purchaseEnergy` and the seller settles the resulting trade.

Sepolia deployment values are provided through Hardhat configuration variables. Do not commit secrets.
