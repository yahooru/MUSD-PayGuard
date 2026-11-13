import Link from "next/link";

/** Mark: a shield outline cut by three gate bars — the preflight sequence in one glyph. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path d="M16 2.5 4.5 7v8.2c0 7.1 4.9 12.4 11.5 14.3 6.6-1.9 11.5-7.2 11.5-14.3V7L16 2.5Z" stroke="var(--cyan)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 12.5h12M10 16.5h12M10 20.5h7" stroke="var(--cyan)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="21.5" cy="20.5" r="1.6" fill="var(--violet)" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-md" aria-label="MUSD PayGuard home">
      <LogoMark />
      <span className="heading text-[16px] tracking-tight">
        MUSD PayGuard
      </span>
    </Link>
  );
}
