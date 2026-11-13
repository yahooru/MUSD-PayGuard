import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { toRecipient } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// The address of a saved recipient is deliberately immutable: changing where "Bob" points
// is exactly what an attacker wants. Users delete and re-add instead (and get re-checked).
const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  verificationNote: z.string().trim().max(200).optional().nullable(),
});

function assertId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Recipient not found.", "not_found");
}

export const PATCH = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  assertId(id);
  const body = await readJson(req, patchSchema);
  const row = await q1(
    `UPDATE payguard.recipients SET
        label = COALESCE($3, label),
        notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
        verification_note = CASE WHEN $6::boolean THEN $7 ELSE verification_note END,
        verified_at = CASE WHEN $6::boolean THEN (CASE WHEN $7 IS NULL OR $7 = '' THEN NULL ELSE now() END) ELSE verified_at END,
        updated_at = now()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, s.userId, body.label ?? null, body.notes !== undefined, body.notes || null, body.verificationNote !== undefined, body.verificationNote || null],
  );
  if (!row) throw new HttpError(404, "Recipient not found.", "not_found");
  await audit(s.userId, "recipient.updated", { type: "recipient", id }, body);
  return json({ recipient: toRecipient(row) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  assertId(id);
  const row = await q1(`DELETE FROM payguard.recipients WHERE id = $1 AND user_id = $2 RETURNING id, address, label`, [id, s.userId]);
  if (!row) throw new HttpError(404, "Recipient not found.", "not_found");
  await audit(s.userId, "recipient.deleted", { type: "recipient", id }, { address: row.address, label: row.label });
  return json({ deleted: true });
});
