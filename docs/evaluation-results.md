# Evaluation Results

## Matching Benchmark (Query Performance)

Date: 2026-10-14

### Setup
- MongoDB Atlas (M0 sandbox)
- Node.js v24.10.0
- 100 trade requests per test
- 50 offers fetched per matching run (limit)

### Results

| Dataset | Query Time | Match Logic | Total | Matches |
|---------|-----------|-------------|-------|---------|
| 1k offers, 100 requests | 26.98ms | 0.15ms | 27.13ms | 86 |
| 10k offers, 100 requests | 41.31ms | 0.12ms | 41.43ms | 98 |

### Analysis
- Query time scales with dataset size (27ms → 41ms for 10x data)
- Match logic is O(offers × requests) but with small constants (sub-millisecond)
- Compound index on `{status, pricePerKWh, createdAt}` enables efficient sorted queries
- `.lean()` and projections reduce memory overhead

### In-Chain Settlement Cost
- Each on-chain settlement (createOffer + purchaseEnergy + settleTrade) takes ~40s
- Gas cost per settlement: ~0.0002 ETH
- Multi-seller aggregation: N fills = N × 40s (not atomic, sequential)
