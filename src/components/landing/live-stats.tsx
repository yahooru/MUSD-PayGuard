"use client";

import { formatAmount } from "@/lib/amount";
import { useNetworkInfo } from "../shell/network-status";

/** Real, live numbers from Mezo Testnet. Shows "unavailable" rather than inventing anything. */
export function LiveStats() {
  const { data, isError } = useNetworkInfo();
  const items = [
    { label: "Latest block", value: data?.blockNumber ? `#${Number(data.blockNumber).toLocaleString("en-US")}` : null },
    { label: "MUSD in circulation", value: data?.musdTotalSupply ? `${formatAmount(BigInt(data.musdTotalSupply), { maxFraction: 0, minFraction: 0 })}` : null },
    { label: "MUSD holders", value: data?.musdHolders != null ? data.musdHolders.toLocaleString("en-US") : null },
    { label: "Gas price", value: data?.gasPriceWei ? `${data.gasPriceWei} wei` : null },
    { label: "RPC round trip", value: data ? `${data.rpcLatencyMs} ms` : null },
  ];
  return (
    <div className="card grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x" aria-live="polite">
      {items.map((it) => (
        <div key={it.label} className="px-5 py-4">
          <p className="text-[12px] text-faint">{it.label}</p>
          <p className="tnum mt-1 text-[18px] font-semibold">{it.value ?? (isError ? "Unavailable" : "…")}</p>
        </div>
      ))}
    </div>
  );
}
