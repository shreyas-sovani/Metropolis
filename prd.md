# Lifeline: PRD

This is the build spec for Metropolis, Track 1 (Onchain Finance & Trading). The product is web only.

Four principles govern it:

- **Zero order-book liquidity at demo time.**
- **No Perpl web app or API on the critical path.** Only Monad RPC and Perpl's contracts.
- **$0.**
- **The smallest possible core.**

## 1. User and job

**Primary user.** A Perpl perps trader running leveraged, isolated-margin positions who keeps spare AUSD in their Perpl account. Perpl never uses that spare balance to save a position: its docs say *"A position can be liquidated even while your account holds ample free balance."*

**Job.** "Show me where Perpl traders get liquidated, and make sure I'm never one of them while my account has money sitting idle."

**What brings the user back.** A daily look at the liquidation map, and a receipt every time Lifeline defends them.

**Secondary users.** Any Monad participant watching market risk: the map is public and needs no wallet.

**Primary user story.** "As a Perpl trader, I want my own idle AUSD to move into my position's margin when it gets close to liquidation, so I stop paying liquidation penalties while my money sits idle, and nobody, including Lifeline, can trade or withdraw my funds."

1. She lands on `/` and sees the problem, the live mainnet numbers, and both primary actions.
2. She checks an address and gets a risk report with liquidation price, distance, idle AUSD, the penalty at stake, and what Lifeline would do now.
3. Mainnet is read-only, so the report points her at a testnet practice account.
4. At `/app` she opens a practice account: a wallet in the browser and a reserved testnet account with a live BTC position and idle AUSD.
5. She takes ownership in one transaction.
6. She sets a safety line and signs. Signing costs no gas.
7. If the position is inside her line, she gets a receipt. If it is outside, Lifeline watches.
8. The dashboard shows live position health, Lifeline's heartbeat, activity, and budget used.
9. She leaves and comes back on the same device. `/app` opens on that dashboard, including top-ups made while she was away.
10. She can withdraw idle AUSD, pause or adjust protection, and keep the account by adding an email.

**Judge story.** "As a judge, I want to verify in three minutes that Lifeline is real: real mainnet risk data, a protection I trigger myself on chain, and proof that Lifeline's key cannot take funds. Then I want to find the evidence for each bounty without hunting."

1. Live market risk on `/radar`: drag BTC to −3%.
2. A real mainnet liquidation Lifeline would have stopped, on `/replay`.
3. Protect a live testnet position on `/app`, the same onboarding as the trader story.
4. Try to break it: withdraw, read what Lifeline's key can and can't do, and compare the twins.
5. Evidence: the bounty map, the methodology, and the risk API.

## 2. Product in one paragraph

Lifeline is a web app with two halves. **The Radar** reads every open Perpl position straight from the mainnet contract and computes each one's exact liquidation price. It renders a live liquidation map per market: long liquidations below the mark, short liquidations above, and the at-risk band highlighted. It also shows how much idle AUSD sits beside the at-risk positions, and has a crash slider that shows which positions would die and how many Lifeline would save. Anyone can paste an address for a risk card and a dry run of what Lifeline would do now. **Lifeline** is the defender. A protected Perpl account appoints Lifeline's operator key, which can do exactly one thing: move the account's own idle balance into a position's margin. When a position's distance to liquidation drops below the owner's trigger, Lifeline tops it up to the owner's target in the next block, within a signed budget. On testnet, a judge gets a guest wallet instantly and claims a live 15× BTC position into it. They arm Lifeline with a signature, watch the position's liquidation price jump one block later, and withdraw funds to prove Lifeline can't.

## 3. The core (what must exist)

1. **Radar (mainnet and testnet).**
   - a live liquidation map per market;
   - headline numbers: tracked open interest, at-risk notional and count, and idle AUSD beside at-risk positions;
   - a list of at-risk positions with anonymized account IDs;
   - a first-order crash simulator.
