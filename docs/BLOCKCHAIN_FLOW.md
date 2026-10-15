# SolarShare Blockchain Flow

## Verified deployment

- Network: Sepolia (`11155111`)
- Contract: `0xd5332E490e251813702bf461CAfED84FF3d0319C`
- The frontend gets the contract address from `VITE_CONTRACT_ADDRESS`; the backend uses `CONTRACT_ADDRESS`. Keep them pointed at the same deployment.
- The contract is the source of truth for registration, offers, escrow, and settlement. MongoDB mirrors marketplace data and transaction hashes for fast UI reads.

## Actors and signing

- **Seller:** registers on-chain with the Prosumer role (1) or Both (3), creates offers with `createOffer`, and releases escrow with `settleTrade`. MetaMask signs the marketplace path.
- **Buyer:** registers with the Consumer role (2) or Both (3), and signs `purchaseEnergy` with MetaMask, attaching the exact ETH payment.
- **Backend-assisted matching:** the backend uses `BUYER_PRIVATE_KEY` to purchase and requires `SELLER_PRIVATE_KEY` to control each matched offer. Matching does not settle; the seller still needs to sign settlement.
- **Backend:** reads and verifies Sepolia receipts/events, then mirrors confirmed purchases and settlements in MongoDB. The API keys are only used by backend-assisted matching and must never be committed or logged.

## Create offer → purchase → settle

```mermaid
sequenceDiagram
    actor Seller as Seller MetaMask
    actor Buyer as Buyer MetaMask
    participant UI as SolarShare UI
    participant API as Backend API
    participant DB as MongoDB
    participant Chain as SolarShare on Sepolia

    Seller->>UI: Connect wallet and publish kWh / rate
    UI->>Chain: registerParticipant(Prosumer) if needed
    UI->>Chain: createOffer(kWh, rate in integer wei)
    Chain-->>UI: Successful receipt + OfferCreated(offerId)
    UI->>API: POST /offers with onChainOfferId
    API->>Chain: Verify offer seller, price, and remaining kWh
    API->>DB: Save verified offer mirror

    Buyer->>UI: Connect wallet and select on-chain offer
    UI->>Chain: Read offer and verify seller, price, availability
    UI->>Chain: registerParticipant(Consumer) if needed
    UI->>Chain: purchaseEnergy(offerId, kWh) with exact msg.value
    Chain-->>UI: Successful receipt + TradePurchased(tradeId)
    UI->>API: POST /transactions/confirm-purchase
    API->>Chain: Verify receipt, sender, event, value, offer and pending trade
    API->>DB: Save pending transaction and update offer mirror

    Seller->>UI: Connect the offer's seller wallet
    UI->>Chain: settleTrade(tradeId)
    Chain-->>UI: Successful receipt + TradeSettled
    UI->>API: POST /transactions/confirm-settlement
    API->>Chain: Verify seller, receipt, event and settled trade
    API->>DB: Mark transaction and request fill settled
    UI-->>Seller: Show settlement; link to Sepolia Etherscan
```

## Verified contract rules

- `purchaseEnergy(offerId, kWh)` permits a partial purchase when the offer has enough remaining kWh.
- The buyer cannot purchase their own offer. Quantity must be positive and the payment must equal `kWh × pricePerKWh` exactly.
- Purchase creates a pending trade and escrows ETH. Only the offer's registered seller can settle it.
- There is no cancel or refund function for a pending trade.
- Rates are converted to integer contract units using 10 decimal places. Chain values and `msg.value` are integer `bigint` values; UI rate/ledger presentation uses decimal numbers.

## Off-chain matching path

`POST /trades` accepts a positive whole-kWh request only when its `buyerId` equals the address controlled by `BUYER_PRIVATE_KEY`. The matcher selects open offers by lowest price and then creation time, and only matches offers whose seller address is controlled by `SELLER_PRIVATE_KEY`. It atomically claims the MongoDB quantity before calling the chain, then reconciles availability from the chain. Each successful fill is a separate purchase and remains pending until that seller settles. The API initially returns the request; matching runs asynchronously.

The separate direct marketplace path is not restricted to the backend's buyer key: the connected MetaMask buyer purchases directly. Both paths require the seller wallet to settle the on-chain trade.

## Invariants and safeguards

1. Chain payments use integer units and must exactly equal quantity multiplied by the contract rate.
2. State-changing calls wait for a successful receipt. Backend confirmation endpoints independently verify the transaction, emitted event, and current chain state before updating MongoDB.
3. A MetaMask offer mirror is created only after `createOffer` succeeds and the backend verifies the on-chain offer ID, seller, price, and availability.
4. The direct buyer flow checks the on-chain seller, price, and availability before purchase. The backend derives the mirrored rate and total from verified chain values.
5. Backend matching claims offer quantity atomically and restores or reconciles the claim when a purchase fails.
6. Private keys belong only in local backend environment configuration. Never commit `.env` files or log key material.
7. UI ledger, activity, and metrics treat a transaction as settled only after settlement confirmation; pending trades are separately shown to the buyer and seller.

## Limitations and demo risks

- Purchased ETH remains escrowed indefinitely until the seller settles; there is no refund or cancellation path.
- Settlement requires the offer's actual seller wallet. A different `SELLER_PRIVATE_KEY` cannot settle MetaMask-created offers.
- Multi-seller matching is a series of separate chain purchases, not an atomic batch. Some fills may succeed while later fills fail.
- Backend-assisted matching works only when the configured keys control the requested buyer and matched seller wallets. Those wallets also need Sepolia ETH for gas and buyer purchase value.
- IoT meter readings and non-wallet offers are MongoDB-only. The direct marketplace purchase button requires an on-chain offer ID. Backend-assisted matching can create a chain offer for an off-chain listing only when its seller address is the wallet controlled by `SELLER_PRIVATE_KEY`.
- An on-chain purchase may succeed even if the subsequent API/MongoDB sync fails. Preserve its transaction hash; retrying confirmation is idempotent by purchase hash.
- Contract transactions cost Sepolia gas and require the configured RPC and frontend/backend contract addresses to refer to the same deployment.
