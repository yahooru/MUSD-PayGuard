import type { NextRequest } from "next/server";
import { getAddress, type Hash } from "viem";
import { z } from "zod";
import { SUPPORTED_NETWORK, explorer } from "@/config/chains";
import { ALL_ROUTER_ADDRESSES, MUSD, isPayGuardRouter } from "@/config/contracts";
import { formatAmount, parseAmountInput } from "@/lib/amount";
import { analyzeAddress, sameAddress } from "@/lib/engine/address";
import { invoiceRefHash, normalizeInvoiceRef, validateInvoiceRef } from "@/lib/invoice";
import { verifyPayment } from "@/lib/verify/receipt";
import { env } from "@/lib/server/env";
import { errorJson, ipHash, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { fetchChainState } from "@/lib/server/tx-verify";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const LIMIT = 30;
const WINDOW = 60;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const schema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "txHash must be a 0x-prefixed 32-byte hash"),
  expected: z.object({
    recipient: z.string().max(64),
    amount: z.string().max(64).optional(),
    amountBaseUnits: z.string().regex(/^\d{1,78}$/).optional(),
    from: z.string().max(64).optional().nullable(),
    invoiceRef: z.string().max(200).optional().nullable(),
  }),
});

type Input = z.infer<typeof schema>;

const VERDICT = {
  confirmed: "verified",
  mismatch: "mismatch",
  reverted: "reverted",
  awaiting_receipt: "pending",
  not_found: "not_found",
  rpc_error: "unavailable",
} as const;

const SUMMARY: Record<string, string> = {
  verified: "The transaction succeeded on Mezo Testnet and contains exactly the expected MUSD transfer.",
  mismatch: "The transaction exists but does NOT prove the expected payment. See the failing step.",
  reverted: "The transaction reverted. No MUSD was transferred.",
  pending: "The transaction is not mined yet or lacks confirmations. Do not treat it as paid.",
  not_found: "Mezo Testnet does not know this transaction hash. It may be fake, dropped, or from another network.",
  unavailable: "The network could not be reached. Nothing was concluded; try again.",
};