2. **Account lookup.** For any address: positions, liquidation price, distance, free balance, and a Lifeline dry run.
3. **Liquidation history,** via Envio HyperSync. Mainnet liquidations with "idle at liquidation" values, the "Lifeline-eligible" count, and a recent-liquidations tape.
4. **Try Lifeline (testnet).**
   - a Privy guest wallet, with no login;
   - claim a pre-opened position (ownership transfer plus a gas drip);
   - accept ownership (one transaction);
   - arm a signed mandate, which triggers an immediate check and action;
   - see the receipt and withdraw.
5. **Keeper loop.** Continuous protection of every armed account, including unclaimed pool positions under a "house" mandate.
6. **Twins.** Live protected and unprotected position pairs with their history.
7. **Provisioning tooling.** Pre-accumulate AUSD and MON, open pool and twin positions using our own counterparty when needed, and register them.

The core writes **no new smart contracts.**

## 4. End-to-end flows

### 4.0 Information architecture

| Route | Job | Primary action |
|---|---|---|
| `/` | Explain Lifeline, show it's live, and route people | Protect a position, check an address, or take the tour |
| `/app` | Onboarding, then the dashboard | Open a practice account, then the dashboard controls |
| `/radar` | Live liquidation map, crash simulator, at-risk table, liquidations tape | Drag a crash slider, or open a lookup |
| `/check` | Address entry with examples | Check |
| `/a/[address]` | Risk report for one address | Protect this account, or try a practice account |
| `/proof` | Hub for twins, replay, methodology, saves, and permissions | Open a proof |
| `/twins` | Protected and unprotected pairs | Explorer links |
| `/replay` | One real mainnet liquidation, replayed | Explorer link |
| `/methodology` | The liquidation rule and the fork check | Reproduce |
| `/developers` | Risk API docs with a live example | Run the example |
| `/tour` | Guided path for a judge | Start the tour |
| `/tour/evidence` | Bounty evidence map | Proof links |

Permanent redirects:

- `/lifeline` → `/app`
- `/judges` → `/tour`
- `/?chain=10143` → `/radar?chain=10143`
- `/a/[address]` stays as it is

`/dev/*` is not routable in production. `/api/e2e/*` stays 404 in production.

### F1: Open the Radar (no wallet)

1. The radar lives at `/radar`. The landing page `/` shows the same live headline numbers from `GET /api/radar?chain=143` and routes users to the product, the radar, the lookup, and the judge tour.
2. The headline strip shows: "Tracking $X open interest across N Perpl positions · $Y within 5% of liquidation (M positions) · $Z idle AUSD beside them."
3. Each market (BTC, ETH, SOL, MON, HYPE, ZEC, discovered onchain) shows a horizontal price axis:
   - long-liquidation notional in 0.25% buckets below the mark, in red;
   - short-liquidation notional above the mark, in green;
   - shaded bands at 1%, 2%, and 5%;
   - the mark line updating every refresh.

   Hovering a bucket lists its positions: anonymized ID, side, leverage, notional, distance, and whether there's idle balance.
4. Below the map is an at-risk table sorted by distance, with a recent-liquidations tape on the side.

### F2: Crash simulator

1. Drag a market's slider from −10% to +10%.
2. The client re-prices every position at the shocked mark, using the snapshot data:
   - positions whose distance goes to 0 or below are "liquidated";
   - a position is "saved by Lifeline" if its account's free balance covers the deposit needed to keep it 1% or more from the shocked price.
3. The panel shows a line in this format (the figures here are illustrative): "−3% BTC: 41 positions / $88k liquidated · Lifeline could save 29 / $61k using their own idle AUSD." It's labeled "first-order: excludes cascade price impact."

### F3: Account lookup and dry run

1. Paste an address (mainnet or testnet). The app calls `GET /api/account/:address`.
2. A risk card is shown for each position: side, entry, mark, liquidation price, distance, deposit, and the account's free balance.
3. The dry run reads: *"Lifeline would add 152 AUSD from your idle balance to your BTC long → distance 2.1% → 6.0%."* On mainnet it ends with: "Protection on mainnet: coming via API-key mode."

### F4: Try Lifeline: claim a live position (testnet)

