"use client";

import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, CircleQuestionMark, Clock, ExternalLink, OctagonX, ScanLine } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { VerificationStep } from "@/lib/verify/receipt";
import { VerificationSteps } from "@/components/engine/verification-steps";
import { CopyButton } from "@/components/ui/data";
import { Button, Field, Input, cn } from "@/components/ui/primitives";

interface VerifyResult {
  verdict: "verified" | "mismatch" | "reverted" | "pending" | "not_found" | "unavailable";
  verified: boolean;
  summary: string;
  reason: string;
  transaction: { hash: string; from: string | null; to: string | null; calledContract: string | null; blockNumber: string | null; confirmations: number; explorerUrl: string };
  expected: { recipient: string; amount: string; from: string | null; invoiceRef: string | null };
  invoice: { ref: string; recordedOnChain: boolean; note: string } | null;
  steps: VerificationStep[];
  checkedAt: string;
  disclaimer: string;
}

const VERDICT = {
  verified: { label: "Payment verified", icon: BadgeCheck, cls: "text-pass border-pass/45 bg-pass/[0.05]" },
  mismatch: { label: "Does not match", icon: OctagonX, cls: "text-fail border-fail/45 bg-fail/[0.05]" },
  reverted: { label: "Transaction failed", icon: OctagonX, cls: "text-fail border-fail/45 bg-fail/[0.05]" },
  pending: { label: "Not confirmed yet", icon: Clock, cls: "text-cyan border-cyan/45 bg-cyan/[0.05]" },
  not_found: { label: "Transaction not found", icon: CircleQuestionMark, cls: "text-warn border-warn/45 bg-warn/[0.05]" },
  unavailable: { label: "Could not check", icon: CircleQuestionMark, cls: "text-na border-na/45 bg-na/[0.05]" },
} as const;

export function VerifyClient() {
  const p = useSearchParams();
  const [tx, setTx] = useState(p.get("tx") ?? "");
  const [to, setTo] = useState(p.get("to") ?? "");
  const [amount, setAmount] = useState(p.get("amount") ?? "");
  const [from, setFrom] = useState(p.get("from") ?? "");
  const [ref, setRef] = useState(p.get("ref") ?? "");
  const m = useMutation({
    mutationFn: () => {
      const qs = new URLSearchParams({ txHash: tx.trim(), recipient: to.trim(), amount: amount.trim() });
      if (from.trim()) qs.set("from", from.trim());
      if (ref.trim()) qs.set("invoiceRef", ref.trim());
      return api<VerifyResult>(`/api/v1/verify?${qs.toString()}`);
    },
  });
  const auto = useRef(false);
  useEffect(() => {
    if (!auto.current && p.get("tx") && p.get("to") && p.get("amount")) {
      auto.current = true;
      m.mutate();
    }
  }, [p, m]);
  const r = m.data;
  const v = r ? VERDICT[r.verdict] : null;
  const share =
    typeof window !== "undefined" && r
      ? `${window.location.origin}/verify?${new URLSearchParams({ tx: tx.trim(), to: to.trim(), amount: amount.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) }).toString()}`
      : "";

  return (
    <div className="mt-8 space-y-6">
      <form
        className="hull grid gap-4 p-5 md:grid-cols-2 md:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="md:col-span-2">
          <Field label="Transaction hash" htmlFor="v-tx">
            <Input id="v-tx" value={tx} onChange={(e) => setTx(e.target.value)} placeholder="0x… (66 characters)" className="mono text-[14px]" required spellCheck={false} />
          </Field>
        </div>
        <Field label="Expected recipient" htmlFor="v-to" hint="Your wallet, if you are the one being paid.">
          <Input id="v-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="mono text-[14px]" required spellCheck={false} />
        </Field>
        <Field label="Expected amount (MUSD)" htmlFor="v-amt">
          <Input id="v-amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250" inputMode="decimal" className="tnum" required />
        </Field>
        <Field label="Expected sender (optional)" htmlFor="v-from">
          <Input id="v-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0x…" className="mono text-[14px]" spellCheck={false} />
        </Field>
        <Field label="Invoice reference (optional)" htmlFor="v-ref" hint="Provable on-chain only for PayGuardRouter payments.">
          <Input id="v-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="INV-2026-0042" />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" variant="primary" size="lg" loading={m.isPending} icon={<ScanLine className="size-4" aria-hidden />}>
            Verify on-chain
          </Button>
        </div>
      </form>

      {m.isError ? (
        <p role="alert" className="rounded-[12px] border border-fail/40 bg-fail/5 p-4 text-sm text-fail">
          {m.error instanceof ApiError ? m.error.message : "Verification failed."}
        </p>
      ) : null}

      {r && v ? (
        <section className={cn("rounded-[18px] border p-6", v.cls)} aria-live="polite" aria-labelledby="vr-h">
          <div className="flex flex-wrap items-center gap-3">
            <v.icon className="size-7" aria-hidden />
            <h2 id="vr-h" className="display text-[26px]">
              {v.label}
            </h2>
          </div>
          <p className="mt-2 text-[15px] text-text">{r.summary}</p>
          <p className="mt-1 text-[13px] text-muted">{r.reason}</p>
          {r.invoice ? <p className="mt-2 text-[13px] text-muted">Invoice {r.invoice.ref}: {r.invoice.note}</p> : null}
          <div className="mt-5">
            <VerificationSteps steps={r.steps} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px]">
            <a className="link inline-flex items-center gap-1" href={r.transaction.explorerUrl} target="_blank" rel="noopener noreferrer">
              Open in Mezo explorer <ExternalLink className="size-3" aria-hidden />
            </a>
            {share ? (
              <span className="inline-flex items-center gap-1 text-muted">
                Share this check <CopyButton value={share} label="Copy verification link" />
              </span>
            ) : null}
            <span className="text-faint">Checked {new Date(r.checkedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</span>
          </div>
          <p className="mt-4 text-[12px] text-faint">{r.disclaimer}</p>
        </section>
      ) : null}
    </div>
  );
}
