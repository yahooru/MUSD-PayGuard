"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins, Plus, ReceiptText, Send, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { SUPPORTED_NETWORK, chainName, isSupportedChain } from "@/config/chains";
import { formatAmount } from "@/lib/amount";
import { api } from "@/lib/client/api";
import type { RecipientDTO, TransactionDTO } from "@/lib/dto";
import { relativeTime } from "@/lib/format";
import { useSession } from "@/components/session";
import { FullAddress, Musd, ShortAddress } from "@/components/ui/data";
import { ButtonLink, Empty, PageHeader, SectionTitle, Skeleton, cn } from "@/components/ui/primitives";
import { CheckIcon, RiskBadge, TxStatusPill } from "@/components/ui/status";
import { useMusdBalance, useNetworkActions } from "@/components/wallet/wallet";

interface Dashboard {
  recent: TransactionDTO[];
  pending: TransactionDTO[];
  warnings: { checkId: string; status: "warn" | "fail"; severity: string; title: string; explanation: string; createdAt: string; draftId: string }[];
  recipients: RecipientDTO[];
  recipientCount: number;
  counts: Record<string, { n: number; total: string }>;
  drafts: { id: string; recipient: string; amount: string; invoiceRef: string | null; status: string; updatedAt: string }[];
}

export function TxRow({ tx }: { tx: TransactionDTO }) {
  return (
    <li>
      <Link href={`/tx/${tx.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[10px] px-3 py-3 hover:bg-surface-2 sm:grid-cols-[1.4fr_1fr_auto]">
        <span className="min-w-0">
          <ShortAddress address={tx.recipient} label={tx.recipientLabel} />
          <span className="block truncate text-[12px] text-faint">
            {tx.invoiceRef ? `${tx.invoiceRef}, ` : ""}
            {relativeTime(tx.submittedAt)}
          </span>
        </span>
        <span className="hidden sm:block">
          <TxStatusPill status={tx.status} size="sm" />
        </span>
        <span className="text-right">
          <Musd value={tx.amount} maxFraction={2} className="text-[14px] font-medium" />
          <span className="mt-0.5 block sm:hidden">
            <TxStatusPill status={tx.status} size="sm" />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function DashboardClient() {
  const session = useSession();
  const { address, chainId, isConnected } = useAccount();
  const { musd, native } = useMusdBalance((address ?? session.address ?? undefined) as `0x${string}` | undefined);
  const { addMusd, switchToMezo } = useNetworkActions();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard"), refetchInterval: 20_000 });
  const d = q.data;
  const confirmed = d?.counts.confirmed;
  const firstRun = d && d.recent.length === 0 && d.recipientCount === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        lede="Your MUSD, your pending payments and everything PayGuard flagged recently."
        actions={
          <>
            <ButtonLink href="/requests?new=1" icon={<ReceiptText className="size-4" aria-hidden />}>
              Request payment
            </ButtonLink>
            <ButtonLink href="/send" variant="primary" icon={<Send className="size-4" aria-hidden />}>
              New payment
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="hull p-5 md:col-span-2">
          <p className="text-[13px] text-muted">MUSD balance (live from {SUPPORTED_NETWORK.name})</p>
          <p className="display mt-2 text-[40px]">
            {musd.data !== undefined ? <Musd value={musd.data} maxFraction={4} /> : musd.isError ? <span className="text-[18px] text-fail">RPC unavailable</span> : <Skeleton className="h-10 w-56" />}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
            <span>
              BTC for fees:{" "}
              <span className="tnum text-text">{native.data ? formatAmount(native.data.value, { maxFraction: 8, minFraction: 0 }) : "…"}</span>
            </span>
            <span className="min-w-0">
              Wallet: <FullAddress address={session.address ?? ""} className="align-middle" />
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={addMusd} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-strong px-3 text-[13px] hover:border-cyan/60">
              <Coins className="size-3.5" aria-hidden /> Add MUSD to wallet
            </button>
            {isConnected && !isSupportedChain(chainId) ? (
              <button type="button" onClick={switchToMezo} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-warn/50 px-3 text-[13px] text-warn">
                <TriangleAlert className="size-3.5" aria-hidden /> On {chainName(chainId)}: switch
              </button>
            ) : null}
          </div>
        </div>
        <div className="card flex flex-col justify-between p-5">
          <div>
            <p className="text-[13px] text-muted">Verified payments</p>
            <p className="display mt-2 text-[34px] tnum">{d ? (confirmed?.n ?? 0) : "…"}</p>
            <p className="text-[13px] text-muted">{confirmed ? <Musd value={confirmed.total} maxFraction={2} /> : null}</p>
          </div>
          <p className="mt-4 text-[12px] text-faint">
            {d ? `${d.pending.length} awaiting verification, ${d.counts.failed?.n ?? 0} failed` : ""}
          </p>
        </div>
      </div>

      {firstRun ? (
        <section className="hull p-6" aria-labelledby="onboard-h">
          <h2 id="onboard-h" className="heading text-lg">
            Get set up in three steps
          </h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ["Get testnet funds", "Testnet BTC pays fees. Use the Mezo faucet, then borrow or receive test MUSD.", SUPPORTED_NETWORK.faucetUrl!, true],
              ["Save a recipient you trust", "Saved contacts let PayGuard catch changed and lookalike addresses.", "/recipients?new=1", false],
              ["Send a first small payment", "Watch every check run, then see the receipt verified on-chain.", "/send", false],
            ].map(([t, b, href, ext], i) => (
              <li key={t as string} className="card p-4">
                <span className="mono text-[12px] text-cyan">Step {i + 1}</span>
                <p className="mt-1 font-medium">{t as string}</p>
                <p className="mt-1 text-[13px] text-muted">{b as string}</p>
                {ext ? (
                  <a className="link mt-2 inline-block text-[13px]" href={href as string} target="_blank" rel="noopener noreferrer">
                    Open faucet
                  </a>
                ) : (
                  <Link className="link mt-2 inline-block text-[13px]" href={href as string}>
                    Start
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-8">
          {d && d.pending.length > 0 ? (
            <section aria-labelledby="pending-h">
              <SectionTitle id="pending-h">Awaiting verification</SectionTitle>
              <ul className="card divide-y divide-line p-1">{d.pending.map((t) => <TxRow key={t.id} tx={t} />)}</ul>
            </section>
          ) : null}
          <section aria-labelledby="recent-h">
            <SectionTitle id="recent-h" aside={<Link className="link text-[13px]" href="/history">All history</Link>}>
              Recent payments
            </SectionTitle>
            {q.isLoading ? (
              <Skeleton className="h-48" />
            ) : d && d.recent.length ? (
              <ul className="card divide-y divide-line p-1">{d.recent.map((t) => <TxRow key={t.id} tx={t} />)}</ul>
            ) : (
              <Empty icon={<Send className="size-4" />} title="No payments yet" body="Payments you send through PayGuard appear here with their verified status." action={<ButtonLink href="/send" variant="primary">New payment</ButtonLink>} />
            )}
          </section>
          {d && d.drafts.length ? (
            <section aria-labelledby="drafts-h">
              <SectionTitle id="drafts-h">Unsent drafts</SectionTitle>
              <ul className="card divide-y divide-line p-1">
                {d.drafts.map((x) => (
                  <li key={x.id}>
                    <Link href={`/review/${x.id}`} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-3 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="mono block truncate text-[13px]">{x.recipient}</span>
                        <span className="text-[12px] text-faint">
                          Draft, not a transaction. {x.status === "reviewed" ? "Reviewed" : x.status === "authorized" ? "Confirmed, not signed" : "Not reviewed"}{" "}
                          {relativeTime(x.updatedAt)}
                        </span>
                      </span>
                      <Musd value={x.amount} maxFraction={2} className="text-[14px]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="space-y-8">
          <section aria-labelledby="warn-h">
            <SectionTitle id="warn-h" aside={<Link className="link text-[13px]" href="/security">Security Centre</Link>}>
              Recent risk warnings
            </SectionTitle>
            {d && d.warnings.length ? (
              <ul className="space-y-2">
                {d.warnings.map((w, i) => (
                  <li key={i}>
                    <Link href={`/review/${w.draftId}`} className="card flex gap-3 p-3.5 hover:border-line-strong">
                      <CheckIcon status={w.status} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">
                          {w.title} <span className={cn("ml-1 text-[11px]", w.status === "fail" ? "text-fail" : "text-warn")}>{w.status === "fail" ? "Failed" : "Warning"}, {w.severity}</span>
                        </span>
                        <span className="line-clamp-2 text-[12px] text-muted">{w.explanation}</span>
                        <span className="text-[11px] text-faint">{relativeTime(w.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card p-4 text-[13px] text-muted">{q.isLoading ? "Loading…" : "No medium or higher warnings in your recent reviews."}</p>
            )}
          </section>
          <section aria-labelledby="rec-h">
            <SectionTitle id="rec-h" aside={<Link className="link text-[13px]" href="/recipients">Manage</Link>}>
              Saved recipients
            </SectionTitle>
            {d && d.recipients.length ? (
              <ul className="card divide-y divide-line p-1">
                {d.recipients.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <ShortAddress address={r.address} label={r.label} />
                    <ButtonLink href={`/send?recipient=${r.id}`} size="sm" variant="ghost">
                      Pay
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<Users className="size-4" />} title="No saved recipients" body="Save addresses you have confirmed so PayGuard can catch changed or lookalike addresses." action={<ButtonLink href="/recipients?new=1" icon={<Plus className="size-4" />}>Save a recipient</ButtonLink>} />
            )}
          </section>
          {d && d.recent[0] ? (
            <p className="text-[12px] text-faint">
              Latest payment risk at review: <RiskBadge category={d.recent[0].riskCategory} size="sm" />
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