1. The user clicks "Try Lifeline live." Privy `createGuestAccount()` creates an embedded wallet instantly, with no login prompt.
2. The app calls Worker `POST /claim` with the Privy access token. The Durable Object then:
   - verifies the token;
   - checks rate limits: one claim per user, and a per-IP cap on the real client IP as forwarded by our server;
   - picks a pool position, preferring BTC at 15×, about 2.7% from liquidation;
   - sends 0.08 testnet MON to the wallet;
   - calls `proxy.transferOwnership(wallet)` from the pool owner key;
   - returns `{proxy, perpId, txs}`.
   - A user who already claimed gets their existing account back.
3. The app shows the position card ("Your 15× BTC long · 2.7% from liquidation · 300 AUSD idle") and a single "Accept ownership" button. That sends `proxy.acceptOwnership()` from the Privy wallet, with UI suppressed and explicit gas and nonce.
4. The position appears on the testnet Radar, highlighted. Until the judge arms their own mandate, the house mandate keeps protecting it (trigger 1.5%, target 2.5%).
5. **Fallbacks:**
   - **If acceptance fails,** the judge stays `pendingOwner`, a retry button is shown, and the position stays protected.
   - **If Privy or the pool is unavailable,** use sandbox mode. The judge is assigned a house position they don't own, and the same arm flow runs with the house signer.

### F5: Arm Lifeline (the demo moment)

1. The user sets the mandate:

   | Field | Default |
   |---|---|
   | Trigger distance | 4% |
   | Target distance | 6% |
   | Per-action cap | 150 AUSD |
   | Total budget | 50% of free balance |
   | Markets | This position's market |
   | Expiry | 7 days |

   The UI explains the trade-off: "Lifeline moves your idle AUSD into this position's margin; if the price keeps moving against you, that AUSD is at risk too."
2. The Privy wallet signs EIP-712 typed data (domain `Lifeline` v1, chainId 10143):

   ```
   Mandate(address account, uint256[] perpIds, uint16 triggerBps, uint16 targetBps,
           uint256 maxPerActionCNS, uint256 budgetCNS, uint64 expiry, uint256 nonce)
   ```

   This costs no gas.
3. Worker `POST /arm` passes it to the Durable Object, which:
   - verifies the signer equals `DelegatedAccount(account).owner()` (via `eth_call`) and that the fields are sane;
   - stores the mandate and retires the house mandate;
   - evaluates immediately. If the distance is below the trigger, it sends `proxy.increasePositionCollateral(perpId, amountCNS)` from the operator key and waits for the receipt.
4. It returns `{txHash, block, addedCNS, liqBefore, liqAfter, distBefore, distAfter, msFromRequest}`. The app animates the position's marker moving away from the mark and shows the receipt with an explorer link.
5. From then on the keeper loop (F6) guards the position.

### F6: Keeper loop (continuous protection)

1. A Durable Object alarm fires every 2 seconds and always reschedules itself in `finally`.
2. It reads, in one Multicall3 batch:
   - `getPositionV2(perpId, accountId)` for each armed account's markets (this also returns `markPricePNS` and `markPriceValid`);
   - `getAccountById(accountId)` for the free balance.
3. For each position it computes the distance (§5.3). If the distance is below the trigger, the cooldown has passed, and the budget remains, it sends one operator top-up (at least 5 AUSD), recorded as pending.
4. Receipts are confirmed on the next tick. Actions are serialized through one operator key inside the single Durable Object, so there are no nonce races.
5. The loop skips a market when `markPriceValid` is false.

### F7: Own it, withdraw, disarm

1. "Withdraw" calls `proxy.withdrawCollateral` as owner for any amount up to the idle balance, and the AUSD lands in the Privy wallet. The UI points out that Lifeline's key can't do this: it's owner-only in Perpl's contract, and the allowlist revocations are visible onchain.
2. "Disarm" sends a signed disarm request, and the Durable Object deactivates the mandate.
3. "Keep this account" upgrades the guest with Privy `login()`.

### F8: Twins

Fixed pairs are opened at the same time, price, and leverage: BTC 15× long and short, and SOL 10× long and short. One of each pair has Lifeline armed with a house mandate (trigger 4%, target 6%, budget 300); the other has nothing. The Twins panel shows each pair's distance, Lifeline's actions (from chain events), and outcomes:

