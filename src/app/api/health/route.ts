import { SUPPORTED_NETWORK } from "@/config/chains";
import { publicClient, withTimeout, errorMessage } from "@/lib/server/chain";
import { q1 } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const [dbRes, rpcRes] = await Promise.allSettled([
    withTimeout(q1<{ ok: number }>("SELECT 1 AS ok"), 5000, "db"),
    withTimeout(Promise.all([publicClient().getChainId(), publicClient().getBlockNumber()]), 6000, "rpc"),
  ]);
  const db = dbRes.status === "fulfilled" ? "ok" : `error: ${errorMessage(dbRes.reason)}`;
  const rpc = rpcRes.status === "fulfilled" ? "ok" : `error: ${errorMessage(rpcRes.reason)}`;
  const chainId = rpcRes.status === "fulfilled" ? rpcRes.value[0] : null;
  const blockNumber = rpcRes.status === "fulfilled" ? rpcRes.value[1].toString() : null;
  const healthy = db === "ok" && rpc === "ok" && chainId === SUPPORTED_NETWORK.chainId;
  return json(
    { status: healthy ? "ok" : "degraded", db, rpc, chainId, expectedChainId: SUPPORTED_NETWORK.chainId, blockNumber, time: new Date().toISOString(), latencyMs: Date.now() - started },
    { status: healthy ? 200 : 503 },
  );
}
