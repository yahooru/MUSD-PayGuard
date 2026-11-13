"use client";

import { ChevronDown, ExternalLink, MessageSquareWarning, OctagonX, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CHECK_GROUP_LABELS } from "@/lib/engine/catalogue";
import type { Explanation } from "@/lib/engine/explain";
import type { Assessment, CheckGroup, CheckResult, CheckStatus } from "@/lib/engine/types";
import { CATEGORY_MEANING } from "@/lib/engine/risk";
import { FullAddress } from "../ui/data";
import { cn } from "../ui/primitives";
import { CheckIcon, CheckStatusTag, CHECK_STATUS_LABEL, RiskBadge } from "../ui/status";

const GROUP_ORDER: CheckGroup[] = ["recipient", "network", "token", "funds", "simulation", "duplicates", "request", "integrity"];
const RANK: Record<CheckStatus, number> = { fail: 3, warn: 2, unavailable: 1, pass: 0 };

/** A check that deserves the reader's attention: anything but a pass or a harmless "not needed". */
export function needsAttention(c: CheckResult): boolean {
  return c.status === "fail" || c.status === "warn" || (c.status === "unavailable" && (c.essential || c.severity !== "info"));
}

export function worstStatus(checks: CheckResult[]): CheckStatus {
  return checks.reduce<CheckStatus>((w, c) => {
    // A non-essential, info-level "not performed" should not paint the whole gate grey.
    const s = c.status === "unavailable" && !c.essential && c.severity === "info" ? "pass" : c.status;
    return RANK[s] > RANK[w] ? s : w;
  }, "pass");
}

