import { formatAmount } from "../../amount";
import { normalizeInvoiceRef } from "../../invoice";
import { analyzeAddress, sameAddress } from "../address";
import { payloadHash } from "../payload";
import { result } from "../result";
import type { CheckResult, HistoryEntry, PreflightContext, RelatedRecord } from "../types";
import { parsePayloadAmount } from "./funds";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const musd = (v: bigint) => `${formatAmount(v, { maxFraction: 6 })} MUSD`;

const txRelated = (h: HistoryEntry, label: string): RelatedRecord => ({ kind: "transaction", id: h.id, label });

export function duplicateChecks(ctx: PreflightContext): CheckResult[] {
  const out: CheckResult[] = [];
  const ref = ctx.payload.invoiceRef ? normalizeInvoiceRef(ctx.payload.invoiceRef) : "";
  const amount = parsePayloadAmount(ctx.payload.amount);
  const to = analyzeAddress(ctx.payload.to).lower;

  if (!ref) {
    out.push(
      result("duplicates.reference", {
        status: "unavailable",
        severity: "low",
        explanation:
          "This payment has no invoice or payment reference, so PayGuard cannot tell whether this invoice was already paid. It can still spot identical recent payments.",
        recommendation: "Add the invoice number as the reference; it also appears on your receipt.",
      }),
    );
  } else {
    out.push(
      result("duplicates.reference", {
        status: "pass",
        severity: "info",
        explanation: `Reference “${ref}” will be compared with your earlier and pending payments (case and spacing are ignored).`,
        recommendation: "No action needed.",
        evidence: [{ label: "Normalised reference", value: ref, kind: "text" }],
      }),
    );

    const sameRef = ctx.history.filter((h) => h.invoiceRefNorm && h.invoiceRefNorm === ref);
    const confirmed = sameRef.filter((h) => h.status === "confirmed");
    const pending = sameRef.filter((h) => h.status === "pending" || h.status === "verification_delayed" || h.status === "unknown");
    const failed = sameRef.filter((h) => h.status === "failed");

    if (confirmed.length > 0) {
      const sameRecipient = to ? confirmed.some((h) => sameAddress(h.to, to)) : false;
      const sameAmount = amount !== null && confirmed.some((h) => BigInt(h.amount) === amount);
      out.push(
        result("duplicates.invoice_paid", {
          status: "warn",
          severity: "high",
          explanation: `Possible duplicate payment: this invoice reference has already been associated with ${
            confirmed.length === 1 ? "a confirmed transaction" : `${confirmed.length} confirmed transactions`
          }${sameRecipient && sameAmount ? " to the same recipient for the same amount" : sameRecipient ? " to the same recipient" : ""}. This match is based on the reference text you entered, so a reused or mistyped reference can also cause it.`,
          recommendation: "Open the earlier payment and confirm with the recipient that this invoice is still unpaid before continuing.",
          evidence: confirmed.slice(0, 3).flatMap((h) => [
            { label: `Paid ${h.submittedAt.slice(0, 10)}`, value: `${musd(BigInt(h.amount))} to ${h.to}`, kind: "text" as const },
            { label: "Transaction", value: h.txHash, kind: "hash" as const, href: ctx.config.explorerTx(h.txHash) },
          ]),
          related: confirmed.slice(0, 3).map((h, i) => txRelated(h, i === 0 ? "Inspect earlier payment" : "Another earlier payment")),
        }),
      );
    } else {
      out.push(
        result("duplicates.invoice_paid", {
          status: "pass",
          severity: "info",
          explanation: failed.length
            ? `No confirmed payment uses this reference. ${failed.length} earlier attempt(s) failed; failed transactions do not move MUSD.`
            : "No confirmed payment in your PayGuard history uses this reference.",
          recommendation: "No action needed.",
          related: failed.slice(0, 1).map((h) => txRelated(h, "Earlier failed attempt")),
        }),
      );
    }

    if (pending.length > 0) {
      out.push(
        result("duplicates.invoice_pending", {
          status: "warn",
          severity: "high",
          explanation: `A payment with this reference is still ${pending[0]!.status === "pending" ? "pending" : "awaiting verification"}. If it confirms, paying again would pay the invoice twice.`,
          recommendation: "Wait for the earlier payment to resolve and check its status before sending again.",
          evidence: pending.slice(0, 3).map((h) => ({
            label: `Submitted ${h.submittedAt.slice(0, 16).replace("T", " ")}`,
            value: h.txHash,
            kind: "hash" as const,
            href: ctx.config.explorerTx(h.txHash),
          })),
          related: pending.slice(0, 3).map((h) => txRelated(h, "Inspect pending payment")),
        }),
      );
    } else {
      out.push(
        result("duplicates.invoice_pending", {
          status: "pass",
          severity: "info",
          explanation: "No pending payment uses this reference.",
          recommendation: "No action needed.",
        }),
      );
    }

    if (ctx.onchainInvoice) {
      const obs = ctx.onchainInvoice;
      if (!obs.ok) {
        out.push(
          result("duplicates.onchain_registry", {
            status: "unavailable",
            severity: "low",
            explanation: `The on-chain invoice registry could not be read (${obs.error}).`,
            recommendation: "The local duplicate checks above still apply.",
          }),
        );
      } else if (obs.value.paid) {
        out.push(
          result("duplicates.onchain_registry", {
            status: "warn",
            severity: "high",
            explanation: `PayGuardRouter has an on-chain record that this wallet already paid reference “${ref}” to this recipient (${musd(
              BigInt(obs.value.amount),
            )} at block ${obs.value.blockNumber}). The record exists regardless of which device or app made the payment.`,
            recommendation: "Do not pay again unless the recipient confirms a second payment is due.",
            evidence: [
              { label: "Recorded amount", value: musd(BigInt(obs.value.amount)), kind: "amount" },
              { label: "Block", value: obs.value.blockNumber, kind: "number" },
            ],
          }),
        );
      } else {
        out.push(
          result("duplicates.onchain_registry", {
            status: "pass",
            severity: "info",
            explanation: "PayGuardRouter has no on-chain record of this wallet paying this reference to this recipient.",
            recommendation: "No action needed.",
          }),
        );
      }
    }
  }

  // Similar recent payments: same recipient + amount. Never blocks — recurring payments are legitimate.
  if (to && amount !== null) {
    const now = ctx.now;
    const similar = ctx.history.filter((h) => sameAddress(h.to, to) && BigInt(h.amount) === amount);
    const pendingRecent = similar.filter(
      (h) => (h.status === "pending" || h.status === "verification_delayed") && now - Date.parse(h.submittedAt) <= HOUR,
    );
    const confirmedRecent = similar.filter((h) => h.status === "confirmed" && now - Date.parse(h.submittedAt) <= 7 * DAY);
    if (pendingRecent.length > 0) {
      out.push(
        result("duplicates.similar_recent", {
          status: "warn",
          severity: "high",
          explanation:
            "An identical payment (same recipient, same amount) was submitted within the last hour and has not confirmed yet. Sending again now is the classic way to pay twice by accident.",
          recommendation: "Open the pending payment and wait for its result.",
          related: pendingRecent.slice(0, 2).map((h) => txRelated(h, "Inspect pending payment")),
        }),
      );
    } else if (confirmedRecent.length > 0) {
      const last = confirmedRecent[0]!;
      out.push(
        result("duplicates.similar_recent", {
          status: "warn",
          severity: "medium",
          explanation: `You paid the same amount to the same recipient on ${last.submittedAt.slice(0, 10)}. That is fine for recurring payments; PayGuard only flags it so you can check it is intended.`,
          recommendation: "Continue if this is a separate, expected payment.",
          related: confirmedRecent.slice(0, 2).map((h) => txRelated(h, "Inspect similar payment")),
        }),
      );
    } else {
      out.push(
        result("duplicates.similar_recent", {
          status: "pass",
          severity: "info",
          explanation: "No identical payment to this recipient was pending in the last hour or confirmed in the last 7 days.",
          recommendation: "No action needed.",
        }),
      );
    }
  }
  return out;
}