- "Unprotected twin liquidated at block X," from a `PositionLiquidated` event;
- or, if testnet's liquidator is idle, "crossed its liquidation price at block X."

### F9: Liquidation history and Lifeline's log

1. `GET /api/liquidations?chain=143&days=30` uses HyperSync to pull every mainnet `PositionLiquidated` and decode it. For each one:

   ```
   idleAtLiq   = accBalanceCNS − max(accAmountCNS, 0)
   eligible    = idleAtLiq ≥ 1% of notional at the liquidation mark
   ```

   `posDepositCNS` is the deposit after liquidation, so comparing idle with it counted almost every full close as eligible. The 1% rule matches F2's "saved" rule. The 30-day window is enforced by block range. The response includes totals, eligible counts and notional, and the latest 50.
2. `GET /api/actions?account=` uses HyperSync to pull testnet `IncreasePositionCollateral` events for protected accounts. Lifeline's action log is therefore read from the chain, not from our database.

### F10: Dashboard

After a claim is accepted, `/app` is the place to come back to. It shows:

- live position health;
- Lifeline's status and heartbeat;
- the activity list, including top-ups made while the trader was away;
- adjust, pause, and resume;
- withdraw of idle AUSD;
- keep the account;
- resume on return to the same browser.

## 5. System

### 5.1 Components

| Component | Platform (free) | Responsibility |
|---|---|---|
| Web app | Next.js on Vercel Hobby | UI; the read-only cached routes `/api/radar`, `/api/account`, `/api/liquidations`, `/api/actions` (Node runtime) |
| Lifeline Durable Object | Cloudflare Worker plus one SQLite-backed Durable Object, free plan, no card | Pool, claims, mandates, the action log cache, the alarm keeper; holds the operator, pool-owner, and sponsor keys as secrets |
| Provisioning CLI | Local Node script (viem) | Faucet accumulation, pool and twin creation, position opening, registration |

The Lifeline core logic (evaluation, sizing, transaction building) is a plain TypeScript module with two adapters: the Durable Object and Node. The Node adapter can run on a laptop behind Cloudflare Tunnel if the Durable Object misbehaves.

### 5.2 Contracts (existing only)

