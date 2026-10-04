# Lifeline: Backlog for the coding agent

This file is the execution plan for building Lifeline as specified in `prd.md`. A coding agent works through it top to bottom, marks progress in place, records evidence, and **stops to ask the human whenever a task is tagged `HUMAN`.**

Source-of-truth order:

1. `prd.md` decides *what* to build.
2. This backlog decides *how and in what order*.
3. `analysis.md` explains *why*.

If this backlog and the PRD disagree, the PRD wins. Log the conflict in the Decision log (§9) and fix the backlog.

**Start here (a fresh agent):**

1. The pnpm workspace from S0.1 is in place. Product docs stay at the repo root. Role keys and service secrets live only in gitignored `secrets/`.
2. Read `prd.md` §2–§5 and §9, then this file's §1–§6.
3. Scan the Decision log (§9) and every task marked `[~]` or `[!]` to recover state from earlier sessions.
4. Continue with the first eligible task (§1.1). Phase 0 and G5 are done. The next task is **G8**.

---

## 1. Agent operating protocol

### 1.1 How to work through this file

1. Find the first task whose status is `[ ]` (not started) and whose `Depends on` tasks are all `[x]`.
2. Mark it `[~]`, do the work, then run every check under **Pass**.
3. **If all checks pass:**
   - fill in the task's **Evidence** line (commands run plus key output, never secrets);
   - mark it `[x]`;
   - commit with message `<task-id>: <short summary>`.
4. **If any check fails:** fix it and re-run. If you can't make it pass, apply the task's **Fallback**. If there is no fallback, mark the task `[!]`, write the reason under Evidence, and stop and ask the human (§1.3).
5. Don't start Phase 8 (if-time) until **D5** is `[x]`.

**Status markers:**

| Marker | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done (all Pass checks met) |
| `[!]` | Blocked; waiting on the human |
| `[-]` | Descoped, with a reason logged in §9 |

### 1.2 Human steps

A task tagged **`HUMAN`** needs a person: creating an account, using a browser faucet, approving an OAuth login, recording video, or submitting the entry. When you reach one:

1. Stop all work.
2. Print the request using the template in §1.3. If several `HUMAN` tasks are ready at the same moment and don't depend on each other, put them in one prompt to save interruptions.
3. Wait for the human's reply. Don't continue other tasks while waiting.
4. Verify the human's result using the task's **Pass** checks before marking it `[x]`. If verification fails, say exactly what's missing and prompt again.

**Recurring human step (MON top-up).** Whenever `pnpm cli status` shows the sponsor's balance under its floor (§4.3), prompt the human to fund it again with the S0.4 template, even in the middle of a phase.

### 1.3 Templates

**Human-step prompt:**

```
=== HUMAN STEP REQUIRED: <task-id> <title> ===
Why this is needed: <one or two sentences>
Please do:
  1. <exact step, with URL>
  2. <exact step>
Put secrets here (do NOT paste private keys into chat): <file path and variable names>
Reply with: <what to type back, for example "done", or a public value such as an App ID>
I will verify by: <the Pass check you will run>
```

**Blocked-task prompt:**

```
=== BLOCKED: <task-id> ===
What failed: <check and observed result>
What I tried: <bullets>
Options: <A / B / C, with your recommendation first>
I need from you: <decision or action>
```

### 1.4 When the agent must stop and ask, even without a `HUMAN` tag

- **A hard rule would be broken** (§2.1).
- **Money would be spent,** or a card, a paid plan, or a paid API would be needed.
- **A mainnet write transaction** would be sent. Mainnet is read-only, always.
- **A gate fails** and its fallback also fails.
- **A destructive action** would be taken on shared state: deleting the Worker, rotating keys that hold funds, or force-pushing.
- **The PRD is ambiguous** in a way that changes what judges see.

### 1.5 Autonomy: improve things, within the PRD

You're encouraged to use your judgment to make the product better. You may:

- choose libraries, file structure inside the layout in §3, UI design, and component patterns;
- refactor, add tests, add useful logging or metrics;
- improve copy and visual polish, and add small robustness improvements;
- tune any **tunable default** (§2.2) when you have measured evidence;
- correct factual errors in the PRD (wrong addresses, ABI shapes, event fields).

Every non-trivial choice like this gets one line in the Decision log (§9): what you changed, why, and the evidence.

You may **not**:

- break a hard rule;
- remove or weaken a core feature (PRD §3);
- add paid services;
- change the product idea or the primary track.

### 1.6 Secrets hygiene

- **Private keys and tokens live only in gitignored files** (§4) and in platform secret stores (Wrangler secrets, Vercel env).
- **Never** print secret values in chat, logs, test output, commit messages, or client bundles.
- Scripts that sync secrets read from files and write to stores without echoing the values.
- Before every commit, run `pnpm secrets:check`, which greps the staged diff for 64-hex keys and known token prefixes. It must exit 0.

---

## 2. Rules from the PRD

### 2.1 Hard rules (never change without asking the human)

| # | Rule | PRD |
|---|---|---|
| H1 | Web app only. No Android or iOS app. | §10 |
| H2 | Mainnet is read-only. All writes happen on Monad testnet (10143). | §10 |
| H3 | The demo-critical path depends only on Monad RPC, Perpl's contracts, Privy, our Worker/DO, and our Vercel routes. **No Perpl web app, Perpl REST, or Perpl WebSocket on it.** No browser request may go to `*.perpl.xyz`. | Principles, §10 |
| H4 | No new smart contracts in the core. | §3, §10 |
| H5 | The operator key can call only `increasePositionCollateral`. All six other operator selectors are revoked at provisioning, and this is checked every time. | §5.2 |
| H6 | Lifeline never opens, closes, or reduces positions automatically in the core. | §10 |
| H7 | Privy is the only account layer, and judges get guest accounts with no login. No Mera, Dynamic, or thirdweb. | §5.4, §10 |
| H8 | $0. No paid plans, no card-required services, no paid APIs, no gas sponsorship services. | Principles |
| H9 | The liquidation math follows PRD §5.3. Values show an "est." label until G4 passes. | §5.3 |
| H10 | Operator transactions are serialized through one Durable Object, so there are no nonce races. | §F6 |
| H11 | Secrets never go into git, the client bundle, or logs. | — |
| H12 | The judge flow needs at most one wallet transaction (`acceptOwnership`) before seeing Lifeline act. The mandate is a gasless signature. | §F4–F5 |

### 2.2 Tunable defaults (change only with measured evidence, logged in §9)

| Parameter | Default | Where |
|---|---|---|
| User mandate | trigger 4%, target 6%, per-action cap 150 AUSD, budget 50% of free balance, expiry 7 days | §F5 |
| House mandate | trigger 1.5%, target 2.5% | §F4 |
| Twin house mandate | trigger 4%, target 6%, budget 300 AUSD | §F8 |
| Minimum action | 5 AUSD | §5.3 |
| Cooldown | 3 blocks per position | §5.3 |
| Alarm interval | 2 s | §5.5 |
| Canary interval | 10 min | §5.5 |
| Dust threshold | $10 notional | §5.3 |
| Buckets | 0.25% of mark, from −15% to +15% | §5.3 |
| At-risk threshold | distance under 5% | §5.3 |
| Crash slider range | ±10% | §F2 |
| "Saved" rule | free balance covers the deposit needed to stay at least 1% from the shocked price | §F2 |
| Claim drip | 0.08 testnet MON | §F4 |
| Rate limits | 1 claim per Privy user; 3 per IP per hour | §F4 |
| Pool account funding | 400 AUSD (about 100 to the position, about 300 free) | §5.9 |
| Pool size | at least 20 available; alert below 10 | §5.9 |
| Pool positions | BTC at the highest allowed leverage up to 15×; ETH up to 12× | §5.9 |
| Cache | radar 2 s; history 60 s | §5.7 |

---

## 3. Repository map (target layout)

Create this layout in S0.1. Keep it unless the Decision log records a better one.

```
/                              repo root (this directory)
├─ prd.md  analysis.md   backlog.md      product docs (do not edit prd.md except factual fixes, logged in §9)
├─ README.md                   what it is, how to run, architecture, ops runbook (written in R1)
├─ package.json                pnpm workspace root: scripts lint, test, build, secrets:check, cli
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .gitignore                  must include: secrets/, .env*, .dev.vars, cli-state/, node_modules, .next, .wrangler
├─ .env.example                every variable name from §4, with empty values and comments
├─ secrets/                    GITIGNORED. testnet-keys.env (agent-generated), services.env (human-filled)
├─ cli-state/                  GITIGNORED. Provisioning state (pool.json, twins.json), resumable
├─ packages/
│  └─ core/                    @lifeline/core: runtime-agnostic TypeScript, no Node- or Worker-only APIs
│     ├─ src/config/           chains, addresses, RPC lists, gas limits, tunable defaults
│     ├─ src/abi/              Exchange (from PerplFoundation/dex-sdk, MIT), DelegatedAccount/Factory (minimal fragments), ERC20, faucet, Multicall3
│     ├─ src/math/             liquidation, distance, sizing, buckets, crash simulation
│     ├─ src/chain/            viem client factory with fallback, readers (perps, positions, accounts), multicall
│     ├─ src/radar/            snapshot builder and types (zod schemas)
│     ├─ src/lifeline/         mandate EIP-712, validator, evaluator, transaction builders
│     ├─ src/hypersync/        query client and event decoders
│     └─ test/                 vitest unit and integration tests
├─ apps/
│  ├─ web/                     Next.js (App Router) on Vercel: UI plus /api routes (Node runtime)
│  │  └─ e2e/                  Playwright specs
│  ├─ worker/                  Cloudflare Worker plus Lifeline Durable Object (SQLite), via wrangler
│  └─ cli/                     Node CLI: keys, funding, faucet, gates, pool, twins, status
└─ (if-time) apps/node-keeper/, apps/mm-plugin/, apps/cre/
```

