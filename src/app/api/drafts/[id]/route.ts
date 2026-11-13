import { z } from "zod";
import { parseAmountInput } from "@/lib/amount";
import { explainAssessment } from "@/lib/engine/explain";
import { validateInvoiceRef } from "@/lib/invoice";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { getDraftRow, getRequest, latestAssessment, toDraft, toRequest } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const s = await requireSession();
  const { id } = await params;
  const row = await getDraftRow(s.userId, id);
  const assessment = await latestAssessment(id, "review");
  const requestRow = row.request_id ? await getRequest(row.request_id) : null;
  return json({
    draft: toDraft(row),
    assessment,
    explanation: assessment ? explainAssessment(assessment) : null,
    request: requestRow ? toRequest(requestRow, s.userId) : null,
  });
});

const patchSchema = z.object({
  recipient: z.string().max(128).optional(),
  amount: z.string().max(64).optional(),
  invoiceRef: z.string().max(200).optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
  selectedRecipientId: z.string().uuid().optional().nullable(),
});

/** Editing a draft always invalidates its review: a new preflight is required before signing. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  const row = await getDraftRow(s.userId, id);
  if (row.transaction_id || row.status === "submitted") {
    throw new HttpError(409, "This payment was already submitted and can no longer be edited.", "submitted");
  }
  const body = await readJson(req, patchSchema);
  let amount: string | null = null;
  if (body.amount !== undefined) {
    const a = parseAmountInput(body.amount);
    if (!a.ok) throw new HttpError(400, a.error, "invalid_amount", [{ path: "amount", message: a.error }]);
    amount = a.value.toString();
  }
  let ref: string | null | undefined = undefined;
  let refNorm: string | null = null;
  if (body.invoiceRef !== undefined) {
    if (body.invoiceRef && body.invoiceRef.trim()) {
      const v = validateInvoiceRef(body.invoiceRef);
      if (!v.ok) throw new HttpError(400, v.error, "invalid_reference", [{ path: "invoiceRef", message: v.error }]);
      ref = body.invoiceRef.trim();
      refNorm = v.normalized;
    } else {
      if (row.method === "router") throw new HttpError(400, "On-chain invoice recording needs an invoice reference.", "reference_required");
      ref = null;
    }
  }
  const updated = await q1(
    `UPDATE payguard.drafts SET
        recipient_input = COALESCE($3, recipient_input),
        amount = COALESCE($4::numeric, amount),
        invoice_ref = CASE WHEN $5::boolean THEN $6 ELSE invoice_ref END,
        invoice_ref_norm = CASE WHEN $5::boolean THEN $7 ELSE invoice_ref_norm END,
        note = CASE WHEN $8::boolean THEN $9 ELSE note END,
        selected_recipient_id = CASE WHEN $10::boolean THEN $11::uuid ELSE selected_recipient_id END,
        status = 'draft', payload_hash = NULL, authorized_at = NULL, authorization_expires_at = NULL,
        acknowledgements = '[]'::jsonb, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status <> 'submitted' RETURNING *`,
    [
      id,
      s.userId,
      body.recipient?.trim() ?? null,
      amount,
      ref !== undefined,
      ref ?? null,
      refNorm,
      body.note !== undefined,
      body.note || null,
      body.selectedRecipientId !== undefined,
      body.selectedRecipientId || null,
    ],
  );
  if (!updated) throw new HttpError(409, "This payment can no longer be edited.", "submitted");
  await audit(s.userId, "draft.edited", { type: "draft", id }, { fields: Object.keys(body) });
  return json({ draft: toDraft(updated) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  const row = await getDraftRow(s.userId, id);
  if (row.transaction_id || row.status === "submitted") throw new HttpError(409, "A submitted payment cannot be discarded.", "submitted");
  await q1(`UPDATE payguard.drafts SET status = 'abandoned', updated_at = now() WHERE id = $1 AND user_id = $2`, [id, s.userId]);
  await audit(s.userId, "draft.abandoned", { type: "draft", id });
  return json({ abandoned: true });
});
