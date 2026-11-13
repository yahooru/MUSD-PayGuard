import { q } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Security Centre data: what the engine found for this wallet, and what it could not check. */
export const GET = route(async () => {
  const s = await requireSession();
  const [warnings, blocked, checkStats, txStats, activity] = await Promise.all([
    q(
      `SELECT c.check_id, c.status, c.severity, c.title, c.explanation, c.created_at, a.draft_id
         FROM payguard.check_results c JOIN payguard.assessments a ON a.id = c.assessment_id
        WHERE c.user_id = $1 AND c.status = 'warn' AND a.purpose = 'review'
        ORDER BY c.created_at DESC LIMIT 25`,
      [s.userId],
    ),
    q(
      `SELECT a.id, a.draft_id, a.summary, a.created_at, a.purpose, d.recipient_input, d.amount,
              (SELECT json_agg(json_build_object('id', c.check_id, 'title', c.title, 'explanation', c.explanation))
                 FROM payguard.check_results c WHERE c.assessment_id = a.id AND (c.status = 'fail' OR (c.status = 'unavailable' AND c.severity IN ('high','critical')))) AS failures
         FROM payguard.assessments a JOIN payguard.drafts d ON d.id = a.draft_id
        WHERE a.user_id = $1 AND a.decision = 'blocked'
        ORDER BY a.created_at DESC LIMIT 20`,
      [s.userId],
    ),
    q(
      `SELECT check_id, status, count(*)::int AS n FROM payguard.check_results
        WHERE user_id = $1 AND created_at > now() - interval '90 days' GROUP BY check_id, status`,
      [s.userId],
    ),
    q(`SELECT status, count(*)::int AS n FROM payguard.transactions WHERE user_id = $1 GROUP BY status`, [s.userId]),
    q(
      `SELECT event, entity_type, entity_id, data, created_at FROM payguard.audit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [s.userId],
    ),
  ]);
  return json({
    warnings: warnings.map((w) => ({
      checkId: w.check_id,
      severity: w.severity,
      title: w.title,
      explanation: w.explanation,
      createdAt: new Date(w.created_at).toISOString(),
      draftId: w.draft_id,
    })),
    blocked: blocked.map((b) => ({
      assessmentId: b.id,
      draftId: b.draft_id,
      summary: b.summary,
      purpose: b.purpose,
      recipient: b.recipient_input,
      amount: String(b.amount),
      createdAt: new Date(b.created_at).toISOString(),
      failures: b.failures ?? [],
    })),
    checkStats: checkStats.map((c) => ({ checkId: c.check_id, status: c.status, n: c.n })),
    verification: Object.fromEntries(txStats.map((t) => [t.status, t.n])),
    activity: activity.map((a) => ({
      event: a.event,
      entityType: a.entity_type,
      entityId: a.entity_id,
      data: a.data,
      createdAt: new Date(a.created_at).toISOString(),
    })),
  });
});