**Standard commands.** Create these in S0.1 and keep them working:

| Command | Does |
|---|---|
| `pnpm install` | Install everything |
| `pnpm -r build` | Build all packages and apps |
| `pnpm -r test` | Unit tests (vitest). Integration tests are tagged and run with `pnpm test:int` |
| `pnpm lint` | ESLint and TypeScript `--noEmit` |
| `pnpm secrets:check` | Scan staged changes for secrets |
| `pnpm cli <command>` | Run CLI commands (§5) |
| `pnpm --filter web dev` | Local web app on `http://localhost:3000` |
| `pnpm --filter worker dev` | Local Worker (`wrangler dev`) |
| `pnpm --filter web e2e` | Playwright against `E2E_BASE_URL` (default localhost) |

---

## 4. Environment and secrets catalog

### 4.1 `secrets/testnet-keys.env` (generated by the agent in S0.3; never committed)

| Variable | Role |
|---|---|
| `SPONSOR_PK` | Holds MON. Gas drips to judges, operator, and the other roles |
| `POOL_OWNER_PK` | Owns pool and twin proxies until a claim; signs house mandates |
| `OPERATOR_PK` | Lifeline operator. Only `increasePositionCollateral` |
| `MAKER_PK` | Counterparty for self-match fills |
| `CALIBRATION_PK` | A plain EOA Perpl account for G4 UI calibration. Testnet only; the human may import it into a browser wallet |
| `TEST_OWNER_PK` | A scripted stand-in for a judge wallet in integration tests |

### 4.2 `secrets/services.env` (filled by the human in S0.6)

| Variable | Source |
|---|---|
| `ENVIO_API_TOKEN` | app.envio.dev → API tokens |
| `PRIVY_APP_ID` | Privy dashboard (public value) |
| `PRIVY_CLIENT_ID` | Privy dashboard, if the SDK version needs it (public value) |
| `PRIVY_VERIFICATION_KEY` | Privy dashboard → app settings → verification key (public key for access tokens) |
| `ALCHEMY_MONAD_MAINNET_URL` / `ALCHEMY_MONAD_TESTNET_URL` | Optional free fallback RPC |
| `ADMIN_SECRET` | Generated by the agent (random 32 bytes) |
| `RADAR_SALT` | Generated by the agent (random), used to anonymize account IDs |

### 4.3 Derived configuration

**Worker secrets** (set with `wrangler secret put` from the files above by `pnpm cli secrets:sync-worker`):

- `OPERATOR_PK`, `POOL_OWNER_PK`, `SPONSOR_PK`;
- `ADMIN_SECRET`, `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`;
- `RPC_URLS_TESTNET`, `LIFELINE_PAUSED`.

**Vercel env** (set by `pnpm cli secrets:sync-vercel`, after the human links the project):

- `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`;
- `NEXT_PUBLIC_WORKER_URL`;
- `ENVIO_API_TOKEN`, `RPC_URLS_MAINNET`, `RPC_URLS_TESTNET`;
- `RADAR_SALT`, `WORKER_HEALTH_URL`.

**Balance floors** (checked by `pnpm cli status`):

| Role | Floor |
|---|---|
| Sponsor | ≥ 3 MON |
| Operator | ≥ 1 MON (auto-topped from sponsor below 1, up to 5) |
| Pool owner | ≥ 1 MON |
| Maker | ≥ 0.5 MON and ≥ 5,000 AUSD |

Below any floor, `pnpm cli status` prints `LOW:` lines and exits non-zero.

---

## 5. CLI command catalog (apps/cli)

The agent builds these across phases. Every command is idempotent or resumable, and prints only addresses, amounts, and transaction hashes.

| Command | Purpose | Built in |
|---|---|---|
| `keys:generate` | Create `secrets/testnet-keys.env` if it's missing (never overwrite) and print the addresses | S0.3 |
| `verify:addresses` | Check code exists at every PRD §5.2 address on both chains, and cross-check the collateral token and faucet token | S0.2 |
| `status` | MON and AUSD balances for each role, pool inventory and distances, twins, floors | S0.5 |
| `fund:mon` | Distribute MON from the sponsor to each role up to its target | S0.5 |
| `faucet:ausd` | Loop `requestFunds` (respecting the global 60 s cooldown) until the AUSD targets are met | S0.5 |
| `gate:<n>` | Gate scripts G1–G8 | Phase 1 |
| `pool:create --count N --market BTC\|ETH` | Full provisioning (§P3) | Phase 3 |
| `twins:create` | Twin pairs (§P4) | Phase 3 |
| `pool:register` | Register state-file entries with the Worker `/admin/pool` | Phase 4 |
| `secrets:sync-worker` / `secrets:sync-vercel` | Push secrets to the platforms without echoing them | Phase 6 |

---

## 6. Human steps at a glance

The human can prepare these in advance.

| ID | Step | Needed by |
|---|---|---|
| S0.4 | Fund the sponsor address with testnet MON from faucets (repeat whenever the agent asks) | All onchain work |
| S0.6 | Envio API token; Privy app plus dashboard settings; Cloudflare login approval; optional Alchemy free RPC | Gates G2, G3, G5 |
| G2-H | Only if browser automation can't drive Privy: click through a local test page | G2 |
| G4-H | Import the calibration key into a browser wallet, open the Perpl testnet UI (works from India), and read one liquidation price | G4 |
| D1 | Vercel login and project link | Deploy |
| D4 | UptimeRobot free monitor (keyword check on `/health`) | Ops |
| D7 | A real judge run on your own phone and laptop browsers | Release |
| D8 | Record the backup demo video | Release |
| R2 | Submit on the Metropolis portal (Track 1 plus bounties) | Release |
| If-time | Perpl testnet API key (X1), MetaMask Agent Wallet login (X2), Nansen API key (X3), Telegram bot token (X4), CRE login (X6), laptop standby host (B1) | Phase 8 |

---

## 7. Backlog

### Phase 0: Setup

#### [x] S0.1 Repository scaffold
- **Type:** AGENT · **Depends on:** none · **PRD:** §5.1
- **Do:**
  - `git init`.
  - Set up the pnpm workspace in the §3 layout, a strict `tsconfig.base.json`, ESLint, vitest, and the root scripts from §3.
  - Add a `.gitignore` covering every path in §3, and a `.env.example` listing every variable in §4.
  - Add `secrets:check`, a script that scans `git diff --cached` for `0x` followed by 64 hex characters and for token patterns.
- **Pass:**
  - `pnpm install && pnpm -r build && pnpm -r test && pnpm lint` exit 0.
  - `git check-ignore secrets/x cli-state/x .dev.vars .env.local` prints all four paths.
  - Staging a fake 64-hex key makes `pnpm secrets:check` exit non-zero.
- **Evidence:** `pnpm install && pnpm -r build && pnpm -r test && pnpm lint` exit 0 (Next.js 15.5.27, vitest 5 tests). `git check-ignore` printed `secrets/x`, `cli-state/x`, `.dev.vars`, `.env.local`. Staging `0x` + 64 hex made `pnpm secrets:check` exit 1 (`private-key`). `git init` reinitialized an existing empty repo.

#### [x] S0.2 Core config, addresses, ABIs
- **Type:** AGENT · **Depends on:** S0.1 · **PRD:** §5.2
- **Do:**
  - In `packages/core/src/config`, add chain objects for 10143 and 143 (viem `monadTestnet` and `monad`), every address from PRD §5.2, ordered RPC fallback lists, and an empty `GAS_LIMITS` map to be filled in G7.
  - Vendor `Exchange.json` from `github.com/PerplFoundation/dex-sdk` (`crates/sdk/abi/dex/Exchange.json`, MIT) and note its license and the commit hash.
  - Hand-write minimal ABI fragments for `DelegatedAccount` and its factory: `create`, `owner`, `pendingOwner`, `transferOwnership`, `acceptOwnership`, `createAccount`, `withdrawCollateral`, `setOperatorAllowlist`, `isOperator`, `operatorNonces`, `DOMAIN_SEPARATOR`, fallback-forwarded Exchange calls, and the `DelegatedAccountCreated` event. **Don't copy BUSL source code.**
  - Add ERC20, the Agora faucet (`requestFunds`, `faucetDripAmount`, `maxAmountToOwn`, `maxDripFrequency`, `lastDripTimestamp`, `token`), and Multicall3.
  - Implement `pnpm cli verify:addresses`.
- **Pass:**
  - `verify:addresses` reports code at every address on its chain.
  - `Exchange.getExchangeInfo()` collateral equals the AUSD address on both chains.
  - `faucet.token()` equals testnet AUSD.
  - Multicall3 has code on both chains.
  - The command exits 0.
- **Evidence:** `pnpm cli verify:addresses` exit 0. Code present on mainnet exchange (225), AUSD (5937), Multicall3 (3808) and testnet exchange (225), factory (4514), AUSD (5937), faucet (1200), Multicall3 (3808). `getExchangeInfo` collateral and `faucet.token()` both matched the PRD AUSD address on the chain where each exists. Exchange ABI vendored from dex-sdk `dbb37c59` (MIT).

