import { getAddress } from "viem";
import { z } from "zod";
import { MUSD } from "@/config/contracts";
import { reviewRequest } from "@/lib/engine/engine";
import { explainAssessment } from "@/lib/engine/explain";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { publicClient } from "@/lib/server/chain";
import { getRequest, historyForEngine, listRecipients, requestSnapshot, toRequest, toSaved } from "@/lib/server/data";
import { q, q1 } from "@/lib/server/db";
import { fetchAddressInfo } from "@/lib/server/explorer";
import { ENGINE_CONFIG, readToken } from "@/lib/server/gather";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { withTimeout, errorMessage } from "@/lib/server/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
type Ctx = { params: Promise<{ id: string }> };

/**
 * Public view of a payment request. Re-validated on every open: token and recipient are
 * re-read from the chain and, for a signed-in viewer, compared with their own history.
 */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const row = await getRequest(id);
  if (!row) throw new HttpError(404, "Payment request not found. Check the link with the person who sent it.", "not_found");
  const session = await getSession();
  const request = toRequest(row, session?.userId);
  const recipient = getAddress(row.recipient_address);
  const [token, recipientCode, explorerInfo, viewer, paidTx] = await Promise.all([
    readToken(MUSD.address),
    withTimeout(publicClient().getCode({ address: recipient }), 8000, "code")
      .then((code) => ({ ok: true as const, value: { code: code ?? null }, source: "Mezo Testnet RPC" }))
      .catch((e) => ({ ok: false as const, error: errorMessage(e), source: "Mezo Testnet RPC" })),
    fetchAddressInfo(recipient),
    session
      ? Promise.all([listRecipients(session.userId), historyForEngine(session.userId)]).then(([r, h]) => ({
          address: session.address,
          savedRecipients: r.map(toSaved),
          history: h,
        }))
      : Promise.resolve(null),
    row.paid_tx_id ? q1(`SELECT tx_hash, block_number FROM payguard.transactions WHERE id = $1`, [row.paid_tx_id]) : Promise.resolve(null),
  ]);
  const assessment = reviewRequest({
    request: requestSnapshot(request),
    now: Date.now(),
    config: ENGINE_CONFIG,
    token,
    recipientCode,
    explorerInfo,
    viewer,
  });
  return json({
    request,
    assessment,
    explanation: explainAssessment(assessment),
    viewer: session ? { address: session.address, isCreator: request.isMine } : null,
    paidTx: paidTx ? { txHash: paidTx.tx_hash, blockNumber: paidTx.block_number ? String(paidTx.block_number) : null } : null,
  });
});

const patchSchema = z.object({ action: z.literal("cancel") });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  await readJson(req, patchSchema);
  const row = await getRequest(id);
  if (!row || row.creator_user_id !== s.userId) throw new HttpError(404, "Payment request not found.", "not_found");
  if (row.status !== "open") throw new HttpError(409, `This request is already ${row.status}.`, "not_open");
  const pending = await q(
    `SELECT id FROM payguard.transactions WHERE request_id = $1 AND status IN ('pending', 'verification_delayed', 'unknown')`,
    [id],
  );
  if (pending.length) throw new HttpError(409, "A payment for this request is still being verified. Wait for it before cancelling.", "pending_payment");
  const updated = await q1(`UPDATE payguard.payment_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [id]);
  await audit(s.userId, "request.cancelled", { type: "request", id });
  return json({ request: toRequest(updated!, s.userId) });
});
