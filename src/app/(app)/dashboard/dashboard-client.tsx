"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, Coins, ExternalLink, Fuel, Plus, ReceiptText, Send, TriangleAlert, UserPlus, Users } from "lucide-react";
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
      <Link href={`/tx/${tx.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[1.4fr_1fr_auto]">
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
  const noFeeBtc = native.data !== undefined && native.data.value === 0n;
  const setup = d
    ? [
        {
          done: native.data !== undefined && native.data.value > 0n,
          title: "Get testnet BTC for fees",
          body: "Fees on Mezo are paid in BTC. The faucet is free; test MUSD comes from borrowing in the Mezo app or a teammate.",
          action: (
            <a className="link inline-flex items-center gap-1 text-[13px]" href={SUPPORTED_NETWORK.faucetUrl} target="_blank" rel="noopener noreferrer">
              Open the Mezo faucet <ExternalLink className="size-3" aria-hidden />
            </a>
          ),
        },
        {
          done: d.recipientCount > 0,
          title: "Save a recipient you trust",
          body: "Saved contacts let PayGuard catch a changed or lookalike address before you pay it.",
          action: (
            <Link className="link text-[13px]" href="/recipients?new=1">
              Save a recipient
            </Link>
          ),
        },
        {
          done: d.recent.length > 0 || d.pending.length > 0,
          title: "Send a first small payment",
          body: "Watch every check run, then see the receipt verified on-chain.",
          action: (
            <Link className="link text-[13px]" href="/send">
              Start a payment
            </Link>
          ),
        },
      ]
    : null;
  const setupDone = setup?.filter((s) => s.done).length ?? 0;
  const showSetup = !!setup && setupDone < setup.length;

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" lede="Your MUSD, your pending payments and everything PayGuard flagged recently." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="hull relative overflow-hidden p-5 md:p-6 lg:col-span-2" aria-labelledby="balance-h">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="relative">
            <h2 id="balance-h" className="text-[13px] text-muted">
              MUSD balance, live from {SUPPORTED_NETWORK.name}
            </h2>
            <div className="display mt-2 text-[40px] md:text-[48px]">
              {musd.data !== undefined ? (
                <Musd value={musd.data} maxFraction={4} />
              ) : musd.isError ? (
                <span className="text-[18px] text-fail">Balance unavailable: the RPC did not answer</span>
              ) : (
                <Skeleton className="h-12 w-60" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
              <span className={cn("inline-flex items-center gap-1.5", noFeeBtc && "text-warn")}>
                <Fuel className="size-3.5" aria-hidden />
                BTC for fees{" "}
                <span className={cn("tnum", noFeeBtc ? "font-medium" : "text-text")}>
                  {native.data ? formatAmount(native.data.value, { maxFraction: 8, minFraction: 0 }) : "…"}
                </span>
                {noFeeBtc ? (
                  <a className="link ml-1" href={SUPPORTED_NETWORK.faucetUrl} target="_blank" rel="noopener noreferrer">
                    Get some
                  </a>
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="mr-1.5">Signed in as</span>
                <FullAddress address={session.address ?? ""} className="align-middle" />
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
              <ButtonLink href="/send" variant="primary" size="sm" icon={<Send className="size-3.5" aria-hidden />}>
                Send
              </ButtonLink>
              <ButtonLink href="/requests?new=1" size="sm" icon={<ReceiptText className="size-3.5" aria-hidden />}>
                Request
              </ButtonLink>
              <ButtonLink href="/verify" size="sm" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
                Verify a payment
              </ButtonLink>
              <ButtonLink href="/recipients?new=1" size="sm" icon={<UserPlus className="size-3.5" aria-hidden />}>
                Save recipient
              </ButtonLink>
              <button
                type="button"
                onClick={addMusd}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Coins className="size-3.5" aria-hidden /> Add MUSD to wallet
              </button>
              {isConnected && !isSupportedChain(chainId) ? (
                <button
                  type="button"
                  onClick={switchToMezo}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-warn/50 px-3 text-[13px] text-warn"
                >
                  <TriangleAlert className="size-3.5" aria-hidden /> On {chainName(chainId)}: switch
                </button>
              ) : null}
            </div>
          </div>
        </section>
        <section className="card grid grid-rows-[1fr_auto] p-5 md:p-6" aria-labelledby="verified-h">
          <div>
            <h2 id="verified-h" className="text-[13px] text-muted">
              Verified payments
            </h2>
            <p className="display tnum mt-2 text-[40px]">{d ? (confirmed?.n ?? 0) : "…"}</p>
            <p className="text-[13px] text-muted">{confirmed ? <>totalling <Musd value={confirmed.total} maxFraction={2} /></> : "Confirmed on-chain by PayGuard"}</p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px]">
            <div>
              <dt className="text-faint">Awaiting verification</dt>
              <dd className="tnum mt-0.5 text-[18px] font-semibold">{d ? d.pending.length : "…"}</dd>
            </div>
            <div>
              <dt className="text-faint">Failed</dt>
              <dd className={cn("tnum mt-0.5 text-[18px] font-semibold", (d?.counts.failed?.n ?? 0) > 0 && "text-fail")}>{d ? (d.counts.failed?.n ?? 0) : "…"}</dd>
            </div>
          </dl>
        </section>
      </div>

      {showSetup && setup ? (
        <section className="hull p-5 md:p-6" aria-labelledby="onboard-h">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="onboard-h" className="heading text-lg">
              Get set up
            </h2>
            <p className="text-[13px] text-muted">
              {setupDone} of {setup.length} done
            </p>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-pass transition-[width] duration-500" style={{ width: `${(setupDone / setup.length) * 100}%` }} />
          </div>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {setup.map((s, i) => (
              <li key={s.title} className={cn("card p-4", s.done && "border-pass/30")}>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full border text-[11px] font-semibold",
                      s.done ? "border-pass/60 bg-pass/15 text-pass" : "border-cyan/60 text-cyan",
                    )}
                  >
                    {s.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  <p className={cn("font-medium", s.done && "text-muted line-through decoration-line-strong")}>{s.title}</p>
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </div>
                <p className="mt-2 text-[13px] text-muted">{s.body}</p>
                {!s.done ? <div className="mt-3">{s.action}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
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
                    <Link href={`/review/${x.id}`} className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-surface-2">
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
                    <Link href={`/review/${w.draftId}`} className="card card-link flex gap-3 p-3.5">
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