#### [x] S0.3 Generate testnet role keys
- **Type:** AGENT · **Depends on:** S0.1 · **PRD:** §5.4
- **Do:**
  - Implement `pnpm cli keys:generate`, which writes `secrets/testnet-keys.env` with the six keys in §4.1. It refuses to overwrite an existing file.
  - Print only the role and its address.
  - Generate `ADMIN_SECRET` and `RADAR_SALT` into `secrets/services.env`, creating the file if needed and never overwriting existing values.
- **Pass:**
  - The file exists with six distinct valid keys.
  - `git check-ignore secrets/testnet-keys.env` succeeds.
  - Re-running the command doesn't change the file (compare checksums).
- **Evidence:** `pnpm cli keys:generate` created `secrets/testnet-keys.env` and printed six addresses (sponsor `0x85db51Abac83F8B1DF2E674c29f8D68527Bf6b10`). Second run printed `testnet-keys.env unchanged` and the file checksum matched. `git check-ignore secrets/testnet-keys.env` printed the path. `ADMIN_SECRET` and `RADAR_SALT` were written into `secrets/services.env` and kept on the second run. Values were not printed.

#### [x] S0.4 Fund the sponsor with testnet MON
- **Type:** **HUMAN** (recurring) · **Depends on:** S0.3 · **PRD:** §5.9
- **Prompt the human:** fund the **SPONSOR** address (print it) with testnet MON. **Target ≥ 15 MON** in total; the first batch can be smaller (≥ 5).
  - Use `https://faucet.monad.xyz`. Connecting Discord or X raises the amount; full-access Discord roles get up to 5 MON per 12 hours per address.
  - Several personal addresses can claim and then send to the sponsor.
  - Other testnet faucets (QuickNode, Chainlink, Owlto) are fine if they're free.
- **Pass:** `pnpm cli status` shows sponsor MON ≥ 5 for the first pass, and ≥ 15 cumulative before D3.
- **Evidence:** `pnpm cli status` showed `SPONSOR MON=10.0000` before the first distribution (first pass ≥ 5). A second 10 MON transfer brought the pre-top-up balance to 13.001. Cumulative received is 20, which clears the 15 MON bar for D3. After the final `fund:mon`, sponsor `MON=11.9650`.

#### [x] S0.5 Distribute MON and accumulate AUSD
- **Type:** AGENT · **Depends on:** S0.2, S0.4 · **PRD:** §5.9
- **Do:**
  - Implement `fund:mon`, which sends MON to the operator (target 5), pool owner (2), maker (0.5), calibration (0.2), and test owner (0.2), keeping the sponsor at or above its floor.
  - Implement `faucet:ausd`. It reads the faucet parameters onchain, respects the global `lastDripTimestamp + maxDripFrequency` cooldown, and loops `requestFunds` for the pool owner and maker until each holds **≥ 25,000 AUSD**, and the calibration and test-owner keys hold **≥ 1,000**. Each transaction uses an explicit gas limit.
  - Implement `status`.
- **Pass:**
  - `pnpm cli status` shows every role at or above target. The command exits 0, with no `LOW:` lines.
  - Each faucet call's receipt status is 1.
- **Fallback:** If the faucet reverts with `MaxFrequencyExceeded`, back off and retry. If it reverts with `InsufficientFunds` or similar, stop and ask the human (§1.4).
- **Evidence:** Eight `requestFunds` receipts, all `status=1`. Pool owner and maker hold 30000 AUSD. Calibration and test owner hold 10000 AUSD. Final `fund:mon` receipts, all `status=1`: pool owner +0.12563874 MON `0xb0af20e9`, maker +0.5 MON `0x8f1dc2c6`, calibration +0.2 MON `0x0b0c218f`, test owner +0.2 MON `0x580789f1`. `pnpm cli status` exit 0 with no `LOW:` lines: sponsor 11.9650 MON, operator 5, pool owner 2 and 30000 AUSD, maker 0.5 and 30000 AUSD, calibration 0.2 and 10000 AUSD, test owner 0.2 and 10000 AUSD.

#### [x] S0.6 Service accounts and credentials
- **Type:** **HUMAN** · **Depends on:** S0.1 · **PRD:** §5.4, §5.6
- **Prompt the human to do all of these in one sitting** and put the values in `secrets/services.env`:
  1. **Envio:** create a free account at `https://app.envio.dev`, create an API token, and set `ENVIO_API_TOKEN`.
  2. **Privy:** create a free app at `https://dashboard.privy.io`.
     - Enable **Guest accounts** (Settings → Advanced).
     - Enable **embedded wallets** for EVM (create for users without wallets).
     - Add allowed origins `http://localhost:3000`. The production origin gets added in D1.
     - Set `PRIVY_APP_ID`, `PRIVY_CLIENT_ID` (if shown), and `PRIVY_VERIFICATION_KEY` (the access-token verification public key).
  3. **Cloudflare:** create a free account with no card. When the agent runs `pnpm --filter worker exec wrangler login`, approve the browser prompt.
  4. **Optional Alchemy:** a free account, with Monad mainnet and testnet RPC URLs in `ALCHEMY_MONAD_*_URL`.
- **Pass:**
  - A HyperSync request with the token returns HTTP 200 (G5 runs the full check).
  - `wrangler whoami` shows the account.
  - The Privy values are non-empty, and `PRIVY_VERIFICATION_KEY` parses as a public key.
- **Evidence:** HyperSync `POST /query` on `monad.hypersync.xyz` returned HTTP 200. `wrangler whoami` shows an OAuth account. `PRIVY_APP_ID` is non-empty. `PRIVY_VERIFICATION_KEY` parses as an EC public key. `PRIVY_CLIENT_ID` was not in the file (set it later only if the dashboard shows one). Optional Alchemy URLs are set.

### Phase 1: Gates (PRD §5.9). Build no product features on a dependency until its gate passes.

#### [x] G5 HyperSync access and liquidation counts
- **Type:** AGENT · **Depends on:** S0.6 · **PRD:** §5.6, §F9
- **Do:**
  - Implement `packages/core/src/hypersync`: a POST `/query` client and decoders for `PositionLiquidated` and `IncreasePositionCollateral`. Compute topic0 from the ABI, not by hand.
  - Count mainnet and testnet `PositionLiquidated` events from each Exchange's deploy block, which the SDK chain constants or the first Exchange log provide.
  - Log both counts in §9.
- **Pass:**
  - Both queries return 200 and paginate to the head.
  - Decoding a sample of 5 or more mainnet events (or all, if fewer exist) yields sane fields: `perpId` is an existing market, prices are close to the historical range, and lots are greater than 0.
  - Counts are recorded.
- **Fallback:**
  - If testnet's count is 0, set the twins display mode to "crossed liquidation price" (PRD F8) and log it.
  - If the token fails, re-prompt S0.6.
- **Evidence:** `pnpm cli gate:5` exit 0. Both scans reached the HyperSync head. Mainnet first Exchange log block 54773010, 3488 `PositionLiquidated` events, 5 pages. Testnet first log block 12174508, 272 events, 2 pages. Five mainnet samples decoded: perpIds 1 and 10 are live markets, scaled marks about 70600, 67302, 69164, 0.0225, and 0.0228, and every `liqLotLNS` was greater than 0.

#### [ ] G8 Mainnet snapshot performance and open-interest cross-check
- **Type:** AGENT · **Depends on:** S0.2 · **PRD:** §5.2, §5.3
- **Do:**
  - Implement chain readers in `packages/core/src/chain`: perps from `getPerpetualExistsBitmap`, `getPerpetualInfoV2`, and paged `getPositionsV2` (page size 200, following `nextNodeId`).
  - Use Multicall3 batching and the RPC fallback client.
  - Add the script `gate:8`.
- **Pass:**
  - A cold full mainnet read finishes in **≤ 5 s** on the public RPC, best of 3.
  - For every market, the sum of lots over long positions equals `longOpenInterestLNS` exactly, and the same holds for shorts. Count before any dust filtering.
  - The total position count matches the sum of `numPositions` across pages.
- **Fallback:** If it's slow or rate-limited, add the optional Alchemy URL (prompt S0.6 item 4) and tune batching.
- **Evidence:**

#### [ ] G6 Self-match fill on testnet
- **Type:** AGENT · **Depends on:** S0.5 · **PRD:** §5.9 provisioning step 5
- **Do:**
  1. As the pool owner, create one `DelegatedAccount` through the factory. The operator signs the `AssignOperator(owner, nonce, deadline)` consent using the factory's EIP-712 domain.
  2. Fund it with 400 AUSD and call `createAccount`.
  3. The maker (a plain EOA Perpl account; create it with `createAccount` if needed) posts a **post-only** resting order near the mark.
  4. The proxy owner crosses it with an IOC `execOrder` through the proxy, opening a small BTC long at the target leverage.
  5. Also try a fill against existing testnet liquidity, with no maker.
- **Pass:**
  - The proxy has an open position with the intended side, a lot within ±1 lot unit of the request, and leverage within ±0.5× of the target.
  - The maker holds the opposite position.
  - Receipt status is 1, and gas used is recorded.
  - Both paths (self-match and existing liquidity) are tried, with their outcomes recorded.
- **Fallback:** If the self-match fails, inspect the order fields and post-only semantics against the dex-sdk docs and retry. If both paths fail, mark `[!]` and ask the human.
- **Evidence:**

