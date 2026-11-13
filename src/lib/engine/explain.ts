import { CATEGORY_MEANING } from "./risk";
import { SEVERITY_RANK } from "./result";
import type { Assessment, CheckResult } from "./types";

/**
 * The "security assistant": deterministic plain-language explanations generated only
 * from the engine's own results. It never adds findings, never claims an address is
 * malicious without evidence and can never override a failed check — it only reads
 * the Assessment. No external AI service is involved, so it always works.
 */

export interface Explanation {
  headline: string;
  verdict: string;
  points: { tone: "stop" | "review" | "note"; text: string; checkId: string }[];
  nextSteps: string[];
  limits: string;
}

const order = (a: CheckResult, b: CheckResult) => {
  const rank = (c: CheckResult) => (c.status === "fail" ? 10 : c.status === "warn" ? 5 : c.essential ? 4 : 0) + SEVERITY_RANK[c.severity];
  return rank(b) - rank(a);
};

export function explainAssessment(a: Assessment): Explanation {
  const failing = a.checks.filter((c) => c.status === "fail").sort(order);
  const warnings = a.checks.filter((c) => c.status === "warn").sort(order);
  const missing = a.checks.filter((c) => c.status === "unavailable" && (c.essential || SEVERITY_RANK[c.severity] >= SEVERITY_RANK.medium));

  let headline: string;
  if (a.decision === "blocked" && failing.length > 0) {
    headline = `PayGuard stopped this payment: ${failing.length === 1 ? "one check failed" : `${failing.length} checks failed`}.`;
  } else if (a.decision === "blocked") {
    headline = "PayGuard could not verify everything it needs, so it will not send yet.";
  } else if (a.decision === "acknowledge") {
    headline = `This payment can go ahead only after you review ${warnings.filter((w) => w.requiresAcknowledgement).length === 1 ? "one serious warning" : "the serious warnings"}.`;
  } else if (a.category === "caution") {
    headline = "Nothing blocks this payment, but some details deserve a second look.";
  } else {
    headline = "No configured check found a problem with this payment.";
  }

  const points: Explanation["points"] = [];
  for (const c of failing) points.push({ tone: "stop", text: c.explanation, checkId: c.id });
  for (const c of warnings) points.push({ tone: c.requiresAcknowledgement ? "stop" : "review", text: c.explanation, checkId: c.id });
  for (const c of missing) points.push({ tone: "note", text: c.explanation, checkId: c.id });

  const nextSteps = [...new Set([...failing, ...warnings, ...missing].map((c) => c.recommendation))].filter(
    (r) => r !== "No action needed.",
  );
  if (nextSteps.length === 0) nextSteps.push("Compare the full recipient address with the one you were given, then confirm.");

  return {
    headline,
    verdict: CATEGORY_MEANING[a.category],
    points: points.slice(0, 8),
    nextSteps: nextSteps.slice(0, 5),
    limits:
      "These explanations are generated from PayGuard's rule results only. PayGuard cannot know who controls an address, cannot reverse a blockchain transfer and cannot catch every scam.",
  };
}
