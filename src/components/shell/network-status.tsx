"use client";

import { useQuery } from "@tanstack/react-query";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { api } from "@/lib/client/api";
import { cn } from "../ui/primitives";

export interface NetworkInfo {
  chainId: number;
  network: string;
  rpcOk: boolean;
  blockNumber: string | null;
  blockTime: string | null;
  gasPriceWei: string | null;
  musdTotalSupply: string | null;
  musdHolders: number | null;
  rpcLatencyMs: number;
  fetchedAt: string;
}

export function useNetworkInfo() {
  return useQuery({
    queryKey: ["network"],
    queryFn: () => api<NetworkInfo>("/api/network"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

/**
 * Persistent testnet badge + live block height, straight from the RPC.
 * `className` owns the display value (default inline-flex), so callers can hide it
 * responsively with e.g. "hidden md:inline-flex" without a class-order conflict.
 */
export function NetworkStatus({ className = "inline-flex" }: { className?: string }) {
  const { data, isError } = useNetworkInfo();
  const ok = data?.rpcOk && !isError;
  return (
    <div className={cn("h-8 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[12px]", className)}>
      <span className="rounded-full bg-warn/15 px-1.5 py-px font-semibold text-warn">Testnet</span>
      <span className="hidden text-muted sm:inline">{SUPPORTED_NETWORK.name}</span>
      <span className="inline-flex items-center gap-1.5 text-muted" title={ok ? `RPC latency ${data?.rpcLatencyMs} ms` : "RPC unreachable"}>
        <span className={cn("size-1.5 rounded-full", ok ? "bg-pass" : data ? "bg-fail" : "bg-na")} aria-hidden />
        <span className="tnum">{data?.blockNumber ? `#${Number(data.blockNumber).toLocaleString("en-US")}` : isError ? "RPC down" : "…"}</span>
        <span className="sr-only">{ok ? "RPC healthy" : "RPC unavailable"}</span>
      </span>
    </div>
  );
}
