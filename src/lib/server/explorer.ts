import { SUPPORTED_NETWORK } from "../../config/chains";
import { MUSD } from "../../config/contracts";
import type { Counterparty, ExplorerAddressInfo, Observation } from "../engine/types";

/**
 * Read-only access to the Mezo Blockscout API. Used for address-poisoning detection
 * (on-chain counterparties) and public labels. Every failure degrades to an
 * "unavailable" observation; nothing here can make a check pass on its own.
 */
const SOURCE = "Mezo explorer API (Blockscout)";

async function getJson(path: string, timeoutMs = 5000): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPPORTED_NETWORK.explorerApiUrl}${path}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

interface BsAddress {
  hash: string;
  is_scam?: boolean;
  is_contract?: boolean;
  name?: string | null;
  public_tags?: { display_name?: string; label?: string }[];
}
interface BsTransfer {
  from: BsAddress;
  to: BsAddress;
  total?: { value?: string };
  timestamp?: string;
  transaction_hash?: string;
  tx_hash?: string;
}

export async function fetchCounterparties(user: string): Promise<Observation<Counterparty[]>> {
  try {
    const { status, body } = await getJson(
      `/addresses/${user}/token-transfers?type=ERC-20&token=${MUSD.address}`,
    );
    if (status === 404) return { ok: true, value: [], source: SOURCE };
    if (status !== 200 || !body || typeof body !== "object") return { ok: false, error: `HTTP ${status}`, source: SOURCE };
    const items = ((body as { items?: BsTransfer[] }).items ?? []).slice(0, 100);
    const lower = user.toLowerCase();
    const out: Counterparty[] = [];
    for (const it of items) {
      const from = it.from?.hash ?? "";
      const outgoing = from.toLowerCase() === lower;
      const other = outgoing ? it.to : it.from;
      if (!other?.hash) continue;
      out.push({
        address: other.hash,
        direction: outgoing ? "out" : "in",
        value: it.total?.value ?? "0",
        timestamp: it.timestamp ?? "",
        txHash: it.transaction_hash ?? it.tx_hash ?? "",
        isScam: !!other.is_scam,
      });
    }
    return { ok: true, value: out, source: SOURCE };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed", source: SOURCE };
  }
}

export async function fetchAddressInfo(address: string): Promise<Observation<ExplorerAddressInfo>> {
  try {
    const { status, body } = await getJson(`/addresses/${address}`);
    if (status === 404) return { ok: true, value: { isScam: false, isContract: false, name: null, publicTags: [] }, source: SOURCE };
    if (status !== 200 || !body) return { ok: false, error: `HTTP ${status}`, source: SOURCE };
    const b = body as BsAddress;
    return {
      ok: true,
      source: SOURCE,
      value: {
        isScam: !!b.is_scam,
        isContract: !!b.is_contract,
        name: b.name ?? null,
        publicTags: (b.public_tags ?? []).map((t) => t.display_name ?? t.label ?? "").filter(Boolean),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed", source: SOURCE };
  }
}

export async function fetchTokenHolders(): Promise<number | null> {
  try {
    const { status, body } = await getJson(`/tokens/${MUSD.address}`, 4000);
    if (status !== 200 || !body) return null;
    const h = Number((body as { holders?: string; holders_count?: string }).holders ?? (body as { holders_count?: string }).holders_count);
    return Number.isFinite(h) ? h : null;
  } catch {
    return null;
  }
}
