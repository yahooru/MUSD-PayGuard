import { BadgeCheck, CircleAlert, CircleCheck, CircleDashed, CircleQuestionMark, Clock, OctagonX, ShieldCheck, TriangleAlert } from "lucide-react";
import type { CheckStatus, RiskCategory, Severity } from "@/lib/engine/types";
import type { TxStatus } from "@/lib/engine/status";
import { STATUS_LABEL } from "@/lib/engine/status";
import { cn } from "@/lib/cn";

/*
  Status is never communicated by colour alone: every state has its own icon SHAPE
  (circle-check, triangle, octagon, dashed circle) and a visible text label.
*/

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "Passed",
  warn: "Warning",
  fail: "Failed",
  unavailable: "Not performed",
};

const CHECK_STYLE: Record<CheckStatus, { icon: typeof CircleCheck; cls: string }> = {
  pass: { icon: CircleCheck, cls: "text-pass" },
  warn: { icon: TriangleAlert, cls: "text-warn" },
  fail: { icon: OctagonX, cls: "text-fail" },
  unavailable: { icon: CircleDashed, cls: "text-na" },
};

export function CheckIcon({ status, className }: { status: CheckStatus; className?: string }) {
  const { icon: Icon, cls } = CHECK_STYLE[status];
  return <Icon className={cn("size-[18px] shrink-0", cls, className)} aria-hidden strokeWidth={2.1} />;
}

export function CheckStatusTag({ status, severity }: { status: CheckStatus; severity?: Severity }) {
  const { cls } = CHECK_STYLE[status];
  const sev = severity && status !== "pass" && severity !== "info" ? ` · ${severity}` : "";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium", cls, "border-current/30 bg-current/[0.06]")}>
      <CheckIcon status={status} className="size-3.5" />
      <span>
        {CHECK_STATUS_LABEL[status]}
        {sev}
      </span>
    </span>
  );
}

const RISK: Record<RiskCategory, { label: string; icon: typeof ShieldCheck; cls: string }> = {
  low: { label: "Low observed risk", icon: ShieldCheck, cls: "text-pass" },
  caution: { label: "Caution", icon: TriangleAlert, cls: "text-warn" },
  high: { label: "High risk", icon: OctagonX, cls: "text-fail" },
};

export function RiskBadge({ category, size = "md" }: { category: RiskCategory | null | undefined; size?: "sm" | "md" }) {
  if (!category) return <span className="text-[12px] text-faint">Not assessed</span>;
  const r = RISK[category];
  const Icon = r.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-current/35 bg-current/[0.07] font-medium",
        r.cls,
        size === "sm" ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]",
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      {r.label}
    </span>
  );
}

const TX: Record<TxStatus, { icon: typeof Clock; cls: string }> = {
  pending: { icon: Clock, cls: "text-cyan" },
  confirmed: { icon: BadgeCheck, cls: "text-pass" },
  failed: { icon: OctagonX, cls: "text-fail" },
  verification_delayed: { icon: CircleAlert, cls: "text-warn" },
  unknown: { icon: CircleQuestionMark, cls: "text-na" },
};

export function TxStatusPill({ status, size = "md" }: { status: TxStatus; size?: "sm" | "md" }) {
  const t = TX[status];
  const Icon = t.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-current/35 bg-current/[0.07] font-medium",
        t.cls,
        size === "sm" ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]",
      )}
    >
      <Icon className={cn(size === "sm" ? "size-3.5" : "size-4", status === "pending" && "animate-pulse")} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Large status orb used on the transaction page. Text label is always rendered next to it. */
export function StatusOrb({ status }: { status: TxStatus }) {
  const t = TX[status];
  const Icon = t.icon;
  return (
    <span className={cn("relative grid size-14 place-items-center rounded-full border border-current/40 bg-current/10", t.cls, status === "pending" && "pulse-ring")}>
      <span className="absolute inset-1.5 rounded-full border border-current/20" aria-hidden />
      <Icon className="size-6" aria-hidden />
    </span>
  );
}
