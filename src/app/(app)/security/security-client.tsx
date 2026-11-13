"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { LIMITATIONS } from "@/lib/limitations";
import { CATALOGUE, CHECK_GROUP_LABELS, RISK_RULES } from "@/lib/engine/catalogue";
import type { CheckGroup } from "@/lib/engine/types";
import type { TxStatus } from "@/lib/engine/status";
import { STATUS_LABEL } from "@/lib/engine/status";
import { relativeTime } from "@/lib/format";
import { Musd } from "@/components/ui/data";
import { Empty, PageHeader, SectionTitle, Skeleton } from "@/components/ui/primitives";
import { CheckIcon, TxStatusPill } from "@/components/ui/status";

interface SecurityData {
  warnings: { checkId: string; severity: string; title: string; explanation: string; createdAt: string; draftId: string }[];
  blocked: { assessmentId: string; draftId: string; summary: string; purpose: string; recipient: string; amount: string; createdAt: string; failures: { id: string; title: string; explanation: string }[] }[];
  checkStats: { checkId: string; status: string; n: number }[];
  verification: Partial<Record<TxStatus, number>>;
  activity: { event: string; entityType: string | null; entityId: string | null; createdAt: string }[];
}



const ACTIVITY_TEXT: Record<string, string> = {
  "auth.sign_in": "Signed in with wallet",
  "draft.created": "Payment draft created",
  "draft.edited": "Draft edited (review invalidated)",
  "draft.abandoned": "Draft discarded",
  "preflight.run": "Security review run",
  "authorize.granted": "Confirmed on review screen",
  "authorize.blocked": "Blocked at final re-check",
  "transaction.submitted": "Transaction hash recorded",
  "transaction.status_changed": "Verification status changed",
  "recipient.created": "Recipient saved",
  "recipient.updated": "Recipient edited",
  "recipient.deleted": "Recipient removed",
  "request.created": "Payment request created",
  "request.cancelled": "Payment request cancelled",
  "settings.updated": "Settings changed",
};

