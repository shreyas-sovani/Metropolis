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
4. Continue with the first eligible task (§1.1). Phase 0, gates G5, G8, G6, G1, G7, G3, G2, and G4, Phase 2 (C1–C8), Phase 3 (P1–P3), W1–W9, U2, U1, U15, U3, and U4 are done. U5 is `[!]` until the sponsor covers the 31.14 MON judging budget and the scheduled runner has a hosted green run. The §7A order's next item stays U5.
5. **Read §7A (Planner review) before taking the next task.** It solves G4: `liquidationPricePNS` matches the contract to the tick on the fork fixtures, and `CALIBRATED=true`. It also adds corrections and upgrades aimed at the cash prizes, and it sets the order to interleave them with the remaining tasks. U2, U1, U15, W7, U3, W8, W9, and U4 are done. U5 is blocked on the sponsor top-up and a private GitHub remote.

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
├─ docs/reference/             Planner reference material (not built, not linted): G4 fork probe and its result tables
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
| `status` | MON and AUSD balances for each role, pool inventory and distances, twins, floors, and the 31.14 MON judging budget | S0.5, U5 |
| `fund:mon` | Distribute MON from the sponsor to each role up to its target | S0.5 |
| `faucet:ausd` | Loop `requestFunds` (respecting the global 60 s cooldown) until the AUSD targets are met | S0.5 |
| `gate:<n>` | Gate scripts G1–G8 | Phase 1 |
| `pool:create --count N --market BTC\|ETH` | Full provisioning (§P3) | Phase 3 |
| `pool:refill --target 30 --per-side 12 --in-band 10` | Create pool accounts until those inventory targets are met | U4 |
| `twins:create` | Twin pairs (§P4) | Phase 3 |
| `twins:volatile` | Rank testnet markets by mark variance and open the top pairs | U15 |
| `pool:register` | Register state-file entries with the Worker `/admin/pool` | Phase 4 |
| `arm:trial` | Live arm, latency, 403, 409, and disarm checks for one owner | W7 |
| `arm:demo --count 20` | Claim, accept, and arm with distance-based defaults | U3 |
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

#### [x] G8 Mainnet snapshot performance and open-interest cross-check
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
- **Evidence:** `pnpm cli gate:8` exit 0 on the public RPC. Best of 3 was 411 ms (attempts 1073, 411, 648). 17 markets, 696 positions. Every market's long and short lot sums equaled `longOpenInterestLNS` and `shortOpenInterestLNS`, and each market's position count equaled the sum of `numPositions`.

#### [x] G6 Self-match fill on testnet
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
- **Evidence:** `pnpm cli gate:6` exit 0. Proxy `0xEc73AFB31b20729160c247A3009C193a4842e95A` (account 816) is a BTC long, lot 100, entry pricePNS 856095, leverage 14.95×. Maker account 817 is the opposite short, lot 100. IOC open `0x5019f425` status 1, gas 521210. Existing-liquidity IOC `0x6b7f7649` status 1, gas 209468, no fill. Factory create gas 895509, AUSD transfer gas 87488, proxy createAccount gas 362057, maker approve gas 85319, maker createAccount gas 242716, post-only gas 301050.

#### [x] G1 Operator least privilege: increase-only round-trip
- **Type:** AGENT · **Depends on:** G6 · **PRD:** §5.2, gate 1
- **Do:**
  - On the G6 proxy, the owner calls `setOperatorAllowlist(selector, false)` for `execOrder`, `execOrders`, `requestDecreasePositionCollateral`, `buyLiquidations`, `depositCollateral`, and `allowOrderForwarding`.
  - The operator then sends `increasePositionCollateral(perpId, 1e6)` through the proxy.
  - Simulate operator calls (`eth_call` with `from` set to the operator) to each revoked selector, to `withdrawCollateral`, and to an ERC20 `transfer` from the proxy.
- **Pass:**
  - The real top-up succeeds, the position's `depositCNS` rises by exactly `1e6`, and the account's free balance falls by the same amount.
  - All seven simulated operator calls revert.
  - The owner can still `withdrawCollateral(1e6)` successfully.
- **Evidence:** `pnpm cli gate:1` exit 0 on proxy `0xEc73AFB31b20729160c247A3009C193a4842e95A`. Owner set all six selectors false (`0x4d8dc985`, `0x39435dac`, `0x171a5b81`, `0xbbac6c95`, `0xbad4a01f`, `0x7962f910`); each read back `allowed=false`. Operator `increasePositionCollateral` `0x9893efa8` status 1, gas 210992; `depositCNS` rose by exactly 1000000 and free balance fell by exactly 1000000. Eight operator `eth_call`s reverted: the six revoked selectors, `withdrawCollateral`, and ERC20 `transfer`. Owner `withdrawCollateral` `0x43dfe3ed` status 1, gas 277992.
- **Fallback:**
  - If the operator `increasePositionCollateral` call reverts because the allowlist lags the Exchange ABI, test the onchain `execOrder` path with order type `IncreasePositionCollateral`. That's 0-indexed enum value 5; confirm it in the dex-sdk.
  - If only that path works, keep `execOrder` allowlisted, log in §9 that H5 is satisfied by the evaluator never building any other order type, and ask the human to approve this deviation.
  - If neither works, mark `[!]` and ask.

#### [x] G7 Gas limit measurement
- **Type:** AGENT · **Depends on:** G1 · **PRD:** §5.9
- **Do:**
  - From the G6/G1 runs (plus any extra runs), record gas used for: factory `create`, AUSD `transfer`, `createAccount`, `setOperatorAllowlist`, owner `execOrder` open, operator `increasePositionCollateral`, `transferOwnership`, `acceptOwnership`, `withdrawCollateral`, the MON drip, and faucet `requestFunds`.
  - Write `GAS_LIMITS = ceil(max observed × 1.2)` into core config.
- **Pass:**
  - Every transaction type has a limit.
  - Re-sending each type with its configured limit succeeds 3 times out of 3.
  - The cost table (MON at the current base fee) is logged in §9.
- **Evidence:** `pnpm cli gate:7` exit 0. Each of the 11 kinds was re-sent 3 times with its configured limit and every receipt was status 1. Base fee was 100 gwei. Cost in MON at that base fee: factory create 0.1074611, AUSD transfer 0.0104986, createAccount 0.0434469, setOperatorAllowlist 0.0104217, execOrder open 0.0625452, increasePositionCollateral 0.0253191, transferOwnership 0.0129406, acceptOwnership 0.0108076, withdrawCollateral 0.0341734, MON drip 0.0036, faucet requestFunds 0.016339.

#### [x] G3 Durable Object alarm on the free plan
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
- **Evidence:** `https://lifeline-gate3.lifeline-shreyas.workers.dev/health` after 30 minutes: 906 ticks (expected 900, pass floor 855), `ticksLast10Min` 298, `maxGapMs` 2090, `errors` 0, `signed` true. `wrangler tail` showed alarm outcomes `ok`, no CPU-limit or eviction errors, and the highest sampled `cpuTime` was 14 ms.

#### [x] G2 Privy guest wallet: ownership and EIP-712
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
- **Evidence:** Headless create never returned a wallet, so G2-H completed it at `http://localhost:3000/dev/gate-privy` with wallet UI suppressed. Guest `0x435371A37dE781A03F1881bEEb127E2A6079BFdf`. Drip `0x866c823f` status 1. Proxy `0x36DF02ca0E9B1644e181342A795556a66eB28b10`. Accept `0xfcda838d` status success, gas 108076. `owner()` is the guest. Mandate signature recovers to the guest. Access token verifies as ES256. `pnpm cli gate:2 check` printed `ownerOk=true sigOk=true tokenOk=true`.

#### [x] G4 Liquidation-price calibration
- **Type:** AGENT, plus **HUMAN** (G4-H, already done) · **Depends on:** C1, G5, G6, **U1, U2** · **PRD:** §5.3 calibration gates
- **Planner finding (verified, read this first):**
  - **The historical check failed because of the method, not the math.** Replaying a position's lifecycle from events misses state the contract keeps: collateralized PnL on increases, premium settlement, collateral decreases, partial liquidations, and price residue. That's where the 10.7% median came from.
  - **The contract itself is the ground truth.** On a *local* Anvil fork, `Exchange.liquidations(descs, false)` on a healthy position emits `CantLiquidatePosAboveMMR(perpId, posAccountId, positionType, markPricePNS, liqPricePNS)`. That is the contract's own liquidation price.
  - **The exact rule matched 694 of 694 positions to the tick** (testnet 152 and mainnet 542; 215 shorts; 626 with nonzero `premiumPnlCNS`; 267 with nonzero residue):

    ```
    entry = pricePNS / 10^priceDecimals                       (raw: ignore priceResiduePNSQ16)
    size  = lotLNS / 10^lotDecimals
    MMF   = getMarginFractions(perpId, 0).perpMaintMarginFracHdths / 100
    MMR   = entry · size / MMF
    liq   = entry + s · (MMR − depositCNS/1e6 − premiumPnlCNS/1e6) / size     (s = +1 long, −1 short)
    liqPNS = s = +1 ? ceil(liq · 10^priceDecimals) : floor(liq · 10^priceDecimals)   (conservative tick rounding)
    ```

  - **Positive `premiumPnlCNS` means funding received,** as in dex-sdk `state/position.rs`. Without the premium term the error grows to 0.3–43%.
  - The reference probe and both result tables are in `docs/reference/` (`g4-fork-probe.mjs.txt`, `g4-fork-*-result.txt`).
  - **Fork mechanics** that the probe proved necessary:
    - start Anvil with `--no-mining` and mine each transaction with `evm_mine(ts)`, with `ts` starting at the fork block's timestamp + 1, so the mark doesn't go stale (`MarkPriceAgeExceedsMax`, 60 s);
    - impersonate `Exchange.owner()` on the fork and call `setPositionAdministrator(caller, true)` and `setAdministrator(caller, true)`, because `liquidations` is permissioned;
    - batch every live position of a market into one `liquidations(…, false)` call.
