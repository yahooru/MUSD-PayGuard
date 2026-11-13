/**
 * Transaction lifecycle. A draft is not a transaction; a submitted transaction is not
 * confirmed. Status only moves forward through these documented transitions, and only
 * the server's receipt verification can produce "confirmed" or "failed".
 */

export type TxStatus = "pending" | "confirmed" | "failed" | "verification_delayed" | "unknown";
export type DraftStatus = "draft" | "reviewed" | "authorized" | "submitted" | "abandoned";

/** Result of one server-side verification attempt. */
export type VerificationOutcome =
  | "confirmed" // receipt success + matching Transfer log + enough confirmations
  | "reverted" // receipt status failed
  | "mismatch" // receipt success but the transfer does not match the reviewed payment
  | "awaiting_receipt" // tx known to the node, not mined yet / not enough confirmations
  | "not_found" // node does not know the hash
  | "rpc_error"; // transport/RPC failure: we could not establish the truth

export const TERMINAL: readonly TxStatus[] = ["confirmed", "failed"];

const ALLOWED: Record<TxStatus, readonly TxStatus[]> = {
  pending: ["pending", "confirmed", "failed", "verification_delayed", "unknown"],
  verification_delayed: ["verification_delayed", "pending", "confirmed", "failed", "unknown"],
  unknown: ["unknown", "pending", "confirmed", "failed", "verification_delayed"],
  confirmed: ["confirmed"],
  failed: ["failed"],
};

export function canTransition(from: TxStatus, to: TxStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Map a verification outcome onto the next status.
 * @param submittedAtMs when the hash was recorded
 * @param missingGraceMs how long a hash may be unknown to the node before we say "unknown"
 */
export function nextStatus(
  current: TxStatus,
  outcome: VerificationOutcome,
  opts: { now: number; submittedAtMs: number; missingGraceMs: number },
): TxStatus {
  if (TERMINAL.includes(current)) return current;
  let proposed: TxStatus;
  switch (outcome) {
    case "confirmed":
      proposed = "confirmed";
      break;
    case "reverted":
    case "mismatch":
      proposed = "failed";
      break;
    case "awaiting_receipt":
      proposed = "pending";
      break;
    case "not_found":
      proposed = opts.now - opts.submittedAtMs > opts.missingGraceMs ? "unknown" : "pending";
      break;
    case "rpc_error":
      proposed = "verification_delayed";
      break;
  }
  return canTransition(current, proposed) ? proposed : current;
}

export const STATUS_LABEL: Record<TxStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  failed: "Failed",
  verification_delayed: "Verification delayed",
  unknown: "Unknown",
};

export const STATUS_MEANING: Record<TxStatus, string> = {
  pending: "Submitted to Mezo Testnet. PayGuard has not yet seen a receipt with enough confirmations. Do not treat this as paid.",
  confirmed:
    "PayGuard fetched the receipt itself and verified: correct network, successful execution, and a MUSD Transfer event with exactly the reviewed sender, recipient and amount.",
  failed: "The transaction reverted, or its receipt does not match the payment you reviewed. No matching MUSD transfer happened.",
  verification_delayed:
    "PayGuard could not reach the network to verify this transaction. It may have succeeded — PayGuard will not say so until it can check the receipt.",
  unknown:
    "The network does not know this transaction hash. It may have been dropped or replaced. Check your wallet's activity before trying again.",
};
