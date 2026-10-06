# Lifeline

Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.

## Risk API

`GET /api/v1/risk/:address?chain=143|10143` returns the contract-exact liquidation price, distance, free balance, Lifeline dry run, and the penalty at stake. CORS is open. The limit is 60 requests a minute per IP.

```bash
curl "$ORIGIN/api/v1/risk/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143"
```

The same liquidation price and distance are on `/api/account/:address` for that address.
