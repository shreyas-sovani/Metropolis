import { DurableObject } from "cloudflare:workers";
import { encodeFunctionData, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { evaluateStub, maxGapMs } from "./stats.js";

const PROXY = "0xEc73AFB31b20729160c247A3009C193a4842e95A" as const;
const EXCHANGE = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc" as const;
const PERP_ID = 16n;
const ACCOUNT_ID = 816n;
const ALARM_MS = 2_000;
const WINDOW_MS = 10 * 60 * 1000;

const readAbi = [
  {
    type: "function",
    name: "getPositionV2",
    stateMutability: "view",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "accountId", type: "uint256" },
    ],
    outputs: [
      {
        name: "position",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "nextNodeId", type: "uint256" },
          { name: "prevNodeId", type: "uint256" },
          { name: "positionType", type: "uint8" },
          { name: "depositCNS", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "entryBlock", type: "uint256" },
          { name: "pnlCNS", type: "int256" },
          { name: "deltaPnlCNS", type: "int256" },
          { name: "premiumPnlCNS", type: "int256" },
          { name: "priceResiduePNSQ16", type: "uint256" },
        ],
      },
      { name: "markPricePNS", type: "uint256" },
      { name: "markPriceValid", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getAccountById",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "uint256" }],
    outputs: [
      {
        name: "account",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "balanceCNS", type: "uint256" },
          { name: "lockedBalanceCNS", type: "uint256" },
          { name: "frozen", type: "uint8" },
          { name: "accountAddr", type: "address" },
          {
            name: "positions",
            type: "tuple",
            components: [
              { name: "bank1", type: "uint256" },
              { name: "bank2", type: "uint256" },
              { name: "bank3", type: "uint256" },
              { name: "bank4", type: "uint256" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "increasePositionCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "amountCNS", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export interface KeeperEnv {
  OPERATOR_PK: string;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  return message.replace(/0x[0-9a-fA-F]{64}/g, "0x…").slice(0, 180);
}

export class Keeper extends DurableObject<KeeperEnv> {
  constructor(ctx: DurableObjectState, env: KeeperEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ticks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          error TEXT,
          signed INTEGER NOT NULL
        )
      `);
    });
  }

  override async alarm(): Promise<void> {
    const started = Date.now();
    let error: string | null = null;
    let signed = 0;
    try {
      signed = (await this.tick()) ? 1 : 0;
    } catch (caught) {
      error = safeError(caught);
    } finally {
      this.ctx.storage.sql.exec(
        "INSERT INTO ticks (at, duration_ms, error, signed) VALUES (?, ?, ?, ?)",
        started,
        Date.now() - started,
        error,
        signed,
      );
      await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("lifeline", { status: 404 });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm < Date.now() - 10_000) {
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
    return Response.json(this.health());
  }

  private health() {
    const now = Date.now();
    const rows = this.ctx.storage.sql
      .exec("SELECT at, error, signed FROM ticks ORDER BY at")
      .toArray() as { at: number; error: string | null; signed: number }[];
    const recent = rows.filter((row) => row.at >= now - WINDOW_MS);
    const last = rows[rows.length - 1];
    return {
      lastTick: last?.at ?? null,
      ticksLast10Min: recent.length,
      total: rows.length,
      maxGapMs: maxGapMs(rows.map((row) => row.at)),
      errors: rows.filter((row) => row.error).length,
      lastError: [...rows].reverse().find((row) => row.error)?.error ?? null,
      signed: last?.signed === 1,
    };
  }

  private async tick(): Promise<boolean> {
    const client = createPublicClient({
      chain: monadTestnet,
      transport: http("https://testnet-rpc.monad.xyz", { timeout: 1_500 }),
    });
    const [position] = await client.multicall({
      contracts: [
        {
          address: EXCHANGE,
          abi: readAbi,
          functionName: "getPositionV2",
          args: [PERP_ID, ACCOUNT_ID],
        },
        {
          address: EXCHANGE,
          abi: readAbi,
          functionName: "getAccountById",
          args: [ACCOUNT_ID],
        },
      ],
      allowFailure: false,
    });
    const deposit = position[0].depositCNS;
    if (evaluateStub(deposit) !== "skip") {
      throw new Error("evaluator stub changed");
    }
    const key = this.env.OPERATOR_PK;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("operator key missing");
    const account = privateKeyToAccount(key as `0x${string}`);
    const signed = await account.signTransaction({
      chainId: 10143,
      nonce: 0,
      gas: 250_000n,
      maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: PROXY,
      data: encodeFunctionData({
        abi: readAbi,
        functionName: "increasePositionCollateral",
        args: [PERP_ID, 1n],
      }),
    });
    return signed.startsWith("0x");
  }
}
