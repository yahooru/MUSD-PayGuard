/**
 * Token amount handling. All amounts are bigint base units; decimal strings only at the edges.
 * No floating-point arithmetic is used for token amounts anywhere in PayGuard.
 */

export const MUSD_DECIMALS = 18;
/** Upper sanity bound for a single payment typed by a person (1 trillion MUSD). */
export const MAX_HUMAN_AMOUNT = 10n ** 12n * 10n ** 18n;

export type AmountParse = { ok: true; value: bigint; normalized: string } | { ok: false; error: string };

/**
 * Parse a human decimal amount ("12.5") into base units.
 * Strict on purpose: no signs, exponents, commas or more fractional digits than the token supports.
 */
export function parseAmountInput(input: string, decimals = MUSD_DECIMALS): AmountParse {
  const s = input.trim();
  if (s.length === 0) return { ok: false, error: "Enter an amount." };
  if (/,/.test(s)) {
    return { ok: false, error: "Use a dot for decimals and leave out thousands separators (for example 1250.50)." };
  }
  if (/[eE]/.test(s)) return { ok: false, error: "Scientific notation is not accepted. Type the full amount." };
  if (/^[+-]/.test(s)) return { ok: false, error: "Enter a positive amount without a sign." };
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return { ok: false, error: "Only digits and one decimal point are allowed." };

  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > decimals) {
    return { ok: false, error: `MUSD supports at most ${decimals} decimal places.` };
  }
  const wholePart = whole === "" ? "0" : whole;
  const value = BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (value === 0n) return { ok: false, error: "The amount must be greater than zero." };
  if (value > MAX_HUMAN_AMOUNT) return { ok: false, error: "That amount is larger than any plausible payment." };
  return { ok: true, value, normalized: formatUnitsExact(value, decimals) };
}

/** Exact decimal string of a base-unit amount, trailing zeros trimmed ("12.5"). */
export function formatUnitsExact(value: bigint, decimals = MUSD_DECIMALS): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/**
 * Display formatting with thousands grouping. Rounds DOWN to `maxFraction` digits
 * (never shows more money than exists) and marks truncation with a leading "≈" only if asked.
 */
export function formatAmount(
  value: bigint,
  opts: { decimals?: number; maxFraction?: number; minFraction?: number } = {},
): string {
  const decimals = opts.decimals ?? MUSD_DECIMALS;
  const maxFraction = opts.maxFraction ?? 4;
  const minFraction = opts.minFraction ?? 2;
  const negative = value < 0n;
  const v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
}

/** Ratio a/b as a number with 2-decimal precision computed in bigint (for display/thresholds only). */
export function ratio(a: bigint, b: bigint): number {
  if (b === 0n) return Number.POSITIVE_INFINITY;
  return Number((a * 100n) / b) / 100;
}

export function bigintMedian(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

export function bigintMax(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  return values.reduce((m, v) => (v > m ? v : m));
}