| Contract | Testnet (10143) | Mainnet (143) |
|---|---|---|
| Perpl Exchange | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |
| Perpl DelegatedAccountFactory | `0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209` | (not used in core) |
| AUSD (6 decimals) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Agora AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` | none |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | same |

**Exchange views used (ABI from the MIT-licensed `dex-sdk`):**

- `getPerpetualExistsBitmap()`;
- `getPerpetualInfoV2(perpId)`: `priceDecimals`, `lotDecimals`, `markPNS`, open interest, `status`;
- `getPositionIds(perpId)` → `getPositionsV2(perpId, pageStart, 200)`, paged with `nextNodeId`;
- `getMarginFractions(perpId, lot)`: `perpMaintMarginFracHdths`;
- `getAccountById(id)` and `getAccountByAddr(addr)`;
- `getPositionV2(perpId, accountId)`.

**Events used:**

- `PositionLiquidated`, with fields (perpId, posAccountId, positionType, markPricePNS, liqPricePNS, liqLotLNS, posLotLNS, deltaPnlCNS, fundingCNS, posAmountCNS, posDepositCNS, accAmountCNS, accBalanceCNS, onOrderBook);
- `IncreasePositionCollateral(perpId, accountId, positionDepositCNS, amountCNS, balanceCNS)`.

None of these fields are indexed, so every log is decoded.

**`DelegatedAccount` usage.**

- **Owner:** the pool owner key until a claim, then the judge's wallet. It's `Ownable2Step`.
- **Operator:** Lifeline's key.
- **Least privilege, set at provisioning:** the owner calls `setOperatorAllowlist(selector, false)` for `execOrder`, `execOrders`, `requestDecreasePositionCollateral`, `buyLiquidations`, `depositCollateral`, and `allowOrderForwarding`. Only `increasePositionCollateral` stays.

**The operator therefore cannot trade, withdraw, deposit, or enable forwarding.** It can only add margin from the account's own free balance. `withdrawCollateral` is owner-only in Perpl's code.

### 5.3 Math (from Perpl docs, verified against the worked example)

**Inputs, per position:**

| Symbol | Meaning |
|---|---|
| s | +1 for a long, −1 for a short |
| Pₑ | raw entry, = `pricePNS` / 10^priceDecimals. `priceResiduePNSQ16` is ignored |
| L | lot, = `lotLNS` / 10^lotDecimals |
| D | deposit, = `depositCNS` / 1e6 |
| F | funding, = `premiumPnlCNS` / 1e6. Positive means funding received |
| MMF | `perpMaintMarginFracHdths` / 100; for example, 25 means 4% |
| Pₘ | mark price |

**Formulas:**

```
MMR           = Pₑ · L / MMF          (MMF from getMarginFractions(perpId, 0))
Liquidation   P_liq = Pₑ + s · (MMR − D − F) / L
P_liq tick    long: ceil(P_liq · 10^priceDecimals); short: floor
Distance      d = s · (Pₘ − P_liq) / Pₘ
```

**Check:** a $100k BTC position at 10× with D = 10k and MMF = 25 gives MMR = 4k and P_liq = 94k, matching the docs.

**Top-up sizing.** When d < trigger, aim for target T:

```
P*     = Pₘ · (1 − s·T)
D*     = MMR − F − s·(P* − Pₑ)·L
add    = min(maxPerAction, freeBalance, budgetLeft, max(0, D* − D))
```

The action is skipped if `add` < 5 AUSD. There's a 3-block cooldown per position.

**Radar aggregation:**

- Positions under $10 notional are dust and excluded.
- Buckets are 0.25% of the mark, from −15% to +15%.
- A position is at-risk if d < 5%.
- Idle balance is `balanceCNS − lockedBalanceCNS`, read for accounts with at-risk positions.
- "Lifeline could protect now" counts at-risk positions where idle ≥ (D* − D) at T = 6%.

**Calibration gates,** which must pass before values drop the "est." label:

1. a unit test on the docs example, plus the dex-sdk entry-100 vectors;
2. `liquidationPricePNS` matches Perpl's own `liqPricePNS` from `gate:4 --fork` on every fixture position (100% of ticks);
3. a match to the Perpl testnet UI's liquidation price for our own positions, within 0.1%.

Historical event replay is not a gate. It misses premium settlement and residue, so it cannot reproduce the contract price.

### 5.4 Wallet and account layer

**Privy is the only account layer.**

- Use `@privy-io/react-auth` version 1.77 or later, with guest accounts enabled, embedded EVM wallets, and chain `monadTestnet`.
- Transactions go through the embedded wallet's `eth_sendTransaction` with explicit `gas` and `nonce`, and wallet UI suppressed after an in-app confirmation. There's only one transaction (`acceptOwnership`); `withdrawCollateral` is optional.
- The EIP-712 mandate is signed with Privy's typed-data signing.
- The Worker verifies the Privy access token (ES256 JWT) with Web Crypto.
- No gas sponsorship. The Durable Object sends a 0.08 MON drip at claim time, which covers accept, withdraw, and slack.

**Keys** (testnet only, separate wallets, nothing else held):

| Key | Holds | Does |
|---|---|---|
| Sponsor | MON | Gas drips to judges and the operator |
| Pool owner | Pool proxies until claimed | `transferOwnership` |
| Operator | MON float of 5 or more | Only `increasePositionCollateral` |
| Maker | AUSD and margin | Provisioning counterparty |

### 5.5 Lifeline Durable Object: state and loop

**SQLite tables:**

| Table | Columns |
|---|---|
| `pool` | proxy, accountId, perpId, side, leverage, status, createdAt |
| `claims` | proxy, privyUserId, owner, ip, claimedAt, acceptedAt |
| `mandates` | proxy, owner, typedData, sig, active, budgetUsedCNS, kind (`house` or `user`) |
| `actions` | id, proxy, perpId, amountCNS, txHash, block, distBefore, distAfter, status |
| `keys` | name, nextNonce |
| `health` | lastAlarmAt, lastError |

**Alarm behavior:**

- every 2 seconds, which is about 43k invocations a day, under the free plan's 100k a day;
- always rescheduled in `finally`;
- reads use the `latest` tag; receipts are confirmed by transaction receipt.

**Self-healing:**

- `/health` re-arms a stale alarm.
- Vercel's `/api/radar` pings `/health` (fire-and-forget) on cache refresh.
- A free UptimeRobot monitor pings `/health` every 5 minutes.

**Canary.** Every 10 minutes, `eth_call` simulates `increasePositionCollateral(1)` from the operator on a canary account. A revert alerts the team and sets the UI banner to "Lifeline degraded."

**Kill switch.** The `LIFELINE_PAUSED` secret disables all sends. Reads still work.

### 5.6 Envio (HyperSync)

- Use the HyperSync endpoints `https://monad.hypersync.xyz` and `https://monad-testnet.hypersync.xyz`, with a free API token held server-side.
- **Queries:**
  - mainnet `PositionLiquidated`, from the Exchange deploy block, cached for 60 seconds;
  - testnet `IncreasePositionCollateral`, filtered to protected accounts in code;
  - testnet `PositionLiquidated`, for twins and as a check on whether testnet's liquidator is active.