- **Do:**
  - **a. Unit tests** (C1 plus U1): the docs example, plus the dex-sdk test vectors (U1).
  - **b. Contract-truth check (replaces the historical check):** `pnpm cli gate:4 --fork` (built in U2) on local forks of testnet and mainnet.
  - **c. UI check (G4-H):** already done, 0.0926%. Note that the UI read used funding 0; the remaining gap is consistent with the premium term.
  - **Historical replay is demoted** to informational only (it's no longer a gate). Keep the code if it's useful for U14, which uses a fork at block N−1 instead.
- **Pass:**
  - Step a passes.
  - **Step b:**
    - at least 600 positions across both chains, at least 4 markets per chain, at least 100 shorts, at least 100 with nonzero premium, and at least 50 with nonzero residue;
    - **100% exact tick match** between `liqPNS` from the core function and the contract's `liqPricePNS`.
  - Step c is already passed.
  - Then set `CALIBRATED=true`, which swaps the "est." label for the "contract-exact" badge (U9).
- **Fallback:** If any position mismatches, print it with all inputs, then compare the entry/residue variants and the rounding direction exactly as the reference probe does. Don't loosen the pass bar without logging why in §9.
- **Evidence:** Step a passes in C1 and the U1 dex-sdk vectors. Step c: the Perpl testnet UI showed 83650.6 for calibration account `0xE928c690D27326bc561A2d07fad3dFAca4815ed6` (id 821, BTC long, lot 100, entryPNS 860220, depositCNS 5734800). With funding 0 and MMF 25 ours is 83728.08. |83728.08 − 83650.6| / 83650.6 = 0.0926%, within 0.1%. Step b: `pnpm cli gate:4 --fork` exited 0 twice on 2026-10-05 with `exactMatchPct` 100 (second run: 912 positions, testnet block 68477876, mainnet block 110829088). `pnpm --filter @lifeline/core exec vitest run test/g4-fixtures.test.ts` matches `liquidationPricePNS` to every fixture tick, 912 positions. `CALIBRATED=true` in `packages/core/src/config/calibration.ts`. Historical replay stays informational.

### Phase 2: Core library (`packages/core`)

#### [x] C1 Math
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
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/math.test.ts` passed 7 tests. Docs example is exact (MMR 4000, P_liq 94000). PRD demo is within the allowed dollar and AUSD tolerances. v8 line coverage of `src/math` is 100%.

#### [x] C2 Chain readers
- **Type:** AGENT · **Depends on:** G8 · **PRD:** §5.2
- **Do:**
  - Turn the G8 readers into a library API: `listPerps`, `readMarket`, `readAllPositions`, `readAccounts(ids)`, `readAccountByAddr`, `readPositionsForAccount`.
  - The RPC fallback client tries each URL in order, with a timeout and one retry.
  - Discover markets onchain, never with a hard-coded list.
- **Pass:**
  - Integration tests on mainnet and testnet return at least one market and positions.
  - The open-interest equality from G8 holds.
  - With the primary RPC replaced by a dead URL, calls still succeed through the fallback.
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/live.test.ts -t "live chain readers"` passed. Mainnet and testnet each returned markets. Every market's long and short lot sums equaled open interest, and each position count equaled `numPositions`. Testnet account 816 still has an open BTC position (perp 16). With `http://127.0.0.1:9` first and a 1.5 s timeout, `listPerps` still returned mainnet markets through the public RPC fallback.

#### [x] C3 Radar snapshot builder
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
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/live.test.ts -t "validates a mainnet snapshot"` passed. Cold build was 1963 ms, 17 markets, 611 non-dust positions. The zod schema parsed. Headline open interest, position count, at-risk count, and idle balance each equaled the sum across markets. The JSON contained no `0x` account address.

#### [x] C4 Crash simulator (pure, runs in the browser)
- **Type:** AGENT · **Depends on:** C3 · **PRD:** §F2
- **Do:** `simulate(snapshotPositions, market, shockPct)` returns liquidated count and notional, and saved count and notional, using the §2.2 "saved" rule. The result is labeled first-order.
- **Pass:**
  - Synthetic tests pass, including exact counts for a hand-built set.
  - Liquidated notional is monotonic: never decreases as the shock grows.
  - A 0% shock liquidates 0.
  - It runs in ≤ 20 ms for 1,000 positions in a Node benchmark.
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/crash.test.ts` passed 3 tests. On the hand-built book a 0% shock liquidates 0, −3% liquidates 1 position / 100 AUSD notional and saves that one, and −7% liquidates 2 / 200 AUSD and saves 1. Liquidated notional does not fall from −1% through −10%. A 1,000-position call, after one warmup, finished within 20 ms. The result label is `first-order: excludes cascade price impact`.

#### [x] C5 Mandate EIP-712
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
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/mandate.test.ts` passed 3 tests. A test key signs and recovers on the PRD §F5 domain. Changing any one of the eight fields makes that signature recover to a different address. Validation accepts a sane mandate and rejects trigger, target, both caps, expiry in the past, expiry past 30 days, an empty market list, an unknown perp, and a used nonce.

#### [x] C6 Lifeline evaluator
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
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/evaluate.test.ts` passed 2 tests. Each skip reason returns `skip`, and the top-up branch returns only `amountCNS`, `distBefore`, and `distTarget`. Across 40 random cap combinations a top-up never exceeds the per-action cap, free balance, or budget left, and it is at least 5 AUSD.

#### [x] C7 Transaction builders
- **Type:** AGENT · **Depends on:** G7 · **PRD:** §5.2, §5.9
- **Do:**
  - Builders for: `increasePositionCollateral` (through the proxy), `transferOwnership`, `acceptOwnership`, `withdrawCollateral`, MON drip, and every provisioning call (factory create with consent signature, transfer, createAccount, setOperatorAllowlist ×6, IOC open, post-only maker order).
  - Every builder takes its gas limit from `GAS_LIMITS`.
- **Pass:**
  - Encoding tests compare against reference calldata.
  - On testnet, `eth_call` simulation of each builder against the G1 proxy succeeds for allowed roles and reverts for disallowed ones, matching G1's results.
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/tx.test.ts` passed. Calldata matches `encodeFunctionData` and every builder uses `GAS_LIMITS`. On the G1 proxy, `eth_call` from the operator succeeds for `increasePositionCollateral` and reverts for withdraw, allowlist, and IOC open. The owner succeeds for withdraw, `transferOwnership`, allowlist, and a 0-value AUSD transfer, and reverts for `acceptOwnership` because there is no pending owner. `createAccount` reverts because the account exists. Factory `create` from the pool owner simulates successfully (`eth_call ok=true`).

#### [x] C8 HyperSync analytics
- **Type:** AGENT · **Depends on:** G5 · **PRD:** §F9
- **Do:**
  - `liquidationHistory(chainId, days)` returns decoded events with `idleAtLiq = accBalanceCNS − max(accAmountCNS, 0)` and `eligible = idleAtLiq ≥ posDepositCNS`, plus totals, eligible totals, and the latest 50.
  - `lifelineActions(accounts[])` returns testnet `IncreasePositionCollateral` events filtered to those accounts.
  - Save real response fixtures for tests.
- **Pass:**
  - Fixture-based tests pass.
  - A live call returns within 5 s.
  - Totals equal the sum of the rows.
- **Evidence:** `pnpm --filter @lifeline/core exec vitest run test/analytics.test.ts` passed 3 tests: idle eligibility, totals equal the row sum, the latest list is capped at 50, and account filtering. Live `liquidationHistory` for 30 days from block 102159198 returned 571 rows in 2186 ms, and that total matched the row sum. A later raw-page save returned HyperSync 429 while `gate:4` was using the token budget, so the checked response was not written to disk.

### Phase 3: Provisioning CLI (`apps/cli`)

#### [x] P1 Faucet and funding commands, hardened
- **Type:** AGENT · **Depends on:** S0.5, G7 · **PRD:** §5.9
- **Do:** Harden `faucet:ausd`, `fund:mon`, and `status`: use the measured gas limits, resume after interruption, and show `LOW:` warnings against the floors in §4.3.
- **Pass:**
  - Killing a run midway and re-running it reaches the targets without duplicate overspend (see the balance deltas).
  - `status` exits non-zero when a floor is breached (test this by setting a temporarily high floor).
- **Evidence:** `pnpm --filter @lifeline/cli test` passed, including an in-flight top-up that is not sent twice. `fund:mon --kill-after-broadcast` sent operator +0.120518814 MON `0xa65c83a0` and stopped. Resume waited for that receipt (status 1, gas 36000) and did not send the operator again; it sent pool owner +1.342906602 `0x36dea485` and maker +0.288709368 `0x04703e91`, both status 1 at gas limit 36000. A second `fund:mon` printed `nothing to send`. Balances: operator 4.8794→5.0000, pool owner 0.6570→2.0000, maker 0.2112→0.5000, sponsor 11.4834→9.7203. `faucet:ausd` used no new drip (`targets met`). `status --floor SPONSOR:MON:1000000` printed `LOW: SPONSOR MON 9.7203 < 1000000.0000` and exited 1. Plain `status` then exited 0 with no `LOW:` lines.

#### [x] P2 Pool provisioning: `pool:create`
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
- **Evidence:** `pnpm cli pool:create --count 3 --market BTC` exit 0. Testnet BTC is perp 16. Leverage from `getMarginFractions` capped at 1500. Three proxies, owner the pool owner, operator set, sides short/long/short: `0xb4C851B0`, `0xe3929EB4`, `0x3e8214A1`. Each lot 1743. Free AUSD 299.35, 298.73, 299.35. Distances on the rerun 2.460%, 2.864%, 2.460%, inside 2.0–3.5%. All six operator calls reverted, and `operatorAllowlist` reads false for `0x4d8dc985`, `0x39435dac`, `0x171a5b81`, `0xbbac6c95`, `0xbad4a01f`, `0x7962f910`. Maker net lot 1543 versus position size 1743. Re-run printed `pool:create nothing new` and created no transactions.

#### [x] P3 Twins: `twins:create`
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
- **Evidence:** `pnpm cli twins:create` exit 0. Four pairs, each owned by the pool owner with the operator set. BTC perp 16 at 15×, SOL perp 48 at 10×. Protected then unprotected: btc-long `0x92fa4337` / `0xfBcABCde` entries 861139 and 861290; btc-short `0x0eCa93D0` / `0x9F8FD580` both 861194; sol-long `0x45Afff08` / `0x2817a172` entries 12079 and 12081; sol-short `0x49975921` / `0xbE9282D7` entries 12064 and 12062. Every pair is inside 0.1%. SOL filled, so ETH was not used. House mandates are not stored until W4; the unprotected legs are flagged in `cli-state/twins.json`. Re-run created no transactions.

### Phase 4: Worker and Durable Object (`apps/worker`)

#### [x] W1 Scaffold, secrets, health
- **Type:** AGENT · **Depends on:** G3 · **PRD:** §5.1, §5.5, §5.7
- **Do:**
  - Turn the G3 prototype into the real Worker: a router, one `Lifeline` Durable Object (SQLite), and secret bindings (§4.3).
  - Add `pnpm cli secrets:sync-worker`.
  - `GET /health` returns `{lastAlarmAt, ticksLast10m, degraded, paused, poolAvailable, version}`.
  - **Amended by U5:** `/health` also returns `sponsorMon`, `operatorMon`, `poolInBand`, `poolBySide`, and `low`.
  - Adapters wrap `packages/core` so the core stays runtime-agnostic.
- **Pass:**
  - `wrangler deploy` succeeds.
  - `curl <worker>/health` returns valid JSON with `degraded:false`.
  - `wrangler secret list` shows every required name, and the secret sync prints no values.
- **Evidence:** `wrangler deploy` uploaded `lifeline` version `322ad00c-6819-4152-a172-b3e791803586`. `curl https://lifeline.lifeline-shreyas.workers.dev/health` returned `{"lastAlarmAt":null,"ticksLast10m":0,"degraded":false,"paused":false,"poolAvailable":0,"version":"1"}`. `pnpm cli secrets:sync-worker` printed only `secret <name> set` for all eight names. `wrangler secret list` shows `OPERATOR_PK`, `POOL_OWNER_PK`, `SPONSOR_PK`, `ADMIN_SECRET`, `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `RPC_URLS_TESTNET`, and `LIFELINE_PAUSED`.

#### [x] W2 Privy access-token verification
- **Type:** AGENT · **Depends on:** W1, G2 · **PRD:** §5.4
- **Do:** Middleware verifies the ES256 JWT using Web Crypto and `PRIVY_VERIFICATION_KEY`, checking issuer, audience (the app ID), and expiry. It resolves the Privy user ID and the embedded wallet address, either from token claims or from a client-supplied address checked against a signed nonce. Choose the most robust option and log it in §9.
- **Pass:**
  - A real token from the G2 page is accepted.
  - Expired, tampered, and wrong-audience tokens each return 401.
- **Evidence:** `pnpm --filter @lifeline/worker exec vitest run test/privy.test.ts` passed. Expired, tampered, and wrong-audience tokens return 401. The guest token from the gate page, stored in `secrets/w2-token`, verified locally and `GET /session` returned 200 for user `did:privy:cmuubqhla00h80cl2otqo1oke` with `address` null. Wallet proof stays a signed nonce because the access token has no wallet claim.

#### [x] W3 Schema and migrations
- **Type:** AGENT · **Depends on:** W1 · **PRD:** §5.5
- **Do:** Create the `pool`, `claims`, `mandates`, `actions`, `keys`, and `health` tables, plus any indexes you need, with migrations versioned in code.
- **Pass:** Migrations are idempotent (applying twice is a no-op), and a round-trip CRUD test passes in `wrangler dev`.
- **Evidence:** `pnpm --filter @lifeline/worker exec vitest run test/schema.test.ts` passed in wrangler dev. Two `POST /schema/selftest` calls both returned `{ok:true, versions:[1,2]}`. The round trip inserted, read, updated, and deleted `pool`, `claims`, `mandates`, `actions`, `keys`, and `health`.

#### [x] W4 Pool registration and house mandates
- **Type:** AGENT · **Depends on:** W3, P2, P3 · **PRD:** §5.9 step 6, §F4, §F8
- **Do:**
  - `POST /admin/pool` (admin secret) registers entries, and `pnpm cli pool:register` pushes `cli-state` into it.
  - On registration, the Durable Object signs a **house mandate** with the pool-owner key: 1.5%/2.5% for pool positions, 4%/6% with a 300 budget for protected twins, and none for unprotected twins.
- **Pass:**
  - The registered count matches `cli-state`.
  - `GET /mandate/:proxy` returns a house mandate for each pool account and protected twin, whose signature recovers to the pool owner.
  - Unprotected twins return 404.
- **Evidence:** `pnpm --filter @lifeline/worker exec vitest run test/house.test.ts test/register.test.ts test/schema.test.ts` passed. `wrangler deploy` uploaded `lifeline` version `97e2bde4-bd47-430c-bf6a-1cfad5aad5b1`. `pnpm cli pool:register` exit 0 twice: `registered 11 mandates 7`. Three pool accounts at 1.5%/2.5% and four protected twins at 4%/6%, budget `300000000`, each signature recovered to pool owner `0xC417c69e72d3531f736353BA16A1eA365DD2f056`, which matches `owner()`. Unprotected `0xfBcABCde`, `0x9F8FD580`, `0x2817a172`, and `0xbE9282D7` returned 404. `GET /health` returned `poolAvailable:3`.

#### [x] W5 Keeper alarm loop
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
- **Evidence:** Soak from `startedAt` 1791213417528 ran 139 minutes with `armed` 10, `nonceErrors` 0, `pending` 0, `maxGapMs` 6497. Five confirmed actions, all `increasePositionCollateral`: `0x96442cfb` 20094 → 60604, `0xe99c0d38` 33749 → 59318, breach `0x1fbf4b1b` 31699 → 56599, `0x5dc1f61e` 39596 → 60000, `0xd44d55a8` 14981 → 25326. The per-tick SQLite writes are removed in version `470e20d7-a04a-4c1c-b5ff-b64f63a6d7a2`; `/health` then showed `ticksLast10m` 3 from memory. `lifeline-gate3` version `551e22e2-06a4-442b-934e-a2bec960323a` no longer reschedules its alarm.

#### [x] W6 `POST /claim`
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
- **Evidence:** Sponsor after the 20 MON transfer was `MON=22.9978`. `fund:mon` sent the operator +0.103301928 MON `0x95d90464`. Five live claims to `TEST_OWNER` `0x1bdD3ceeb704FF0881F77dEd498eDeB1dC011682` returned 200 in 1185, 977, 787, 707, and 720 ms, p50 787. The first claim `0xe3929EB4` (account 830, BTC, distance 20769) set `pendingOwner` to that wallet and raised its MON by 0.08 (`drip` `0x6d4e7558`, `transferOwnership` `0x700139c2`). The house mandate stayed `kind:house`. The same user again returned 409. The fourth claim from IP `203.0.113.10` returned 429. Empty pool 503 `{sandbox:true}` is the wrangler check in `test/claim-http.test.ts`. One pool position remains available. `/health` after the claims: `degraded:false`, `poolAvailable:1`.

#### [x] W7 `POST /arm`, `/disarm`, `/mandate/:proxy`
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
- **Evidence:** `pnpm cli arm:trial` exit 0 on worker version `a778587f-3dfb-4555-8259-a0e3592d998e`. Test owner `0x1bdD3cee` held `0xe3929EB4` at distance 28291 (2.83%). Arm at 4%/6% returned `0x064f003f` in 782 ms, added 47169101, and an independent chain read was 59999. Four more owned positions armed the same way: `0xec891823` 700 ms, `0xda30db02` 716 ms, `0xc990afc8` 390 ms, `0x48533832` 657 ms. Each chain distance was 59999, inside [58000, 65000]. `msFromRequest` samples 782, 700, 716, 390, 657, p50 700. A maker-signed mandate returned 403. Replaying nonce 1 on `0xe3929EB4` returned 409. Disarm then `POST /admin/breach` returned `armed:false`, and 8 s later `/admin/soak` had no new action for that proxy. Accepts before the extra arms: `0xab56c827`, `0x5881bdb5`, `0x296f5cb3`, `0xdc71d084`.

#### [x] W8 `GET /twins` and sandbox mode
- **Type:** AGENT · **Depends on:** W5, C8 · **PRD:** §F8, §F4 fallback
- **Do:**
  - `/twins` returns pairs with their distances, Lifeline actions (from C8, read from the chain), and outcome (`liquidated at block X`, `crossed liq at block X`, or `alive`).
  - Add `POST /sandbox/arm` (rate-limited, no wallet). It arms a house-owned sandbox position with user-chosen trigger and target using the house signer, and returns the same payload as `/arm`.
- **Pass:**
  - `/twins` lists every pair from `cli-state` with correct ownership and mandate status.
  - Sandbox arm produces a confirmed top-up within the W7 tolerance.
  - Sandbox is rate-limited (429 on abuse).
- **Evidence:** Worker `0a8bb0af-92a2-4a74-809c-6c1535318ef4`. `GET /twins` returned `count` 7. Before the sandbox arm every protected leg was `mandate:house` and every unprotected leg was `mandate:none`, with a live `distanceE6` and outcome `alive`. Confirmed actions included `0x96442cfb`, `0xe99c0d38`, and `0x5dc1f61e`. `POST /sandbox/arm` on sol-short `0x49975921` at 4%/6% returned `0x85fe2562` in 868 ms, `distBefore` 39806, `distAfter` 59996. An independent chain read was 61128, inside [58000, 65000]. The same IP's fourth call returned 429 `{"error":"rate"}`. After the arm, sol-short's protected mandate is `user` and the other six protected legs stayed `house`.

#### [x] W9 Canary, kill switch, self-healing
- **Type:** AGENT · **Depends on:** W5 · **PRD:** §5.5
- **Do:**
  - Every 10 min, simulate `increasePositionCollateral(1)` as the operator on a canary pool account. A revert sets `degraded=true` with a reason.
  - `LIFELINE_PAUSED=true` blocks every send but keeps reads working.
  - `/health` re-arms the alarm if `lastAlarmAt` is more than 10 s old.
- **Pass:**
  - Pointing the canary at a non-allowlisted selector in a test sets `degraded:true`.
  - With paused on, a forced breach yields `skip PAUSED`, and the radar still works.
  - Deleting the alarm manually in a test and then calling `/health` restores ticking within 5 s.
- **Evidence:** `judgeCanary` on `execOrder` returns `degraded:true` / `canary revert`, and the collateral selector with no revert returns `degraded:false`. `evaluate` with `paused:true` returns `skip PAUSED` while `healthReport` still returns `poolAvailable` and `paused:true`. `pnpm --filter @lifeline/worker exec vitest run test/alarm.test.ts` deleted the alarm and `/health` scheduled a new one within 5s (`alarm` was non-null and less than 5s ahead).

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
  - **Amended by U3 and U6:** arm defaults come from the live distance (U3), and the automated runs use U6's strategy.
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
  - **Amended by U5:** `pnpm cli status` must print `budget ok` (need 31.1400 MON) before this pool work. `budget short` is the S0.4 prompt.
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
  - a keyword monitor on `<worker>/health` that alerts when the body contains `"degraded":true` or `"low":true` (U5), or when the check fails, every 5 minutes, alerting your email;
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
  - **Amended by U6:** each D5 cycle is 3 automated runs plus 1 human run with a real Privy guest, verified onchain.
  - **Amended by U3:** all 3 runs show a confirmed top-up at the arm step (no `ABOVE_TRIGGER` skips).
  - The receipt shows the "Contract-exact" badge (U9).
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

#### [-] X5 Replay a real liquidation
- **Superseded by U14** (§7A), which uses a local fork at block N−1 and the exact contract rule instead of event reconstruction. Logged in §9.
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
- **Pass:** `pnpm cli gate:4 --fork` (U2) runs daily against fresh local forks of both chains, and any tick mismatch sets a degraded-calibration banner. Event reconstruction is no longer used for calibration (see G4).
- **Evidence:**

---

## 7A. Planner review: corrections and upgrades for winning the cash prizes

These tasks come from a review of the build's progress against the prize targets. They are part of the core unless marked otherwise, and they follow the same protocol (§1): pass checks, evidence, commits, and human stops.

**Order of work.** Interleave these with the remaining Phase 4–7 tasks in this order:

1. **U2 → U1 → finish G4** (`CALIBRATED=true`). Done.
2. **U15** (time-sensitive: twins need time and volatility to show a real liquidation). Done. `GET /twins` lists the pairs with distances and outcomes, and sandbox arm is done.
3. Finish **W7**, then **U3**, then the rest of W8 and W9. Done.
4. **U4** and **U5**. U4 is done. U5 is blocked: the sponsor is short of 31.14 MON, and this checkout has no GitHub remote for the cron.
5. **U7**, then A1–A3.
6. A4–A6 together with **U8, U9, U10, U13, U16**.
7. A7 with **U6**, then A8–A10.
8. **U12** (it has a HUMAN step), then D1–D4.
9. D5, using U6's criteria.
10. **U11** before R1 and R2. **U14** before D8, so the replay can appear in the video.

**Prize mapping.** Each task's **Why** line names the prize it strengthens: Perpl API $5k, Perpl Analytics/Risk $3k, Envio $1k, Privy $5k, Track 1 $10k, or Grand Champion.

#### [x] U2 Contract-truth calibration command: `gate:4 --fork`
- **Type:** AGENT · **Depends on:** C2 · **Unblocks:** G4, U1, U9, B7
- **Why:** It turns "est." into "matches Perpl's contract to the tick," the strongest credibility line for the Perpl Analytics bounty and Track 1.
- **Do:**
  - Port `docs/reference/g4-fork-probe.mjs.txt` into `apps/cli` as `gate:4 --fork [--chain 10143|143|both]`.
  - **Fork lifecycle:** start `anvil --fork-url <chain rpc> --port <free port> --no-mining --silent` as a child process, wait until it's ready, and always kill it on exit.
  - **Safety assertions:**
    - the client URL is `127.0.0.1` or `localhost`;
    - the fork's chain ID equals the source chain's;
    - no role key from `secrets/` is ever loaded by this command; only impersonation is used.
  - **On the fork:**
    - pin block timestamps (`evm_mine(ts)` starting at the fork block timestamp + 1);
    - impersonate `Exchange.owner()` and grant `setPositionAdministrator` and `setAdministrator` to a throwaway caller;
    - for **every** live position of every market (paginate past the first 200), batch `liquidations(descs, false)` and decode `CantLiquidatePosAboveMMR` and `PositionLiquidated`.
  - **Fixtures:** write `packages/core/test/fixtures/g4-truth-<chainId>.json` with per position: inputs (`perpId`, `positionType`, `pricePNS`, `priceResiduePNSQ16`, `lotLNS`, `depositCNS`, `premiumPnlCNS`, `priceDecimals`, `lotDecimals`, `maintHdths`) and the contract's `liqPricePNS`.
  - Write a summary JSON (date, counts, exact-match %) for U9.
  - If `anvil` is missing, prompt the human to install Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).
