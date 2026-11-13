import { encodeFunctionData, getAddress, type Address } from "viem";
import { z } from "zod";
import { MUSD, PAYGUARD_ROUTER, musdAbi } from "@/config/contracts";
import { parseAmountInput } from "@/lib/amount";
import { analyzeAddress } from "@/lib/engine/address";
import { missingAcknowledgements, runPreflight } from "@/lib/engine/engine";
import { invoiceRefHash } from "@/lib/invoice";
import { parseSettings } from "@/lib/settings";
import { audit } from "@/lib/server/audit";
import { requireWriter } from "@/lib/server/auth";
import { draftPayload, getDraftRow, getUserSettingsRaw, saveAssessment } from "@/lib/server/data";
import { q1 } from "@/lib/server/db";
import { feeDto, gatherContext } from "@/lib/server/gather";
import { errorJson, HttpError, json, readJson, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

const AUTH_TTL_MS = 10 * 60 * 1000;

const schema = z.object({
  payloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  acknowledgements: z.array(z.string().max(64)).max(40).default([]),
  walletChainId: z.number().int().positive().nullable(),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  addressConfirmation: z.string().max(8).optional().nullable(),
  fullAddressCompared: z.boolean().optional(),
});

/**
 * The last gate before a signature. Re-gathers every observation, re-runs the engine
 * against the exact stored payload with the hash the user reviewed, and only then
 * returns the transaction parameters (with an explicit gas limit).
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const s = await requireWriter(req);
  const { id } = await params;
  const body = await readJson(req, schema);
  const row = await getDraftRow(s.userId, id);

  if (row.status === "submitted" || row.transaction_id) {
    throw new HttpError(409, "This payment was already submitted. Open it to follow its status.", "submitted", { transactionId: row.transaction_id });
  }
  if (row.status !== "reviewed" && row.status !== "authorized") {
    throw new HttpError(409, "Run the security review before confirming.", "not_reviewed");
  }
  if (body.walletAddress.toLowerCase() !== s.address || row.from_address !== s.address) {
    throw new HttpError(409, "Your wallet account changed since you signed in. Sign in again with the account that will pay.", "account_changed");
  }
  if (!row.payload_hash || row.payload_hash.toLowerCase() !== body.payloadHash.toLowerCase()) {
    throw new HttpError(409, "The payment changed after your review. Review it again.", "review_stale");
  }

  const settings = parseSettings(await getUserSettingsRaw(s.userId));
  const payload = draftPayload(row);
  const { ctx, fee } = await gatherContext({
    userId: s.userId,
    payload,
    walletChainId: body.walletChainId,
    selectedRecipientId: row.selected_recipient_id ?? null,
    settings,
    reviewedPayloadHash: body.payloadHash,
  });
  const assessment = runPreflight(ctx);
  const saved = await saveAssessment(s.userId, id, "authorize", assessment, feeDto(fee));

  if (assessment.decision === "blocked") {
    await audit(s.userId, "authorize.blocked", { type: "draft", id }, { blockers: assessment.blockers });
    return errorJson(409, "blocked", "PayGuard re-checked the payment right before signing and found a blocking problem.", { assessment: saved });
  }
  const missing = missingAcknowledgements(assessment, body.acknowledgements);
  if (missing.length > 0) {
    return errorJson(409, "acknowledgement_required", "Acknowledge each serious warning before signing.", { missing, assessment: saved });
  }
  if (settings.security.confirmFullAddress && body.fullAddressCompared !== true) {
    return errorJson(409, "address_comparison_required", "Confirm that you compared the full recipient address.", {});
  }
  const to = analyzeAddress(payload.to).checksummed as Address;
  const amount = BigInt(payload.amount);
  const threshold = parseAmountInput(settings.security.largePaymentThreshold);
  if (threshold.ok && amount > threshold.value) {
    const suffix = to.slice(-4).toLowerCase();
    if ((body.addressConfirmation ?? "").trim().toLowerCase() !== suffix) {
      return errorJson(409, "address_confirmation_required", "Type the last 4 characters of the recipient address to confirm this large payment.", {});
    }
  }
  if (!fee) throw new HttpError(503, "The network fee could not be estimated. Try again in a moment.", "fee_unavailable");

  const expiresAt = new Date(Date.now() + AUTH_TTL_MS).toISOString();
  await q1(
    `UPDATE payguard.drafts SET status = 'authorized', authorized_at = now(), authorization_expires_at = $3, acknowledgements = $4, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [id, s.userId, expiresAt, JSON.stringify(assessment.acknowledgementsRequired)],
  );
  await audit(s.userId, "authorize.granted", { type: "draft", id }, { category: assessment.category, acknowledged: assessment.acknowledgementsRequired });

  const call =
    payload.method === "router"
      ? { kind: "router" as const, to: PAYGUARD_ROUTER.address, invoiceRefHash: invoiceRefHash(payload.invoiceRef ?? "") }
      : { kind: "direct" as const, to: MUSD.address, data: encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [to, amount] }) };

  return json({
    authorization: {
      draftId: id,
      payloadHash: assessment.payloadHash,
      expiresAt,
      chainId: payload.chainId,
      from: getAddress(payload.from),
      token: MUSD.address,
      recipient: to,
      amount: amount.toString(),
      method: payload.method,
      gas: fee.gasLimit.toString(),
      maxFee: fee.maxFee.toString(),
      call,
    },
    assessment: saved,
  });
});