#### [ ] G1 Operator least privilege: increase-only round-trip
- **Type:** AGENT · **Depends on:** G6 · **PRD:** §5.2, gate 1
- **Do:**
  - On the G6 proxy, the owner calls `setOperatorAllowlist(selector, false)` for `execOrder`, `execOrders`, `requestDecreasePositionCollateral`, `buyLiquidations`, `depositCollateral`, and `allowOrderForwarding`.
  - The operator then sends `increasePositionCollateral(perpId, 1e6)` through the proxy.
  - Simulate operator calls (`eth_call` with `from` set to the operator) to each revoked selector, to `withdrawCollateral`, and to an ERC20 `transfer` from the proxy.
- **Pass:**
  - The real top-up succeeds, the position's `depositCNS` rises by exactly `1e6`, and the account's free balance falls by the same amount.
  - All seven simulated operator calls revert.
  - The owner can still `withdrawCollateral(1e6)` successfully.
- **Fallback:**
  - If the operator `increasePositionCollateral` call reverts because the allowlist lags the Exchange ABI, test the onchain `execOrder` path with order type `IncreasePositionCollateral`. That's 0-indexed enum value 5; confirm it in the dex-sdk.
  - If only that path works, keep `execOrder` allowlisted, log in §9 that H5 is satisfied by the evaluator never building any other order type, and ask the human to approve this deviation.
  - If neither works, mark `[!]` and ask.
- **Evidence:**

#### [ ] G7 Gas limit measurement
- **Type:** AGENT · **Depends on:** G1 · **PRD:** §5.9
- **Do:**
  - From the G6/G1 runs (plus any extra runs), record gas used for: factory `create`, AUSD `transfer`, `createAccount`, `setOperatorAllowlist`, owner `execOrder` open, operator `increasePositionCollateral`, `transferOwnership`, `acceptOwnership`, `withdrawCollateral`, the MON drip, and faucet `requestFunds`.
  - Write `GAS_LIMITS = ceil(max observed × 1.2)` into core config.
- **Pass:**
  - Every transaction type has a limit.
  - Re-sending each type with its configured limit succeeds 3 times out of 3.
  - The cost table (MON at the current base fee) is logged in §9.
- **Evidence:**

#### [ ] G3 Durable Object alarm on the free plan
- **Type:** AGENT · **Depends on:** S0.6, G1 · **PRD:** §5.5, gate 3
- **Do:**
  - Deploy a minimal Worker plus a SQLite-backed Durable Object.
  - Its alarm runs every 2 s and, each tick: does one Multicall3 read of the G1 proxy's position and account; runs the evaluator stub; viem-signs (but doesn't send) a top-up transaction; records the tick time, duration, and errors in SQLite; and reschedules in `finally`.
  - `/health` returns the last tick time and the count of ticks in the last 10 minutes.
  - Run for **30 minutes.**
- **Pass:**
  - Ticks reach at least 95% of the expected count (≥ 855 of 900).
  - There are no CPU-limit or eviction errors in `wrangler tail`.
  - The largest gap between ticks is ≤ 10 s.
  - Signing works in the Worker runtime.
- **Fallback:**
  - Measure and log the CPU per tick.
  - If the free plan can't sustain it, keep the code runtime-agnostic and switch the keeper host to the Node adapter (B1). That needs a laptop, pm2, and Cloudflare Tunnel, so it's a HUMAN step: ask first.
- **Evidence:**

#### [ ] G2 Privy guest wallet: ownership and EIP-712
- **Type:** AGENT, with **HUMAN** fallback (G2-H) · **Depends on:** S0.6, G1 · **PRD:** §5.4, gate 2
- **Do:**
  1. Build a temporary page at `apps/web/app/dev/gate-privy` that creates a guest account, shows the embedded wallet address, can send `acceptOwnership()` on a given proxy (explicit gas and nonce, wallet UI suppressed), and can sign the PRD §F5 `Mandate` typed data.
  2. The CLI drips 0.08 MON to the guest address and calls `transferOwnership(guest)` on a fresh test proxy.
  3. Drive the page with Playwright. If headless Privy can't complete, use G2-H: prompt the human to open `http://localhost:3000/dev/gate-privy` and click the two buttons.
  4. Remove the page, or keep it behind a dev-only flag, once the gate passes.
- **Pass:**
  - `owner()` equals the guest address.
  - The signature recovers to the guest address against the PRD §F5 domain and types.
  - No more than one wallet confirmation UI appeared (ideally none).
  - The Privy access token from the page verifies offline with `PRIVY_VERIFICATION_KEY` (ES256).
- **Fallback:** If guest wallets can't send transactions, try Privy email login (still Privy) and log it in §9. If both fail, mark `[!]` and ask the human, offering sandbox-only mode as the option.
- **Evidence:**

#### [ ] G4 Liquidation-price calibration
- **Type:** AGENT, plus **HUMAN** (G4-H) · **Depends on:** C1, G5, G6 · **PRD:** §5.3 calibration gates
- **Do:**
  - **a. Unit test** (already in C1): the docs example.
  - **b. Historical check.** For up to 20 mainnet `PositionLiquidated` events, reconstruct each position's entry price and deposit from earlier `PositionOpened`, `PositionIncreased`, `IncreasePositionCollateral`, and `PositionDecreased` events for the same account and market (via HyperSync). Compute the liquidation price and compare it with the event's `liqPricePNS`.
  - **c. UI check (G4-H).** The calibration key opens a plain EOA position on testnet; the CLI does this. Then prompt the human: "Import the CALIBRATION key into a browser wallet (testnet only), open `https://testnet.perpl.xyz`, connect, and reply with the Liquidation Price shown for the open position."
  - Use the results to settle the sign of funding (`premiumPnlCNS`).
- **Pass:**
  - Step a passes.
  - For step c, |ours − UI| / UI ≤ 0.1%.
  - For step b, the median relative error is ≤ 0.1% over the events checked. If fewer than 5 events exist, log that and rely on a and c.
  - When all of this passes, flip the config flag `CALIBRATED=true`, which removes the "est." labels (H9).
- **Fallback:** If the error is above 0.1%, investigate funding sign, maintenance-fraction scaling, and lot or price decimals. Until it passes, keep "est." labels and continue the other work; this gate blocks only the label removal.
- **Evidence:**

### Phase 2: Core library (`packages/core`)

#### [ ] C1 Math
- **Type:** AGENT · **Depends on:** S0.2 · **PRD:** §5.3
- **Do:** Implement these as pure functions with bigint-safe scaling, using `number` only for display:
  - MMR, liquidation price, distance;
  - top-up sizing (P*, D*, `add` with caps), minimum action, and cooldown check;
  - dust filter, buckets, the at-risk flag, and "could protect now."
- **Pass (vitest):**
  - **Docs example:** $100k at 10×, D = 10k, MMF = 25 → MMR = 4k, P_liq = 94k, exact.
  - **PRD demo example:** $1,500 notional at 15×, mark 85,260, D = 100, MMF = 25 → P_liq ≈ 82,986 (±1), distance ≈ 2.67%, add to reach 6% ≈ 50 AUSD (±0.5), P_liq after ≈ 80,144 (±1).
  - **Short symmetry:** mirrored inputs give mirrored outputs.
  - **Each cap binds** in its own test: per-action, free balance, and budget.
  - **Edge cases:** distance at or above trigger gives no action; `add` < 5 is skipped; the cooldown blocks a repeat.
  - Line coverage of `src/math` is ≥ 95%.
- **Evidence:**

#### [ ] C2 Chain readers
- **Type:** AGENT · **Depends on:** G8 · **PRD:** §5.2
- **Do:**
  - Turn the G8 readers into a library API: `listPerps`, `readMarket`, `readAllPositions`, `readAccounts(ids)`, `readAccountByAddr`, `readPositionsForAccount`.
  - The RPC fallback client tries each URL in order, with a timeout and one retry.
  - Discover markets onchain, never with a hard-coded list.
- **Pass:**
  - Integration tests on mainnet and testnet return at least one market and positions.
  - The open-interest equality from G8 holds.
  - With the primary RPC replaced by a dead URL, calls still succeed through the fallback.
- **Evidence:**

#### [ ] C3 Radar snapshot builder
- **Type:** AGENT · **Depends on:** C1, C2 · **PRD:** §F1, §5.3, §5.7
- **Do:**
  - `buildSnapshot(chainId)` returns, per market: mark, open interest, buckets (long below, short above), and the at-risk list (anonymized ID = first 8 hex of `keccak(RADAR_SALT, chainId, accountId)`).
  - Each at-risk entry carries side, leverage, notional, distance, deposit, free balance (read only for at-risk accounts), and the "could protect now" flag.
  - Headline totals and the block number.
  - Also export the compact position arrays the crash simulator needs.
  - Write a zod schema for the snapshot.
- **Pass:**
  - The schema validates on a live mainnet snapshot.
  - Headline totals equal the sum over markets.
  - No raw account address or ID appears in the snapshot JSON (grep test).
  - The build finishes in ≤ 6 s cold.
- **Evidence:**

#### [ ] C4 Crash simulator (pure, runs in the browser)
- **Type:** AGENT · **Depends on:** C3 · **PRD:** §F2
- **Do:** `simulate(snapshotPositions, market, shockPct)` returns liquidated count and notional, and saved count and notional, using the §2.2 "saved" rule. The result is labeled first-order.
- **Pass:**
  - Synthetic tests pass, including exact counts for a hand-built set.
  - Liquidated notional is monotonic: never decreases as the shock grows.
  - A 0% shock liquidates 0.
  - It runs in ≤ 20 ms for 1,000 positions in a Node benchmark.
- **Evidence:**

