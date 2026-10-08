# Lifeline

Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.

## Site

Production is [lifeline-five-murex.vercel.app](https://lifeline-five-murex.vercel.app). It serves the product through the V7 agent pass. The real Privy guest run is still open.

| Route | Page |
|---|---|
| `/` | Landing page, with the live mainnet strip |
| `/radar` | Market risk |
| `/check` | Address check |
| `/a/[address]` | Risk report. Liquidation prices are dollars. |
| `/app` | Practice-account onboarding. The dashboard is V8. |

## Risk API

`GET /api/v1/risk/:address?chain=143|10143` returns the contract-exact liquidation price, distance, free balance, Lifeline dry run, and the penalty at stake. CORS is open. The limit is 60 requests a minute per IP.

```bash
curl "$ORIGIN/api/v1/risk/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143"
```

The same liquidation price and distance are on `/api/account/:address` for that address.

## Operations

Run these from the repo root. Role keys stay in `secrets/testnet-keys.env`. Service tokens stay in `secrets/services.env`.

### Status

```bash
pnpm cli status
curl -fsS https://lifeline.lifeline-shreyas.workers.dev/health
```

`budget ok` means the sponsor still covers the 31.1400 MON judging budget. A `LOW:` line means a floor was missed. `degraded:false` and `ticksLast10m` near 300 means the keeper alarm is healthy. `poolAvailable` is the claimable inventory. `armed`, `lastBlock`, and `claimsToday` are on `/health`. `low:true` means the sponsor is under 3 MON, the operator is under 1 MON, fewer than 10 accounts are available, or fewer than 5 are in the demo band. After the 10 MON top-up on 2026-10-08, `status` printed `budget ok` and ops run 37722089588 was green.

`/health` returns 503 `{"status":"error","degraded":"..."}` when Durable Object storage rejects the call, including the free-tier rows-read cap. The keeper is down until a later `/health` succeeds. That request retries the schema migration and sets the alarm. The alarm stays at 2 seconds. Keeper ticks read from memory and refresh SQLite at most once a minute.

### Refill the pool

```bash
pnpm cli pool:refill --target 30 --per-side 12 --in-band 10
pnpm cli pool:register
```

The refill creates testnet BTC accounts until those three counts are met, then registers them. A second run that prints `pool:refill nothing new` sent no transactions.

### Top up MON and AUSD

```bash
pnpm cli fund:mon
pnpm cli faucet:ausd
```

`fund:mon` brings each role up to its MON target from the sponsor and will not spend the sponsor through its floor. `faucet:ausd` loops the testnet faucet until the AUSD targets are met. If `status` prints `budget short`, fund the sponsor address from a testnet faucet before either command.

### Kill switch

Reads keep working. Operator sends stop.

```bash
cd apps/worker
printf 'true' | pnpm exec wrangler secret put LIFELINE_PAUSED
curl -fsS -X POST -H "x-admin-secret: $ADMIN_SECRET" https://lifeline.lifeline-shreyas.workers.dev/admin/alarm/clear
sleep 20
curl -fsS https://lifeline.lifeline-shreyas.workers.dev/health
printf 'false' | pnpm exec wrangler secret put LIFELINE_PAUSED
curl -fsS -X POST -H "x-admin-secret: $ADMIN_SECRET" https://lifeline.lifeline-shreyas.workers.dev/admin/alarm/clear
sleep 20
curl -fsS https://lifeline.lifeline-shreyas.workers.dev/health
```

Set `ADMIN_SECRET` from `secrets/services.env` in the shell first. Do not print it. The alarm clear is what makes the running keeper load the new secret. `/health` shows `paused:true` while the switch is on. Keep `LIFELINE_PAUSED=false` in `secrets/services.env` so a later `pnpm cli secrets:sync-worker` does not turn the switch back on.

### Rotate a compromised testnet key

1. Generate a replacement key offline and record only its address.
2. From the pool owner, `addOperator` that address on every live pool and twin proxy, then revoke the old operator.
3. Replace `OPERATOR_PK` in `secrets/testnet-keys.env`.
4. Run `pnpm cli secrets:sync-worker` from the repo root.

The old key should no longer satisfy `operator()` on those proxies. Do not commit the key file.

### Node keeper

`apps/node-keeper` is not in this build. Until that standby exists, failover is the kill switch above: pause the Worker, then unpause it when the alarm should resume.

### Testnet reset

A testnet reset is config only. No new contracts are deployed.

1. Replace the testnet addresses in `packages/core/src/config/addresses.ts`.
2. `pnpm --filter @lifeline/core build`
3. `pnpm --filter @lifeline/worker exec wrangler deploy`
4. `pnpm cli pool:create` and `pnpm cli pool:register` for the new exchange.

The mainnet addresses stay as they are. The web app reads them from the same config on its next deploy.

## Bounty map

The same map with the live links is at [/judges](https://lifeline-five-murex.vercel.app/judges).

| Bounty | Proof |
|---|---|
| Perpl API | [Risk response](https://lifeline-five-murex.vercel.app/api/v1/risk/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143) |
| Perpl Analytics | [Radar](https://lifeline-five-murex.vercel.app/) and [methodology](https://lifeline-five-murex.vercel.app/methodology) |
| Envio | [Liquidation history](https://lifeline-five-murex.vercel.app/api/liquidations) |
| Privy | [Guest acceptOwnership](https://testnet.monadexplorer.com/tx/0xaa32f3a1aeace9c5582de8f31ec49499af4673fd6d89762de88cc50b10f73dac) |
| Track 1 | [Top-up](https://testnet.monadexplorer.com/tx/0xf322eed96f2f1460cc6477b3037ce2a7cfd56d3a31198242712d236644099d85) |

A stored replay of a real mainnet Bitcoin liquidation is at [/replay](https://lifeline-five-murex.vercel.app/replay). The page reads `apps/web/data/mainnet-replay.json` and does not call an archive node.
