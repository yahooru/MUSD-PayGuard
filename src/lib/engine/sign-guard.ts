import { decodeFunctionData, type Hex } from "viem";
import { musdAbi } from "../../config/contracts";
import { sameAddress } from "./address";
import { payloadHash } from "./payload";
import type { PaymentPayload } from "./types";

/**
 * Final client-side gate, run immediately before the wallet is asked to sign.
 * Re-derives everything from the payload the user reviewed and refuses to continue if the
 * transaction about to be signed differs in any way (recipient, amount, token, chain, sender),
 * if the reviewed hash no longer matches, or if the wallet account/network changed.
 */
export interface SignRequest {
  reviewedPayloadHash: string;
  payload: PaymentPayload;
  account: string | undefined;
  walletChainId: number | undefined;
  expected: { chainId: number; token: string; router: string };
  call:
    | { kind: "direct"; to: string; data: Hex }
    | { kind: "router"; to: string; args: { to: string; amount: bigint; invoiceRefHash: string } ; expectedRefHash: string };
}

export function checkSignRequest(r: SignRequest): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const p = r.payload;
  if (payloadHash(p).toLowerCase() !== r.reviewedPayloadHash.toLowerCase()) problems.push("The payment no longer matches the reviewed payload hash.");
  if (!r.account || !sameAddress(r.account, p.from)) problems.push("The connected wallet account is not the account that reviewed this payment.");
  if (r.walletChainId !== r.expected.chainId || p.chainId !== r.expected.chainId) problems.push("The wallet is not on the supported network.");
  if (!sameAddress(p.token, r.expected.token)) problems.push("The token is not the configured MUSD contract.");
  const amount = BigInt(p.amount);

  if (r.call.kind === "direct") {
    if (p.method !== "direct") problems.push("Payment method changed after review.");
    if (!sameAddress(r.call.to, r.expected.token)) problems.push("The transaction would not call the MUSD contract.");
    try {
      const d = decodeFunctionData({ abi: musdAbi, data: r.call.data });
      if (d.functionName !== "transfer") problems.push("The transaction is not a plain MUSD transfer.");
      else {
        const [to, value] = d.args as readonly [string, bigint];
        if (!sameAddress(to, p.to)) problems.push("The transaction recipient differs from the reviewed recipient.");
        if (value !== amount) problems.push("The transaction amount differs from the reviewed amount.");
      }
    } catch {
      problems.push("The transaction data could not be decoded.");
    }
  } else {
    if (p.method !== "router") problems.push("Payment method changed after review.");
    if (!sameAddress(r.call.to, r.expected.router)) problems.push("The transaction would not call PayGuardRouter.");
    if (!sameAddress(r.call.args.to, p.to)) problems.push("The router recipient differs from the reviewed recipient.");
    if (r.call.args.amount !== amount) problems.push("The router amount differs from the reviewed amount.");
    if (r.call.args.invoiceRefHash.toLowerCase() !== r.call.expectedRefHash.toLowerCase()) problems.push("The invoice reference differs from the reviewed reference.");
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}
