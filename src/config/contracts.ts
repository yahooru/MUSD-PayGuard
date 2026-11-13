import { getAddress, type Address } from "viem";
import { MEZO_TESTNET_ID } from "./chains";

/**
 * Central contract configuration: addresses, expected on-chain properties and ABIs.
 *
 * MUSD addresses come from the official Mezo contracts reference
 * (https://mezo.org/docs/users/resources/contracts-reference) and the official
 * mezo-org/musd deployment artifacts (matsnet = Mezo testnet). They were
 * re-checked on-chain on 2026-10-26: name "Mezo USD", symbol "MUSD", 18 decimals,
 * EIP-712 domain { name: "Mezo USD", version: "1", chainId: 31611 }.
 *
 * Testnet and mainnet contracts are never interchangeable: lookups are keyed by
 * chain id and there is deliberately no fallback.
 */

export interface TokenConfig {
  chainId: number;
  address: Address;
  expected: { name: string; symbol: string; decimals: number };
  permit: { name: string; version: string };
  source: string;
}

export const MUSD_BY_CHAIN: Record<number, TokenConfig> = {
  [MEZO_TESTNET_ID]: {
    chainId: MEZO_TESTNET_ID,
    address: getAddress("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503"),
    expected: { name: "Mezo USD", symbol: "MUSD", decimals: 18 },
    permit: { name: "Mezo USD", version: "1" },
    source: "mezo.org contracts reference + github.com/mezo-org/musd deployments/matsnet/MUSD.json",
  },
};

/** Mainnet MUSD, documented for reference only. PayGuard never sends on mainnet. */
export const MUSD_MAINNET_REFERENCE = getAddress("0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186");

export function musdFor(chainId: number): TokenConfig | null {
  return MUSD_BY_CHAIN[chainId] ?? null;
}

/** The token used for every payment. Throws at import time if misconfigured. */
export const MUSD: TokenConfig = (() => {
  const t = musdFor(MEZO_TESTNET_ID);
  if (!t) throw new Error("MUSD is not configured for the supported network");
  return t;
})();

/**
 * PayGuardRouter: optional, non-custodial on-chain invoice registry.
 * pay(to, amount, invoiceRef) moves MUSD payer -> recipient with transferFrom in one
 * transaction and records the invoice reference per payer, so a second payment of the
 * same invoice reverts on-chain (from any device or app). Holds no funds, has no owner.
 */
export const PAYGUARD_ROUTER = {
  chainId: MEZO_TESTNET_ID,
  address: getAddress("0x4523152E1033F3a095A89E7AB6f85150a154B958"),
  deployTx: "0x2a22d783b8a9249a9840ec2217b351cc4614bd4c661e8df47006896479f31b07" as `0x${string}`,
  deployBlock: 16372387,
  sourceVerifiedOnExplorer: false,
} as const;

/**
 * Addresses that must never receive a payment: tokens sent here are unrecoverable
 * or are rejected by the token. Lower-cased for comparison.
 */
export const BURN_ADDRESSES: Record<string, string> = {
  "0x0000000000000000000000000000000000000000": "the zero address",
  "0x000000000000000000000000000000000000dead": "the conventional 0x…dEaD burn address",
  "0xdead000000000000000042069420694206942069": "a well-known burn address",
};

/** Known Mezo / MUSD system contracts on testnet. A payment to these is almost certainly a mistake. */
export const KNOWN_SYSTEM_CONTRACTS: Record<string, string> = {
  "0x118917a40faf1cd7a13db0ef56c86de7973ac503": "the MUSD token contract itself",
  "0xcdf7028ceab81fa0c6971208e83fa7872994bee5": "MUSD BorrowerOperations",
  "0xe47c80e8c23f6b4a1ae41c34837a0599d5d16bb0": "MUSD TroveManager",
  "0x86bcf0841622a5dac14a313a15f96a95421b9366": "MUSD PriceFeed",
  "0x1cca7e410ee41739792ea0a24e00349dd247680e": "MUSD StabilityPool",
  "0x4e4cba3779d56386ed43631b4dcd6d8eacecbcf6": "MUSD HintHelpers",
  "0x722e4d24fd6ff8b0ac679450f3d91294607268fa": "MUSD SortedTroves",
  "0xd4d6c36a592a2c5e86035a6bca1d57747a567f37": "MUSD InterestRateManager",
  "0x4523152e1033f3a095a89e7ab6f85150a154b958": "the PayGuardRouter contract (it never holds funds)",
};