#### [ ] C5 Mandate EIP-712
- **Type:** AGENT · **Depends on:** S0.2 · **PRD:** §F5
- **Do:**
  - Types and domain (`Lifeline` v1, chainId 10143) exactly as in PRD §F5; you may add a `version` field, logged in §9.
  - `buildMandate`, `hashMandate`, `recoverSigner`, and `validateMandate`:
    - 0 < trigger < target ≤ 2000 bps;
    - caps > 0;
    - expiry is in the future and ≤ 30 days out;
    - every perpId is in the account's markets;
    - the nonce is unused.
- **Pass:**
  - A sign/recover round-trip works with a test key.
  - Changing any single field breaks recovery.
  - Every validation rule has a failing-case test.
- **Evidence:**

#### [ ] C6 Lifeline evaluator
- **Type:** AGENT · **Depends on:** C1, C5 · **PRD:** §F6, §5.3
- **Do:** `evaluate(mandate, positionState, accountState, lastActionBlock, nowBlock, budgetUsed)` returns either `{action: 'topUp', amountCNS, distBefore, distTarget}` or `{action: 'skip', reason}`. The skip reasons are:

  | Reason | When |
  |---|---|
  | `MARK_INVALID` | `markPriceValid` is false |
  | `NO_POSITION` | Nothing open on that market |
  | `ABOVE_TRIGGER` | Distance is at or above the trigger |
  | `COOLDOWN` | Fewer than 3 blocks since the last action |
  | `BUDGET_EXHAUSTED` | Budget used up |
  | `BELOW_MIN` | `add` is under 5 AUSD |
  | `NO_FREE_BALANCE` | The account has nothing idle |
  | `EXPIRED` | The mandate has expired |
  | `PAUSED` | The kill switch is on |

  The evaluator never produces any other transaction type (H6).
- **Pass:** Every skip reason and the top-up branch have a unit test, and a property test confirms the amount never exceeds any cap.
- **Evidence:**

#### [ ] C7 Transaction builders
- **Type:** AGENT · **Depends on:** G7 · **PRD:** §5.2, §5.9
- **Do:**
  - Builders for: `increasePositionCollateral` (through the proxy), `transferOwnership`, `acceptOwnership`, `withdrawCollateral`, MON drip, and every provisioning call (factory create with consent signature, transfer, createAccount, setOperatorAllowlist ×6, IOC open, post-only maker order).
  - Every builder takes its gas limit from `GAS_LIMITS`.
- **Pass:**
  - Encoding tests compare against reference calldata.
  - On testnet, `eth_call` simulation of each builder against the G1 proxy succeeds for allowed roles and reverts for disallowed ones, matching G1's results.
- **Evidence:**

#### [ ] C8 HyperSync analytics
- **Type:** AGENT · **Depends on:** G5 · **PRD:** §F9
- **Do:**
  - `liquidationHistory(chainId, days)` returns decoded events with `idleAtLiq = accBalanceCNS − max(accAmountCNS, 0)` and `eligible = idleAtLiq ≥ posDepositCNS`, plus totals, eligible totals, and the latest 50.
  - `lifelineActions(accounts[])` returns testnet `IncreasePositionCollateral` events filtered to those accounts.
  - Save real response fixtures for tests.
- **Pass:**
  - Fixture-based tests pass.
  - A live call returns within 5 s.
  - Totals equal the sum of the rows.
- **Evidence:**

### Phase 3: Provisioning CLI (`apps/cli`)

#### [ ] P1 Faucet and funding commands, hardened
- **Type:** AGENT · **Depends on:** S0.5, G7 · **PRD:** §5.9
- **Do:** Harden `faucet:ausd`, `fund:mon`, and `status`: use the measured gas limits, resume after interruption, and show `LOW:` warnings against the floors in §4.3.
- **Pass:**
  - Killing a run midway and re-running it reaches the targets without duplicate overspend (see the balance deltas).
  - `status` exits non-zero when a floor is breached (test this by setting a temporarily high floor).
- **Evidence:**

#### [ ] P2 Pool provisioning: `pool:create`
- **Type:** AGENT · **Depends on:** G1, G6, C7 · **PRD:** §5.9
- **Do:**
  - Per account, run steps 1–5 from PRD §5.9. Open BTC at the highest allowed leverage up to 15× (derive it from `getMarginFractions`), or ETH up to 12×.
  - Alternate long and short.
  - Prefer existing liquidity, falling back to the maker self-match.
  - Write each step to `cli-state/pool.json` so runs can resume.
- **Pass:**
  - `pool:create --count 3 --market BTC` produces 3 accounts. For each, the owner is the pool owner and the operator is set.
  - All six revoked selectors revert when simulated as the operator.
  - Each position is open with a distance in the expected range (BTC 2.0–3.5%, ETH 2.5–4.5%) and a free balance of ≥ 250 AUSD.
  - Re-running with `--count 3` creates nothing new.
  - The maker's net position is within ±1 position size of flat.
- **Evidence:**

#### [ ] P3 Twins: `twins:create`
- **Type:** AGENT · **Depends on:** P2 · **PRD:** §F8
- **Do:**
  - Open pairs at the same time and leverage: BTC 15× long and short, and SOL 10× long and short (or the allowed maximum).
  - Each pair has one protected and one unprotected position.
  - Record the pairs in `cli-state/twins.json`.
- **Pass:**
  - 4 pairs exist, with the two sides of each pair's entry price within 0.1% of each other.
  - Each has an open position and correct ownership.
  - Unprotected twins have no mandate (verified after W4).
- **Fallback:** If SOL liquidity is thin, use self-match. If that fails, use ETH and log it in §9.
- **Evidence:**

### Phase 4: Worker and Durable Object (`apps/worker`)

#### [ ] W1 Scaffold, secrets, health
- **Type:** AGENT · **Depends on:** G3 · **PRD:** §5.1, §5.5, §5.7
- **Do:**
  - Turn the G3 prototype into the real Worker: a router, one `Lifeline` Durable Object (SQLite), and secret bindings (§4.3).
  - Add `pnpm cli secrets:sync-worker`.
  - `GET /health` returns `{lastAlarmAt, ticksLast10m, degraded, paused, poolAvailable, version}`.
  - Adapters wrap `packages/core` so the core stays runtime-agnostic.
- **Pass:**
  - `wrangler deploy` succeeds.
  - `curl <worker>/health` returns valid JSON with `degraded:false`.
  - `wrangler secret list` shows every required name, and the secret sync prints no values.
- **Evidence:**

#### [ ] W2 Privy access-token verification
- **Type:** AGENT · **Depends on:** W1, G2 · **PRD:** §5.4
- **Do:** Middleware verifies the ES256 JWT using Web Crypto and `PRIVY_VERIFICATION_KEY`, checking issuer, audience (the app ID), and expiry. It resolves the Privy user ID and the embedded wallet address, either from token claims or from a client-supplied address checked against a signed nonce. Choose the most robust option and log it in §9.
- **Pass:**
  - A real token from the G2 page is accepted.
  - Expired, tampered, and wrong-audience tokens each return 401.
- **Evidence:**

#### [ ] W3 Schema and migrations
- **Type:** AGENT · **Depends on:** W1 · **PRD:** §5.5
- **Do:** Create the `pool`, `claims`, `mandates`, `actions`, `keys`, and `health` tables, plus any indexes you need, with migrations versioned in code.
- **Pass:** Migrations are idempotent (applying twice is a no-op), and a round-trip CRUD test passes in `wrangler dev`.
- **Evidence:**

#### [ ] W4 Pool registration and house mandates
- **Type:** AGENT · **Depends on:** W3, P2, P3 · **PRD:** §5.9 step 6, §F4, §F8
- **Do:**
  - `POST /admin/pool` (admin secret) registers entries, and `pnpm cli pool:register` pushes `cli-state` into it.
  - On registration, the Durable Object signs a **house mandate** with the pool-owner key: 1.5%/2.5% for pool positions, 4%/6% with a 300 budget for protected twins, and none for unprotected twins.
- **Pass:**
  - The registered count matches `cli-state`.
  - `GET /mandate/:proxy` returns a house mandate for each pool account and protected twin, whose signature recovers to the pool owner.
  - Unprotected twins return 404.
- **Evidence:**

#### [ ] W5 Keeper alarm loop
- **Type:** AGENT · **Depends on:** W4, C6, C7 · **PRD:** §F6, §5.5
- **Do:**
  - Every 2 s: load active mandates, batch-read positions and accounts with Multicall3, evaluate, and send at most one top-up per position per tick, serialized through the operator key with local nonce tracking.
  - Mark sends pending and confirm on the next tick.
  - Reschedule in `finally`.
  - Auto-top-up the operator's MON from the sponsor when it's below 1.
  - Log every decision (reason codes) to `actions` or the debug log.
- **Pass (1-hour soak on testnet with ≥ 10 armed accounts):**
  - The largest alarm gap is ≤ 10 s, with zero nonce errors and zero stuck pending sends.
  - **Forced breach:** use the admin route to temporarily arm a canary mandate with a trigger above the current distance. A confirmed top-up must land within 2 ticks plus 2 blocks.
  - The distance after a top-up is within [target − 0.2%, target + 0.5%], unless a cap bound it; capped results carry a `capped` reason.
  - No transaction type other than `increasePositionCollateral` is ever sent (check the `actions` table and the explorer).
- **Evidence:**

