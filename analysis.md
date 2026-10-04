# Lifeline: the decision (pivot after red team)

**Why we pivoted.** The red team (`findings.md`) showed that copy trading only works if third-party testnet liquidity fills the judge's orders at the exact moment they click. Today's checks add three more problems:

- **Perpl geo-blocks US and UK users** (`geo_block: BY, CU, GB, IR, KP, RU, SY, UA, US`), and many main-track judges are US-based.
- **Privy's gas sponsorship is paid.**
- **No free always-on VM exists** without a card.

So we changed the idea instead of patching it.

## The idea

**Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.** It has two parts:

- **The Radar:** a live, exact liquidation map of every open Perpl position, built from mainnet data.
- **The Lifeline:** an automated defender that moves a position's own idle account balance into its margin, in the next block, before Perpl liquidates it.

**The job, in one sentence:** "Show me where Perpl traders get liquidated, and make sure I'm never one of them while my account has money sitting idle."

**The problem is real, documented, and measured today.**

- **Perpl documents the gap.** Perpl uses isolated margin, and its own docs warn: *"A position can be liquidated even while your account holds ample free balance."*
- **It's live on mainnet right now.** At 16:00 IST today, the probe read 600 open positions, about $1.56M notional on each side:
  - **133 positions, about $193k notional, were within 5% of liquidation.**
  - **32 of the 40 closest sit in accounts holding idle AUSD, about 29,400 AUSD in total.**
