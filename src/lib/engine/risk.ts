import { SEVERITY_RANK } from "./result";
import type { CheckResult, CheckStatus, Decision, RiskCategory } from "./types";

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  low: "Low observed risk",
  caution: "Caution",
  high: "High risk",
};

export const CATEGORY_MEANING: Record<RiskCategory, string> = {
  low: "No configured check found a specific problem. This does not mean the payment is guaranteed safe.",
  caution: "One or more checks found an unusual condition, or could not run. Review the findings before continuing.",
  high: "A critical validation failed or a serious inconsistency was detected.",
};

export interface RiskOutcome {
  category: RiskCategory;
  decision: Decision;
  rules: string[];
  blockers: CheckResult[];
  acknowledgements: CheckResult[];
  notPerformed: CheckResult[];
  counts: Record<CheckStatus, number>;
}

/**
 * Documented category rules (also listed in catalogue.ts RISK_RULES and the README):
 *   R-CAT-1  any fail                                   → high, blocked
 *   R-CAT-2  any essential check unavailable            → blocked (fail safe), at least caution
 *   R-CAT-3  any warn with severity high/critical       → high, acknowledgement required
 *   R-CAT-4  any warn low/medium, or non-essential
 *            unavailable with severity ≥ medium          → caution
 *   R-CAT-5  otherwise                                  → low observed risk
 */
export function categorize(checks: CheckResult[]): RiskOutcome {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, unavailable: 0 };
  for (const c of checks) counts[c.status]++;

  const fails = checks.filter((c) => c.status === "fail");
  const essentialUnavailable = checks.filter((c) => c.status === "unavailable" && c.essential);
  const seriousWarns = checks.filter((c) => c.status === "warn" && SEVERITY_RANK[c.severity] >= SEVERITY_RANK.high);
  const minorWarns = checks.filter(
    (c) => c.status === "warn" && SEVERITY_RANK[c.severity] >= SEVERITY_RANK.low && SEVERITY_RANK[c.severity] < SEVERITY_RANK.high,
  );
  const notableUnavailable = checks.filter(
    (c) => c.status === "unavailable" && !c.essential && SEVERITY_RANK[c.severity] >= SEVERITY_RANK.medium,
  );

  const rules: string[] = [];
  let category: RiskCategory = "low";
  let decision: Decision = "proceed";

  if (fails.length > 0) {
    rules.push("R-CAT-1");
    category = "high";
    decision = "blocked";
  }
  if (essentialUnavailable.length > 0) {
    rules.push("R-CAT-2");
    decision = "blocked";
    if (category === "low") category = "caution";
  }
  if (seriousWarns.length > 0) {
    rules.push("R-CAT-3");
    category = "high";
    if (decision !== "blocked") decision = "acknowledge";
  }
  if (minorWarns.length > 0 || notableUnavailable.length > 0) {
    rules.push("R-CAT-4");
    if (category === "low") category = "caution";
  }
  if (rules.length === 0) rules.push("R-CAT-5");

  return {
    category,
    decision,
    rules,
    blockers: checks.filter((c) => c.blocking),
    acknowledgements: seriousWarns,
    notPerformed: checks.filter((c) => c.status === "unavailable"),
    counts,
  };
}
