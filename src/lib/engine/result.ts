import { CATALOGUE_BY_ID } from "./catalogue";
import type { CheckId, CheckResult, CheckStatus, Evidence, FindingClass, RelatedRecord, Severity } from "./types";

const CLASS: Record<CheckStatus, FindingClass> = {
  pass: "ok",
  fail: "technical_failure",
  warn: "suspicious_pattern",
  unavailable: "not_performed",
};

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface ResultInput {
  status: CheckStatus;
  severity: Severity;
  explanation: string;
  recommendation: string;
  evidence?: Evidence[];
  related?: RelatedRecord[];
  /** Override the catalogue's essential flag (rarely needed). */
  essential?: boolean;
}

/** Builds a CheckResult, deriving class/blocking/acknowledgement from status + severity. */
export function result(id: CheckId, input: ResultInput): CheckResult {
  const entry = CATALOGUE_BY_ID[id];
  const essential = input.essential ?? entry.essential;
  const blocking = input.status === "fail" || (input.status === "unavailable" && essential);
  const requiresAcknowledgement = input.status === "warn" && SEVERITY_RANK[input.severity] >= SEVERITY_RANK.high;
  return {
    id,
    group: entry.group,
    title: entry.title,
    status: input.status,
    severity: input.severity,
    findingClass: CLASS[input.status],
    blocking,
    requiresAcknowledgement,
    essential,
    evidence: input.evidence ?? [],
    explanation: input.explanation,
    recommendation: input.recommendation,
    rule: entry.rule,
    related: input.related && input.related.length > 0 ? input.related : undefined,
  };
}

/** A dependent check that cannot run because an earlier objective check failed. */
export function skipped(id: CheckId, because: string): CheckResult {
  return result(id, {
    status: "unavailable",
    severity: "info",
    essential: false,
    explanation: `Not run: ${because}`,
    recommendation: "Fix the failed check above; this check runs again automatically.",
  });
}
