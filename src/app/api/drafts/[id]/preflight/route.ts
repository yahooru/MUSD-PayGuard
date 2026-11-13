import { z } from "zod";
import { runPreflight } from "@/lib/engine/engine";
import { explainAssessment } from "@/lib/engine/explain";
import { parseSettings } from "@/lib/settings";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { draftPayload, getDraftRow, getUserSettingsRaw, saveAssessment, toDraft } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { feeDto, gatherContext } from "@/lib/server/gather";
import { HttpError, json, readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ walletChainId: z.number().int().positive().nullable() });

/** Run the full preflight for a draft and bind the review to its payload hash. */
export const POST = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  const { walletChainId } = await readJson(req, schema);
  const row = await getDraftRow(s.userId, id);
  if (row.status === "submitted" || row.transaction_id) throw new HttpError(409, "This payment was already submitted.", "submitted");
  if (row.status === "abandoned") throw new HttpError(409, "This draft was discarded.", "abandoned");

  const settings = parseSettings(await getUserSettingsRaw(s.userId));
  const payload = draftPayload(row);
  const { ctx, fee } = await gatherContext({
    userId: s.userId,
    payload,
    walletChainId,
    selectedRecipientId: row.selected_recipient_id ?? null,
    settings,
  });
  const assessment = runPreflight(ctx);
  const saved = await saveAssessment(s.userId, id, "review", assessment, feeDto(fee));
  const updated = await q1(
    `UPDATE payguard.drafts SET status = 'reviewed', payload_hash = $3, latest_assessment_id = $4,
        authorized_at = NULL, authorization_expires_at = NULL, acknowledgements = '[]'::jsonb, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status <> 'submitted' RETURNING *`,
    [id, s.userId, assessment.payloadHash, saved.id],
  );
  await audit(s.userId, "preflight.run", { type: "draft", id }, { category: assessment.category, decision: assessment.decision, counts: assessment.counts });
  return json({ draft: toDraft(updated ?? row), assessment: saved, explanation: explainAssessment(saved), settings });
});