- **The Perpl co-founder wants it.** Perpl co-founder PBJ (also a bounty judge) lists both halves of this product as unchecked items on his own [PerplBot](https://github.com/0x70626a/PerplBot) roadmap: "Liquidation cluster alerts" and "Auto-defend liquidation (using available collateral or wallet assets)."

**Why a user opens it twice.** Traders check liquidation maps every day; on centralized exchanges that's CoinGlass-style heatmaps, and Perpl has nothing equivalent. And every time Lifeline acts, the user gets a receipt: "Added 50 AUSD · liquidation moved $82,990 → $80,140 · next block."

**Why it only works on Monad:**

- **Exact, not estimated.** Perpl matches and settles every order onchain, so every position's entry, size, deposit, and funding is public state. Centralized-exchange heatmaps are model estimates; this map is computed. Fetching all 600 positions takes about 2 seconds over public RPC.
- **The defense lands in the next block.** Blocks are about 300 ms on testnet and 400 ms on mainnet, at about $0.0005 per action. Small, frequent top-ups are cheap enough to automate and fast enough to beat the liquidation keeper. On slow or expensive chains, auto-margin bots lose that race.

**Demo wow:**

- the real Perpl market's liquidation map breathing with the mark price;
- a crash slider that shows which real positions die and how many Lifeline would save;
- the judge's own testnet position jumping away from its liquidation price one block after they arm Lifeline;
- a protected and an unprotected "twin" position, live side by side.

## Track and cash prizes

**One track: Track 1, Onchain Finance & Trading.** It holds the Perpl analytics bounty, and MetaMask's plugin bounty as a stretch.

**Cash prizes the core can win, most likely first:**

1. **Perpl, Best Analytics / Risk Tool: $3,000** (Track 1). The Radar is literally "a real-time analytics, risk-monitoring … dashboard focused on Perpl," and it's on the judge's own roadmap.
2. **Perpl, Best use of Perpl's API: $5,000.** Lifeline is the "production-ready automation system." It is built on Perpl's own delegated-account operator model, and it ships the "auto-defend liquidation" item from the judge's roadmap almost word for word.
3. **Envio, Best Use of Envio: $1,000.** HyperSync powers the liquidation history, the "Lifeline would have saved" stat, and the chain-verified log of every Lifeline action.
4. **Privy: $5,000.** Privy guest accounts give judges an embedded wallet instantly, with no login. That wallet accepts ownership of the protected account, signs the Lifeline mandate (EIP-712), and withdraws. That's well beyond authentication.
5. **Track 1 place: $10,000.**
6. **Grand Champion: $25,000.**

The core ceiling is $14,000 in bounties plus $10,000 for a track place.

**If engineering time remains**, each of these separable add-ons unlocks one more prize:

1. **MetaMask Agent Wallet plugin: $2,500** (Track 1). It gives agents liquidation defense on Monad testnet.
2. **Nansen labels on at-risk positions:** a share of the **$5,000 pool**.
3. **A Chainlink CRE liquidation-pressure feed onchain: $3,000.**

With all three, the ceiling rises to $24,500.

## Every cash prize: pursue or drop

**Pursue (core)**

- **Track 1 ($10k × 3).** A risk layer for an onchain order book fits the track's own framing.
- **Grand Champion ($25k).** Eligible automatically; a long shot.
- **Perpl, Best Analytics / Risk Tool ($3k, Track 1).** This is the Radar.
- **Perpl, Best use of Perpl's API ($5k, all tracks).** This is Lifeline's automation.
- **Envio ($1k, all tracks).** HyperSync drives history and receipts. It needs no hosted indexer, so the free tier's 7-day deletion rule doesn't apply.
- **Privy ($5k, all tracks).** Guest embedded wallets own the protected position, sign the mandate, and withdraw. Privy is the only account layer.

**Pursue only if time remains**

- **MetaMask Agent Wallet Plugin ($2.5k, Track 1).** `mm lifeline radar|risk|arm`, with the mandate signed through Agent Wallet's typed-data signing. Agent Wallet supports Monad testnet (10143).
- **Nansen ($5k pool).** Badges such as "Smart money at risk" on the 20 largest at-risk positions, cached daily. The free tier is 100 credits plus 10 a day, which only covers a demo-sized set.
- **Chainlink CRE ($3k).** A cron workflow reads Perpl mainnet positions, computes liquidation pressure per market, and writes it to a feed contract on testnet. Lifeline reads it to raise targets when a cascade looks likely.

**Drop**

- **Tracks 2, 3, and 4.** We can have only one primary track.
- **Agora mobile bounties (2 × $10k).** They require mobile apps, and the product is web-only.
- **Dynamic ($5k).** It would be a second account layer, and Privy's guest wallets remove login friction.
- **Mera UX and Mera Many Keys ($2.5k each).** A second account layer. Mera's passkeys also fail on desktop Chrome's local profile, which is a judge-setup risk.
- **Kuru, both bounties ($5k each).** They depend on liquidity.
- **Aurora Intents ($5k).** It needs real mainnet funds.
- **Cleanverse ($2k).** It's scoped to Track 4.
- **Community Team ($5k).** We're not eligible.

These aren't prize targets because they pay credits or services: Alchemy, Kimi, Qwen, Hunyuan, and the services pool. Alchemy's free RPC is still used as a fallback endpoint.

## How Lifeline resolves the red-team blockers

| Finding | Copy-trading plan | Lifeline |
|---|---|---|
| C5 testnet liquidity | Every copy needed a live fill | **Zero fills at demo time.** The Radar reads mainnet. Demo positions are opened in advance, by our own accounts trading with each other. Lifeline's action moves collateral, not orders. |
| Perpl geo-block (new) | US judges would be routed into trading Perpl perps | The critical path uses only Monad RPC and Perpl's contracts. No Perpl web app or API is on the critical path. |
| C1 scope | Four systems, plus a mirror engine | **Three deployables:** a Vercel app, one Cloudflare Worker with a Durable Object, and a local provisioning script. Lifeline has one action type. |
| C2 Privy sponsorship | Five sponsored transactions per follow | No sponsorship needed. The judge sends one transaction (accept ownership) on a 0.08 MON drip, and the mandate is a free signature. |
| C3 reserve balance | Burst mirroring from thin floats | Lifeline acts rarely: one top-up per breach, with a cooldown. Keys hold a float of 5 MON or more. |
| C4 always-on host | A paid or card-only VM | A Cloudflare Durable Object alarm loop on the free plan, no card. Arming acts synchronously, so the demo moment never waits on the loop. |
| H1 phantom logs | Mirrored log events at the `Proposed` stage | Decisions come from state reads. A spurious top-up is harmless, and receipts confirm the final transaction. |
| H4 faucet | Unverified | Verified: a global `lastDripTimestamp` (60 s shared cooldown), 10,000 AUSD per drip, and about 998M AUSD in the faucet. The last drip was about 2 hours ago. |
| H5 Privy multi-transaction | Five chained transactions | One transaction and one signature. |
| H6 Envio caps | Hosted dual-chain indexer | HyperSync queries only, cached server-side. |
| M1 mainnet leaderboard effort | Indexer and backfill | Direct view calls: `getPositionsV2` pages plus Multicall3 (deployed on both chains). |
| M7 regulatory | Copy trading looks like asset management | A self-directed risk tool that acts only on the user's own account. |

## Ideas we killed in this round

- **Copy trading v2,** even with our own testnet market maker. It still needs live fills, it has the largest engine, and it routes US judges into trading perps.
- **Radar only.** It's the most robust option, but it leaves Perpl's API bounty ($5k) and Privy ($5k) on the table.
- **Parimutuel "liquidation markets" or up/down games.** No liquidity needed, but the category is crowded, it reads as gambling, and it fits Perpl weakly.
- **An x402 agent-payments marketplace** (Track 4). It's crowded and has only $2k of track-scoped cash.
- **Kuru markets, or a Perpl market-making vault.** They need capital, and judges can't use them.

## Closest existing products, and why the lane is open

- **The [Perpl app](https://app.perpl.xyz)** shows your own position's liquidation price. It has no market-wide map and no auto-margin.
- **[PerplBot](https://github.com/0x70626a/PerplBot)** has a CLI liquidation simulator for your own account. Cluster alerts and auto-defense are unchecked roadmap items.
- **[Chainhelm](https://chainhelm.com/en/all-perpdex-leaderboard/)** ranks Perpl traders by PnL (via Perpl's leaderboard API). It covers PnL, not risk.
- **Centralized exchanges** (Bybit, MEXC, KuCoin) ship auto-add margin as a standard feature, and CoinGlass-style heatmaps are standard for Hyperliquid and CEXs. Monad has neither.

## What Monad gets

- **The missing risk layer for its flagship onchain order book:** exact liquidation intelligence plus automated defense. It can extend to Monad's other onchain perps venues later.
- **A permission pattern other apps can copy.** Lifeline's operator key can do exactly one thing, add margin from the account's own balance. Trading, withdrawing, and depositing are revoked onchain.
- **A visible demonstration of Monad's speed.** The defense lands one block after the breach, and the receipt shows it.

## How this fails judging, and the scope cut that prevents it

**The main failure mode:** judges see "a dashboard plus a cron job." The Radar looks like any heatmap, the testnet defense looks staged, and Lifeline reads as a feature rather than a product.

**The cut and the emphasis that prevent it:**

- **Show the gap with real money first.** The opening screen shows live counts of positions within 5% of liquidation and the idle AUSD sitting beside them. The crash slider then shows how many real positions Lifeline would save.
- **Let judges own the defense.** The judge holds the protected position in their own wallet, arms Lifeline with their own signature, sees it act one block later, and then withdraws to prove Lifeline can't.
- **Keep scope to one action and one demo path.** Lifeline only adds margin, with no auto-reduce. Mainnet gets only the Radar plus a "what Lifeline would do now" dry run. Testnet gets the live defense, on BTC and ETH.
- **Cut** the order ticket, alerts, the API-key mode, and every add-on bounty unless the core is done.

## Red team of this plan (self-critique) and the fixes

Each fix is written into `prd.md`.

| # | Severity | Weakness | Fix |
|---|---|---|---|
| 1 | Critical | **Wrong liquidation math makes the map lie** (funding sign, dynamic margin, dust). | Implement the documented formula. Unit-test it against the docs' worked example ($100k BTC at 10× liquidates at $94k). Calibrate against the Perpl testnet UI's liquidation price for our own positions. Cross-check against historical `PositionLiquidated.liqPricePNS` via HyperSync. Filter dust under $10. Label values "est." until calibrated. |
| 2 | Critical | **The testnet demo looks staged.** | Testnet BTC tracks mainnet (about $85,26x on both). Positions are real Perpl testnet positions, and the judge owns theirs and can withdraw. Twin pairs on volatile markets build an organic history of saves and liquidations. The demo copy says plainly why positions are pre-opened. |
| 3 | High | **Auto-adding margin can increase losses,** because idle funds become at-risk margin. | The mandate has a hard budget, a per-action cap, a target, and an expiry, with an "alert-only" mode. The UI states the trade-off; KuCoin documents the same caveat. Defaults are a 4% trigger, a 6% target, and a budget of 50% of free balance. |
| 4 | High | **Pool exhaustion or claim abuse.** | One claim per Privy user and three per IP per hour. Keep at least 20 pooled positions, alert below 10, and refill with the provisioning script. If the pool is empty, fall back to a shared sandbox where the judge watches a house position get protected. |
| 5 | High | **Keeper uptime on Cloudflare's free plan** (alarm retries exhausted; Durable Object CPU limits on free uncertain). | Always reschedule the alarm inside `try/finally`. Self-heal on traffic: every Radar request pings `/health`, which re-arms a stale alarm. A free UptimeRobot monitor pings it every 5 minutes. Keep the Lifeline core runtime-agnostic, with a Node adapter that can run on a laptop behind Cloudflare Tunnel. Measure the alarm's CPU first. |
| 6 | High | **RPC rate limits** when many judges open the Radar. | Server-side snapshot, cached for 2 seconds (shared CDN cache plus in-memory), so there's one upstream refresh no matter how many viewers. Fallback RPCs: rpc.monad.xyz, Monad infra, and Alchemy free. |
| 7 | High | **Testnet MON scarcity** (faucet gives 0.05–5 MON per 12 hours). | Budget about 14 MON total: about 3.6 for 30 pool positions, about 0.7 for twins, about 5 for judge drips, and about 4.5 for keeper top-ups. Use tight explicit gas limits, since Monad charges the limit. Claim from several team addresses with Discord roles, starting now. |
| 8 | Medium | **Perpl ABI or allowlist drift mid-event.** | Use ABIs from the MIT-licensed `dex-sdk`. A canary `eth_call` simulates `increasePositionCollateral` from the operator every 10 minutes and alerts on revert. All addresses live in one config module. |
| 9 | Medium | **"Liquidation-hunting" ethics** (exposing targets). | The map aggregates by price bucket and anonymizes account IDs. Address lookup shows only what's already public. Protected positions make hunting less profitable. |
| 10 | Medium | **The "would have saved" stat over-claims.** | Count a liquidation as "Lifeline-eligible" only if the account's idle balance at that moment (from the event's `accBalanceCNS − accAmountCNS`) was at least the position's deposit. Show the rule next to the number. |
| 11 | Medium | **Real mainnet users can't arm Lifeline in the core.** | Be honest about it: mainnet gets the Radar and a dry run today. The first if-time item is API-key mode (Perpl trade-scoped keys, which can't withdraw), tested on testnet, for existing accounts with no migration. |
| 12 | Medium | **Competing Perpl dashboards from other teams.** | Differentiate on exactness, the idle-balance gap, the crash simulator, and the fact that it acts, not just shows. |
| 13 | Medium | **Privy dependency** for the claim and arm flow. | If Privy fails, a sandbox mode with no wallet still shows Lifeline acting. |
| 14 | Low | **Testnet's liquidation engine may be idle,** so the unprotected twin never actually gets liquidated. | Count testnet liquidations via HyperSync first. If there are none, show "crossed its liquidation price at block X" instead. |
| 15 | Low | **Rapid repeated top-ups** spam gas. | Enforce a minimum action of 5 AUSD, a 3-block cooldown, and hysteresis between trigger and target. |
| 16 | Low | **Scope still large for the time left.** | The core is a strict priority list; if-time items start only after the core demo runs end-to-end. |

## Verified today (October 4, live checks)

- **Perpl mainnet.** `getPositionsV2` returned 271 BTC, 110 ETH, 73 MON, 56 SOL, 55 HYPE, and 35 ZEC positions, fetched in about 2.2 seconds. Maintenance fractions are 2500 for BTC (4%) and 2000 for most others (5%). BTC mark was $85,260.5, with 24-hour volume of about $4.9M (per Perpl's app).
- **Perpl testnet.** It has an active market maker: ETH quoted 16 levels deep at about 1 bp spread, BTC with about 2 BTC on the ask, and about 30 trades a minute per market. Blocks arrive about every 290 ms (69 blocks in 20 seconds).
- **Multicall3** is deployed on both chains.
- **Privy guest accounts** give fully functional embedded wallets with no login.
- **Cloudflare's free plan** supports SQLite-backed Durable Objects with alarms, 100k requests a day, and no card.
- **`DelegatedAccount`** uses two-step ownership transfer (`transferOwnership` then `acceptOwnership`), and its operator allowlist is editable by the owner.

## Why this is the highest-probability path to at least one cash prize

- **Demo-proof by construction.** The hook is real mainnet money and needs no wallet. The interactive part needs zero order-book liquidity, one transaction, and one signature, on any browser, in any country.
- **Four core bounties map to four core features,** two of them copied from the Perpl judge's own roadmap, plus three cheap, separable add-ons.
- **The smallest build of any plan we've considered,** with every load-bearing dependency verified live today rather than assumed.
