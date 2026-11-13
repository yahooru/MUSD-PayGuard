import { explainAssessment } from "@/lib/engine/explain";
import { getTransactionRow, toAssessment, toDraft, toTransaction } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Re-fetchable by id: tracking state lives on the server and survives refreshes and devices. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const s = await requireSession();
  const { id } = await params;
  const row = await getTransactionRow(s.userId, id);
  const [assessmentRow, authRow, draftRow] = await Promise.all([
    row.assessment_id ? q1(`SELECT * FROM payguard.assessments WHERE id = $1`, [row.assessment_id]) : null,
    q1(`SELECT * FROM payguard.assessments WHERE draft_id = $1 AND purpose = 'authorize' ORDER BY created_at DESC LIMIT 1`, [row.draft_id]),
    q1(`SELECT d.*, NULL AS transaction_id FROM payguard.drafts d WHERE d.id = $1`, [row.draft_id]),
  ]);
  const assessment = assessmentRow ? toAssessment(assessmentRow) : null;
  return json({
    transaction: toTransaction(row),
    assessment,
    authorizationAssessment: authRow ? toAssessment(authRow) : null,
    explanation: assessment ? explainAssessment(assessment) : null,
    draft: draftRow ? toDraft(draftRow) : null,
  });
});
