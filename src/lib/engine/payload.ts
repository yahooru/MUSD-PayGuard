import { keccak256, toBytes } from "viem";
import { normalizeInvoiceRef } from "../invoice";
import type { PaymentPayload } from "./types";

/**
 * Canonical payload encoding. The hash binds a review to the exact payment:
 * chain, token, sender, recipient, amount, reference, method and request.
 * Any change (even letter case of the recipient) produces a different hash and
 * forces a fresh review before a signature can be requested.
 */
export const PAYLOAD_VERSION = "PAYGUARD_PAYLOAD_V1";

export function canonicalPayload(p: PaymentPayload): string {
  return [
    PAYLOAD_VERSION,
    String(p.chainId),
    p.token.trim().toLowerCase(),
    p.from.trim().toLowerCase(),
    // Recipient is kept exactly as entered (trimmed) so a checksum/case edit also counts as a change.
    p.to.trim(),
    BigInt(p.amount).toString(),
    p.invoiceRef ? normalizeInvoiceRef(p.invoiceRef) : "",
    p.method,
    p.requestId ?? "",
  ].join("|");
}

export function payloadHash(p: PaymentPayload): `0x${string}` {
  return keccak256(toBytes(canonicalPayload(p)));
}

export function payloadsEqual(a: PaymentPayload, b: PaymentPayload): boolean {
  return canonicalPayload(a) === canonicalPayload(b);
}
