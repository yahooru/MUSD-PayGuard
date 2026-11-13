import { BaseError, createPublicClient, decodeErrorResult, http, type Hex, type PublicClient } from "viem";
import { mezoTestnet, rpcUrl } from "../../config/chains";
import { musdAbi, routerAbi } from "../../config/contracts";
import { formatAmount } from "../amount";
import type { RevertInfo } from "../engine/types";

let client: PublicClient | null = null;

/** Server-side public client for Mezo Testnet. Short timeouts; callers decide how to degrade. */
export function publicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: mezoTestnet,
      transport: http(rpcUrl(), { timeout: 10_000, retryCount: 2, retryDelay: 300 }),
    }) as PublicClient;
  }
  return client;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

const ERROR_ABI = [...musdAbi.filter((x) => x.type === "error"), ...routerAbi.filter((x) => x.type === "error")];

function findRevertData(e: unknown): Hex | null {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur; i++) {
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) return data as Hex;
    if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      const inner = (data as { data: string }).data;
      if (/^0x[0-9a-fA-F]{8,}$/.test(inner)) return inner as Hex;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** Human description of a decoded custom error / revert string. */
export function humanizeRevert(data: Hex): string | null {
  try {
    const d = decodeErrorResult({ abi: ERROR_ABI, data });
    const args = (d.args ?? []) as readonly unknown[];
    switch (d.errorName as string) {
      case "Error":
        return String(args[0]);
      case "ERC20InsufficientBalance":
        return `insufficient MUSD balance (has ${formatAmount(args[1] as bigint)} MUSD, needs ${formatAmount(args[2] as bigint)} MUSD)`;
      case "ERC20InsufficientAllowance":
        return `allowance too low (approved ${formatAmount(args[1] as bigint)} MUSD, needs ${formatAmount(args[2] as bigint)} MUSD)`;
      case "ERC20InvalidReceiver":
        return "the token rejects this receiver";
      case "AlreadyPaid":
        return "PayGuardRouter already recorded this invoice reference as paid by you to this recipient";
      case "InvalidRecipient":
        return "PayGuardRouter rejects this recipient (zero address, the router, the token, or yourself)";
      case "ZeroAmount":
        return "the amount is zero";
      case "EmptyInvoiceRef":
        return "PayGuardRouter requires an invoice reference";
      case "ERC2612ExpiredSignature":
        return "the permit signature expired";
      case "ERC2612InvalidSigner":
        return "the permit signature is invalid";
      default:
        return d.errorName;
    }
  } catch {
    return null;
  }
}

/**
 * Classify an RPC error: was it an on-chain revert (with a reason when decodable)
 * or a transport problem (RPC down, timeout)? Transport problems never count as reverts.
 */
export function describeRpcError(e: unknown): RevertInfo {
  const data = findRevertData(e);
  const msg = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
  const details = e instanceof BaseError ? e.details ?? "" : "";
  const isRevert = !!data || /revert/i.test(msg) || /revert/i.test(details);
  let reason = data ? humanizeRevert(data) : null;
  if (!reason) {
    const desc = `${msg} ${details}`.match(/desc = ([^\n]+?)\.?(\s|$)/);
    reason = desc?.[1]?.trim() || null;
  }
  if (!reason) {
    const m = msg.match(/reason:\s*(.+)$/);
    reason = m?.[1]?.trim() || null;
  }
  if (!reason || reason === ".") reason = isRevert ? "execution reverted (no reason given)" : msg.slice(0, 160);
  return { reason, data: data ?? undefined, isRevert };
}

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  if (e instanceof Error) return e.message.slice(0, 200);
  return String(e).slice(0, 200);
}