- **Pass:**
  - The command exits 0 on both chains.
  - The coverage bar from G4 step b is met: at least 600 positions, at least 4 markets per chain, at least 100 shorts, at least 100 with premium, and at least 50 with residue.
  - Fixtures and the summary are written.
  - A second run reproduces the same pass result.
  - No real network receives a transaction: assert the sender's nonce on the real RPC is unchanged.
- **Evidence:** `pnpm --filter @lifeline/cli exec vitest run test/gate-4-fork.test.ts` passed 7. `pnpm cli gate:4 --fork` exited 0 twice. The second run wrote 912 positions, 19 markets, 297 shorts, 781 with nonzero premium, 374 with nonzero residue, and `exactMatchPct` 100. Testnet block 68477876 had 202 positions across 8 markets. Mainnet block 110829088 had 710 positions across 11 markets. The real owner nonce stayed 1 and the throwaway caller nonce stayed 0. Fixtures are `packages/core/test/fixtures/g4-truth-10143.json`, `g4-truth-143.json`, and `g4-fork-summary.json`.

#### [x] U1 Exact contract liquidation rule in the core
- **Type:** AGENT · **Depends on:** U2 (fixtures) · **Amends:** C1, C3, C4, C6, and PRD §5.3
- **Why:** The radar, the crash simulator, the dry run, and the keeper all must use the contract's own number. A one-tick conservative rounding also means Lifeline never underestimates risk.
- **Do:**
  - Add `liquidationPricePNS(position, market)` implementing the rule in G4's planner finding: raw entry, `premiumPnlCNS` subtracted, MMR at raw entry, conservative tick rounding.
  - Route every liquidation price, distance, at-risk flag, "could protect now," crash outcome, dry run, and evaluator decision through it.
  - Keep the unrounded function only as an internal helper.
  - Add the dex-sdk vectors from `crates/sdk/src/state/position.rs` tests, all with entry 100, size 10, deposit 100, mm 20:
    - liquidation: long 95 → 100 after paying 5 per unit; short 105 → 100; long receiving funding goes to 90 and short to 110;
    - bankruptcy: 90, 95, 110, 105, 85, 115.
  - Add a fixture test asserting a **100% exact tick match** on both U2 fixtures.
  - Fix PRD §5.3 (formula, premium sign, rounding, calibration gates) as a factual correction, logged in §9.