#### [ ] W6 `POST /claim`
- **Type:** AGENT · **Depends on:** W2, W4 · **PRD:** §F4
- **Do:**
  - Verify the token and enforce the rate limits.
  - Pick an available pool position: prefer BTC, then the lowest distance that's still above the house trigger.
  - Send the 0.08 MON drip and `transferOwnership(wallet)` from the pool owner, wait for both receipts, and return `{proxy, perpId, accountId, txs, position}`.
  - Mark the position `claimed`. The house mandate stays active.
- **Pass (integration with the `TEST_OWNER_PK` wallet and a test token path):**
  - `pendingOwner()` equals the wallet, and the wallet's MON rose by 0.08.
  - A second claim from the same user returns 409.
  - A 4th claim from the same IP within an hour returns 429.
  - An empty pool returns 503 with `{sandbox:true}`.
  - p50 latency is ≤ 3 s over 5 claims.
- **Evidence:**

#### [ ] W7 `POST /arm`, `/disarm`, `/mandate/:proxy`
- **Type:** AGENT · **Depends on:** W6, C5, C6 · **PRD:** §F5, §F7
- **Do:**
  - `/arm` verifies the token, validates the mandate (C5), and checks the signer equals `owner()` by `eth_call`. It then stores the mandate, retires the house mandate, evaluates immediately, and if needed sends and waits for the top-up.
  - It returns `{txHash, block, addedCNS, liqBefore, liqAfter, distBefore, distAfter, msFromRequest}`, or `{skipped, reason}`.
  - `/disarm` requires a signed disarm message (EIP-712 or EIP-191, your choice; log it in §9) from the owner.
- **Pass:**
  - With `TEST_OWNER_PK` owning a claimed position at about 2.7%, arming at 4%/6% returns a confirmed top-up, and an independent chain read shows the distance after within the W5 tolerance.
  - `msFromRequest` p50 is ≤ 2,500 over 5 trials.
  - A mandate signed by a non-owner returns 403.
  - A replayed nonce returns 409.
  - After disarm, a forced breach produces no action.
- **Evidence:**

#### [ ] W8 `GET /twins` and sandbox mode
- **Type:** AGENT · **Depends on:** W5, C8 · **PRD:** §F8, §F4 fallback
- **Do:**
  - `/twins` returns pairs with their distances, Lifeline actions (from C8, read from the chain), and outcome (`liquidated at block X`, `crossed liq at block X`, or `alive`).
  - Add `POST /sandbox/arm` (rate-limited, no wallet). It arms a house-owned sandbox position with user-chosen trigger and target using the house signer, and returns the same payload as `/arm`.
- **Pass:**
  - `/twins` lists every pair from `cli-state` with correct ownership and mandate status.
  - Sandbox arm produces a confirmed top-up within the W7 tolerance.
  - Sandbox is rate-limited (429 on abuse).
- **Evidence:**

#### [ ] W9 Canary, kill switch, self-healing
- **Type:** AGENT · **Depends on:** W5 · **PRD:** §5.5
- **Do:**
  - Every 10 min, simulate `increasePositionCollateral(1)` as the operator on a canary pool account. A revert sets `degraded=true` with a reason.
  - `LIFELINE_PAUSED=true` blocks every send but keeps reads working.
  - `/health` re-arms the alarm if `lastAlarmAt` is more than 10 s old.
- **Pass:**
  - Pointing the canary at a non-allowlisted selector in a test sets `degraded:true`.
  - With paused on, a forced breach yields `skip PAUSED`, and the radar still works.
  - Deleting the alarm manually in a test and then calling `/health` restores ticking within 5 s.
- **Evidence:**

### Phase 5: Web app (`apps/web`)

#### [ ] A1 Scaffold, Privy, design system
- **Type:** AGENT · **Depends on:** G2 · **PRD:** §5.1, §5.4
- **Do:**
  - Start Next.js (App Router, TypeScript), from Monad's Next.js + Privy template or fresh; your call.
  - Add `PrivyProvider` with guest accounts, embedded EVM wallets, and supported chains Monad testnet and mainnet (read-only).
  - Build a dark, data-dense UI shell with routes `/` (Radar), `/a/[address]`, `/lifeline`, and `/twins`.
  - Show global banners for "Lifeline degraded," "RPC degraded," and "Lifeline paused" from `/health`.
- **Pass:**
  - `pnpm --filter web build` succeeds.
  - Playwright: the home page renders with no console errors at 390 px and 1440 px widths.
  - The client bundle contains no secret values (grep the build output for the private-key and token names in §4).
- **Evidence:**

#### [ ] A2 `/api/radar`
- **Type:** AGENT · **Depends on:** C3, A1 · **PRD:** §F1, §5.7
- **Do:**
  - A Node-runtime route calls `buildSnapshot(chain)`.
  - It sets `Cache-Control: public, s-maxage=2, stale-while-revalidate=10`, with an in-memory single-flight cache so concurrent requests share one upstream build.
  - It pings the Worker `/health` fire-and-forget on refresh.
  - It accepts `chain=143|10143`.