- **No hosted HyperIndex** in the core, so there is no deletion-after-inactivity risk.

### 5.7 APIs

**Vercel routes.** All are read-only, use `Cache-Control: s-maxage` (2 s for radar, 60 s for history), and have upstream RPC fallbacks: rpc.monad.xyz → Monad infra RPC → Alchemy free.

| Route | Returns |
|---|---|
| `GET /api/radar?chain=` | Per market: mark, open interest, buckets, at-risk list (anonymized), idle totals, "could protect now"; plus headline totals and block number |
| `GET /api/account/:address?chain=` | Positions, risk metrics, dry-run actions |
| `GET /api/liquidations?chain=&days=` | History, eligibility totals, latest list |
| `GET /api/actions?account=` | Lifeline actions read from the chain |

**Worker routes.** These require a Privy token, except the admin and health routes.

| Route | Purpose |
|---|---|
| `POST /claim` | Claim a pool position (§F4) |
| `POST /arm` | Store a mandate and run the immediate action (§F5) |
| `POST /disarm` | Deactivate a mandate |
| `GET /mandate/:proxy` | The stored mandate |
| `GET /twins` | Twin pairs and their status |
| `GET /health` | Last alarm time, last error |
| `POST /admin/pool` | Register provisioned positions (admin secret) |

### 5.8 What is onchain vs. offchain

| Onchain | Offchain |
|---|---|
| Every position, mark, balance, and liquidation on Perpl | Radar aggregation and the crash simulation (server and client) |
| Ownership of protected accounts (`Ownable2Step`) and the operator allowlist | Mandates (signed EIP-712, stored in the Durable Object, verifiable by anyone) |
| Every Lifeline top-up (`IncreasePositionCollateral` events) | Keeper scheduling, sizing, and cooldowns |
| Withdrawals by the owner | Claims, rate limits, health |

### 5.9 Ops: funding, provisioning, gates

**Gas budget, about 14 testnet MON:**

| Use | Approx. MON |
|---|---|
| 30 pool positions, about 0.12 each | 3.6 |
| Twins | 0.7 |
| Judge drips, 0.08 each × 60 | 5 |
| Keeper top-ups, about 0.015 each × 300 | 4.5 |

- Use explicit gas limits measured on testnet, because Monad charges the limit.
- Claim MON from the Monad faucet with several team addresses that have Discord roles (up to 5 MON per 12 hours each).

**AUSD.**

- The faucet's 60-second cooldown is global, each drip is 10,000 AUSD, and each address can hold at most 100k.
- The CLI loops `requestFunds` for the pool owner and maker until each holds at least 25k.
- Each pool account gets 400 AUSD: about 100 deposited into the position and about 300 left free.

**Provisioning, per pool account:**

