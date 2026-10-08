import { ADDRESSES, TESTNET_ID, erc20Abi, openChain, rpcUrls } from "@lifeline/core";
import { getAddress, isAddress } from "viem";
import { jsonError } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }): Promise<Response> {
  const { address } = await context.params;
  if (!isAddress(address)) return jsonError("address", 400);
  const wallet = getAddress(address);
  const ausd = ADDRESSES[TESTNET_ID].ausd;
  if (!ausd) return jsonError("ausd", 500);
  try {
    const chain = openChain(TESTNET_ID, { urls: rpcUrls(TESTNET_ID), timeout: 8_000 });
    const [monWei, ausdMicro] = await Promise.all([
      chain.client.getBalance({ address: wallet }),
      chain.client.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    ]);
    return Response.json({ address: wallet, monWei: monWei.toString(), ausdMicro: ausdMicro.toString() });
  } catch {
    return jsonError("rpc", 502);
  }
}
