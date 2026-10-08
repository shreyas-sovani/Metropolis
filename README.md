# Lifeline

Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.

## Site

Production is [lifeline-five-murex.vercel.app](https://lifeline-five-murex.vercel.app).

| Route | Page |
|---|---|
| `/` | Landing page, with the live mainnet strip |
| `/radar` | Market risk |
| `/app` | Practice-account onboarding, then the dashboard |
| `/tour` | The 3-minute judge tour |
| `/developers` | Risk API docs and a live example |
| `/check` | Address check |
| `/a/[address]` | Risk report. Liquidation prices are dollars. |
| `/proof` | Twins, the mainnet replay, contract-exact, and saves |

`/lifeline` redirects to `/app`. `/judges` redirects to `/tour`.

## User stories

As a Perpl trader, I want my own idle AUSD to move into my position's margin when it gets close to liquidation, so I stop paying liquidation penalties while my money sits idle, and nobody, including Lifeline, can trade or withdraw my funds.

As a judge, I want to verify in three minutes that Lifeline is real: real mainnet risk data, a protection I trigger myself on chain, and proof that Lifeline's key cannot take funds. Then I want to find the evidence for each bounty without hunting.

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

`/health` returns 503 `{"status":"error","degraded":"..."}` when Durable Object storage rejects the call, including the free-tier rows-read cap. The keeper is down until a later `/health` succeeds. That request retries the schema migration and sets the alarm. The alarm stays at 2 seconds.

Keeper ticks read from memory. In-flight actions reload from SQLite every minute and the pool roster every 15 minutes, so the keeper reads about 150,000 rows a day against the free 5,000,000. The Worker caches `/health` for 5 seconds, but only while the last tick is under 10 seconds old, so a stalled alarm still gets re-armed. To bypass the cache:

```bash
curl -fsS -H "x-admin-secret: $ADMIN_SECRET" "https://lifeline.lifeline-shreyas.workers.dev/health?fresh=1"
```

Every hour the keeper deletes up to 100 settled actions older than 30 days and up to 100 sandbox hits older than 7 days. Pending actions, claims, and saves are kept.

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

The same map with the live links is at [/tour/evidence](https://lifeline-five-murex.vercel.app/tour/evidence).

| Bounty | Proof |
|---|---|
| Perpl API | [Developers](https://lifeline-five-murex.vercel.app/developers) |
| Perpl Analytics | [Market risk](https://lifeline-five-murex.vercel.app/radar) |
| Envio | [Liquidation history](https://lifeline-five-murex.vercel.app/api/liquidations) |
| Privy | [Protect a position](https://lifeline-five-murex.vercel.app/app) |
| Track 1 | [Twins](https://lifeline-five-murex.vercel.app/twins) |

A stored replay of a real mainnet Bitcoin liquidation is at [/replay](https://lifeline-five-murex.vercel.app/replay). The page reads `apps/web/data/mainnet-replay.json` and does not call an archive node.
