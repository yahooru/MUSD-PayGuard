import { MUSD } from "@/config/contracts";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { musdAbi } from "@/config/contracts";
import { publicClient, withTimeout } from "@/lib/server/chain";
import { fetchTokenHolders } from "@/lib/server/explorer";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Live, real network facts for the landing page and status bar. Never fabricated: nulls on failure. */
export async function GET() {
  const c = publicClient();
  const started = Date.now();
  const [block, gasPrice, supply, holders] = await Promise.allSettled([
    withTimeout(c.getBlock(), 6000, "block"),
    withTimeout(c.getGasPrice(), 6000, "gas"),
    withTimeout(c.readContract({ address: MUSD.address, abi: musdAbi, functionName: "totalSupply" }), 6000, "supply"),
    fetchTokenHolders(),
  ]);
  const rpcLatencyMs = Date.now() - started;
  return json(
    {
      chainId: SUPPORTED_NETWORK.chainId,
      network: SUPPORTED_NETWORK.name,
      rpcOk: block.status === "fulfilled",
      blockNumber: block.status === "fulfilled" ? block.value.number.toString() : null,
      blockTime: block.status === "fulfilled" ? new Date(Number(block.value.timestamp) * 1000).toISOString() : null,
      gasPriceWei: gasPrice.status === "fulfilled" ? gasPrice.value.toString() : null,
      musdTotalSupply: supply.status === "fulfilled" ? supply.value.toString() : null,
      musdHolders: holders.status === "fulfilled" ? holders.value : null,
      rpcLatencyMs,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
