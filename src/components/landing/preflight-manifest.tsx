import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { getAddress } from "viem";
import { groupHex } from "@/lib/format";
import { cn } from "../ui/primitives";

/**
 * The landing hero: an example of the review PayGuard puts in front of a payment.
 * The checks resolve one by one (CSS only, no JS), and the last one catches the
 * mistake PayGuard exists for. Reduced motion shows the finished review at once.
 * It is labelled as an example: no real wallet, payment or contact is shown.
 */

const SAMPLE_TO = getAddress("0x9f112fbf81c47d05a3e6b2c9d4f0a17e3b5c7c3a");

const CHECKS: { label: string; detail: string; tone: "pass" | "warn" }[] = [
  { label: "Address", detail: "Valid format, EIP-55 checksum matches", tone: "pass" },
  { label: "Network", detail: "Wallet and payment both on Mezo Testnet", tone: "pass" },
  { label: "Token", detail: "The official MUSD contract, read on-chain", tone: "pass" },
  { label: "Balance", detail: "Covers 250 MUSD plus the network fee", tone: "pass" },
  { label: "Simulation", detail: "The transfer succeeds against the latest block", tone: "pass" },
  { label: "Duplicate", detail: "INV-0042 was paid to this address 3 days ago", tone: "warn" },
];

function Row({ i, children, className }: { i: number; children: React.ReactNode; className?: string }) {
  return (
    <li className={cn("check-seq", className)} style={{ "--i": i } as CSSProperties}>
      {children}
    </li>
  );
}

export function PreflightManifest({ className }: { className?: string }) {
  const groups = groupHex(SAMPLE_TO);
  return (
    <figure className={cn("relative", className)} aria-label="Example of a PayGuard security review">
      {/* A faint second sheet behind: the review is one page in a stack of payments. */}
      <div className="absolute inset-x-6 -bottom-3 top-6 rounded-[22px] border border-line bg-surface/40" aria-hidden />
      <div className="hull relative overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
          <p className="text-[13px] font-semibold text-muted">Security review</p>
          <p className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-faint">Example</p>
        </div>

        <div className="px-5 pb-4 pt-5 sm:px-6">
          <p className="text-[13px] text-muted">You are about to send</p>
          <p className="display tnum mt-1 text-[40px] sm:text-[44px]">
            250.00<span className="ml-2 text-[0.5em] font-medium text-muted">MUSD</span>
          </p>
          <div className="mt-3 grid gap-1 text-[13px] sm:grid-cols-[88px_1fr] sm:gap-x-3">
            <span className="text-faint">To</span>
            <span className="mono text-[13px] leading-6 tracking-[0.02em]">
              {groups.map((g, i) => (
                <span key={i} className={cn(i === 0 ? "text-faint" : "text-text", "mr-[0.4em]")}>
                  {g}
                </span>
              ))}
            </span>
            <span className="text-faint">Reference</span>
            <span className="mono">INV-0042</span>
          </div>
        </div>

        <ol className="border-t border-line px-3 py-2 sm:px-4">
          {CHECKS.map((c, i) => (
            <Row key={c.label} i={i} className={cn("flex items-start gap-3 rounded-[10px] px-2 py-2", c.tone === "warn" && "bg-warn/[0.07]")}>
              <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
                <span className="check-pending absolute inset-0 rounded-full border-2 border-line-strong border-t-cyan" aria-hidden />
                <span className="check-done">
                  {c.tone === "warn" ? (
                    <TriangleAlert className="size-[18px] text-warn" strokeWidth={2.1} aria-hidden />
                  ) : (
                    <CircleCheck className="size-[18px] text-pass" strokeWidth={2.1} aria-hidden />
                  )}
                </span>
              </span>
              <span className="min-w-0 text-[13.5px] leading-snug">
                <span className={cn("font-medium", c.tone === "warn" ? "text-warn" : "text-text")}>{c.label}</span>
                <span className="sr-only">{c.tone === "warn" ? ": warning." : ": passed."}</span>
                <span className="block text-muted">{c.detail}</span>
              </span>
            </Row>
          ))}
        </ol>

        <div className="border-t border-line bg-bg-deep/50 px-5 py-4 sm:px-6">
          <ol>
            <Row i={CHECKS.length} className="flex items-start gap-3">
              <OctagonAlert className="mt-0.5 size-5 shrink-0 text-fail" aria-hidden />
              <span className="text-[13.5px] leading-snug">
                <span className="font-semibold text-fail">High risk: possible duplicate payment.</span>{" "}
                <span className="text-muted">Your wallet stays closed until you open the earlier payment and confirm this one is new.</span>
              </span>
            </Row>
          </ol>
        </div>
      </div>
    </figure>
  );
}
