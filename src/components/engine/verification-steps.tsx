"use client";

import { CircleCheck, CircleDashed, Clock, OctagonX } from "lucide-react";
import type { VerificationStep } from "@/lib/verify/receipt";
import { cn } from "../ui/primitives";

const STEP_ICON = { pass: CircleCheck, fail: OctagonX, pending: Clock, skipped: CircleDashed } as const;
const STEP_CLS = { pass: "text-pass", fail: "text-fail", pending: "text-cyan", skipped: "text-na" } as const;
const STEP_LABEL = { pass: "Verified", fail: "Failed", pending: "Waiting", skipped: "Not required" } as const;

export function VerificationSteps({ steps }: { steps: VerificationStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const Icon = STEP_ICON[s.state];
        return (
          <li key={s.id} className="flex gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
            <Icon className={cn("mt-0.5 size-4 shrink-0", STEP_CLS[s.state])} aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                {s.label} <span className={cn("ml-1 text-[12px] font-normal", STEP_CLS[s.state])}>{STEP_LABEL[s.state]}</span>
              </p>
              <p className="break-words text-[12px] text-muted">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

