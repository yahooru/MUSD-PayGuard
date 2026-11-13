import { listRecipients, toTransaction, TX_SELECT } from "@/lib/server/data";
import { q } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  const [recent, pending, warnings, recipients, counts, drafts] = await Promise.all([
    q(`${TX_SELECT} WHERE t.user_id = $1 ORDER BY t.submitted_at DESC LIMIT 6`, [s.userId]),
    q(`${TX_SELECT} WHERE t.user_id = $1 AND t.status IN ('pending', 'verification_delayed', 'unknown') ORDER BY t.submitted_at DESC`, [s.userId]),
    q(
      `SELECT c.check_id, c.status, c.severity, c.title, c.explanation, c.created_at, a.draft_id
         FROM payguard.check_results c JOIN payguard.assessments a ON a.id = c.assessment_id
        WHERE c.user_id = $1 AND c.status IN ('warn', 'fail') AND c.severity IN ('medium', 'high', 'critical') AND a.purpose = 'review'
        ORDER BY c.created_at DESC LIMIT 6`,
      [s.userId],
    ),
    listRecipients(s.userId),
    q(
      `SELECT status, count(*)::int AS n, coalesce(sum(amount), 0)::text AS total FROM payguard.transactions WHERE user_id = $1 GROUP BY status`,
      [s.userId],
    ),
    q(
      `SELECT id, recipient_input, amount, invoice_ref, status, updated_at FROM payguard.drafts
        WHERE user_id = $1 AND status IN ('draft', 'reviewed', 'authorized') ORDER BY updated_at DESC LIMIT 4`,
      [s.userId],
    ),
  ]);
  return json({
    recent: recent.map(toTransaction),
    pending: pending.map(toTransaction),
    warnings: warnings.map((w) => ({
      checkId: w.check_id,
      status: w.status,
      severity: w.severity,
      title: w.title,
      explanation: w.explanation,
      createdAt: new Date(w.created_at).toISOString(),
      draftId: w.draft_id,
    })),
    recipients: recipients.slice(0, 6),
    recipientCount: recipients.length,
    counts: Object.fromEntries(counts.map((c) => [c.status, { n: c.n, total: c.total }])),
    drafts: drafts.map((d) => ({
      id: d.id,
      recipient: d.recipient_input,
      amount: String(d.amount),
      invoiceRef: d.invoice_ref,
      status: d.status,
      updatedAt: new Date(d.updated_at).toISOString(),
    })),
  });
});