- **Pass:**
  - All vectors pass.
  - Fixture tests pass at 100% exact on 600 or more positions.
  - Every existing core, worker, and CLI test still passes.
  - The C1 PRD demo example still passes at its tolerances.
- **Evidence:** `pnpm --filter @lifeline/core test` passed 43 tests, including the dex-sdk entry-100 vectors and a 912-position fixture match. `pnpm --filter @lifeline/cli test` passed 25. `pnpm --filter @lifeline/worker test` passed 19. The docs example still liquidates at 94000. Radar assembly, the crash simulator, and `evaluate` take distance from `liquidationPricePNS`. PRD §5.3 now states the premium sign, raw entry, and conservative tick rounding.

#### [x] U15 Aggressive twins on volatile markets (time-sensitive)
- **Type:** AGENT · **Depends on:** P3, W4
- **Why:** "The unprotected twin was liquidated by Perpl's own engine while its protected twin survived" is the single most convincing proof for judges. Testnet's liquidator is active (G5 counted 272 liquidations), but it needs volatility and time.
- **Do:**
  - Rank testnet markets by recent mark variance. Sample `getPerpetualInfoV2.markPNS` over 30 minutes, or use HyperSync trade or mark events if that's cheaper.
  - Open **two more twin pairs** today on the two most volatile markets (candidates MON, PUMP, NEAR, ZEC) at the highest leverage allowed, alternating sides.
  - Register them with the protected leg on a house mandate of 4%/6% and a 300 budget; the unprotected leg gets none.
