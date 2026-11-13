/**
 * Types for the PayGuard preflight engine.
 *
 * The engine is a pure function of a fully-gathered context: it performs no I/O,
 * reads no clock (time is passed in) and has no UI dependencies. The same module
 * runs in the browser, in API routes, in the public verification API and in tests.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "unavailable";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type CheckGroup =
  | "recipient"
  | "network"
  | "token"
  | "funds"
  | "simulation"
  | "duplicates"
  | "request"
  | "integrity";

/**
 * How a finding should be read. The spec requires these three to be distinguishable:
 *  - technical_failure: a confirmed, objective problem (status "fail")
 *  - suspicious_pattern: evidence that deserves review but is not proof (status "warn")
 *  - not_performed: the check could not run, so it proves nothing either way (status "unavailable")
 */
export type FindingClass = "ok" | "technical_failure" | "suspicious_pattern" | "not_performed";

export type CheckId =
  | "recipient.format"
  | "recipient.checksum"
  | "recipient.destination"
  | "recipient.self"
  | "recipient.contract"
  | "recipient.book"
  | "recipient.lookalike"
  | "recipient.first_time"
  | "recipient.explorer_flags"
  | "network.wallet"
  | "network.payment"
  | "token.config"
  | "token.onchain"
  | "funds.amount"
  | "funds.balance"
  | "funds.gas"
  | "funds.anomaly"
  | "simulation.estimate"
  | "simulation.call"
  | "duplicates.reference"
  | "duplicates.invoice_paid"
  | "duplicates.invoice_pending"
  | "duplicates.onchain_registry"
  | "duplicates.similar_recent"
  | "request.status"
  | "request.expiry"
  | "request.recipient"
  | "request.amount"
  | "request.network"
  | "request.token"
  | "request.reference"
  | "request.creator"
  | "integrity.payload";

export type EvidenceKind = "address" | "hash" | "amount" | "text" | "number" | "time" | "chain";

export interface Evidence {
  label: string;
  value: string;
  kind?: EvidenceKind;
  href?: string;
}

export interface RelatedRecord {
  kind: "transaction" | "request" | "recipient";
  id: string;
  label: string;
}

export interface CheckResult {
  id: CheckId;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  severity: Severity;
  findingClass: FindingClass;
  /** True when this result prevents the normal send flow. */
  blocking: boolean;
  /** True when the user must explicitly acknowledge this finding before signing. */
  requiresAcknowledgement: boolean;
  /** Essential checks fail safe: if they cannot be performed, sending is blocked. */
  essential: boolean;
  evidence: Evidence[];
  explanation: string;
  recommendation: string;
  /** Documented rule that produced this outcome (see catalogue.ts / README). */
  rule: string;
  related?: RelatedRecord[];
}

export type RiskCategory = "low" | "caution" | "high";
export type Decision = "proceed" | "acknowledge" | "blocked";

export interface Assessment {
  engineVersion: string;
  evaluatedAt: string;
  payloadHash: `0x${string}`;
  category: RiskCategory;
  categoryLabel: string;
  decision: Decision;
  /** Rule ids from risk.ts that determined category and decision. */
  decisionRules: string[];
  checks: CheckResult[];
  counts: Record<CheckStatus, number>;
  blockers: CheckId[];
  acknowledgementsRequired: CheckId[];
  notPerformed: CheckId[];
  summary: string;
  nextAction: string;
}

/* ------------------------------------------------------------------ Inputs */

export type PaymentMethod = "direct" | "router";

/** The exact payment that will be signed. Hashed to detect changes after review. */
export interface PaymentPayload {
  chainId: number;
  token: string;
  from: string;
  /** Recipient exactly as entered (validated by the engine, not before). */
  to: string;
  /** Base units, decimal string (bigint-safe). */
  amount: string;
  invoiceRef: string | null;
  method: PaymentMethod;
  requestId: string | null;
}

export type Observation<T> =
  | { ok: true; value: T; source: string; at?: string }
  | { ok: false; error: string; source: string; at?: string };

export interface RevertInfo {
  /** Decoded reason, e.g. "ERC20InsufficientBalance" or a revert string. */
  reason: string;
  /** Raw revert data if any. */
  data?: string;
  /** True when the node reported an execution revert (as opposed to a transport error). */
  isRevert: boolean;
}

export interface TokenObservation {
  hasCode: boolean;
  name: string;
  symbol: string;
  decimals: number;
}

export interface FeeObservation {
  /** Raw eth_estimateGas result, null if the call failed. */
  estimate: bigint | null;
  estimateError?: RevertInfo;
  /** Gas limit PayGuard will send with (explicit, floored). */
  gasLimit: bigint;
  estimateUsable: boolean;
  maxFeePerGas: bigint;
  /** gasLimit * maxFeePerGas: the most the network fee can be. */
  maxFee: bigint;
}

export interface SimulationObservation {
  success: boolean;
  blockNumber?: string;
  returned?: boolean | null;
  revert?: RevertInfo;
  /** Describes what exactly was simulated when it is not the literal final transaction. */
  note?: string;
}

export interface SavedRecipient {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  notes?: string | null;
}

export type HistoryStatus = "pending" | "confirmed" | "failed" | "verification_delayed" | "unknown";

export interface HistoryEntry {
  id: string;
  to: string;
  amount: string;
  invoiceRefNorm: string | null;
  status: HistoryStatus;
  submittedAt: string;
  txHash: string;
}

export interface Counterparty {
  address: string;
  direction: "in" | "out";
  value: string;
  timestamp: string;
  txHash: string;
  isScam?: boolean;
}

export interface ExplorerAddressInfo {
  isScam: boolean;
  isContract: boolean;
  name: string | null;
  publicTags: string[];
}

export interface RequestSnapshot {
  id: string;
  creator: string;
  recipient: string;
  amount: string;
  token: string;
  chainId: number;
  invoiceRef: string | null;
  description: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "open" | "paid" | "cancelled";
  paidTxId: string | null;
}

export interface OnchainInvoiceObservation {
  paid: boolean;
  amount: string;
  blockNumber: string;
}

export interface EngineConfig {
  chainId: number;
  chainName: string;
  token: { address: string; name: string; symbol: string; decimals: number };
  /** Lower-cased address -> description. */
  burnAddresses: Record<string, string>;
  systemContracts: Record<string, string>;
  explorerTx: (hash: string) => string;
  explorerAddress: (address: string) => string;
}

export interface PreflightContext {
  payload: PaymentPayload;
  /** Unix ms. Passed in so the engine stays deterministic. */
  now: number;
  config: EngineConfig;
  wallet: { connectedChainId: number | null };
  token: Observation<TokenObservation>;
  balances: Observation<{ musd: bigint; native: bigint }>;
  recipientCode: Observation<{ code: string | null }>;
  fee: Observation<FeeObservation>;
  simulation: Observation<SimulationObservation>;
  savedRecipients: SavedRecipient[];
  selectedRecipientId?: string | null;
  history: HistoryEntry[];
  counterparties: Observation<Counterparty[]>;
  explorerInfo?: Observation<ExplorerAddressInfo>;
  request?: RequestSnapshot | null;
  onchainInvoice?: Observation<OnchainInvoiceObservation> | null;
  /** Hash of the payload the user reviewed (set when re-verifying right before signing). */
  reviewedPayloadHash?: string | null;
}