1. The operator signs `AssignOperator` consent.
2. Pool owner: `factory.create(operator, deadline, sig)`.
3. `AUSD.transfer(proxy, 400e6)`, then `proxy.createAccount(400e6)`.
4. Six `setOperatorAllowlist(…, false)` calls.
5. Open the position as owner with an IOC `proxy.execOrder`: BTC at 15× (about 2.7% from liquidation) or ETH at 12× (about 3.3%).
   - The counterparty is testnet's resting liquidity.
   - If that's thin, the maker account first posts a post-only resting order at mark ± 0.05% and the demo account crosses it, which is self-provided liquidity.
   - Alternate long and short so the maker stays roughly flat.
6. Register with `POST /admin/pool`. A house mandate is applied automatically.

**Pool health.** Keep at least 20 available, alert below 10, and refill with the CLI.

**Gate checks,** to pass before building on each dependency:

1. An operator `increasePositionCollateral` round-trip on a fresh testnet `DelegatedAccount` after the allowlist revocations. This also confirms the allowlist isn't stale.
2. `transferOwnership` → `acceptOwnership` from a Privy guest wallet.
3. Durable Object alarm CPU and invocation behavior on the free plan.
4. The liquidation-price calibration from §5.3.
5. A HyperSync token, plus a count of mainnet and testnet `PositionLiquidated` events.
6. Provisioning one position by self-match.

## 6. If time remains (ranked by cash and wow per unit of effort)

Effort tags: **S** small, **M** medium, **L** large. Each item is separable.

### A. Product and bounty strength

1. **API-key mode for existing Perpl accounts (M).** This is the real mainnet path and the strongest use of Perpl's API.
   - The user pastes a trade-scoped Perpl API key, which by Perpl's design can never withdraw.
   - Lifeline sends `IncreasePositionCollateral` (order type 6) over Perpl's trading WebSocket, signed with Ed25519.
   - Test it on testnet with keys created in the Perpl testnet UI. That's accessible from India; the US and UK are geo-blocked.
   - Run the client server-side from a non-US region.
2. **MetaMask Agent Wallet plugin `lifeline` (S–M). Unlocks MetaMask's $2.5k (Track 1).**
   - Commands: `mm lifeline radar <market>`, `mm lifeline risk <address>`, `mm lifeline claim`, and `mm lifeline arm --trigger 4 --target 6 --budget 200`.
   - The mandate is signed with `walletExecutor` typed-data signing, and `acceptOwnership` is submitted on chain 10143.
3. **Nansen badges (S). Competes for the Nansen $5k pool.**
   - For the 20 largest at-risk mainnet accounts, fetch Nansen labels and PnL summary for the owner address.
   - Show badges such as "Smart money at risk" or "fresh wallet."
   - Cache for 24 hours. The free tier is 100 credits plus 10 a day.
4. **Liquidation alerts (S–M).** Web push or a Telegram bot, for any watched address crossing 5%/3%, or a cluster within 1% of the mark. These are PBJ's "cluster alerts" and "significant liquidation alerts" roadmap items, and the strongest retention feature for real mainnet users.
5. **"Replay a real liquidation" (M).** Pick a historical mainnet liquidation, replay the mark path from Perpl candles (server-side, non-US region), and mark the block where Lifeline would have acted and how much idle AUSD it would have used.
6. **Chainlink CRE liquidation-pressure feed (M). Unlocks CRE's $3k.**
   - A cron workflow uses CRE's EVM read to pull Perpl mainnet positions.
   - It computes, per market and side, the notional within 1%, 3%, and 5% of the mark.
   - It writes a report to a small `LiquidationPressureFeed` consumer contract on testnet, run with `cre workflow simulate`.
   - Lifeline raises targets when pressure is high. Other protocols can read the feed.
7. **Cascade with real book depth (M).** Replace the first-order simulator with an iterative cascade. Liquidated notional is sold into the book at depth read from `getVolumeAtBookPrice` around the mark, then re-checked.
8. **"Open your own" testnet position (S–M).** The owner opens a fresh position through the proxy with an IOC. It needs live liquidity, so on failure it shows "Testnet book thin; claim a ready position."
9. **Shareable save cards (S).** An Open Graph image: "Lifeline saved a 15× BTC long at block N · +50 AUSD margin."

