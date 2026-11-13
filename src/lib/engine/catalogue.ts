import type { CheckGroup, CheckId } from "./types";

/**
 * The documented check catalogue. Every check the engine can emit is listed here with
 * the rule it applies, so every result in the UI can link back to a written rule.
 * The README and the Security Centre render this table.
 */
export interface CatalogueEntry {
  id: CheckId;
  group: CheckGroup;
  title: string;
  rule: string;
  /** What is checked, in one sentence. */
  checks: string;
  /** Outcome rules: what produces pass / warn / fail / unavailable. */
  outcomes: string;
  /** Essential checks fail safe: if they cannot run, sending is blocked. */
  essential: boolean;
  sources: string;
}

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  recipient: "Recipient",
  network: "Network",
  token: "Token",
  funds: "Balance and fees",
  simulation: "Simulation",
  duplicates: "Duplicate protection",
  request: "Payment request",
  integrity: "Review integrity",
};

export const CATALOGUE: CatalogueEntry[] = [
  {
    id: "recipient.format",
    group: "recipient",
    title: "Address format",
    rule: "R-REC-01",
    checks: "The recipient is a syntactically valid 20-byte EVM address with no hidden characters.",
    outcomes:
      "Fail: empty, missing 0x, wrong length, non-hex characters, invisible/bidi characters, or a name instead of an address. Pass otherwise. A valid format never proves who owns the address.",
    essential: true,
    sources: "Input only",
  },
  {
    id: "recipient.checksum",
    group: "recipient",
    title: "Checksum (EIP-55)",
    rule: "R-REC-02",
    checks: "Mixed-case addresses must match their EIP-55 checksum, which catches most single-character typos.",
    outcomes:
      "Fail: mixed case with an invalid checksum (likely typo or tampering). Pass: valid checksum. Not performed: all lower/upper case (no checksum present).",
    essential: false,
    sources: "Input only",
  },
  {
    id: "recipient.destination",
    group: "recipient",
    title: "Unrecoverable destinations",
    rule: "R-REC-03",
    checks: "The recipient is not the zero/burn address, the MUSD token contract or another MUSD system contract.",
    outcomes: "Fail: any match (funds would be lost or the token rejects the transfer). Pass otherwise.",
    essential: false,
    sources: "Central contract config",
  },
  {
    id: "recipient.self",
    group: "recipient",
    title: "Self-transfer",
    rule: "R-REC-04",
    checks: "The recipient is not the sending wallet.",
    outcomes: "Warn (medium): sending to yourself costs gas and changes nothing. Pass otherwise.",
    essential: false,
    sources: "Input + connected wallet",
  },
  {
    id: "recipient.contract",
    group: "recipient",
    title: "Recipient type",
    rule: "R-REC-05",
    checks: "Reads eth_getCode to tell a wallet (EOA) from a smart contract.",
    outcomes:
      "Warn (medium): recipient is a contract that may not be able to move MUSD back out. Warn (low): EIP-7702 delegated account. Pass: plain account. Not performed: RPC unavailable.",
    essential: false,
    sources: "Mezo RPC eth_getCode",
  },
  {
    id: "recipient.book",
    group: "recipient",
    title: "Saved recipient match",
    rule: "R-REC-06",
    checks: "Compares the address with your recipient book and with the contact you selected.",
    outcomes:
      "Warn (critical): differs from the address saved for the selected contact. Warn (high): the address is saved under a different contact than the one selected. Pass: matches a saved entry or nothing to compare. Saved means you saved it, not that it is verified.",
    essential: false,
    sources: "Your recipient book",
  },
  {
    id: "recipient.lookalike",
    group: "recipient",
    title: "Lookalike / address poisoning",
    rule: "R-REC-07",
    checks:
      "Looks for a saved recipient, a past payee or an on-chain counterparty whose address shares the first and last characters but is different.",
    outcomes:
      "Warn (critical): ≥4 leading and ≥4 trailing characters match a known address, or the address first appeared as a zero-value/dust transfer to you. Warn (high): ≥3+3 characters (≥7 total) match. Pass: no lookalike among the compared addresses.",
    essential: false,
    sources: "Recipient book, PayGuard history, Mezo explorer token transfers",
  },
  {
    id: "recipient.first_time",
    group: "recipient",
    title: "First-time recipient",
    rule: "R-REC-08",
    checks: "Whether you have paid this address before through PayGuard or saved it.",
    outcomes: "Warn (low): never paid and not saved. Pass: saved or previously paid (with count and date).",
    essential: false,
    sources: "PayGuard history, recipient book",
  },
  {
    id: "recipient.explorer_flags",
    group: "recipient",
    title: "Explorer labels",
    rule: "R-REC-09",
    checks: "Reads public labels for the address from the Mezo block explorer (Blockscout).",
    outcomes:
      "Warn (high): the explorer marks the address as a scam. Pass: no negative label. Not performed: explorer unavailable. PayGuard reports the label as the explorer's claim, not its own finding.",
    essential: false,
    sources: "Mezo explorer API",
  },
  {
    id: "network.wallet",
    group: "network",
    title: "Wallet network",
    rule: "R-NET-01",
    checks: "The connected wallet is on Mezo Testnet (chain 31611).",
    outcomes: "Fail: any other chain. Not performed (blocks): network unknown. Pass: chain 31611.",
    essential: true,
    sources: "Connected wallet",
  },
  {
    id: "network.payment",
    group: "network",
    title: "Payment network",
    rule: "R-NET-02",
    checks: "The payment is being built for the configured network.",
    outcomes: "Fail: payload chain differs from the configured network. Pass otherwise.",
    essential: true,
    sources: "Central network config",
  },
  {
    id: "token.config",
    group: "token",
    title: "Token contract",
    rule: "R-TOK-01",
    checks: "The token address equals the MUSD address in the verified central configuration for this chain.",
    outcomes: "Fail: any other address, even if it is called MUSD. Pass: exact match.",
    essential: true,
    sources: "Central contract config (official Mezo docs)",
  },
  {
    id: "token.onchain",
    group: "token",
    title: "Token properties on-chain",
    rule: "R-TOK-02",
    checks: "Reads code, name, symbol and decimals from the token contract and compares them with expected values.",
    outcomes: "Fail: no code or any property differs. Not performed (blocks): unreadable. Pass: all match.",
    essential: true,
    sources: "Mezo RPC",
  },
  {
    id: "funds.amount",
    group: "funds",
    title: "Amount",
    rule: "R-FND-01",
    checks: "The amount is a positive whole number of base units within uint256.",
    outcomes: "Fail: zero, negative or unparseable. Pass otherwise.",
    essential: true,
    sources: "Input",
  },
  {
    id: "funds.balance",
    group: "funds",
    title: "MUSD balance",
    rule: "R-FND-02",
    checks: "Your live MUSD balance covers the amount.",
    outcomes: "Fail: balance below amount. Not performed (blocks): balance unreadable. Pass otherwise.",
    essential: true,
    sources: "Mezo RPC balanceOf",
  },
  {
    id: "funds.gas",
    group: "funds",
    title: "BTC for network fee",
    rule: "R-FND-03",
    checks: "Your native BTC balance covers the maximum network fee (gas limit × max fee per gas).",
    outcomes:
      "Fail: zero BTC or less than the maximum fee. Not performed: fee unknown (balance shown). Pass otherwise. MUSD cannot pay gas.",
    essential: false,
    sources: "Mezo RPC eth_getBalance, fee estimate",
  },
  {
    id: "funds.anomaly",
    group: "funds",
    title: "Amount compared with your history",
    rule: "R-FND-04",
    checks: "Compares the amount with your confirmed PayGuard payments.",
    outcomes:
      "Warn (medium): ≥5× your median payment and above your largest (≥10× suggests an extra zero). Not performed: fewer than 3 confirmed payments. Pass otherwise.",
    essential: false,
    sources: "PayGuard history",
  },
  {
    id: "simulation.estimate",
    group: "simulation",
    title: "Gas estimate",
    rule: "R-SIM-01",
    checks: "eth_estimateGas for the exact transaction.",
    outcomes:
      "Fail: the node reports the transaction would revert. Warn (low): implausibly low estimate (a safe floor is used instead). Not performed: RPC error. Pass otherwise.",
    essential: false,
    sources: "Mezo RPC eth_estimateGas",
  },
  {
    id: "simulation.call",
    group: "simulation",
    title: "Transaction simulation",
    rule: "R-SIM-02",
    checks: "eth_call of the exact transfer from your address at the latest block.",
    outcomes:
      "Fail: reverts or returns false (reason decoded when known). Not performed: RPC error. Pass: succeeded — which does not guarantee the real transaction will.",
    essential: false,
    sources: "Mezo RPC eth_call",
  },
  {
    id: "duplicates.reference",
    group: "duplicates",
    title: "Payment reference",
    rule: "R-DUP-01",
    checks: "Whether the payment carries an invoice or payment reference.",
    outcomes: "Not performed (low): no reference, so invoice-level duplicate detection cannot run. Pass otherwise.",
    essential: false,
    sources: "Input",
  },
  {
    id: "duplicates.invoice_paid",
    group: "duplicates",
    title: "Reference already paid",
    rule: "R-DUP-02",
    checks: "Looks for a confirmed payment with the same normalised reference.",
    outcomes: "Warn (high): match found (inspect the earlier payment). Pass: no confirmed match.",
    essential: false,
    sources: "PayGuard history",
  },
  {
    id: "duplicates.invoice_pending",
    group: "duplicates",
    title: "Reference in a pending payment",
    rule: "R-DUP-03",
    checks: "Looks for a pending, delayed or unknown payment with the same reference.",
    outcomes: "Warn (high): match found — wait for it to resolve. Pass otherwise.",
    essential: false,
    sources: "PayGuard history",
  },
  {
    id: "duplicates.onchain_registry",
    group: "duplicates",
    title: "On-chain invoice registry",
    rule: "R-DUP-04",
    checks: "Asks PayGuardRouter whether you already paid this reference to this recipient on-chain.",
    outcomes:
      "Warn (high): recorded as paid on-chain (from any device or app). Not performed: RPC error. Pass: not recorded.",
    essential: false,
    sources: "PayGuardRouter.getPayment",
  },
  {
    id: "duplicates.similar_recent",
    group: "duplicates",
    title: "Similar recent payment",
    rule: "R-DUP-05",
    checks: "Same recipient and same amount, pending in the last hour or confirmed in the last 7 days.",
    outcomes:
      "Warn (high): an identical payment is still pending. Warn (medium): an identical payment was confirmed recently. Pass otherwise. Recurring identical payments are legitimate, so this never blocks.",
    essential: false,
    sources: "PayGuard history",
  },
  {
    id: "request.status",
    group: "request",
    title: "Request status",
    rule: "R-REQ-01",
    checks: "The payment request is still open.",
    outcomes: "Warn (high): already paid or cancelled. Pass: open.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "request.expiry",
    group: "request",
    title: "Request expiry",
    rule: "R-REQ-02",
    checks: "The request has not passed its expiry date.",
    outcomes: "Warn (high): expired. Pass: not expired or no expiry.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "request.recipient",
    group: "request",
    title: "Recipient matches request",
    rule: "R-REQ-03",
    checks: "The payment goes to the address in the request.",
    outcomes: "Warn (critical): different address. Pass: identical.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "request.amount",
    group: "request",
    title: "Amount matches request",
    rule: "R-REQ-04",
    checks: "The payment amount equals the requested amount.",
    outcomes: "Warn (high): different amount (difference shown). Pass: identical.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "request.network",
    group: "request",
    title: "Request network",
    rule: "R-REQ-05",
    checks: "The request names the supported network.",
    outcomes: "Fail: other network. Pass: supported network.",
    essential: false,
    sources: "PayGuard requests + network config",
  },
  {
    id: "request.token",
    group: "request",
    title: "Request token",
    rule: "R-REQ-06",
    checks: "The request names the configured MUSD contract.",
    outcomes: "Fail: any other token address. Pass: configured MUSD.",
    essential: false,
    sources: "PayGuard requests + contract config",
  },
  {
    id: "request.reference",
    group: "request",
    title: "Reference matches request",
    rule: "R-REQ-07",
    checks: "The payment reference equals the request's invoice reference.",
    outcomes: "Warn (medium): differs. Pass: identical after normalisation.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "request.creator",
    group: "request",
    title: "Request creator",
    rule: "R-REQ-08",
    checks: "Shows which wallet created the request (proved by signature at creation).",
    outcomes:
      "Warn (low): pays out to an address other than the creator's wallet. Pass otherwise. A valid request never proves the requester is legitimate.",
    essential: false,
    sources: "PayGuard requests",
  },
  {
    id: "integrity.payload",
    group: "integrity",
    title: "Details unchanged since review",
    rule: "R-INT-01",
    checks: "The exact payment about to be signed hashes to the payload you reviewed.",
    outcomes: "Fail: anything changed after review. Pass: identical (hash shown).",
    essential: true,
    sources: "Payload hash (keccak256)",
  },
];

export const CATALOGUE_BY_ID: Record<CheckId, CatalogueEntry> = Object.fromEntries(
  CATALOGUE.map((c) => [c.id, c]),
) as Record<CheckId, CatalogueEntry>;

export const RISK_RULES = [
  {
    id: "R-CAT-1",
    text: "Any check with status fail → High risk, sending blocked.",
  },
  {
    id: "R-CAT-2",
    text: "Any essential check that could not be performed → sending blocked (fail safe); category at least Caution.",
  },
  {
    id: "R-CAT-3",
    text: "Any warning of high or critical severity → High risk; each such warning must be acknowledged before signing.",
  },
  {
    id: "R-CAT-4",
    text: "Any other warning (low/medium), or a non-essential check of medium+ severity that could not be performed → Caution.",
  },
  {
    id: "R-CAT-5",
    text: "Otherwise → Low observed risk. This never means the payment is guaranteed safe.",
  },
] as const;
