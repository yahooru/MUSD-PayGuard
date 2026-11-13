import { getAddress } from "viem";

/**
 * Address analysis used by the recipient checks. Pure string logic plus viem's
 * EIP-55 checksum implementation.
 */

export type ChecksumState = "valid" | "invalid" | "absent";

export interface AddressAnalysis {
  input: string;
  trimmed: string;
  valid: boolean;
  /** Human-readable reason when invalid. */
  problem: string | null;
  /** Machine-readable reason code when invalid. */
  problemCode:
    | null
    | "empty"
    | "hidden_characters"
    | "looks_like_name"
    | "missing_prefix"
    | "bad_length"
    | "non_hex";
  checksum: ChecksumState;
  /** Lower-case canonical form (only when valid). */
  lower: string | null;
  /** EIP-55 checksummed form (only when valid). */
  checksummed: string | null;
  hadSurroundingWhitespace: boolean;
}

// Zero-width, bidi-override, BOM and other invisible characters used to disguise strings.
const HIDDEN = /[\u0000-\u001F\u007F-\u009F ​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

export function analyzeAddress(input: string): AddressAnalysis {
  const base = {
    input,
    trimmed: input.trim(),
    valid: false,
    checksum: "absent" as ChecksumState,
    lower: null,
    checksummed: null,
    hadSurroundingWhitespace: input !== input.trim(),
  };
  const s = base.trimmed;
  if (s.length === 0) return { ...base, problem: "No recipient address was entered.", problemCode: "empty" };
  if (HIDDEN.test(s)) {
    return {
      ...base,
      problem:
        "The address contains invisible or control characters. This can happen when an address is copied from a web page or chat that was crafted to disguise it.",
      problemCode: "hidden_characters",
    };
  }
  if (/^[^\s]+\.[a-z]{2,}$/i.test(s) && !/^0x/i.test(s)) {
    return {
      ...base,
      problem: "This looks like a name (for example an ENS name), not an address. Mezo payments need the full 0x address.",
      problemCode: "looks_like_name",
    };
  }
  if (!/^0x/i.test(s)) {
    return {
      ...base,
      problem: /^[0-9a-f]{40}$/i.test(s)
        ? "The address is missing its 0x prefix. Copy the full address again from the recipient."
        : "An EVM address starts with 0x followed by 40 hexadecimal characters.",
      problemCode: "missing_prefix",
    };
  }
  const body = s.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(body)) {
    const bad = [...body].filter((c) => !/[0-9a-fA-F]/.test(c));
    const hint = bad.some((c) => /[oO]/.test(c))
      ? " The letter O is not valid: did you mean the digit 0?"
      : bad.some((c) => /[lIi]/.test(c))
        ? " The letters l / I are not valid: did you mean the digit 1?"
        : "";
    return {
      ...base,
      problem: `The address contains characters that are not hexadecimal (${[...new Set(bad)].slice(0, 4).join(" ")}).${hint}`,
      problemCode: "non_hex",
    };
  }
  if (body.length !== 40) {
    return {
      ...base,
      problem: `An address has exactly 40 characters after 0x; this one has ${body.length}. A character was probably ${
        body.length < 40 ? "lost" : "added"
      } while copying.`,
      problemCode: "bad_length",
    };
  }

  const lower = `0x${body.toLowerCase()}`;
  const checksummed = getAddress(lower);
  const isAllLower = body === body.toLowerCase();
  const isAllUpper = body === body.toUpperCase();
  // An all-upper or all-lower body carries no checksum information (EIP-55).
  const checksum: ChecksumState =
    isAllLower || isAllUpper ? "absent" : checksummed === `0x${body}` ? "valid" : "invalid";

  return { ...base, valid: true, problem: null, problemCode: null, checksum, lower, checksummed };
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Number of identical leading and trailing hex characters (after 0x), case-insensitive. */
export function sharedEnds(a: string, b: string): { prefix: number; suffix: number } {
  const x = a.toLowerCase().replace(/^0x/, "");
  const y = b.toLowerCase().replace(/^0x/, "");
  let prefix = 0;
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < x.length - prefix &&
    suffix < y.length - prefix &&
    x[x.length - 1 - suffix] === y[y.length - 1 - suffix]
  )
    suffix++;
  return { prefix, suffix };
}

export type LookalikeStrength = "strong" | "moderate";

/**
 * Address-poisoning heuristic. Attackers generate vanity addresses that share the first
 * and last characters of an address the victim uses, because wallets and explorers often
 * truncate addresses to "0x1234…abcd".
 *
 * Rule R-REC-LOOK:
 *   strong   = at least 4 leading AND 4 trailing hex characters match, full address differs
 *   moderate = at least 3 leading AND 3 trailing match and prefix + suffix >= 7
 * Random collisions at these lengths are ~1 in 16^7 (strong: 1 in 16^8) per pair, so
 * a match is unlikely to be coincidence.
 */
export function lookalikeStrength(a: string, b: string): LookalikeStrength | null {
  if (sameAddress(a, b)) return null;
  const { prefix, suffix } = sharedEnds(a, b);
  if (prefix >= 4 && suffix >= 4) return "strong";
  if (prefix >= 3 && suffix >= 3 && prefix + suffix >= 7) return "moderate";
  return null;
}
