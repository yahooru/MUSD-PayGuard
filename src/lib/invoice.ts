import { keccak256, toBytes, type Hex } from "viem";

/**
 * Invoice / payment reference handling.
 *
 * Convention (shared with PayGuardRouter, see contracts/contracts/PayGuardRouter.sol):
 *   normalizedRef = NFKC(ref).trim(), internal whitespace collapsed to one space, upper-cased
 *   invoiceRefHash = keccak256(utf8(normalizedRef))
 *
 * Normalising before comparing means "inv-0042", " INV-0042 " and "INV-0042" are treated
 * as the same invoice, which is what a person paying an invoice expects.
 */

export const INVOICE_REF_MAX_LENGTH = 64;

// Control characters, zero-width characters and bidi overrides are rejected outright:
// they make two references look identical while being different strings.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

export function normalizeInvoiceRef(ref: string): string {
  return ref.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

export type InvoiceRefValidation = { ok: true; normalized: string } | { ok: false; error: string };

export function validateInvoiceRef(ref: string): InvoiceRefValidation {
  if (FORBIDDEN_CHARS.test(ref)) {
    return { ok: false, error: "The reference contains invisible or control characters. Type it again by hand." };
  }
  const normalized = normalizeInvoiceRef(ref);
  if (normalized.length === 0) return { ok: false, error: "The reference is empty." };
  if (normalized.length > INVOICE_REF_MAX_LENGTH) {
    return { ok: false, error: `Keep the reference to ${INVOICE_REF_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, normalized };
}

/** bytes32 key used on-chain by PayGuardRouter. */
export function invoiceRefHash(ref: string): Hex {
  return keccak256(toBytes(normalizeInvoiceRef(ref)));
}