async function verify(req: NextRequest, input: Input) {
  const limited = await rateLimit(`v1verify:${ipHash(req, env.sessionSecret())}`, LIMIT, WINDOW);
  const rlHeaders = {
    ...CORS,
    "x-ratelimit-limit": String(limited.limit),
    "x-ratelimit-remaining": String(limited.remaining),
    "x-ratelimit-reset": String(limited.reset),
  };
  if (!limited.allowed) {
    return errorJson(429, "rate_limited", `Rate limit is ${LIMIT} requests per minute per client. Retry after the reset time.`, undefined, {
      ...rlHeaders,
      "retry-after": String(Math.max(1, limited.reset - Math.floor(Date.now() / 1000))),
    });
  }

  const recipient = analyzeAddress(input.expected.recipient);
  if (!recipient.valid) return errorJson(400, "invalid_recipient", recipient.problem ?? "Invalid recipient address.", undefined, rlHeaders);
  if (recipient.checksum === "invalid") return errorJson(400, "invalid_recipient", "Recipient address fails its EIP-55 checksum.", undefined, rlHeaders);
  let from: string | null = null;
  if (input.expected.from) {
    const f = analyzeAddress(input.expected.from);
    if (!f.valid || f.checksum === "invalid") return errorJson(400, "invalid_from", "Expected sender is not a valid address.", undefined, rlHeaders);
    from = f.lower;
  }
  let amount: bigint;
  if (input.expected.amountBaseUnits) amount = BigInt(input.expected.amountBaseUnits);
  else if (input.expected.amount) {
    const a = parseAmountInput(input.expected.amount);
    if (!a.ok) return errorJson(400, "invalid_amount", a.error, undefined, rlHeaders);
    amount = a.value;
  } else return errorJson(400, "invalid_amount", "Provide expected.amount (decimal MUSD) or expected.amountBaseUnits.", undefined, rlHeaders);
  let refHash: `0x${string}` | null = null;
  let refNorm: string | null = null;
  if (input.expected.invoiceRef) {
    const v = validateInvoiceRef(input.expected.invoiceRef);
    if (!v.ok) return errorJson(400, "invalid_invoice_ref", v.error, undefined, rlHeaders);
    refNorm = normalizeInvoiceRef(input.expected.invoiceRef);
    refHash = invoiceRefHash(input.expected.invoiceRef);
  }

  const hash = input.txHash.toLowerCase() as Hash;
  const state = await fetchChainState(hash);
  const target = state.tx?.to ?? state.receipt?.to ?? null;
  const viaRouter = isPayGuardRouter(target);
  const result = state.rpcError
    ? null
    : verifyPayment({
        expected: {
          chainId: SUPPORTED_NETWORK.chainId,
          token: MUSD.address,
          to: recipient.lower!,
          amount,
          from,
          method: "any",
          routerAddress: ALL_ROUTER_ADDRESSES,
          invoiceRefHash: viaRouter ? refHash : null,
          requiredConfirmations: SUPPORTED_NETWORK.requiredConfirmations,
        },
        tx: state.tx,
        receipt: state.receipt,
        latestBlock: state.latestBlock,
      });
  const verdict = result ? VERDICT[result.outcome] : "unavailable";
  return json(
    {
      verdict,
      verified: verdict === "verified",
      summary: SUMMARY[verdict],
      reason: result?.reason ?? `RPC unavailable: ${state.rpcError}`,
      network: { chainId: SUPPORTED_NETWORK.chainId, name: SUPPORTED_NETWORK.name },
      token: { address: MUSD.address, symbol: MUSD.expected.symbol, decimals: MUSD.expected.decimals },
      transaction: {
        hash,
        from: state.tx?.from ? getAddress(state.tx.from) : null,
        to: target ? getAddress(target) : null,
        calledContract: target ? (sameAddress(target, MUSD.address) ? "MUSD" : viaRouter ? "PayGuardRouter" : "other") : null,
        blockNumber: result?.blockNumber ?? null,
        confirmations: result?.confirmations ?? 0,
        explorerUrl: explorer.tx(hash),
      },
      expected: {
        recipient: recipient.checksummed,
        amountBaseUnits: amount.toString(),
        amount: `${formatAmount(amount, { maxFraction: 18, minFraction: 0 })} MUSD`,
        from: from ? getAddress(from) : null,
        invoiceRef: refNorm,
      },
      transfer: result?.matchedTransfer ?? null,
      transfers: result?.transfers ?? [],
      invoice: refHash
        ? {
            ref: refNorm,
            refHash,
            recordedOnChain: viaRouter ? verdict === "verified" : false,
            note: viaRouter
              ? "Checked against the PayGuardRouter InvoicePaid event in this transaction."
              : "This is a direct MUSD transfer: it carries no on-chain invoice reference, so the reference cannot be proven from the chain.",
          }
        : null,
      steps: result?.steps ?? [],
      checkedAt: new Date().toISOString(),
      disclaimer:
        "Computed live from the Mezo Testnet RPC receipt and MUSD Transfer logs. Proves what happened on-chain, not who controls the addresses.",
    },
    { headers: rlHeaders },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > 8 * 1024) return errorJson(413, "too_large", "Request body too large.", undefined, CORS);
    const parsed = schema.safeParse(text ? JSON.parse(text) : {});
    if (!parsed.success) {
      return errorJson(400, "invalid_input", "Invalid request.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })), CORS);
    }
    return await verify(req, parsed.data);
  } catch (e) {
    if (e instanceof SyntaxError) return errorJson(400, "bad_json", "Body must be JSON.", undefined, CORS);
    console.error("[v1/verify]", e);
    return errorJson(500, "internal", "Verification failed unexpectedly. Nothing was concluded.", undefined, CORS);
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const parsed = schema.safeParse({
      txHash: sp.get("txHash") ?? sp.get("tx") ?? "",
      expected: {
        recipient: sp.get("recipient") ?? sp.get("to") ?? "",
        amount: sp.get("amount") ?? undefined,
        amountBaseUnits: sp.get("amountBaseUnits") ?? undefined,
        from: sp.get("from"),
        invoiceRef: sp.get("invoiceRef") ?? sp.get("ref"),
      },
    });
    if (!parsed.success) {
      return errorJson(400, "invalid_input", "Invalid request.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })), CORS);
    }
    return await verify(req, parsed.data);
  } catch (e) {
    console.error("[v1/verify]", e);
    return errorJson(500, "internal", "Verification failed unexpectedly. Nothing was concluded.", undefined, CORS);
  }
}