/** The preflight made visible: one gate per check group, in the order a payment passes them. */
export function GateRail({ checks, className }: { checks: CheckResult[]; className?: string }) {
  const groups = GROUP_ORDER.filter((g) => checks.some((c) => c.group === g));
  return (
    <ol className={cn("grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2", className)} aria-label="Preflight gates">
      {groups.map((g) => {
        const inGroup = checks.filter((c) => c.group === g);
        const s = worstStatus(inGroup);
        const tone = s === "pass" ? "border-pass/40" : s === "warn" ? "border-warn/50" : s === "fail" ? "border-fail/60" : "border-na/40 border-dashed";
        return (
          <li key={g} className="min-w-0">
            <a
              href={`#group-${g}`}
              className={cn("flex h-full items-center gap-2 rounded-[10px] border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2", tone)}
            >
              <CheckIcon status={s} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{CHECK_GROUP_LABELS[g]}</span>
                <span className="block text-[11px] text-faint">{CHECK_STATUS_LABEL[s]}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function Evidence({ c }: { c: CheckResult }) {
  if (c.evidence.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-2">
      {c.evidence.map((e, i) => (
        <div key={i} className="grid gap-0.5 sm:grid-cols-[200px_1fr] sm:gap-3">
          <dt className="text-[12px] text-faint">{e.label}</dt>
          <dd className="min-w-0 text-[13px]">
            {e.kind === "address" && /^0x[0-9a-fA-F]{40}$/.test(e.value) ? (
              <FullAddress address={e.value} />
            ) : e.kind === "hash" ? (
              e.href ? (
                <a className="mono link break-all text-[12px]" href={e.href} target="_blank" rel="noopener noreferrer">
                  {e.value}
                </a>
              ) : (
                <span className="mono break-all text-[12px]">{e.value}</span>
              )
            ) : e.href ? (
              <a className="link inline-flex items-center gap-1" href={e.href} target="_blank" rel="noopener noreferrer">
                {e.value} <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : (
              <span className={cn(e.kind === "amount" || e.kind === "number" ? "tnum" : "", "break-words")}>{e.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function relatedHref(r: NonNullable<CheckResult["related"]>[number]): string {
  if (r.kind === "transaction") return `/tx/${r.id}`;
  if (r.kind === "request") return `/pay/${r.id}`;
  return `/recipients#${r.id}`;
}

function CheckRow({
  c,
  ack,
  onAck,
  ackDisabled,
}: {
  c: CheckResult;
  ack?: boolean;
  onAck?: (id: string, v: boolean) => void;
  ackDisabled?: boolean;
}) {
  const [open, setOpen] = useState(needsAttention(c));
  return (
    <li
      className={cn(
        "rounded-[12px] border bg-surface",
        c.status === "fail" ? "border-fail/45" : c.status === "warn" && c.requiresAcknowledgement ? "border-warn/55" : "border-line",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <CheckIcon status={c.status} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-medium">{c.title}</span>
            <CheckStatusTag status={c.status} severity={c.severity} />
            {c.blocking ? <span className="rounded-full bg-fail/15 px-2 py-0.5 text-[11px] font-semibold text-fail">Blocks sending</span> : null}
            {c.requiresAcknowledgement ? (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">Needs your acknowledgement</span>
            ) : null}
          </span>
          <span className={cn("mt-1 block text-[13px] text-muted", !open && "line-clamp-1")}>{c.explanation}</span>
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="border-t border-line px-4 pb-4 pt-3 sm:pl-11">
          <p className="text-[13px]">
            <span className="font-medium text-text">What to do: </span>
            <span className="text-muted">{c.recommendation}</span>
          </p>
          <Evidence c={c} />
          {c.related?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.related.map((r) => (
                <Link key={`${r.kind}-${r.id}`} href={relatedHref(r)} className="link text-[13px]">
                  {r.label}
                </Link>
              ))}
            </div>
          ) : null}
          <p className="mt-3 text-[11px] text-faint">
            Rule {c.rule} ({c.id}).{" "}
            {c.findingClass === "technical_failure"
              ? "Confirmed technical failure."
              : c.findingClass === "suspicious_pattern"
                ? "Suspicious pattern: evidence to review, not proof of fraud."
                : c.findingClass === "not_performed"
                  ? "This check could not be performed, so it proves nothing either way."
                  : "No problem found by this rule."}
          </p>
          {c.requiresAcknowledgement && onAck ? (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-[10px] border border-warn/40 bg-warn/5 p-3 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--warn)]"
                checked={!!ack}
                disabled={ackDisabled}
                onChange={(e) => onAck(c.id, e.target.checked)}
              />
              <span>
                I have read this warning, checked the evidence above, and still want to send this payment.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function CheckList({
  checks,
  acks,
  onAck,
  ackDisabled,
}: {
  checks: CheckResult[];
  acks?: Record<string, boolean>;
  onAck?: (id: string, v: boolean) => void;
  ackDisabled?: boolean;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  const groups = GROUP_ORDER.filter((g) => checks.some((c) => c.group === g));
  const attention = checks.filter(needsAttention).length;
  const quietTotal = checks.length - attention;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-surface/60 px-4 py-3 text-[13px]">
        <p className="text-muted">
          {attention ? (
            <>
              <span className="font-semibold text-text">{attention}</span> {attention === 1 ? "check needs" : "checks need"} your attention.{" "}
              {quietTotal} found no problem.
            </>
          ) : (
            <>All {checks.length} checks found no problem. That is low observed risk, not a guarantee.</>
          )}
        </p>
        {quietTotal ? (
          <button type="button" className="link" aria-pressed={showQuiet} onClick={() => setShowQuiet((v) => !v)}>
            {showQuiet ? "Hide checks without problems" : "Show every check"}
          </button>
        ) : null}
      </div>
      {groups.map((g) => {
        const items = checks
          .filter((c) => c.group === g)
          .sort((a, b) => RANK[b.status] - RANK[a.status]);
        const loud = items.filter(needsAttention);
        const quiet = items.filter((c) => !needsAttention(c));
        const shown = showQuiet ? items : loud;
        return (
          <section key={g} id={`group-${g}`} aria-labelledby={`h-${g}`} className="scroll-mt-24">
            <h3 id={`h-${g}`} className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
              {CHECK_GROUP_LABELS[g]}
              <span className="tnum font-normal text-faint">({items.length})</span>
            </h3>
            {shown.length ? (
              <ul className="space-y-2">
                {shown.map((c) => (
                  <CheckRow key={c.id} c={c} ack={acks?.[c.id]} onAck={onAck} ackDisabled={ackDisabled} />
                ))}
              </ul>
            ) : null}
            {!showQuiet && quiet.length ? (
              <button
                type="button"
                onClick={() => setShowQuiet(true)}
                className={cn(
                  "card-link flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[12px] border border-line bg-surface/50 px-4 py-2.5 text-left text-[13px]",
                  shown.length > 0 && "mt-2",
                )}
                aria-label={`Show ${quiet.length} ${CHECK_GROUP_LABELS[g]} checks without problems`}
              >
                {quiet.map((c) => (
                  <span key={c.id} className="inline-flex items-center gap-1.5 text-muted">
                    <CheckIcon status={c.status} className="size-3.5" />
                    {c.title}
                  </span>
                ))}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function Verdict({ a, compact = false }: { a: Assessment; compact?: boolean }) {
  const decisionText =
    a.decision === "blocked"
      ? "Sending is blocked until the failed or unverifiable checks are resolved."
      : a.decision === "acknowledge"
        ? "You can continue only after acknowledging each serious warning."
        : "You can continue to the final confirmation.";
  const Icon = a.decision === "blocked" ? OctagonX : a.decision === "acknowledge" ? TriangleAlert : ShieldCheck;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[16px] border p-5",
        a.category === "high" ? "border-fail/45 bg-fail/[0.05]" : a.category === "caution" ? "border-warn/45 bg-warn/[0.05]" : "border-pass/40 bg-pass/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <RiskBadge category={a.category} />
        <span className="tnum text-[12px] text-faint">
          {a.counts.pass} passed, {a.counts.warn} warnings, {a.counts.fail} failed, {a.counts.unavailable} not performed
        </span>
      </div>
      <p className="heading mt-3 flex items-start gap-2 text-[18px]">
        <Icon
          className={cn("mt-0.5 size-5 shrink-0", a.decision === "blocked" ? "text-fail" : a.decision === "acknowledge" ? "text-warn" : "text-pass")}
          aria-hidden
        />
        {decisionText}
      </p>
      {!compact ? <p className="mt-2 text-sm text-muted">{CATEGORY_MEANING[a.category]}</p> : null}
      {!compact ? (
        <p className="mt-2 text-[12px] text-faint">
          Decided by {a.decisionRules.join(", ")} (see the rule table in the Security Centre). Engine {a.engineVersion}.
        </p>
      ) : null}
    </div>
  );
}

export function AssistantPanel({ e }: { e: Explanation }) {
  return (
    <section className="card p-5" aria-labelledby="assistant-h">
      <h3 id="assistant-h" className="flex items-center gap-2 text-[14px] font-semibold">
        <MessageSquareWarning className="size-4 text-violet" aria-hidden />
        In plain language
      </h3>
      <p className="mt-2 text-[15px] font-medium">{e.headline}</p>
      {e.points.length ? (
        <ul className="mt-3 space-y-2">
          {e.points.map((p) => (
            <li key={p.checkId} className="flex gap-2 text-[13px] text-muted">
              <span
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", p.tone === "stop" ? "bg-fail" : p.tone === "review" ? "bg-warn" : "bg-na")}
                aria-hidden
              />
              <span>
                <span className="sr-only">{p.tone === "stop" ? "Stop: " : p.tone === "review" ? "Review: " : "Note: "}</span>
                {p.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-[13px] font-medium">Next steps</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-muted">
        {e.nextSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">{e.limits}</p>
    </section>
  );
}
