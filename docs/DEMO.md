# SolarShare Demo Script

## Prerequisites

- Backend running on port 3000
- Frontend running on http://localhost:5173
- MetaMask connected to Sepolia testnet
- Two wallets funded with Sepolia ETH (buyer + seller)

---

## Step-by-Step Demo

### 1. Landing Page

1. Open http://localhost:5173
2. **See:** Logo, pitch, "Sell energy" / "Buy energy" buttons, chain status badge
3. **Verify:** Chain status shows "Sepolia · RPC OK · Contract deployed"
4. Click **"Sell energy"** → should navigate to `/seller`

### 2. Connect Seller Wallet

1. Click **"Connect wallet"** (top right)
2. MetaMask prompts → select seller account → approve
3. **Verify:** Wallet chip shows seller address, "Sepolia", balance
4. If wallet is not registered as Prosumer, see onboarding banner
5. Click **"Register as Prosumer on Sepolia"** → confirm in MetaMask
6. **Verify:** Banner disappears, lands on `/seller`

### 3. Seller Publishes an Offer

1. On `/seller`, see: overview cards (generation, consumption, surplus, open offers, earned)
2. In **"Sell your solar surplus"** panel:
   - Enter `5` in "Available energy (whole kWh)"
   - Enter `5.25` in "Marketplace rate (₹ / kWh)"
   - See wei preview update live
3. Click **"Publish on Sepolia"**
4. **Step progress shows:** Confirm in wallet → Creating on-chain → Registering → Live
5. MetaMask prompts → confirm `createOffer` transaction
6. **Verify:** Success toast appears, offer appears in "My offers" table with on-chain offer ID and Etherscan link

### 4. Seller Publishes a Second Offer

1. Enter `3` kWh @ `₹4.80`
2. Click **"Publish on Sepolia"** → confirm in MetaMask
3. **Verify:** BOTH offers appear in "My offers" table

### 5. Switch to Buyer Wallet

1. In MetaMask, switch to buyer account
2. **Verify:** Header updates to show buyer address
3. If wallet is not registered as Consumer, see onboarding banner
4. Click **"Register as Consumer on Sepolia"** → confirm in MetaMask

### 6. Buyer Submits Energy Request

1. Navigate to `/buyer` (or click "Buy energy")
2. See: overview cards (open requests, kWh bought, total spent, avg price)
3. In **"Request energy"** panel:
   - Enter `7` in "Energy needed (whole kWh)"
   - Enter `6.00` in "Maximum rate (₹ / kWh)`
4. **See fill preview:** Produced by the matcher itself — the listings it would buy, kWh from each, average matched rate, matched value, and the ETH the contract would escrow
5. If supply < requested, see warning: "Only X of 7 kWh is currently available at this price"
6. Click **"Submit matched request"**
7. **Verify:** Success toast: "Request accepted. The backend signs purchaseEnergy with BUYER_PRIVATE_KEY; each registered seller signs settlement."
8. **Verify:** Request appears in "Requests and fills" with status `partially_filled` or `filled`
9. **Verify:** Each fill shows status `purchased` (NOT `settled`)

### 7. Verify No Premature Settlement

1. Navigate to `/ledger` (Smart Grid Ledger)
2. **Verify:** The pending purchase does NOT appear here (only settled trades with confirmed receipts appear)
3. Navigate to `/buyer` → "Requests and fills"
4. **Verify:** Fill status is `purchased` (escrowed), NOT `settled`

### 8. Seller Settles Trade

1. Switch MetaMask back to **seller** account
2. Navigate to `/seller`
3. In **"Awaiting seller settlement"** panel, see the incoming purchase
4. **Verify:** Shows buyer address, kWh, value, trade ID, purchase tx link
5. Click **"Settle"** button
6. MetaMask prompts → confirm `settleTrade` transaction
7. **Verify:** Success toast: "Trade settled on-chain! Funds released to seller."
8. **Verify:** Settlement appears in "Earnings history" with settlement tx link

### 9. Verify Settlement in Ledger

1. Navigate to `/ledger`
2. **Verify:** Settled trade appears with seller, buyer, energy, value, purchase tx, settlement tx
3. Both tx links open Sepolia Etherscan

### 10. Direct Purchase (MetaMask Buyer)

1. Switch to buyer account
2. Navigate to `/buyer`
3. In **"On-chain offers"** panel, see open offers sorted by price (cheapest first)
4. Click **"Buy On-Chain"** on an offer
5. MetaMask prompts → confirm `purchaseEnergy` with ETH value
6. **Verify:** Trade appears in "Purchase history" with status `purchased` (not settled)

---

## Who Signs What

| Step | Signed By | Mechanism |
|------|-----------|-----------|
| Seller registers as Prosumer | Seller MetaMask | `registerParticipant(1)` |
| Seller creates offer | Seller MetaMask | `createOffer(kWh, price)` |
| Buyer registers as Consumer | Buyer MetaMask | `registerParticipant(2)` |
| Buyer submits request | N/A (off-chain) | `POST /trades` |
| Matching purchase | Backend `BUYER_PRIVATE_KEY` | `purchaseEnergy(offerId, kWh)` |
| Seller settlement | Seller MetaMask | `settleTrade(tradeId)` |
| Direct buyer purchase | Buyer MetaMask | `purchaseEnergy(offerId, kWh)` |

---

## Error Scenarios to Demo

| Scenario | Expected Message |
|----------|-----------------|
| Wrong network | "Switch MetaMask to Sepolia and try again." |
| Not registered | "This wallet is not registered as a Prosumer." |
| Insufficient ETH | "This wallet needs more Sepolia ETH for the transaction and gas." |
| User rejects MetaMask | "The request was cancelled in MetaMask." |
| Short supply | "Only X of Y kWh is currently available at this price." |
| Buyer tries to settle | "Only the seller can settle this trade" |
| Unmatched request | Stays as "open" or "partially_filled", never shows in Ledger |

---

## Key Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing page with role selection |
| `/seller` | Seller workspace (overview, publish, offers, settle) |
| `/buyer` | Buyer workspace (overview, request, fills, purchase, history) |
| `/market` | Read-only offer browsing |
| `/ledger` | Settled trades with tx links |
| `/news` | Activity feed + announcements |
