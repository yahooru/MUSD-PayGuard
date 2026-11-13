import { z } from "zod";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { MUSD } from "@/config/contracts";
import { parseAmountInput } from "@/lib/amount";
import { validateInvoiceRef } from "@/lib/invoice";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { getRequest, toDraft } from "@/lib/server/data";
import { q, q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const draftSchema = z.object({
  recipient: z.string().max(128),
  amount: z.string().max(64),
  invoiceRef: z.string().max(200).optional().nullable(),
  note: z.string().trim().max(280).optional().nullable(),
  method: z.enum(["direct", "router"]).default("direct"),
  requestId: z.string().max(40).optional().nullable(),
  selectedRecipientId: z.string().uuid().optional().nullable(),
});

type DraftInput = z.infer<typeof draftSchema>;

/** Validates and normalises draft fields. Address validity is judged by the engine, not here. */
async function normalise(userId: string, body: DraftInput) {
  const amount = parseAmountInput(body.amount);
  if (!amount.ok) throw new HttpError(400, amount.error, "invalid_amount", [{ path: "amount", message: amount.error }]);
  let invoiceRef: string | null = null;
  let invoiceRefNorm: string | null = null;
  if (body.invoiceRef && body.invoiceRef.trim() !== "") {
    const v = validateInvoiceRef(body.invoiceRef);
    if (!v.ok) throw new HttpError(400, v.error, "invalid_reference", [{ path: "invoiceRef", message: v.error }]);
    invoiceRef = body.invoiceRef.trim();
    invoiceRefNorm = v.normalized;
  }
  if (body.method === "router" && !invoiceRef) {
    throw new HttpError(400, "On-chain invoice recording needs an invoice reference.", "reference_required", [
      { path: "invoiceRef", message: "Required for on-chain invoice recording" },
    ]);
  }
  if (body.selectedRecipientId) {
    const r = await q1(`SELECT id FROM payguard.recipients WHERE id = $1 AND user_id = $2`, [body.selectedRecipientId, userId]);
    if (!r) throw new HttpError(400, "The selected recipient does not exist.", "invalid_recipient");
  }
  if (body.requestId) {
    const r = await getRequest(body.requestId);
    if (!r) throw new HttpError(400, "The payment request does not exist.", "invalid_request");
  }
  return { amount: amount.value, invoiceRef, invoiceRefNorm };
}

export const POST = route(async (req) => {
  const s = await requireWriter(req);
  const body = await readJson(req, draftSchema);
  const n = await normalise(s.userId, body);
  const row = await q1(
    `INSERT INTO payguard.drafts (user_id, from_address, recipient_input, amount, token_address, chain_id, invoice_ref, invoice_ref_norm, note, method, request_id, selected_recipient_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      s.userId,
      s.address,
      body.recipient.trim(),
      n.amount.toString(),
      MUSD.address,
      SUPPORTED_NETWORK.chainId,
      n.invoiceRef,
      n.invoiceRefNorm,
      body.note || null,
      body.method,
      body.requestId || null,
      body.selectedRecipientId || null,
    ],
  );
  await audit(s.userId, "draft.created", { type: "draft", id: row!.id }, { method: body.method, requestId: body.requestId ?? null });
  return json({ draft: toDraft(row!) }, { status: 201 });
});

export const GET = route(async () => {
  const s = await requireSession();
  const rows = await q(
    `SELECT d.*, t.id AS transaction_id FROM payguard.drafts d LEFT JOIN payguard.transactions t ON t.draft_id = d.id
      WHERE d.user_id = $1 AND d.status IN ('draft', 'reviewed', 'authorized') ORDER BY d.updated_at DESC LIMIT 20`,
    [s.userId],
  );
  return json({ drafts: rows.map(toDraft) });
});
