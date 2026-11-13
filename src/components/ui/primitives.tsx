"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-cyan text-cyan-ink font-semibold hover:bg-cyan-strong shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_0_1px_rgb(127_232_245/0.4),0_8px_24px_-10px_rgb(69_217_236/0.6)] disabled:shadow-none",
  secondary: "bg-surface-2 text-text font-medium border border-line-strong hover:border-cyan/60 hover:bg-surface-3",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-fail/10 text-fail font-medium border border-fail/40 hover:bg-fail/20",
  quiet: "text-cyan hover:text-cyan-strong underline-offset-4 hover:underline",
};

/** Shared by Button and ButtonLink: colour transitions plus a 1px press so a click is felt. */
const BASE =
  "items-center justify-center whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:active:translate-y-0";

/**
 * Buttons are inline-flex unless the caller sets its own base display (e.g. "hidden sm:inline-flex").
 * Emitting both would leave the outcome to stylesheet order, which is how "hidden" silently lost.
 */
function display(className?: string): string | false {
  return !/(^|\s)(hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents)(\s|$)/.test(className ?? "") && "inline-flex";
}
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[8px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-[12px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        display(className),
        BASE,
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        variant !== "quiet" && SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  icon,
  external,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  icon?: ReactNode;
  external?: boolean;
}) {
  const cls = cn(display(className), BASE, VARIANT[variant], variant !== "quiet" && SIZE[size], className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  aside,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-text">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[13px] text-fail">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full bg-bg-deep border border-line rounded-[10px] px-3.5 text-[15px] text-text placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-cyan/70 focus:shadow-[0_0_0_4px_rgb(69_217_236/0.12)] focus:outline-none focus-visible:outline-none aria-[invalid=true]:border-fail/70 aria-[invalid=true]:focus:shadow-[0_0_0_4px_rgb(255_114_114/0.12)] disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputBase, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(inputBase, "py-2.5 min-h-20", className)} {...rest} />;
});

/**
 * Loading placeholder. Rendered as a block-level <span> so it is valid anywhere, including
 * inside a <p> (a <div> there is invalid HTML and breaks hydration).
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("skeleton block", className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function Empty({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-[14px] border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative mx-auto max-w-sm">
        {icon ? <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full border border-line-strong text-cyan">{icon}</div> : null}
        <p className="heading text-base">{title}</p>
        {body ? <div className="mt-1.5 text-sm text-muted">{body}</div> : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 id={id} className="heading text-[17px]">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function PageHeader({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <h1 className="display text-[30px] md:text-[38px]">{title}</h1>
        {lede ? <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function ErrorNote({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-[12px] border border-fail/40 bg-fail/5 px-4 py-3">
      <p className="text-sm font-semibold text-fail">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
