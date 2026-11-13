import { analyzeAddress } from "./address";
import { networkChecks, tokenChecks } from "./checks/chain";
import { duplicateChecks, integrityCheck, requestChecks } from "./checks/duplicates";
import { fundsChecks, simulationChecks } from "./checks/funds";
import { recipientChecks } from "./checks/recipient";
import { payloadHash } from "./payload";
import { CATEGORY_LABEL, categorize } from "./risk";
import type { Assessment, CheckId, CheckResult, HistoryEntry, PreflightContext, RequestSnapshot, SavedRecipient } from "./types";

export const ENGINE_VERSION = "payguard-preflight/1.0.0";

/**
 * Run every preflight check against a fully gathered context.
 * Pure and deterministic: same context in, same assessment out.
 */
export function runPreflight(ctx: PreflightContext): Assessment {
  const address = analyzeAddress(ctx.payload.to);
  const checks: CheckResult[] = [
    ...recipientChecks(ctx, address),
    ...networkChecks(ctx),
    ...tokenChecks(ctx),
    ...fundsChecks(ctx),
    ...simulationChecks(ctx),
    ...duplicateChecks(ctx),
    ...requestChecks(ctx),
    integrityCheck(ctx),
  ];
  const outcome = categorize(checks);

  const summary = (() => {
    const { counts } = outcome;
    const parts = [`${counts.pass} passed`];
    if (counts.warn) parts.push(`${counts.warn} warning${counts.warn === 1 ? "" : "s"}`);
    if (counts.fail) parts.push(`${counts.fail} failed`);
    if (counts.unavailable) parts.push(`${counts.unavailable} not performed`);
    return `${CATEGORY_LABEL[outcome.category]}: ${parts.join(", ")}.`;
  })();

  const nextAction =
    outcome.decision === "blocked"
      ? outcome.blockers[0]?.recommendation ?? "Resolve the failed checks before sending."
      : outcome.decision === "acknowledge"
        ? "Read each serious warning and acknowledge it explicitly before you can sign."
        : "Compare the full recipient address one last time, then confirm and sign in your wallet.";

  return {
    engineVersion: ENGINE_VERSION,
    evaluatedAt: new Date(ctx.now).toISOString(),
    payloadHash: payloadHash(ctx.payload),
    category: outcome.category,
    categoryLabel: CATEGORY_LABEL[outcome.category],
    decision: outcome.decision,
    decisionRules: outcome.rules,
    checks,
    counts: outcome.counts,
    blockers: outcome.blockers.map((c) => c.id),
    acknowledgementsRequired: outcome.acknowledgements.map((c) => c.id),
    notPerformed: outcome.notPerformed.map((c) => c.id),
    summary,
    nextAction,
  };
}

export interface RequestReviewContext {
  request: RequestSnapshot;
  now: number;
  config: PreflightContext["config"];
  token: PreflightContext["token"];
  recipientCode: PreflightContext["recipientCode"];
  explorerInfo?: PreflightContext["explorerInfo"];
  /** Present when the person opening the request is signed in: enables personal checks. */
  viewer?: { address: string; savedRecipients: SavedRecipient[]; history: HistoryEntry[] } | null;
}

const REQUEST_ONLY_SKIP: CheckId[] = ["request.recipient", "request.amount", "request.reference"];

/**
 * Re-validate a payment request when it is opened (before any payment is drafted).
 * Uses the same check implementations as the payment preflight, restricted to what can
 * be judged from the request itself (and, for a signed-in viewer, their own history).
 */
export function reviewRequest(rc: RequestReviewContext): Assessment {
  const req = rc.request;
  const viewer = rc.viewer ?? null;
  const ctx: PreflightContext = {
    payload: {
      chainId: req.chainId,
      token: req.token,
      from: viewer?.address ?? req.creator,
      to: req.recipient,
      amount: req.amount,
      invoiceRef: req.invoiceRef,
      method: "direct",
      requestId: req.id,
    },
    now: rc.now,
    config: rc.config,
    wallet: { connectedChainId: rc.config.chainId },
    token: rc.token,
    balances: { ok: false, error: "not applicable", source: "request review" },
    recipientCode: rc.recipientCode,
    fee: { ok: false, error: "not applicable", source: "request review" },
    simulation: { ok: false, error: "not applicable", source: "request review" },
    savedRecipients: viewer?.savedRecipients ?? [],
    selectedRecipientId: null,
    history: viewer?.history ?? [],
    counterparties: { ok: true, value: [], source: "request review" },
    explorerInfo: rc.explorerInfo,
    request: req,
    onchainInvoice: null,
  };
  const address = analyzeAddress(req.recipient);
  const personal: CheckId[] = ["recipient.book", "recipient.lookalike", "recipient.first_time", "recipient.self"];
  const recipient = recipientChecks(ctx, address).filter((c) => (viewer ? true : !personal.includes(c.id)) && c.id !== "recipient.checksum");
  const network = networkChecks(ctx).filter((c) => c.id === "network.payment");
  const token = tokenChecks(ctx);
  const request = requestChecks(ctx).filter((c) => !REQUEST_ONLY_SKIP.includes(c.id));
  const dups = viewer
    ? duplicateChecks(ctx).filter((c) => c.id === "duplicates.invoice_paid" || c.id === "duplicates.invoice_pending")
    : [];
  const checks = [...recipient, ...network, ...token, ...request, ...dups];
  const outcome = categorize(checks);
  return {
    engineVersion: ENGINE_VERSION,
    evaluatedAt: new Date(rc.now).toISOString(),
    payloadHash: payloadHash(ctx.payload),
    category: outcome.category,
    categoryLabel: CATEGORY_LABEL[outcome.category],
    decision: outcome.decision,
    decisionRules: outcome.rules,
    checks,
    counts: outcome.counts,
    blockers: outcome.blockers.map((c) => c.id),
    acknowledgementsRequired: outcome.acknowledgements.map((c) => c.id),
    notPerformed: outcome.notPerformed.map((c) => c.id),
    summary: `${CATEGORY_LABEL[outcome.category]}: request checked with ${checks.length} rules.`,
    nextAction:
      outcome.decision === "blocked"
        ? "Do not pay this request."
        : "If you expected this request, start the payment: PayGuard runs the full preflight against your wallet next.",
  };
}

/**
 * Validate acknowledgements given by the user against an assessment.
 * Every check that requires acknowledgement must be acknowledged; extra ids are ignored.
 */
export function missingAcknowledgements(assessment: Assessment, acknowledged: string[]): string[] {
  const given = new Set(acknowledged);
  return assessment.acknowledgementsRequired.filter((id) => !given.has(id));
}

export function canSign(assessment: Assessment, acknowledged: string[]): { ok: true } | { ok: false; reason: string } {
  if (assessment.decision === "blocked") return { ok: false, reason: "The review contains blocking findings." };
  const missing = missingAcknowledgements(assessment, acknowledged);
  if (missing.length > 0) return { ok: false, reason: `Acknowledge: ${missing.join(", ")}` };
  return { ok: true };
}