/* ------------------------------------------------------------------ ABIs */

export const musdAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  { type: "error", name: "ERC20InvalidReceiver", inputs: [{ name: "receiver", type: "address" }] },
  { type: "error", name: "ERC20InvalidSender", inputs: [{ name: "sender", type: "address" }] },
  { type: "error", name: "ERC2612ExpiredSignature", inputs: [{ name: "deadline", type: "uint256" }] },
  {
    type: "error",
    name: "ERC2612InvalidSigner",
    inputs: [
      { name: "signer", type: "address" },
      { name: "owner", type: "address" },
    ],
  },
] as const;

export const routerAbi = [
  {
    type: "error",
    name: "AlreadyPaid",
    inputs: [
      { name: "payer", type: "address" },
      { name: "recipient", type: "address" },
      { name: "invoiceRef", type: "bytes32" },
    ],
  },
  { type: "error", name: "EmptyInvoiceRef", inputs: [] },
  { type: "error", name: "InvalidRecipient", inputs: [{ name: "recipient", type: "address" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroToken", inputs: [] },
  {
    type: "event",
    name: "InvoicePaid",
    anonymous: false,
    inputs: [
      { indexed: true, name: "payer", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: true, name: "invoiceRef", type: "bytes32" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "totalPaidForRef", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPayment",
    stateMutability: "view",
    inputs: [
      { name: "payer", type: "address" },
      { name: "recipient", type: "address" },
      { name: "invoiceRef", type: "bytes32" },
    ],
    outputs: [
      { name: "paid", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "paidAt", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "isPaid",
    stateMutability: "view",
    inputs: [
      { name: "payer", type: "address" },
      { name: "recipient", type: "address" },
      { name: "invoiceRef", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "invoiceRef", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "payWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "invoiceRef", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "totalPaidTo",
    stateMutability: "view",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "invoiceRef", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "paymentCountTo",
    stateMutability: "view",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "invoiceRef", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

/* --------------------------------------------------------------- Gas policy */

/**
 * Mezo testnet enforces the EIP-7623 calldata floor and the public RPC has been seen
 * returning implausibly low estimates (21,644 gas for a transfer that costs ~51,700).
 * PayGuard therefore always sends an explicit gas limit:
 *   gas = max(estimate * 13 / 10, floor)
 * and treats estimates below `implausibleBelow` as invalid.
 * Note: Mezo charges at least half of the gas limit, so the displayed fee is a
 * conservative maximum, not the exact amount that will be charged.
 */
export const GAS_POLICY = {
  erc20Transfer: { floor: 90_000n, implausibleBelow: 30_000n },
  erc20Approve: { floor: 90_000n, implausibleBelow: 30_000n },
  routerPay: { floor: 250_000n, implausibleBelow: 60_000n },
  routerPayWithPermit: { floor: 300_000n, implausibleBelow: 60_000n },
  bufferNumerator: 13n,
  bufferDenominator: 10n,
} as const;

export type GasKind = keyof Omit<typeof GAS_POLICY, "bufferNumerator" | "bufferDenominator">;

export function gasLimitFor(kind: GasKind, estimate: bigint | null | undefined): { gas: bigint; estimateUsable: boolean } {
  const policy = GAS_POLICY[kind];
  const usable = estimate != null && estimate >= policy.implausibleBelow;
  const buffered = usable ? (estimate * GAS_POLICY.bufferNumerator) / GAS_POLICY.bufferDenominator : 0n;
  return { gas: buffered > policy.floor ? buffered : policy.floor, estimateUsable: usable };
}