- **Pass:**
  - Both pairs are open with entries within 0.1% of each other.
  - `pool:register` succeeds, and `/twins` (W8) lists 6 pairs.
  - The volatility ranking is logged in §9.
- **Evidence:** `twins:volatile` ranked testnet `MarkUpdated` over 20,000 blocks: MON variance `3.2157e-7` (742 samples), PUMP `1.8296e-7` (518), NEAR `1.8069e-7` (625), ZEC `1.1960e-7` (374). Opened `mon-long` at 2921/2922 and `pump-short` at 6311/6311. An earlier window also left a matching `pump-long` at 6619/6618. All three are inside 0.1%. `pnpm cli pool:register` exited 0: `registered 20 mandates 13`. Protected legs are house mandates at 4%/6% with budget `300000000`; unprotected legs return 404. `GET /twins` returned `count` 7. Worker version `1d53d621-2ac3-4412-b5ba-97f9c8ae87a0`.

#### [x] U3 Demo-fire guarantee: arming always produces a visible top-up
- **Type:** AGENT · **Depends on:** W7 · **Amends:** W6, A7
- **Why:** This prevents the main failure mode. If the price moved in a claimed position's favor, its distance sits above the default 4% trigger, arming returns `ABOVE_TRIGGER`, and the judge sees nothing happen. That costs every prize.
- **Do:**
  1. **Demo band for claims.** `/claim` first picks positions whose distance is in [house target, 3.5%]. Otherwise it picks the closest above the house trigger.
  2. **Arm defaults from live distance.**
     - `trigger = max(4%, roundUp(distance, 0.5%) + 1%)` and `target = trigger + 2%`, clamped to C5's limits.
     - The UI shows: "Your position is X% from liquidation. Lifeline will act below Y% and restore Z%."
  3. **When the user lowers the trigger below the current distance,** show "Armed: Lifeline will act when distance falls below Y%." Add a clearly labeled "Test Lifeline now" button that re-signs with the trigger just above the current distance. That's an honest, user-initiated test.
- **Pass:**
  - Over **20 consecutive claim → accept → arm cycles** on testnet (test-owner path), **20 of 20** produce a confirmed top-up with `distAfter` inside the W5 tolerance.
  - A property test of the default computation covers distances from 1.5% to 15%.
  - The UI test shows the explanatory copy.
- **Evidence:** `pnpm cli arm:demo --count 20` exited 0: `confirmed 20/20` on worker `e45931f9-f6d1-4255-bb4b-f67737a75d76`. Every cycle claimed, accepted, and armed. Chain distances after the top-up sat on the target tick: 64998 or 64999 for target 650 (`0x42ff833f`, `0x86e94a65`), 59998 or 59999 for target 600 (`0x041e1599`, `0xfeeac8ed`), and 84998 for target 850 (`0x531b717f` on `0xb4C851B0`, which started at 52416). `pnpm --filter @lifeline/core exec vitest run test/arm-defaults.test.ts` covers 1.5% through 15% and the sentence "Your position is 2.8% from liquidation. Lifeline will act below 4% and restore 6%." The same test shows "Armed: Lifeline will act when distance falls below 3%." and the label "Test Lifeline now".

#### [x] U4 Pool inventory: demo band, both sides, recycling of unaccepted claims
- **Type:** AGENT · **Depends on:** U3 · **Amends:** P2, W6, D3
- **Why:** Judges arrive throughout the review window. An empty or out-of-band pool degrades the demo to sandbox mode.
- **Do:**
  - **`pnpm cli pool:refill --target 30 --per-side 12 --in-band 10`** creates accounts until there are at least 30 available, at least 12 on each side, and at least 10 inside the demo band. It's idempotent.
  - Positions that drift above 6% are flagged `reserve` and offered last.
  - **Recycling (in the Durable Object alarm, at most once per 60 s):**
    - A claim that isn't accepted within 10 minutes is cancelled. The pool owner calls `transferOwnership(address(0))`, which overwrites `pendingOwner` under `Ownable2Step`; verify `pendingOwner() == 0`.
    - The position then returns to `available` with its house mandate intact.
- **Pass:**
  - **Forced test:** claim without accepting, advance the timeout in a test, and confirm `pendingOwner` is 0 and the status is `available`.
  - A second claim of the same position works.
  - `pool:refill` reaches all three targets, and a re-run sends nothing.
- **Evidence:** `pnpm --filter @lifeline/worker exec vitest run test/recycle.test.ts test/claim.test.ts` passed. An unaccepted claim older than 10 minutes plans `clear` (`transferOwnership(0)`); `pendingCleared` is true only for the zero address; `releaseClaim` sets status `available` and `pickPool` returns that proxy again. A 7% reserve is offered only when no closer account is free. `pnpm cli pool:refill --target 30 --per-side 12 --in-band 10` created accounts through `available=30 long=15 short=15 inBand=30`. The re-run printed `available=30 long=15 short=15 inBand=30` and `pool:refill nothing new`, exit 0. `/health` `poolAvailable` is 30. Worker `ce97d881-e28d-4034-846f-6543f781c9c6`. `pool:register` then exited 0, with sol-short kept as `house-signed kind=user`.

#### [!] U5 Ops signals, scheduled runner, and MON budget
- **Type:** AGENT, plus **HUMAN** decision · **Depends on:** U4 · **Amends:** W1, D4, D3
- **Why:** The product must stay demoable for the whole judging period with no one watching it.
- **Do:**
  - **Health signals.** `/health` adds `sponsorMon`, `operatorMon`, `poolAvailable`, `poolInBand`, `poolBySide`, and `low`. `low` is true when the sponsor has under 3 MON, the operator under 1 MON, available under 10, or in-band under 5.
    - D4's UptimeRobot keyword monitor must also alert on `"low":true`.
  - **Scheduled runner** (prompt the human first). Recommend a GitHub Actions cron every 30 minutes on a private repository (free minutes) that runs `pool:refill`, `faucet:ausd`, and `status`, with **testnet-only** role keys in GitHub encrypted secrets.
    - If the human declines, log it in §9 and document a manual daily runbook step instead.
  - **MON budget,** recomputed from G7's measured costs: about 0.286 MON per pool account, about 0.097 per claim (drip plus gas), and about 0.025 per top-up.
    - For 40 accounts, 100 claims, and 400 top-ups that's about 31 MON.
    - Prompt the S0.4 top-up for the shortfall before D3.
- **Pass:**
  - The new `/health` fields are present.
  - A forced low condition flips `low:true`.
  - The scheduled job has one green run, or the decline is logged with the runbook step added.
  - `pnpm cli status` shows enough MON for the budget above.
- **Evidence:** Health fields and the forced-low test pass. The budget check does not: sponsor `21.0530` against need `31.1400`, shortfall `10.0869`. There is no git remote, so the Actions cron has not had a hosted run. Daily commands until that exists: `pnpm cli pool:refill --target 30 --per-side 12 --in-band 10`, `pnpm cli faucet:ausd`, `pnpm cli status`. On 2026-10-06 those exited 0, 0, and 0 after the operator top-up. `pnpm --filter @lifeline/worker exec vitest run test/health.test.ts` passed, including `isOpsLow` flipping true under each floor and false on the floors themselves. Worker `aac808b6-08bd-4734-99fb-199b9a566ae0`. `GET /health` returned `sponsorMon` `21.0530`, `operatorMon` `5.0000`, `poolAvailable` 30, `poolInBand` 30, `poolBySide` `{"long":15,"short":15}`, `low` false. `pool:refill` printed `available=30 long=15 short=15 inBand=30` and `nothing new`. `faucet:ausd` printed `targets met`. `fund:mon` sent the operator `+0.748938978` MON, tx `0xba696288`, status 1. Keeper ticks are `degraded:true` with `Too many subrequests` on the alarm.

