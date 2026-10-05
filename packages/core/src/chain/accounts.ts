import type { Address, PublicClient } from "viem";
import { exchangeAbi } from "../abi/exchange.js";
import { perpIdsFromBitmap } from "./bitmap.js";
import { type PositionNode } from "./positions.js";

export interface AccountInfo {
  accountId: bigint;
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  freeCNS: bigint;
  frozen: number;
  accountAddr: Address;
  perpIds: number[];
}

export interface AccountPosition {
  perpId: number;
  position: PositionNode;
  markPricePNS: bigint;
  markPriceValid: boolean;
}

interface AccountRaw {
  accountId: bigint;
  balanceCNS: bigint;
  lockedBalanceCNS: bigint;
  frozen: number;
  accountAddr: Address;
  positions: { bank1: bigint; bank2: bigint; bank3: bigint; bank4: bigint };
}

export function freeBalanceCNS(balanceCNS: bigint, lockedBalanceCNS: bigint): bigint {
  return balanceCNS > lockedBalanceCNS ? balanceCNS - lockedBalanceCNS : 0n;
}

export function asAccount(raw: AccountRaw): AccountInfo {
  return {
    accountId: raw.accountId,
    balanceCNS: raw.balanceCNS,
    lockedBalanceCNS: raw.lockedBalanceCNS,
    freeCNS: freeBalanceCNS(raw.balanceCNS, raw.lockedBalanceCNS),
    frozen: Number(raw.frozen),
    accountAddr: raw.accountAddr,
    perpIds: perpIdsFromBitmap([
      raw.positions.bank1,
      raw.positions.bank2,
      raw.positions.bank3,
      raw.positions.bank4,
    ]),
  };
}

export async function readAccounts(
  client: PublicClient,
  exchange: Address,
  ids: readonly bigint[],
): Promise<AccountInfo[]> {
  if (ids.length === 0) return [];
  const rows = await client.multicall({
    contracts: ids.map((id) => ({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountById" as const,
      args: [id] as const,
    })),
    allowFailure: false,
  });
  return rows.map((row) => asAccount(row as AccountRaw));
}

export async function readAccountByAddr(
  client: PublicClient,
  exchange: Address,
  accountAddr: Address,
): Promise<AccountInfo> {
  const raw = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getAccountByAddr",
    args: [accountAddr],
  })) as AccountRaw;
  return asAccount(raw);
}

export async function readPositionsForAccount(
  client: PublicClient,
  exchange: Address,
  accountId: bigint,
): Promise<AccountPosition[]> {
  const [account] = await readAccounts(client, exchange, [accountId]);
  if (!account || account.perpIds.length === 0) return [];
  const rows = await client.multicall({
    contracts: account.perpIds.map((perpId) => ({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPositionV2" as const,
      args: [BigInt(perpId), accountId] as const,
    })),
    allowFailure: false,
  });
  const open: AccountPosition[] = [];
  account.perpIds.forEach((perpId, index) => {
    const row = rows[index] as readonly [PositionNode, bigint, boolean];
    const position = row[0];
    if (position.lotLNS <= 0n) return;
    open.push({
      perpId,
      position,
      markPricePNS: row[1],
      markPriceValid: row[2],
    });
  });
  return open;
}