- **Pass:**
  - Warm p95 is ≤ 300 ms and cold is ≤ 6 s.
  - A load test of 50 concurrent requests over 10 s causes ≤ 6 upstream builds (check the route's counter).
  - The response validates against the C3 schema.
- **Evidence:**

#### [ ] A3 `/api/account`, `/api/liquidations`, `/api/actions`
- **Type:** AGENT · **Depends on:** C2, C6, C8, A1 · **PRD:** §F3, §F9, §5.7
- **Do:**
  - `/api/account/[address]`: positions, risk metrics, and the evaluator dry run at the default 4%/6%.
  - `/api/liquidations`: C8 history, cached for 60 s.
  - `/api/actions?account=`: C8 Lifeline actions.
  - Every route has RPC fallback and uniform error JSON.
- **Pass:**
  - For a live mainnet address with an at-risk position, the dry-run amount equals `evaluate()` run directly.
  - The liquidations totals equal the sum of the rows.
  - The action tx hashes for a W7 test account equal the Durable Object's `actions` rows.
  - An invalid address returns 400.
- **Evidence:**

#### [ ] A4 Radar UI
- **Type:** AGENT · **Depends on:** A2, A3 · **PRD:** §F1
- **Do:**
  - **Headline strip:** open interest, at-risk notional and count, idle AUSD beside at-risk positions, and the block number.
  - **Per-market liquidation map:** red long buckets below the mark, green short buckets above, 1%, 2%, and 5% bands, and a mark line. Hovering a bucket shows anonymized positions.
  - **At-risk table:** sorted by distance; clicking a row opens `/a/[address]`, or a positional detail view when the address is anonymized. Your call how to deep-link without exposing raw IDs on the map.
  - A recent-liquidations tape, a chain toggle, and a 2 s refresh.
  - Show the "est." label while `CALIBRATED=false`.
  - Make it eye-catching but readable, with smooth transitions.
- **Pass:**
  - Playwright confirms the headline numbers equal the API response.
  - Every market is rendered.
  - Hover shows details, and the toggle switches chains.
  - No raw account IDs or addresses appear on the map (DOM check).
  - Screenshots are saved to `apps/web/e2e/artifacts/`.
- **Evidence:**

#### [ ] A5 Crash simulator UI
- **Type:** AGENT · **Depends on:** C4, A4 · **PRD:** §F2
- **Do:** A per-market slider (±10%) runs C4 in the browser. It highlights buckets that would liquidate, shows the "liquidated / saved" line, and carries the "first-order: excludes cascade price impact" label.
- **Pass:**
  - Each slider step re-renders in ≤ 100 ms with 600+ positions (measured with a performance mark).
  - Displayed numbers equal `simulate()` for 3 sampled shocks.
  - The label is present.
- **Evidence:**

#### [ ] A6 Account lookup and dry run
- **Type:** AGENT · **Depends on:** A3 · **PRD:** §F3
- **Do:**
  - Paste an address on either chain to get a risk card for each position.
  - Show the dry-run sentence in the PRD §F3 format.
  - On mainnet, append "Protection on mainnet: coming via API-key mode."
- **Pass:** For one known mainnet at-risk account and one testnet pool account, the card values equal `/api/account`, the dry-run sentence matches the template, and the mainnet suffix is present.
- **Evidence:**

#### [ ] A7 Try Lifeline flow
- **Type:** AGENT · **Depends on:** W6, W7, A4 · **PRD:** §F4, §F5, §F7
- **Do:**
  1. "Try Lifeline live" creates a guest account → `/claim` → a position card → a single "Accept ownership" button (one transaction, explicit gas and nonce, wallet UI suppressed).
  2. Then show the arm form with PRD defaults and the trade-off text → sign the EIP-712 mandate → `/arm`.
  3. Then the **receipt animation:** the marker moves on the testnet map, with liquidation before → after, distance before → after, the block, milliseconds, and an explorer link.
  4. Then "Withdraw 50 AUSD" (owner transaction) with the note that the operator can't do this and links to the revoked permissions; then "Disarm"; then "Keep this account" (Privy `login()`).
- **Pass (Playwright on a fresh browser context against local and then deployed environments, 3 consecutive runs):**
  - From the first click to the arm receipt takes ≤ 60 s of wall time.
  - At most 1 wallet transaction happens before the receipt.
  - The receipt's `distAfter` meets the W7 tolerance, checked by an independent chain read.
  - The withdraw transaction succeeds and the wallet's AUSD rises by 50.
  - Disarm stops actions.
  - If Playwright can't drive Privy, the human runs it once (prompt as G2-H) and the agent verifies onchain.
- **Evidence:**

#### [ ] A8 Twins panel
- **Type:** AGENT · **Depends on:** W8, A4 · **PRD:** §F8
- **Do:** Show the pairs side by side with distances, action timelines (chain events with explorer links), and the outcome badge.
- **Pass:** It renders every pair from `/twins`. Each action row links to a real transaction whose event matches (amount and account). The outcome badge matches `/twins`.
- **Evidence:**

#### [ ] A9 Fallbacks and error states
- **Type:** AGENT · **Depends on:** A7, W8 · **PRD:** §F4 fallbacks, §5.5
- **Do:**
  - Sandbox mode UI, used automatically when Privy fails, the pool is empty, or accept fails.
  - A retry for accept failure, keeping `pendingOwner` messaging.
  - Banners for degraded, paused, or RPC fallback.
  - Friendly empty and error states everywhere.
- **Pass (Playwright with forced failures):**
  - Privy blocked by a route-abort leads to sandbox arm succeeding.
  - A mocked empty pool (503 `sandbox:true`) leads to sandbox.
  - A degraded `/health` shows the banner.
  - With the RPC primary forced dead, the radar still loads.
- **Evidence:**

#### [ ] A10 Polish and copy
- **Type:** AGENT · **Depends on:** A4–A9 · **PRD:** §2, §9
- **Do:**
  - Tighten all copy to the PRD's voice: plain sentences, the trade-off warning, and the "est." label until calibrated.
  - Add page titles and Open Graph basics, favicon, accessibility labels, and keyboard focus.
  - Add the opening one-liner: "Lifeline keeps Perpl positions from being liquidated while money sits idle next to them."
- **Pass:**
  - Lighthouse (mobile) accessibility is ≥ 90 and performance is ≥ 70 on `/`.
  - Network capture of the full A7 flow shows zero browser requests to `*.perpl.xyz` (H3).
- **Evidence:**

### Phase 6: Deploy and operations

#### [ ] D1 Vercel project
- **Type:** **HUMAN**, then AGENT · **Depends on:** A1 · **PRD:** §5.1
- **Prompt the human:**
  - Create or sign in to a free Vercel account and approve `vercel login` when the agent runs it.
  - Confirm the project name.
  - Afterwards, add the production URL to Privy's allowed origins (Privy dashboard).
- **Agent then:**
  - `vercel link`;
  - `pnpm cli secrets:sync-vercel`;
  - deploy preview, then production.
- **Pass:**
  - The production URL serves `/` with live radar data.
  - The Privy guest flow initializes on the production origin, with no origin error in the console.
- **Evidence:**

#### [ ] D2 Production Worker
- **Type:** AGENT · **Depends on:** W1–W9 · **PRD:** §5.5
- **Do:** Run `secrets:sync-worker` and `wrangler deploy`, and set `NEXT_PUBLIC_WORKER_URL` and `WORKER_HEALTH_URL` in Vercel.
- **Pass:** Production `/health` returns `degraded:false` and `ticksLast10m ≥ 285`.
- **Evidence:**

#### [ ] D3 Production pool and twins
- **Type:** AGENT · **Depends on:** D2, P2, P3 · **PRD:** §5.9
- **Do:**
  - Top up funds: prompt S0.4 if the sponsor is below 15 MON cumulative.
  - `pool:create` until there are at least 20 available, split BTC and ETH.
  - Make sure twins exist, then `pool:register`.
- **Pass:**
  - `/health` shows `poolAvailable ≥ 20`.
  - `pnpm cli status` shows no `LOW:` lines.
  - Every pool position's distance is above its house trigger.
- **Evidence:**

#### [ ] D4 Uptime monitoring
- **Type:** **HUMAN** · **Depends on:** D2 · **PRD:** §5.5
- **Prompt the human:** Create a free UptimeRobot account and add:
  - a keyword monitor on `<worker>/health` that alerts when the body contains `"degraded":true` or the check fails, every 5 minutes, alerting your email;
  - an HTTP monitor on the Vercel `/`.
- **Pass:** Both monitors show "up," and a test alert (pause the Worker briefly with `LIFELINE_PAUSED` or make `/health` fail) reaches the human. The human confirms.
- **Evidence:**

#### [ ] D5 Production end-to-end demo check
- **Type:** AGENT · **Depends on:** D1–D4, A1–A10 · **PRD:** §9
- **Do:** Run the PRD §9 demo script against production with Playwright, on fresh contexts, **3 consecutive times**, measuring every step.
- **Pass:**
  - All 3 runs complete every step.
  - The radar loads in ≤ 3 s.
  - The crash slider responds.
  - The lookup dry run works.
  - Claim, accept, and arm complete, and the receipt satisfies the W7 tolerance.
  - The twins panel renders.
  - Withdraw works.
  - Zero browser requests go to `*.perpl.xyz`.
  - Pool availability stays ≥ 17 afterward.
  - **Only when D5 passes may Phase 8 start.**
- **Evidence:**

#### [ ] D6 Ops runbook
- **Type:** AGENT · **Depends on:** D5 · **PRD:** §5.5, §5.9
- **Do:** In `README.md` under "Operations," document: checking status, refilling the pool, topping up MON and AUSD, the kill switch, reading `/health`, rotating a compromised testnet key, switching to the Node keeper (B1), and recovering from a testnet reset (config-only).
- **Pass:** Each procedure has copy-pasteable commands, and a dry run of "refill pool" and "toggle kill switch" from the runbook works as written.
- **Evidence:**

#### [ ] D7 Judge rehearsal on real devices
- **Type:** **HUMAN** · **Depends on:** D5
- **Prompt the human:** Run the demo script yourself on (a) a phone browser and (b) a laptop browser in a fresh profile, ideally one with a VPN set to a US location. Reply with any step that felt slow or confusing.
- **Pass:** The human confirms both runs completed. The agent fixes the issues reported (each one becomes a new task appended to Phase 5 or 6) and re-runs D5.
- **Evidence:**

#### [ ] D8 Backup demo video
- **Type:** **HUMAN** · **Depends on:** D7
- **Prompt the human:** Record the PRD §9 script (≤ 3 min) with screen and voiceover. Upload it (unlisted YouTube or similar) and reply with the link.
- **Pass:** The link plays and covers all §9 beats. The agent adds it to the README.
- **Evidence:**

### Phase 7: Release

#### [ ] R1 README and repository hygiene
- **Type:** AGENT · **Depends on:** D5
- **Do:**
  - **README sections:**
    - what Lifeline is (the PRD §2 paragraph) and live links;
    - an architecture diagram as text or Mermaid;
    - how to run locally and the repository map;
    - a security model: operator least privilege, keys are testnet-only, and the `Ownable2Step` claim flow;
    - honest limitations: testnet protection, mainnet read-only, first-order crash simulation, calibration status;
    - attribution: Perpl dex-sdk ABIs (MIT); Perpl `DelegatedAccount` is used as deployed (BUSL source not copied);
    - the backup video link.
  - Add an MIT `LICENSE` for our code.
- **Pass:**
  - A fresh clone, `pnpm install && pnpm -r build && pnpm -r test`, succeeds.
  - `pnpm secrets:check` over the whole history (`git log -p`) finds nothing.
  - Every README link resolves.
- **Evidence:**

#### [ ] R2 Submission on the Metropolis portal
- **Type:** **HUMAN** · **Depends on:** R1, D8
- **Prompt the human:**
  - Submit on the Metropolis dashboard: project profile, demo video, short write-up, and code link.
  - Choose primary track **Track 1: Onchain Finance & Trading**.
  - Select the bounties: Perpl "Best use of Perpl's API," Perpl "Best Analytics / Risk Tool," Envio "Best Use of Envio," and Privy. Add MetaMask, Nansen, and CRE only if their Phase 8 tasks are `[x]`.
  - Fill each bounty's required fields.
  - The agent prepares a fact sheet of links, the bounty-to-feature mapping, and key numbers for the human to use in their own words.
- **Pass:** The human confirms the submission and the selected bounties.
- **Evidence:**

### Phase 8: If time remains (start only after D5 is `[x]`; in this order)

Each item must keep every hard rule and must not regress D5. Re-run D5 after each item.

#### [ ] X1 API-key mode (existing Perpl accounts)
- **Type:** AGENT, plus **HUMAN** (key creation) · **PRD:** §6.A.1
- **Human step:** Using the CALIBRATION EOA in a browser wallet, open the Perpl testnet UI, enable trading, create a **trade-scoped** API key, and save the token and Ed25519 secret into `secrets/services.env` as `PERPL_TESTNET_API_KEY` and `PERPL_TESTNET_API_SECRET`.
- **Agent:**
  - A server-side Perpl trading-WebSocket client (Ed25519-signed sign-in) that sends `IncreasePositionCollateral` (order type 6).
  - A mandate variant for API-key accounts.
  - Run it from a non-US region (Vercel function region or Worker; verify Perpl doesn't geo-block it). It must never be on the judge-critical path.
- **Pass:**
  - A forced breach on the calibration account produces a top-up with the W5 tolerance through the API path.
  - A withdrawal attempted through the API key is rejected (Perpl's design).
  - D5 still passes.
- **Evidence:**

#### [ ] X2 MetaMask Agent Wallet plugin
- **Type:** AGENT, plus **HUMAN** (`mm` login) · **PRD:** §6.A.2
- **Do:**
  - Package an oclif plugin in `apps/mm-plugin` with an `mm` manifest.
  - Commands: `lifeline radar <market>`, `lifeline risk <address>`, `lifeline claim`, and `lifeline arm`.
  - The mandate is signed with `walletExecutor` typed-data signing; `acceptOwnership` is submitted on chain 10143.
- **Human step:** Install and sign in to MetaMask Agent Wallet (`mm`), enable plugins, and approve the local install consent screen.
- **Pass:**
  - `mm lifeline radar BTC` prints buckets that match the API.
  - `mm lifeline claim` then `mm lifeline arm` produces a confirmed top-up.
  - The plugin installs from a local path with the consent screen showing the declared capabilities.
- **Evidence:**

#### [ ] X3 Nansen badges
- **Type:** AGENT, plus **HUMAN** (free Nansen API key into `NANSEN_API_KEY`) · **PRD:** §6.A.3
- **Do:**
  - Server-side, for the 20 largest at-risk mainnet accounts, resolve the owner address and fetch Nansen labels and PnL summary.
  - Cache for 24 hours and enforce a credit budget so it never exceeds the free tier.
  - Show badges on the radar and the risk card.
- **Pass:**
  - Badges render for any covered addresses.
  - Daily credits used are ≤ 10 after the initial cache fill (logged).
  - With the key missing, the feature turns off silently.
- **Evidence:**

#### [ ] X4 Liquidation alerts
- **Type:** AGENT, plus optional **HUMAN** (Telegram bot token from BotFather) · **PRD:** §6.A.4
- **Do:**
  - Web push, using the service worker from the template, or a Telegram bot.
  - Alert when a watched address crosses 5% or 3%, or a cluster comes within 1% of the mark.
  - Evaluate from the radar snapshot cadence.
- **Pass:** Subscribing a testnet pool account and forcing its distance under 5% (via a twin or a test) delivers an alert within 10 s.
- **Evidence:**

#### [ ] X5 Replay a real liquidation
- **Type:** AGENT · **PRD:** §6.A.5
- **Do:** For a chosen historical mainnet liquidation, reconstruct the position and its mark path (Perpl candles server-side from a non-US region, with an onchain fallback). Animate the path, with the block where Lifeline would have acted and the AUSD it would have used.
- **Pass:** The replay's liquidation price matches the event's `liqPricePNS` within 0.1%, and the "Lifeline would act" block is the first block where distance fell below 4%.
- **Evidence:**

#### [ ] X6 Chainlink CRE liquidation-pressure feed
- **Type:** AGENT, plus **HUMAN** (`cre login`, free) · **PRD:** §6.A.6
- **Do:**
  - A cron workflow (TypeScript SDK) reads mainnet positions through CRE's EVM read and computes notional within 1%, 3%, and 5% per side.
  - It writes a report to a small `LiquidationPressureFeed` consumer contract on testnet. This is the only contract we add, and only in Phase 8: MIT, minimal, Foundry tests.
  - Run it with `cre workflow simulate` and broadcast.
  - Show "Attested by CRE" on the radar; the keeper may raise targets when pressure is high.
- **Pass:** The simulated run writes a report onchain, the feed values match `buildSnapshot` within 1%, and the radar shows the attested values with a link.
- **Evidence:**

#### [ ] X7 Cascade with real book depth
- **Type:** AGENT · **PRD:** §6.A.7
- **Do:** An iterative cascade using `getVolumeAtBookPrice` levels around the mark, behind a "cascade" toggle.
- **Pass:** With no positions in range, the cascade equals the first-order result. Liquidated notional is ≥ the first-order result for any shock. It renders in ≤ 300 ms.
- **Evidence:**

#### [ ] X8 Open your own testnet position
- **Type:** AGENT · **PRD:** §6.A.8
- **Do:** An owner-side IOC open through the proxy from the judge's wallet. On no fill, show "Testnet book thin; claim a ready position."
- **Pass:** It succeeds when testnet liquidity exists, and shows the fallback message with no stuck state when it doesn't (test with a deliberately unreachable price bound).
- **Evidence:**

#### [ ] X9 Shareable save cards
- **Type:** AGENT · **PRD:** §6.A.9
- **Do:** An Open Graph image route plus a public receipt page for each Lifeline action.
- **Pass:** The card renders with real values for a real action transaction, and the link unfurls (verified with an OG validator).
- **Evidence:**

#### [ ] B1 Node keeper warm standby
- **Type:** AGENT, plus **HUMAN** (an always-on laptop, pm2, Cloudflare Tunnel login) · **PRD:** §6.B.1
- **Do:** `apps/node-keeper` reuses the core with a Node adapter and a **separate operator key**, added as a second operator on pool accounts. The standby path needs one more `addOperator` per account. Failover is manual: a flag tells the Durable Object to stop and the node keeper to start.
- **Pass:** With the Durable Object paused and the node keeper active, a forced breach is defended within the W5 tolerance.
- **Evidence:**

#### [ ] B2 RPC health scoring and `/metrics`
- **Type:** AGENT · **PRD:** §6.B.2
- **Pass:** `/metrics` reports alarm lag, action latency p50/p95, and failures by reason, and a dead primary RPC is demoted automatically within 3 failures.
- **Evidence:**

#### [ ] B3 Automatic pool refill
- **Type:** AGENT · **PRD:** §6.B.3
- **Pass:** When availability drops below 10, the Durable Object provisions up to 20 by self-match, with no human involved and all G1 checks applied to the new accounts.
- **Evidence:**

#### [ ] B4 Volatility-aware targets
- **Type:** AGENT · **PRD:** §6.B.4
- **Pass:** The target adjusts within [user target, user target + 3%] based on recent mark variance, with a unit test and a logged rationale.
- **Evidence:**

#### [ ] B5 Reduce mode
- **Type:** AGENT, plus a **HUMAN** decision (it re-enables `execOrder` for opted-in accounts, which changes H5 and H6 for those accounts) · **PRD:** §6.B.5
- **Pass:** Only opted-in accounts can be reduced. Reduce happens only when the budget is exhausted and distance is under the trigger. The order is an IOC close.
- **Evidence:**

#### [ ] B6 Our own protected-account contract
- **Type:** AGENT, plus a **HUMAN** decision (adds a contract) · **PRD:** §6.B.6
- **Pass:** MIT, written from scratch, deployed as immutable clones. Budget and per-action caps are enforced onchain, with Foundry fork tests against the testnet Exchange. The engine works unchanged.
- **Evidence:**

#### [ ] B7 Calibration suite
- **Type:** AGENT · **PRD:** §6.B.7
- **Pass:** Every new `PositionLiquidated` event is checked against our math, and drift above 0.1% sets a degraded-calibration banner.
- **Evidence:**

---

## 8. Definition of done (core)

The core is done when all of these hold:

- Every task in Phases 0–7 is `[x]`, or `[-]` with a logged reason. No `[!]` remains.
- D5 has passed 3 consecutive times on production.
- Every hard rule in §2.1 holds. Specifically:
  - H3: no browser requests go to `*.perpl.xyz`.
  - H5: the operator's revoked selectors revert, verified on a fresh pool account at release.
  - H11: `secrets:check` is clean over all history.
- `pnpm cli status` shows no `LOW:` lines, and the pool has at least 20 positions available.
- The README is complete, the backup video link works, and the submission is confirmed (R2).

---

## 9. Decision log

Append one line per decision, in order: `<task-id> | decision | why | evidence`.

- S0.1 | `!.env.example` under `.env*` | the catalog must be committed and every other `.env*` file must stay ignored | `git status` lists `.env.example` as untracked
- S0.1 | `secrets:check` skips the `0x`+64-hex key pattern inside `packages/core/src/abi/*.json` | vendored Exchange ABI contains 176 bytes32 literals of that shape; token-prefix scans still apply there | count on `Exchange.json` at dex-sdk `dbb37c59`
- S0.2 | mainnet RPC order is `rpc.monad.xyz`, `rpc-mainnet.monadinfra.com`, `rpc1.monad.xyz` | PRD fallback is public RPC, then Monad infra, then Alchemy free; `rpc1.monad.xyz` is the documented public Alchemy endpoint | docs.monad.xyz network-information; `verify:addresses` exit 0
- S0.2 | testnet RPC order is `testnet-rpc.monad.xyz`, then `rpc-testnet.monadinfra.com`; `ALCHEMY_MONAD_TESTNET_URL` is appended when set | testnet docs publish no public Alchemy URL | docs.monad.xyz testnets
- S0.2 | faucet fragment is `requestFunds(address)` | Agora's deployed faucet takes the receiver | `faucet.token()` matched testnet AUSD during `verify:addresses`
- S0.2 | `secrets:check` sets `maxBuffer` to 64MB on `git diff --cached` | Node's default 1MB buffer throws on the vendored Exchange artifact | staging `Exchange.json` made the checker exit 1 before the buffer increase
- S0.6 | copy `PRIVY_PUBLIC_KEY` into `PRIVY_VERIFICATION_KEY` | dashboard value was stored under the public-key name; the pass check names the verification key | Node `createPublicKey` parsed it as `ec`
- S0.5 | sponsor calls `requestFunds(receiver)` | `estimateGas` from the sponsor succeeded for another address | faucet tx `0xd9fd4331` status=1
- S0.5 | explicit gas is `ceil(estimate × 1.2)` until G7 writes `GAS_LIMITS` | Monad charges the gas limit | transfer limit 25200; faucet limits 156720 and 136158
- S0.5 | `fund:mon` stops when the next send would put the sponsor under 3 MON | 10 MON cannot pay 7.9 of role targets plus gas and still leave the floor | status after the run: sponsor `MON=3.0010`
- G5 | sample lot check uses `liqLotLNS > 0` | `posLotLNS` is the lot remaining after liquidation and is 0 on a full close | first mainnet samples had `posLot=0` and `liqLot` 10, 1600, 1132, 488