export function CheckCatalogue() {
  const groups = [...new Set(CATALOGUE.map((c) => c.group))] as CheckGroup[];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{CHECK_GROUP_LABELS[g]}</h3>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-line text-[12px] text-faint">
                <tr>
                  <th scope="col" className="w-[72px] px-4 py-2.5 font-medium">Rule</th>
                  <th scope="col" className="w-[190px] px-4 py-2.5 font-medium">Check</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">What it checks and how it decides</th>
                  <th scope="col" className="w-[160px] px-4 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {CATALOGUE.filter((c) => c.group === g).map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="mono px-4 py-3 text-[12px] text-cyan">{c.rule}</td>
                    <td className="px-4 py-3 font-medium">
                      {c.title}
                      {c.essential ? <span className="mt-1 block text-[11px] font-normal text-warn">Essential: fails safe</span> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <p className="text-text">{c.checks}</p>
                      <p className="mt-1">{c.outcomes}</p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-faint">{c.sources}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiskRules() {
  return (
    <ul className="card divide-y divide-line">
      {RISK_RULES.map((r) => (
        <li key={r.id} className="flex gap-4 px-4 py-3 text-[13px]">
          <span className="mono w-16 shrink-0 text-cyan">{r.id}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function SecurityClient() {
  const q = useQuery({ queryKey: ["security"], queryFn: () => api<SecurityData>("/api/security") });
  const d = q.data;
  const totals = (["pass", "warn", "fail", "unavailable"] as const).map((s) => [s, d?.checkStats.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0) ?? 0] as const);
  return (
    <div className="space-y-10">
      <PageHeader
        title="Security Centre"
        lede="What PayGuard checks, what it found for your wallet, and what it cannot do. Every rule below is the exact rule the engine applies."
      />
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="hull p-5" aria-labelledby="ver-h">
          <h2 id="ver-h" className="text-[13px] font-semibold text-muted">
            Verification status of your payments
          </h2>
          {q.isLoading ? (
            <Skeleton className="mt-3 h-16" />
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {(["confirmed", "pending", "verification_delayed", "unknown", "failed"] as TxStatus[]).map((s) => (
                <li key={s} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
                  <TxStatusPill status={s} size="sm" />
                  <span className="tnum text-[15px] font-semibold">{d?.verification[s] ?? 0}</span>
                  <span className="sr-only">{STATUS_LABEL[s]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5" aria-labelledby="out-h">
          <h2 id="out-h" className="text-[13px] font-semibold text-muted">
            Non-passing check results, last 90 days
          </h2>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {totals
              .filter(([s]) => s !== "pass")
              .map(([s, n]) => (
                <li key={s} className="rounded-[10px] border border-line px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    <CheckIcon status={s} className="size-3.5" />
                    {s === "warn" ? "Warnings" : s === "fail" ? "Failures" : "Not performed"}
                  </span>
                  <span className="tnum mt-1 block text-[20px] font-semibold">{n}</span>
                </li>
              ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="w-h">
          <SectionTitle id="w-h">Recent warnings</SectionTitle>
          {d?.warnings.length ? (
            <ul className="space-y-2">
              {d.warnings.slice(0, 12).map((w, i) => (
                <li key={i} className="card flex gap-3 p-3.5">
                  <CheckIcon status="warn" className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {w.title} <span className="text-[11px] text-warn">{w.severity}</span>
                    </p>
                    <p className="line-clamp-2 text-[12px] text-muted">{w.explanation}</p>
                    <p className="text-[11px] text-faint">
                      {relativeTime(w.createdAt)},{" "}
                      <Link className="link" href={`/review/${w.draftId}`}>
                        open review
                      </Link>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<ShieldCheck className="size-4" />} title="No warnings yet" body="Warnings from your security reviews are listed here." />
          )}
        </section>
        <section aria-labelledby="f-h">
          <SectionTitle id="f-h">Failed validations (sending blocked)</SectionTitle>
          {d?.blocked.length ? (
            <ul className="space-y-2">
              {d.blocked.slice(0, 12).map((b) => (
                <li key={b.assessmentId} className="card p-3.5">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="mono truncate">{b.recipient.slice(0, 26)}</span>
                    <Musd value={b.amount} maxFraction={2} />
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {b.failures.map((f) => (
                      <li key={f.id} className="flex gap-2 text-[12px] text-muted">
                        <CheckIcon status="fail" className="size-3.5" />
                        <span>
                          <span className="text-text">{f.title}:</span> {f.explanation}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-faint">
                    {relativeTime(b.createdAt)} {b.purpose === "authorize" ? "(at final re-check)" : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<ShieldCheck className="size-4" />} title="No blocked payments" body="When a check fails, the payment and the reason are recorded here." />
          )}
        </section>
      </div>

      <section aria-labelledby="cat-h">
        <SectionTitle id="cat-h">Configured safety checks</SectionTitle>
        <p className="-mt-1 mb-4 max-w-3xl text-sm text-muted">
          Each check returns passed, warning, failed or not performed, with its evidence. Failed checks are confirmed technical problems; warnings are
          patterns worth reviewing, not proof of fraud; not performed means the check could not run and proves nothing.
        </p>
        <CheckCatalogue />
      </section>

      <section aria-labelledby="rules-h">
        <SectionTitle id="rules-h">How the risk category is decided</SectionTitle>
        <RiskRules />
      </section>

      <section aria-labelledby="lim-h">
        <SectionTitle id="lim-h">What PayGuard cannot do</SectionTitle>
        <ul className="card list-disc space-y-2 py-4 pl-9 pr-5 text-sm text-muted">
          {LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="act-h">
        <SectionTitle id="act-h">Activity log</SectionTitle>
        {d?.activity.length ? (
          <ol className="card divide-y divide-line">
            {d.activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span>{ACTIVITY_TEXT[a.event] ?? a.event}</span>
                <span className="text-[12px] text-faint">{relativeTime(a.createdAt)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="card p-4 text-sm text-muted">{q.isLoading ? "Loading…" : "No activity yet."}</p>
        )}
      </section>
    </div>
  );
}
