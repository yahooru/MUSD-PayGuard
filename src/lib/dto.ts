import type { Assessment, PaymentMethod, PaymentPayload } from "./engine/types";
import type { DraftStatus, TxStatus } from "./engine/status";
import type { VerificationResult } from "./verify/receipt";

/** JSON shapes returned by the PayGuard API. Amounts are base-unit decimal strings. */

export interface RecipientDTO {
  id: string;
  label: string;
  address: string;
  chainId: number;
  notes: string | null;
  verificationNote: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentsCount: number;
  lastPaidAt: string | null;
}

export interface DraftDTO {
  id: string;
  from: string;
  recipientInput: string;
  amount: string;
  tokenAddress: string;
  chainId: number;
  invoiceRef: string | null;
  note: string | null;
  method: PaymentMethod;
  requestId: string | null;
  selectedRecipientId: string | null;
  status: DraftStatus;
  payloadHash: string | null;
  createdAt: string;
  updatedAt: string;
  payload: PaymentPayload;
  transactionId: string | null;
}

export interface AssessmentDTO extends Assessment {
  id: string;
  purpose: "review" | "authorize";
  createdAt: string;
  fee: { gasLimit: string; maxFeePerGas: string; maxFee: string; estimate: string | null } | null;
}

export interface TransactionDTO {
  id: string;
  draftId: string;
  txHash: string;
  chainId: number;
  from: string;
  recipient: string;
  recipientLabel: string | null;
  token: string;
  amount: string;
  invoiceRef: string | null;
  method: PaymentMethod;
  requestId: string | null;
  assessmentId: string | null;
  riskCategory: "low" | "caution" | "high" | null;
  acknowledgements: string[];
  gasLimit: string | null;
  status: TxStatus;
  statusReason: string | null;
  blockNumber: string | null;
  confirmations: number | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  verification: VerificationResult | null;
  submittedAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  checkAttempts: number;
}

export interface RequestDTO {
  id: string;
  creator: string;
  recipient: string;
  payer: string | null;
  amount: string;
  token: string;
  chainId: number;
  invoiceRef: string | null;
  description: string | null;
  expiresAt: string | null;
  status: "open" | "paid" | "cancelled";
  paidTxId: string | null;
  createdAt: string;
  isMine: boolean;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
