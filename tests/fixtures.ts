import { BURN_ADDRESSES, KNOWN_SYSTEM_CONTRACTS, MUSD } from "@/config/contracts";
import { MEZO_TESTNET, explorer } from "@/config/chains";
import type { EngineConfig, PreflightContext } from "@/lib/engine";

export const ALICE = "0x9F112Fbf7440a7D8031F72c99e25C179D77f0AB4";
export const BOB = "0x6c85c0358EE1eDe03c1820DeeA006E1b2f09f631";
export const CAROL = "0x242097EC010825a937cE0644c1DeF52bda2FcC5e";
/** Shares the first 4 and last 4 hex characters with BOB but is a different address. */
export const BOB_LOOKALIKE = `0x6c85${"a".repeat(32)}f631`;
export const ONE = 10n ** 18n;
export const NOW = Date.parse("2026-10-26T12:00:00Z");

export const engineConfig: EngineConfig = {
  chainId: MEZO_TESTNET.chainId,
  chainName: MEZO_TESTNET.name,
  token: { address: MUSD.address, ...MUSD.expected },
  burnAddresses: BURN_ADDRESSES,
  systemContracts: KNOWN_SYSTEM_CONTRACTS,
  explorerTx: explorer.tx,
  explorerAddress: explorer.address,
};

/** A context where every check passes, except first-time recipient (bob is saved, so that passes too). */
export function baseContext(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    payload: {
      chainId: MEZO_TESTNET.chainId,
      token: MUSD.address,
      from: ALICE,
      to: BOB,
      amount: (2n * ONE).toString(),
      invoiceRef: "INV-1001",
      method: "direct",
      requestId: null,
    },
    now: NOW,
    config: engineConfig,
    wallet: { connectedChainId: MEZO_TESTNET.chainId },
    token: { ok: true, source: "rpc", value: { hasCode: true, name: "Mezo USD", symbol: "MUSD", decimals: 18 } },
    balances: { ok: true, source: "rpc", value: { musd: 150n * ONE, native: 300_000_000_000_000n } },
    recipientCode: { ok: true, source: "rpc", value: { code: null } },
    fee: {
      ok: true,
      source: "rpc",
      value: { estimate: 52_000n, gasLimit: 90_000n, estimateUsable: true, maxFeePerGas: 200n, maxFee: 18_000_000n },
    },
    simulation: { ok: true, source: "rpc", value: { success: true, returned: true, blockNumber: "16372312" } },
    savedRecipients: [{ id: "rec-bob", label: "Bob", address: BOB, createdAt: "2026-10-20T10:00:00Z" }],
    selectedRecipientId: "rec-bob",
    history: [],
    counterparties: { ok: true, source: "explorer", value: [] },
    request: null,
    onchainInvoice: null,
    reviewedPayloadHash: null,
    ...overrides,
  };
}

export function withPayload(patch: Partial<PreflightContext["payload"]>, overrides: Partial<PreflightContext> = {}): PreflightContext {
  const ctx = baseContext(overrides);
  return { ...ctx, payload: { ...ctx.payload, ...patch } };
}