### B. Hardening and heavier cores

1. **The Node adapter actually running** on a laptop with pm2 and Cloudflare Tunnel as a warm standby, using a separate operator key to avoid nonce races. Failover is manual (S).
2. **RPC failover with health scoring**, plus a `/metrics` route: alarm lag, action latency, failures by reason (S–M).
3. **Automatic pool refill** inside the Durable Object, using the maker self-match flow (M).
4. **Volatility-aware targets** computed from recent mark variance, with incremental top-ups (S–M).
5. **A reduce mode:** an IOC partial close when the budget is exhausted. It needs `execOrder` re-enabled per account and live liquidity (M).
6. **Our own protected-account contract** that enforces the budget and per-action caps onchain. It would be MIT-licensed, written from scratch (Perpl's contracts are BUSL-1.1), and deployed as immutable clones (L).
7. **A calibration suite** that re-runs the liquidation math against every new `PositionLiquidated` event and alerts on drift (S).

## 7. Later (after the hackathon)

- Mainnet protection through API-key mode and protected accounts, an audit, and geo-gating for mainnet automation.
- Other onchain perps venues on Monad.
- A per-save fee or a B2B embed for venues.
- Lifeline mandates for trading agents (ERC-8004 identities).

## 8. Stack, each piece tied to a feature

| Piece (source) | Feature it serves |
|---|---|
| Next.js PWA + Privy template (resources.md starter templates) | Web app base and Privy wiring |
| Privy guest accounts and embedded wallets (Privy docs; sponsor bounty) | Instant judge wallet, accept ownership, EIP-712 mandate, withdraw |
| Perpl docs and `dex-sdk` ABI (resources.md) | Position and margin views, liquidation formula, order types |
| Perpl `delegated-account`, deployed (Perpl GitHub) | Protected accounts with a single-purpose operator |
| AUSD and Agora testnet faucet | Pool collateral and free balance |
| Envio HyperSync (resources.md Envio guides) | Liquidation history, eligibility stat, chain-verified action log |
| Monad docs: gas pricing, reserve balance, block tags (resources.md) | Explicit gas limits, key floats, `latest` vs. confirmed reads |
| Monad public RPC, Crouton free RPC, Alchemy free RPC (resources.md) | Primary and fallback RPC |
| Tenderly (resources.md perk) | Debugging and simulating provisioning and operator transactions |
| MonadVision (BlockVision) and Monadscan | Receipt links |
| Outside resources.md, free: Cloudflare Workers and Durable Objects, Vercel Hobby, viem, UptimeRobot | Keeper and state, hosting, chain client, uptime pings |

## 9. Demo script (3 minutes, any browser, no install)

Five beats, in this order. Together they are the judge tour.

1. **Live market risk.** Open `/radar` on mainnet. The headline numbers are live. Drag BTC to −3% and the crash line updates.
2. **A real liquidation.** Open `/replay`. One Bitcoin long was liquidated on mainnet with idle AUSD beside it. Lifeline would have added that idle AUSD. The proof link is the mainnet transaction.
3. **Protect a live position.** Open `/app` on testnet. Open a practice account, take ownership, and sign a safety line. The receipt is a real top-up, and there is at most one wallet transaction before it.
4. **Try to break it.** Withdraw idle AUSD from the account just taken. Only the owner can. Then show what Lifeline's key can and can't do, and open `/twins`.
5. **Evidence.** Open `/tour/evidence`. Each bounty has the requirement, how Lifeline meets it, the code path, and one proof link.

**Backup:** a recorded run of the same script, and a sandbox mode that needs no wallet.

## 10. Non-goals

- Any mobile app.
- New smart contracts in the core.
- Copy trading, signals, or trade recommendations.
- Opening, closing, or reducing positions automatically.
- Mainnet funds, mainnet automation, fiat on-ramps, or cross-chain deposits.
- Perpl's web app or API on the demo-critical path.
- Gas sponsorship services.
- Any second account layer (Mera, Dynamic).
- Hosted indexers.
- Fees, tokens, or points.
