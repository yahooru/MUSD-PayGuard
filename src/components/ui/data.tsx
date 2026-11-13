"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { getAddress } from "viem";
import { explorer } from "@/config/chains";
import { formatAmount } from "@/lib/amount";
import { groupHex, shortAddress, shortHash } from "@/lib/format";
import { cn } from "./primitives";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn("inline-flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-3 hover:text-text", className)}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-pass" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

function checksum(a: string): string {
  try {
    return getAddress(a.toLowerCase());
  } catch {
    return a;
  }
}

/**
 * Full address in grouped monospace (0x 9F11 2Fbf …) so people can compare group by group.
 * The first and last groups are emphasised because that is what lookalike attacks imitate —
 * and the middle is shown at full strength too, to discourage comparing only the ends.
 */
export function FullAddress({ address, className, copy = true, link = true }: { address: string; className?: string; copy?: boolean; link?: boolean }) {
  const a = checksum(address);
  const groups = groupHex(a);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="mono break-all text-[14px] leading-6 tracking-[0.02em]" aria-label={`Address ${a}`}>
        {groups.map((g, i) => (
          <span key={i} className={cn(i === 0 ? "text-faint" : "text-text", "mr-[0.45em] last:mr-0")}>
            {g}
          </span>
        ))}
      </span>
      <span className="inline-flex items-center">
        {copy ? <CopyButton value={a} label="Copy address" /> : null}
        {link ? (
          <a
            href={explorer.address(a)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-surface-3 hover:text-text"
            aria-label="Open address in Mezo explorer"
            title="Open in Mezo explorer"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </span>
    </span>
  );
}

export function ShortAddress({ address, label, className }: { address: string; label?: string | null; className?: string }) {
  const a = checksum(address);
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-2", className)} title={a}>
      {label ? <span className="truncate font-medium">{label}</span> : null}
      <span className={cn("mono text-[13px]", label ? "text-faint" : "text-text")}>{shortAddress(a)}</span>
    </span>
  );
}

export function TxHash({ hash, short = true, className }: { hash: string; short?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <a href={explorer.tx(hash)} target="_blank" rel="noopener noreferrer" className="mono link text-[13px] break-all" title={hash}>
        {short ? shortHash(hash) : hash}
      </a>
      <CopyButton value={hash} label="Copy transaction hash" />
    </span>
  );
}

export function Musd({ value, className, maxFraction = 4, unit = true }: { value: string | bigint; className?: string; maxFraction?: number; unit?: boolean }) {
  const v = typeof value === "bigint" ? value : BigInt(value || "0");
  return (
    <span className={cn("tnum", className)}>
      {formatAmount(v, { maxFraction })}
      {unit ? <span className="ml-1 text-[0.8em] font-medium text-muted">MUSD</span> : null}
    </span>
  );
}

export function DefinitionList({ items, className }: { items: { term: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map((it) => (
        <div key={it.term} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-[13px] text-muted">{it.term}</dt>
          <dd className="min-w-0 text-[14px]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