export function requestChecks(ctx: PreflightContext): CheckResult[] {
  const req = ctx.request;
  if (!req) return [];
  const out: CheckResult[] = [];
  const amount = parsePayloadAmount(ctx.payload.amount);
  const reqAmount = parsePayloadAmount(req.amount);
  const related: RelatedRecord[] = [{ kind: "request", id: req.id, label: "Open request" }];

  if (req.status === "paid") {
    out.push(
      result("request.status", {
        status: "warn",
        severity: "high",
        explanation: "This payment request is already marked as paid by a verified transaction.",
        recommendation: "Inspect the earlier payment before paying again.",
        related: req.paidTxId ? [{ kind: "transaction", id: req.paidTxId, label: "Inspect earlier payment" }, ...related] : related,
      }),
    );
  } else if (req.status === "cancelled") {
    out.push(
      result("request.status", {
        status: "warn",
        severity: "high",
        explanation: "The creator cancelled this payment request.",
        recommendation: "Ask the requester for a new request instead of paying a cancelled one.",
        related,
      }),
    );
  } else {
    out.push(result("request.status", { status: "pass", severity: "info", explanation: "The request is open.", recommendation: "No action needed.", related }));
  }

  if (req.expiresAt && Date.parse(req.expiresAt) < ctx.now) {
    out.push(
      result("request.expiry", {
        status: "warn",
        severity: "high",
        explanation: `This request expired on ${req.expiresAt.slice(0, 16).replace("T", " ")} UTC. Expired requests are a common vector for stale or replayed payment details.`,
        recommendation: "Ask the requester to confirm or reissue the request.",
        evidence: [{ label: "Expired", value: req.expiresAt, kind: "time" }],
      }),
    );
  } else {
    out.push(
      result("request.expiry", {
        status: "pass",
        severity: "info",
        explanation: req.expiresAt ? `Valid until ${req.expiresAt.slice(0, 16).replace("T", " ")} UTC.` : "The request has no expiry date.",
        recommendation: "No action needed.",
      }),
    );
  }

  out.push(
    sameAddress(req.recipient, ctx.payload.to)
      ? result("request.recipient", { status: "pass", severity: "info", explanation: "The payment goes to the address in the request.", recommendation: "No action needed." })
      : result("request.recipient", {
          status: "warn",
          severity: "critical",
          explanation: "The payment's recipient is not the address in the payment request.",
          recommendation: "Pay the address in the request, or confirm the change with the requester through a channel you trust.",
          evidence: [
            { label: "Request recipient", value: req.recipient, kind: "address" },
            { label: "Payment recipient", value: ctx.payload.to, kind: "address" },
          ],
        }),
  );

  if (amount !== null && reqAmount !== null && amount !== reqAmount) {
    const diff = amount > reqAmount ? amount - reqAmount : reqAmount - amount;
    out.push(
      result("request.amount", {
        status: "warn",
        severity: "high",
        explanation: `You are about to pay ${amount > reqAmount ? "more" : "less"} than the request asks for (difference: ${musd(diff)}).`,
        recommendation: "Pay the requested amount unless you agreed a different one with the requester.",
        evidence: [
          { label: "Requested", value: musd(reqAmount), kind: "amount" },
          { label: "This payment", value: musd(amount), kind: "amount" },
        ],
      }),
    );
  } else {
    out.push(
      result("request.amount", {
        status: "pass",
        severity: "info",
        explanation: reqAmount !== null ? `The amount equals the requested ${musd(reqAmount)}.` : "The amount matches the request.",
        recommendation: "No action needed.",
      }),
    );
  }

  out.push(
    req.chainId === ctx.config.chainId
      ? result("request.network", { status: "pass", severity: "info", explanation: `The request is for ${ctx.config.chainName}.`, recommendation: "No action needed." })
      : result("request.network", {
          status: "fail",
          severity: "critical",
          explanation: `The request asks for payment on chain ${req.chainId}, which PayGuard does not support.`,
          recommendation: "Ask the requester for a request on Mezo.",
        }),
  );

  out.push(
    sameAddress(req.token, ctx.config.token.address)
      ? result("request.token", { status: "pass", severity: "info", explanation: "The request names the configured MUSD contract.", recommendation: "No action needed." })
      : result("request.token", {
          status: "fail",
          severity: "critical",
          explanation: "The request names a token contract that is not the configured MUSD contract.",
          recommendation: "Do not pay this request with PayGuard.",
          evidence: [
            { label: "Requested token", value: req.token, kind: "address" },
            { label: "Configured MUSD", value: ctx.config.token.address, kind: "address" },
          ],
        }),
  );

  const reqRef = req.invoiceRef ? normalizeInvoiceRef(req.invoiceRef) : "";
  const payRef = ctx.payload.invoiceRef ? normalizeInvoiceRef(ctx.payload.invoiceRef) : "";
  out.push(
    reqRef === payRef
      ? result("request.reference", { status: "pass", severity: "info", explanation: reqRef ? `Reference “${reqRef}” matches the request.` : "Neither the request nor the payment has a reference.", recommendation: "No action needed." })
      : result("request.reference", {
          status: "warn",
          severity: "medium",
          explanation: "The payment reference differs from the request's invoice reference, which makes the payment harder to reconcile.",
          recommendation: "Use the reference from the request.",
          evidence: [
            { label: "Request reference", value: reqRef || "(none)", kind: "text" },
            { label: "Payment reference", value: payRef || "(none)", kind: "text" },
          ],
        }),
  );

  out.push(
    sameAddress(req.creator, req.recipient)
      ? result("request.creator", {
          status: "pass",
          severity: "info",
          explanation:
            "The request was created by the same wallet that receives the money; the creator proved control of that wallet by signing in. A valid request still does not prove the requester is who they claim to be.",
          recommendation: "Make sure you know who controls this wallet.",
          evidence: [{ label: "Creator", value: req.creator, kind: "address" }],
        })
      : result("request.creator", {
          status: "warn",
          severity: "low",
          explanation:
            "The request pays out to a different address than the wallet that created it. Businesses sometimes do this, but it also lets a third party redirect payments.",
          recommendation: "Confirm with the business that the payout address is theirs.",
          evidence: [
            { label: "Creator", value: req.creator, kind: "address" },
            { label: "Pays out to", value: req.recipient, kind: "address" },
          ],
        }),
  );
  return out;
}

export function integrityCheck(ctx: PreflightContext): CheckResult {
  const current = payloadHash(ctx.payload);
  if (ctx.reviewedPayloadHash && ctx.reviewedPayloadHash.toLowerCase() !== current.toLowerCase()) {
    return result("integrity.payload", {
      status: "fail",
      severity: "critical",
      explanation:
        "The payment details changed after you reviewed them. PayGuard will only request a signature for exactly what you reviewed.",
      recommendation: "Review the payment again.",
      evidence: [
        { label: "Reviewed payload", value: ctx.reviewedPayloadHash, kind: "hash" },
        { label: "Current payload", value: current, kind: "hash" },
      ],
    });
  }
  return result("integrity.payload", {
    status: "pass",
    severity: "info",
    explanation: ctx.reviewedPayloadHash
      ? "The payment about to be signed is byte-for-byte the payment you reviewed."
      : "This review is bound to the payload hash below. If any detail changes, PayGuard requires a new review before signing.",
    recommendation: "No action needed.",
    evidence: [{ label: "Payload hash", value: current, kind: "hash" }],
  });
}