#### [ ] U7 HyperSync budget: incremental history cache
- **Type:** AGENT · **Depends on:** C8 · **Amends:** A3
- **Why:** C8 and G4 already hit HyperSync 429s. Judges' traffic must never turn the history (which drives the Envio bounty) into errors.
- **Do:**
  - Build liquidation history incrementally: one full backfill, then a 60-second tail refresh from a stored block cursor.
  - Store aggregates plus the cursor in the Worker Durable Object (an admin-only refresh route) or a durable Vercel cache. Your call; log it.
  - Honor rate-limit reset headers with backoff.
  - On error, serve the last good data with `stale:true`.
- **Pass:**
  - 100 concurrent `/api/liquidations` requests produce at most 1 HyperSync request per 60 s (counter).
  - A simulated 429 yields stale data with no 5xx.
  - Totals still equal the sum of the rows.
- **Evidence:**

#### [ ] U8 Money-left-on-table metrics
- **Type:** AGENT · **Depends on:** U1, U7 · **Amends:** A4, A6
- **Why:** It turns risk into dollars, which is the sharpest Perpl Analytics angle and the strongest Track 1 pitch line.
- **Do:**
  - Read `getLiquidationInfo(perpId)` for the split: `liqUserAmtPer100K`, `liqInsAmtPer100K`, and `liqProtocolAmtPer100K`.
  - **Verify the event semantics on 5 recent liquidations:** check that the user share plus the insurance and protocol shares reconstruct the residual within 1 CNS. Use `accAmountCNS` and `AccountLiquidationCredit` or transfer events in the same transaction as needed, and log the method in §9.
  - **Show:**
    - **Radar headline:** "Liquidation penalties paid in 30 days: $X. Avoidable with the account's own idle AUSD: $Y."
    - **At-risk band:** "Penalty at stake now: $W" (the insurance and protocol share × MMR over at-risk positions).
    - **Risk card:** "If liquidated now you'd forfeit about $Z."
- **Pass:**
  - Unit tests on the split.
  - The 5-event reconciliation passes.
  - Totals reconcile with the per-event sums.
  - The values render on Radar and in the risk card.
- **Evidence:**

#### [ ] U9 "Contract-exact" badge and methodology page
- **Type:** AGENT · **Depends on:** U1, U2, A1 · **Amends:** A4, A10, H9
- **Why:** It's credibility the judges can check themselves, for Perpl Analytics and Track 1.
- **Do:**
  - When `CALIBRATED=true`, replace "est." everywhere with a **"Contract-exact"** badge that links to `/methodology`.
  - That page shows the exact rule, the latest `gate:4 --fork` summary (date, positions, markets, shorts, premium and residue counts, exact-match %), the script path, and how to reproduce it locally.
- **Pass:**
  - The page renders from the committed U2 summary JSON.
  - The badge is hidden when `CALIBRATED=false` (test both states).
- **Evidence:**

#### [ ] U10 Perpl public API enrichment (server-side, off the critical path)
- **Type:** AGENT · **Depends on:** A2 · **Amends:** A4
- **Why:** It strengthens the "Best use of Perpl's API" case ($5k) without risking H3.
- **Do:**
  - Server routes fetch Perpl `GET /api/v1/pub/context` (market display names, fees, max leverage) and candles (a 24-hour mark sparkline per market, and data for U14).
  - Pin these routes to a non-US Vercel region (for example `fra1` or `sin1`) and confirm Perpl serves it.
  - Cache for 5 minutes.
  - Every field has an onchain fallback.
  - Nothing is fetched from the browser.
- **Pass:**
  - With the Perpl API reachable, names and sparklines render.
  - With the Perpl API blocked (mock or abort), Radar renders fully from onchain data and A7 still passes.
  - The browser network log shows zero `*.perpl.xyz` requests.
- **Evidence:**

#### [ ] U13 Saves ledger: proof that Lifeline actually saved positions
- **Type:** AGENT · **Depends on:** U1, W5, C8 · **Amends:** A4, A8
- **Why:** "N positions survived a move that would have liquidated them" is the demo's wow line, provable from chain data. It serves Track 1, Grand Champion, and the Perpl API bounty.
- **Do:**
  - For every confirmed top-up, store the exact pre-top-up liquidation price.
  - Watch later marks. If the mark crosses that pre-top-up price while the position is still open (no `PositionLiquidated`), record a **save**: top-up transaction, crossing block, and the margin added.
  - Show a live "Saves" counter and list on Radar, on Twins, and in `/judges`.
- **Pass:**
  - Unit tests on synthetic mark paths: save, no save, and liquidated anyway.
  - Each live save links to its top-up transaction and crossing block.
  - The counter shows 0 honestly when there are none.
- **Evidence:**

#### [ ] U16 Public risk endpoint
- **Type:** AGENT · **Depends on:** U1, A3
- **Why:** It's an infrastructure give-back that Perpl integrators can call, which strengthens the Perpl API and Analytics stories.
- **Do:**
  - `GET /api/v1/risk/:address?chain=` returns JSON with the contract-exact liquidation price, distance, free balance, Lifeline dry run, and penalty at stake.
  - CORS open, 60 requests per minute per IP.
  - Documented in README and on `/judges`.
- **Pass:** Values equal `/api/account` for the same address, the rate limit returns 429 when exceeded, and the docs example `curl` works.
- **Evidence:**

#### [ ] U6 End-to-end strategy for Privy flows
- **Type:** AGENT, plus **HUMAN** (one real-Privy run per D5 cycle) · **Depends on:** A7 · **Amends:** A7 and D5 pass checks
- **Why:** G2 proved headless Playwright can't create a Privy guest wallet, so A7 and D5 as written can't pass automatically.
- **Do:**
  1. Try Playwright **headed** Chromium with a persistent context.
  2. If Privy still won't initialize, add an `E2E_WALLET=test` build flag that swaps the wallet adapter for a test signer using `TEST_OWNER_PK` from a local-only env. Everything else in the flow stays identical.
     - A build check must fail if the test adapter is present in a production bundle.
  3. Each D5 cycle is **3 automated runs plus 1 human run** with a real Privy guest. Prompt it like G2-H, and the agent verifies the human run onchain.
- **Pass:**
  - 3 automated runs are green.
  - The production bundle grep shows no test adapter.
  - The human run is confirmed with its transaction hashes.
- **Evidence:**

#### [ ] U12 Anti-abuse on `/claim` (Cloudflare Turnstile, free)
- **Type:** AGENT, plus **HUMAN** · **Depends on:** W6, A7
- **Why:** Guest accounts cost nothing to mint, so a script could drain the pool before judges arrive. That would turn the Privy and Track 1 demo into a sandbox fallback.
- **Human step:** In the Cloudflare dashboard, create a free Turnstile widget (managed or invisible mode) for the production domain and localhost. Put `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET` in `secrets/services.env`.
- **Do:** Require a Turnstile token on `/claim` and `/sandbox/arm`, verify it server-side in the Worker, and keep the existing rate limits.
- **Pass:**
  - A missing or invalid token returns 403.
  - A normal flow shows no visible challenge in Chrome and Safari.
  - Rate limits are still enforced.
- **Evidence:**

#### [ ] U11 Judge guide and bounty evidence pack
- **Type:** AGENT · **Depends on:** D5 · **Amends:** R1, R2
- **Why:** Bounty judges skim. Mapping each written requirement to a live, clickable proof raises the odds on every bounty.
- **Do:** Build a `/judges` page and a README "Bounty map." For each targeted bounty (Perpl API, Perpl Analytics/Risk, Envio, Privy, plus MetaMask, Nansen, and CRE if done), give:
  - the requirement in one line;
  - how Lifeline meets it;
  - the code path;
  - a one-click live proof, such as a real top-up transaction, the HyperSync-backed history endpoint, the Privy guest plus EIP-712 plus transaction flow, `/methodology`, the saves ledger, or the risk API.

  Add a 90-second "judge path" with deep links: a pre-filled lookup of a real at-risk mainnet account, the claim button, and the twins panel.
- **Pass:** Every claim has a working link (an automated link check), and the human reviews the page in R2.
- **Evidence:**

#### [ ] U14 Replay a recent real mainnet liquidation (replaces X5)
- **Type:** AGENT · **Depends on:** U1, U2, U10 · **Supersedes:** X5
- **Why:** It's a real person's real loss, shown with what Lifeline would have done. That's the strongest storytelling beat for the video and Track 1.
- **Constraint:** The public mainnet RPC serves only recent state. Block 110,000,000 (about 816k blocks back) was readable; 105,000,000 was not. Use a liquidation from the last 3 days.
- **Do:**
  - Fork mainnet locally at block N−1 of a recent `PositionLiquidated` and read the exact position and account state.
  - The exact rule must equal the event's `liqPricePNS`.
  - Sample the mark path over the hours before (onchain per-block samples or Perpl candles, server-side).
  - Mark the block where Lifeline would have acted at 4%/6%, and the AUSD it would have used from the account's idle balance.
  - **Precompute and store as static JSON,** so the page never needs archive access at runtime.
- **Pass:**
  - The replayed event matches to the exact tick.
  - The page renders from the stored JSON.
  - The "would act" block is the first sampled block below the trigger.
- **Evidence:**

---

## 8. Definition of done (core)

The core is done when all of these hold:

