/**
 * Joins class names, skipping falsy parts. Lives outside any "use client" module so
 * Server Components can call it too (a function exported from a client module cannot).
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
