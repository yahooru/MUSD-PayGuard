"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, ExternalLink, ListFilter, ScrollText, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { explorer } from "@/config/chains";
import { api } from "@/lib/client/api";
import type { TransactionDTO } from "@/lib/dto";
import type { TxStatus } from "@/lib/engine/status";
import { STATUS_LABEL } from "@/lib/engine/status";
import { formatDateTime, shortHash } from "@/lib/format";
import { Musd, ShortAddress } from "@/components/ui/data";
import { Button, Empty, Input, PageHeader, Skeleton, cn } from "@/components/ui/primitives";
import { RiskBadge, TxStatusPill } from "@/components/ui/status";

const STATUSES: TxStatus[] = ["confirmed", "pending", "failed", "verification_delayed", "unknown"];
const RISKS = [
  ["low", "Low observed risk"],
  ["caution", "Caution"],
  ["high", "High risk"],
] as const;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-8 rounded-full border px-3 text-[13px] transition-colors", on ? "border-cyan/60 bg-cyan/10 text-text" : "border-line text-muted hover:border-line-strong")}
    >
      {children}
    </button>
  );
}

export function HistoryClient() {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [risks, setRisks] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const dq = useDeferredValue(search);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const params = new URLSearchParams();
  if (statuses.length) params.set("status", statuses.join(","));
  if (risks.length) params.set("risk", risks.join(","));
  if (dq.trim()) params.set("q", dq.trim());
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (min) params.set("min", min);
  if (max) params.set("max", max);
  const PAGE = 25;
  const q = useInfiniteQuery({
    queryKey: ["history", params.toString()],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ transactions: TransactionDTO[]; hasMore: boolean }>(`/api/transactions?${params.toString()}&limit=${PAGE}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.transactions) ?? [];
  const filtered = statuses.length || risks.length || dq || from || to || min || max;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction history"
        lede="Only transactions that were actually submitted on-chain appear here. Unsent drafts live on the dashboard; payment requests have their own page."
        actions={
          <a href="/api/export" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface-2 px-4 text-sm hover:border-cyan/60">
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <section className="card space-y-4 p-4" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <ListFilter className="size-4 text-faint" aria-hidden />
          {STATUSES.map((s) => (
            <Chip key={s} on={statuses.includes(s)} onClick={() => toggle(statuses, setStatuses, s)}>
              {STATUS_LABEL[s]}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {RISKS.map(([v, l]) => (
            <Chip key={v} on={risks.includes(v)} onClick={() => toggle(risks, setRisks, v)}>
              {l}
            </Chip>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Recipient, name, reference or hash" className="pl-10" aria-label="Search" />
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-faint">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min MUSD" aria-label="Minimum amount" />
            <span className="text-faint">to</span>
            <Input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max MUSD" aria-label="Maximum amount" />
          </div>
        </div>
      </section>

      {q.isLoading ? (
        <Skeleton className="h-72" />
      ) : rows.length === 0 ? (
        <Empty
          icon={<ScrollText className="size-4" />}
          title={filtered ? "No payment matches these filters" : "No on-chain payments yet"}
          body={filtered ? "Clear a filter to widen the search." : "Send a payment and it will be listed here once its hash is recorded."}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <caption className="sr-only">Payments</caption>
            <thead className="border-b border-line text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Date (UTC)</th>
                <th scope="col" className="px-4 py-3 font-medium">Recipient</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                <th scope="col" className="px-4 py-3 font-medium">Reference</th>
                <th scope="col" className="px-4 py-3 font-medium">Risk at review</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/tx/${t.id}`} className="link">
                      {formatDateTime(t.submittedAt).replace(" UTC", "")}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <ShortAddress address={t.recipient} label={t.recipientLabel} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Musd value={t.amount} maxFraction={4} />
                  </td>
                  <td className="px-4 py-3">{t.invoiceRef ?? <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-3">
                    <RiskBadge category={t.riskCategory} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <TxStatusPill status={t.status} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <a href={explorer.tx(t.txHash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-muted hover:text-text">
                      {shortHash(t.txHash)} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage ? (
        <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