- Every task in Phases 0–7 and every U-task in §7A is `[x]`, or `[-]` with a logged reason. No `[!]` remains.
- G4 is `[x]` and `CALIBRATED=true`, backed by a 100% exact tick match in `gate:4 --fork`.
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
- G8 | `getPositionsV2` returns a 200-slot page; only the first `numPositions` entries are live, and the next cursor is that last entry's `nextNodeId` | counting the padded tail broke the position-count check while the lot sums already matched open interest | BTC page 2 was 200 slots with `numPositions` 60; after the slice, 17 markets matched exactly
- G6 | testnet BTC is perp 16, and a book price is `basePricePNS + priceONS` | perp 1 reverts on testnet; the SDK stores book prices as base plus the ONS offset | BTC `basePricePNS` 50000, and the bid/ask bracketed the mark
- G6 | order `maxNegPnlCollatBPS` defaults to 1000 | a taker order with 0 reverts `TakerOrderSettlementFailed` result code 14; the dex-sdk default is 1000 bps | IOC at 1000 filled lot 100, leverage hundredths 1495
- G6 | the self-match target is 15× (`leverageHdths` 1500) | testnet BTC initial margin 1500 is 15×, the PRD cap | filled position printed 1495 hundredths
- G1 | the operator simulation covers eight calls | the task names six revoked selectors plus `withdrawCollateral` and an ERC20 `transfer` | all eight reverted; `increasePositionCollateral` stayed allowlisted and the 1 AUSD top-up moved deposit and free balance by exactly 1000000
- G7 | `GAS_LIMITS` is ceil(max receipt gas × 1.2) per kind | Monad charges the gas limit, and the receipt's gasUsed equals that limit | three resends of each of the 11 kinds succeeded at base fee 100 gwei
- G2 | guest acceptance went through the dev page with `showWalletUIs: false` | Playwright's `createGuestAccount` stayed on "creating" and never returned a wallet | guest `0x435371A37dE781A03F1881bEEb127E2A6079BFdf` owns proxy `0x36DF02ca0E9B1644e181342A795556a66eB28b10`; mandate recovers to that guest; access token verifies ES256
- G3 | the soak worker is `lifeline-gate3` on `lifeline-shreyas.workers.dev` | the account had no workers.dev subdomain, and the production name `lifeline` stays free | 906 ticks in 30 minutes, max gap 2090 ms, 0 stored errors, signing succeeded, tail outcomes `ok`
- C1 | money is micro-dollars and MMF is `perpMaintMarginFracHdths / 100` | the docs example divides notional by 25, and testnet BTC maintenance hundredths are 2500 | docs P_liq is 94000 exactly; the calibration position read MMF 25
- G4 | funding 0 is within 0.1% of the testnet UI on a fresh BTC long, and the historical median is not | the UI price is 83650.6 and the formula with F = 0 gives 83728.08; 8 reconstructed liquidations had median error 0.1293 | relative UI error 0.0926%; `CALIBRATED` stays false because the historical median is above 0.1%
- G4 | the historical scan checkpoints `cli-state/gate-4-progress.json` and sleeps on the HyperSync reset header | a full lifecycle walk was dying on 429 | scan resumed from block 54,000,000 and finished at block 108,000,000
- G4 | the finished historical sample stays above 0.1%, so `CALIBRATED` remains false | 8 reconstructed liquidations had best median relative error 0.106726 | `gate:4` exit 1 after `checked=8`
- C2 | the read client keeps a 20 s timeout and one retry, and tries URLs in order | the pass check replaces the primary with a dead port | `listPerps` succeeded with `127.0.0.1:9` first
- C3 | maintenance margin is read once per market at lot 1 | BTC lots 1, 179, 670, and 12000 all returned maint hundredths 2500, and a per-lot read blew the 6 s budget | cold snapshot 1963 ms after the change, 20425 ms before it
- C3 | the public id is the first 8 hex chars of `keccak256(abi.encode(bytes32 salt, uint256 chainId, uint256 accountId))` | the backlog asks for keccak of the salt, chain, and account | snapshot JSON has no account address; salt is 32 bytes stored as 64 hex chars
- C3 | idle balance is read only for accounts that already have an at-risk position, and headline idle is the sum of the per-market totals | C3 says not to read every account, and the pass check requires the headline to equal the sum | an account at risk on two markets is counted in both
- C5 | the mandate has no extra message field | PRD §F5 already puts version `1` in the EIP-712 domain | sign/recover matches that domain
- C6 | `PAUSED` and `EXPIRED` are checked before mark and position state | a kill switch must not size a top-up | unit tests cover every skip reason
- C8 | the 30-day window is `blocks/sec` measured over the last 5,000 blocks, times 30 days | Monad's block time is not a hard-coded constant | live history from block 102159198 returned in 2186 ms
- P1 | `fund:mon` and `faucet:ausd` use `GAS_LIMITS` and resume an in-flight checkpoint instead of sending it again | Monad charges the gas limit, and a crash after broadcast would otherwise pay the same top-up twice | killed after operator `0xa65c83a0`; resume skipped that send; second `fund:mon` sent nothing; `status --floor SPONSOR:MON:1000000` exited 1
- P2 | the first pool side reduces the maker, and the book is used only when self-match would add to the maker | the maker was already short from G6, so three self-matched longs would leave two lots of exposure | maker net lot 1543 against size 1743; sides short, long, short
- P2 | the sponsor sent 0.5 MON to the pool owner and 0.5 MON to the maker before the three creates | both sat on their floors and measured gas would have crossed them | `0x6e93def2` and `0xcde8034b`, status 1, gas 36000
- P3 | SOL is perp 48, so the ETH fallback stayed unused | `listPerps` returned a SOL market and both SOL pairs filled | entries 12079/12081 and 12064/12062
- P3 | the sponsor sent the pool owner only the MON still above the 3 MON floor | topping up to 5 MON would have broken the sponsor floor | partial `0xf362ef64` of 0.559593068 MON
- W1 | the product Worker is `lifeline` and the G3 soak Worker `lifeline-gate3` stays deployed | the production name was kept free during the gate | `https://lifeline.lifeline-shreyas.workers.dev/health` `degraded:false`
- W1 | `degraded` is false until an alarm stores an error | a fresh Durable Object has no ticks, and the pass check requires `degraded:false` | health JSON above, `poolAvailable` 0
- W2 | the embedded wallet is proven with a signed nonce, not read from an unverified header | Privy access tokens carry `sub`, `iss` `privy.io`, `aud`, and `exp`, and not the wallet | unit test rejects a signature bound to a different user id; guest `GET /session` returned 200
- W3 | schema versions live in `schema_migrations` and columns are added only when missing | the gate Durable Object already had a narrower `pool` table | second selftest returned the same versions `[1, 2]`
- W4 | a pool house mandate is 1.5%/2.5%, cap 150 AUSD, budget 300 AUSD, expiry now plus 29 days, nonce 0 | PRD §F4 sets the distances, a pool account keeps about 300 AUSD free, the user cap is 150 AUSD, and validation rejects an expiry past 30 days | `GET /mandate/0xb4C851B0` returned trigger 150, target 250, budget `300000000`, kind `house`
- W4 | a protected twin is 4%/6% with the same cap and a 300 AUSD budget, and an unprotected twin has no row | PRD §F8 | four protected signatures recovered to `0xC417c69e`; four unprotected GETs returned 404
- W4 | `pool.json` has no leverage, so registration uses the market cap (BTC 1500, ETH 1200) | P2 targets those caps | `planEntries` test
- W4 | twins use status `twin` or `unprotected`, and re-registration leaves an active mandate in place | a claim must not hand out a twin, and a later user mandate must stay | `/health` `poolAvailable` 3; second `pool:register` stayed at 11 registered and 7 mandates
- W4 | migration 3 adds `market`, `role`, and `pair_id` | the twins panel needs the pair, and claim needs to tell a twin from the pool | schema selftest versions `[1, 2, 3]`
- W5 | three more BTC accounts bring the armed set to 10, and the soak clock restarts after that register | the pass needs the whole hour at 10 or more armed accounts | `pool:register` `registered 14 mandates 10`; reset `armed` 10 at `startedAt` 1791213417528
- W5 | `pool:create` can exit 1 after a successful create when an older account leaves the distance band | the forced breach left `0xb4C851B0` at distance 57618 | log line `inBand=false`, and `done 6/6`
- W6 | a test claim is the admin secret plus the same wallet proof and a caller-supplied user id | five latency claims need five user ids, and one Privy guest is one user | empty `POST /claim` returned 503 `{sandbox:true}`
- W6 | the 0.08 MON drip is refused when it would put the sponsor under 3 MON | the sponsor was on its floor before the 20 MON transfer | route returns 503 `{error:"sponsor floor"}` before sending
- W6 | five latency claims share the test-owner wallet and use distinct user ids, with the admin secret gating that path | the pass needs five claims, one user, and an IP limit of three | p50 787 ms; first `pendingOwner` is the test owner; MON +0.08; repeat 409; fourth same-IP claim 429
- W7 | disarm is an EIP-191 personal signature, separate from the EIP-712 mandate | the backlog leaves the disarm encoding open | message `lifeline-disarm:<proxy>:<nonce>`
- W7 | the arm route stays undeployed until the W5 hour finishes | a worker deploy opens an alarm gap larger than 10 s | test owner accepted `0xe3929EB4` via `0xbca91b70` and is `owner()`
- W5 | alarm timestamps stay in the isolate, and `health_state` is updated only when the error changes | each tick inserted a row, deleted a row, and updated health, and `lifeline-gate3` inserted another row every 2 s; that reached 90% of the 100,000 daily rows-written cap | after the cut, `/health` `ticksLast10m` is 3 and gate3 returns `{"stopped":true}`
- G4 (planner) | the contract-truth fork check replaces historical replay as gate step b | lifecycle replay from events misses collateralized PnL, premium settlement, collateral decreases, partial liquidations, and residue, which explains the 10.7% median; on a local fork `liquidations(…, false)` emits the contract's own `liqPricePNS` via `CantLiquidatePosAboveMMR` | `docs/reference/g4-fork-*-result.txt`
- G4 (planner) | the exact rule is: raw `pricePNS` entry (residue ignored), `premiumPnlCNS` subtracted (positive = received), MMR at raw entry, ceil to tick for longs and floor for shorts | variant comparison: `raw:cons` exact on 152/152 testnet and 542/542 mainnet; the SDK effective-entry form without rounding was within 1 tick on only 130/152 and 419/542 | probe run on 2026-10-05 against forks at testnet 68,465,119 and mainnet 110,816,351
- G4 (planner) | the core already subtracts `premiumPnlCNS` with the right sign; only conservative tick rounding is missing for exactness | `packages/core/src/math/liquidation.ts` gap = mmr − deposit − funding; `radar/snapshot.ts` passes `premiumPnlCNS` as funding | U1
- U14 (planner) | the public mainnet RPC serves only recent state | `getPositionIds` at block 110,000,000 succeeded; at 105,000,000 it returned "Block requested not found" | the replay must use a liquidation from the last ~3 days
- X5 (planner) | descoped in favor of U14 | the fork-at-N−1 method is exact, while event reconstruction is not | G4 finding
- U2 | anvil starts with `--quiet` and `--disable-block-gas-limit` | this anvil build rejects `--silent`, and it rejects `--gas-limit` together with `--disable-block-gas-limit` | `anvil --help`; `gate:4 --fork` exit 0
- U2 | a liquidation batch that returns no price event is split and retried | one mainnet pass saw UNI with 14 live positions and 0 events; later passes priced that market | final second run UNI 13 of 13, `exactMatchPct` 100
- U2 | fixtures keep positions that emit `CantLiquidatePosAboveMMR` or `PositionLiquidated` | a few live positions emit neither, as in the reference probe | second run 912 priced positions, coverage bar met, real nonces unchanged
- U1 | `liquidationPricePNS` is the product rule: raw `pricePNS`, premium subtracted, maintenance at lot 0, ceil for longs and floor for shorts | a one-tick conservative price is what the contract emits | fixture test exact on 912 positions; dex-sdk entry-100 vectors pass
- U1 | bankruptcy drops the maintenance term and keeps the same tick rounding | the dex-sdk tests separate liquidation from bankruptcy | long base 90, pay 95, receive 85; short base 110, pay 105, receive 115
- G4 | `CALIBRATED=true` | step b is the fork fixture match, and the historical median is no longer a gate | `packages/core/src/config/calibration.ts`; UI check stays 0.0926%
- U15 | rank markets by the variance of successive relative `MarkUpdated` moves over the last 20,000 blocks | a 30-minute poll is slower, and raw price variance is not comparable across MON and ZEC | MON `3.2157e-7` (742), PUMP `1.8296e-7` (518), NEAR `1.8069e-7` (625), ZEC `1.1960e-7` (374)
- U15 | a new leg is sized to 180 AUSD of initial margin, and the order leverage is the market's own initial-margin hundredths | $1,500 at MON's 3× needs $500, and the twin account only holds $400 | `mon-long` filled at 2921/2922
- U15 | a book fill outside 0.1% is closed with a crossing IOC (`maxMatches` 50) and dropped when it is not in the current plan | the first MON short filled 3094 against 3103 | closes `0xce4e5328` and `0x6df0820d`; the pair was then empty
- U15 | `pool:register` accepts a claimed account whose house mandate is still the active one | W6 moved `0xe3929EB4` to the test owner and the house mandate stayed | register exit 0, `kind=house`
- W7 | the arm and disarm routes went out with the U15 worker deploy | the soak hour had finished, and `/twins` needed a deploy | version `1d53d621-2ac3-4412-b5ba-97f9c8ae87a0`
- W7 | the mandate signer is the owner EOA, and `account` in the typed data is the proxy | the session wallet and the proxy are different addresses, so requiring them to be equal rejected every real arm | `arm:trial` non-owner 403, owner arms 200
- W7 | a user mandate uses nonce 1 or higher | the house mandate already stores nonce 0, and `nonceUsed` treats that stored nonce as spent | five arms used nonces 1–5; replay of nonce 1 returned 409
- W7 | `/admin/breach` does not reactivate `active = 0` | disarm must survive a forced breach | `breachMayReplace(0)` is false; live breach returned `armed:false` and no new action
- W7 | arm inserts an `inflight` pending row before `sendTransaction` | the keeper tick can otherwise send a second top-up for the same position | five chain distances landed at 59999 with one action each
- W8 | `GET /twins` lists pair id, market, side, and house-versus-none mandate | U15 needed the list before sandbox arm | `count` 7 on 2026-10-06; distances, actions, outcomes, and `POST /sandbox/arm` are still open
- U3 | `/claim` prefers the demo band [2.5%, 3.5%], then the closest position above the 1.5% house trigger | a position that has drifted to 2% would otherwise be handed out and might sit above a 4% trigger | `pickPool` test; live arms used 4.5%/6.5% when distance was about 3.2%
- U3 | arm defaults are `max(4%, roundUp(distance, 0.5%) + 1%)` and target is trigger + 2%, clamped to a 20% target | the judge must see a top-up even when the position is safer than 4% | property test from 1.5% to 15%; cycle 20 armed 6.5%/8.5% from 5.24%
- U3 | a signed transaction is posted to each testnet RPC, and the nonce falls back to the chain when the stored nonce is more than one ahead | dropped broadcasts had left the worker nonce ahead, so later sends never landed | sponsor nonce stayed 53 until the reset; `0x42ff833f` then confirmed
- U3 | receipt polls inside one Worker invocation stay at three tries | more polls hit the Worker subrequest cap | claim returns the tx hashes and `arm:demo` waits for them on the local RPC
- U3 | a failed keeper tick reschedules in 20s | a 2s loop of failing RPC calls kept the endpoint rate-limited | `/health` after a deploy showed the alarm still present
- U3 | `pool:register` reopens a claimed row whose on-chain owner is still the pool owner and whose pending owner is zero | a broadcast that never landed had marked `0xc4C86A35` claimed | after reopen, `/health` `poolAvailable` was 20 and that proxy was cycle 1
- U3 | a failed maker cancel does not abort `pool:create` | the cancel reverted after a zero-lot book fill and stopped the remaining opens | later `pool:create done 27/27`
- W8 | sandbox arm is unsigned and limited to 3 calls per IP per hour | the fallback demo has no wallet, and an open route would let one client drain the house budget | sol-short `0x85fe2562`; fourth call 429
- W8 | a closed leg is `liquidated at block N`, a non-positive distance is `crossed liq at block N`, and every other open leg is `alive` | the twins panel needs an outcome before a liquidator event exists | all 7 pairs were `alive` on 2026-10-06
- W9 | the canary is an `increasePositionCollateral(1)` eth_call; any other selector counts as a revert | the operator is allowlisted only for that call, so a revoked selector must set degraded | `judgeCanary(execOrder)` is `canary revert`
- W9 | `/health` sets the alarm 50ms out when it is missing or the last tick is more than 10s old | a deleted alarm must resume without waiting for the next isolate event | alarm test, under 5s
- U4 | positions above 6% are status `reserve` and `pickPool` offers them last | the demo should hand out the 2.5–3.5% band first | claim test: 7% loses to 2%, and is chosen only when it is alone
- U4 | an unaccepted claim is recycled at most once a minute by `transferOwnership(0)`, and only released when `pendingOwner` reads back as zero | the house mandate stays in place, and an accepted owner is not overwritten | `planRecycle` keeps an owner who is not the pool owner; `releaseClaim` deletes the claim row
- U4 | `pool:refill` counts pool-owned positions at or under 6%, and the demo band is 2.5–3.5% | claimed accounts and far-from-liquidation positions should not satisfy the inventory targets | first run 30/15/15/30; re-run `nothing new`
- U4 | `pool:register` accepts a house-signed `user` mandate on an account the pool owner still owns | sandbox arm left sol-short as `kind=user` without moving `owner()` | register exit 0, `house-signed kind=user`
- U5 | `/health` reads sponsor and operator balances and the 2.5–3.5% band at most once a minute | radar and UptimeRobot both hit `/health`, and a chain read on every request would multiply RPC calls | live JSON `poolAvailable` 30, `poolInBand` 30, `poolBySide` 15/15, `low` false
- U5 | `low` is true only under 3 MON, under 1 MON, under 10 available, or under 5 in-band | the floors themselves must stay quiet | `isOpsLow` test
- U5 | the judging budget is 31.14 MON and `status` prints it without turning it into a `LOW:` floor | the 3 MON sponsor floor stays the operational alert; 31.14 is the judging reserve | `budget short need=31.1400 sponsor=21.0530 shortfall=10.0869`
- U5 | the 30-minute runner is `.github/workflows/ops.yml`, and until a private remote exists the same three commands are the daily cycle | this checkout has no git remote, and `cli-state/` is gitignored so a clean Actions runner must restore it from cache instead of minting a second pool | local cycle exit 0 after the operator top-up `0xba696288`
