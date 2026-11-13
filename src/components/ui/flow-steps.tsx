import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Where the user is in a payment: the same four steps on the send, review and
 * transaction pages, so it is always clear what has happened and what comes next.
 * Signing is its own step because it is the one moment that cannot be undone.
 */
export const FLOW_STEPS = [
  { id: "details", label: "Details", hint: "Recipient, amount, reference" },
  { id: "review", label: "Review", hint: "Every check, with evidence" },
  { id: "sign", label: "Sign", hint: "Your wallet, after a final re-check" },
  { id: "verify", label: "Verify", hint: "Receipt read from the chain" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export function FlowSteps({
  current,
  outcome,
  className,
}: {
  current: FlowStepId;
  /** Set on the last step once the chain has answered. */
  outcome?: "done" | "failed";
  className?: string;
}) {
  const at = FLOW_STEPS.findIndex((s) => s.id === current);
  const step = FLOW_STEPS[at]!;
  return (
    <nav aria-label="Payment progress" className={cn("mb-6", className)}>
      {/* Compact form for phones: one line of text and a segmented bar. */}
      <div className="sm:hidden">
        <p className="text-[13px] text-muted">
          Step {at + 1} of {FLOW_STEPS.length}: <span className="font-medium text-text">{step.label}</span>
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden>
          {FLOW_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "h-1 rounded-full",
                i < at || (i === at && outcome === "done") ? "bg-pass" : i === at ? (outcome === "failed" ? "bg-fail" : "bg-cyan") : "bg-line-strong",
              )}
            />
          ))}
        </div>
      </div>

      <ol className="hidden items-start sm:flex">
        {FLOW_STEPS.map((s, i) => {
          const done = i < at || (i === at && outcome === "done");
          const failed = i === at && outcome === "failed";
          const isCurrent = i === at && !outcome;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-start" aria-current={i === at ? "step" : undefined}>
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    done && "border-pass/60 bg-pass/15 text-pass",
                    failed && "border-fail/60 bg-fail/15 text-fail",
                    isCurrent && "border-cyan bg-cyan/15 text-cyan shadow-[0_0_0_4px_rgb(69_217_236/0.1)]",
                    i > at && "border-line-strong text-faint",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : failed ? <X className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[13px] font-medium", i > at ? "text-faint" : "text-text")}>
                    {s.label}
                    <span className="sr-only">{done ? " (done)" : failed ? " (failed)" : isCurrent ? " (current step)" : ""}</span>
                  </span>
                  <span className="hidden truncate text-[12px] text-faint md:block">{s.hint}</span>
                </span>
              </div>
              {i < FLOW_STEPS.length - 1 ? (
                <span className={cn("mx-3 mt-3.5 h-px min-w-6 flex-1", i < at ? "bg-pass/50" : "bg-line-strong")} aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
