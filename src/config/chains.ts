import { defineChain, type Chain } from "viem";

/**
 * Central, validated network configuration.
 *
 * Every chain id, RPC URL and explorer URL used anywhere in PayGuard comes from
 * this module. Nothing else in the codebase hard-codes network details.
 * Values were checked against https://mezo.org/docs/developers/getting-started/
 * and the live RPC (eth_chainId = 0x7b7b) before deployment.
 */

export const MEZO_TESTNET_ID = 31611 as const;
export const MEZO_MAINNET_ID = 31612 as const;

export interface NetworkConfig {
  chainId: number;
  hexChainId: `0x${string}`;
  name: string;
  shortName: string;
  isTestnet: boolean;
  rpcUrl: string;
  wsUrl?: string;
  explorerUrl: string;
  explorerApiUrl: string;
  faucetUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Confirmations required before a payment can be shown as confirmed. */
  requiredConfirmations: number;
  /** Client-side receipt polling cadence while a payment page is open. */
  receiptPollMs: number;
  /** How long a submitted hash may be missing from the node before it is reported as "unknown". */
  missingTxGraceMs: number;
}

export const MEZO_TESTNET: NetworkConfig = {
  chainId: MEZO_TESTNET_ID,
  hexChainId: "0x7b7b",
  name: "Mezo Testnet",
  shortName: "mezo-testnet",
  isTestnet: true,
  rpcUrl: "https://rpc.test.mezo.org",
  wsUrl: "wss://rpc-ws.test.mezo.org",
  explorerUrl: "https://explorer.test.mezo.org",
  explorerApiUrl: "https://api.explorer.test.mezo.org/api/v2",
  faucetUrl: "https://faucet.test.mezo.org/",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  requiredConfirmations: 1,
  receiptPollMs: 4000,
  missingTxGraceMs: 15 * 60 * 1000,
};

/** The single network PayGuard will construct or send payments on. */
export const SUPPORTED_NETWORK = MEZO_TESTNET;
export const SUPPORTED_CHAIN_IDS: readonly number[] = [MEZO_TESTNET_ID];

/** Chains a wallet might be on that we can name in error messages (never used to send). */
export const KNOWN_CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  10: "OP Mainnet",
  56: "BNB Smart Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum One",
  11155111: "Sepolia",
  [MEZO_TESTNET_ID]: "Mezo Testnet",
  [MEZO_MAINNET_ID]: "Mezo Mainnet",
};

export function chainName(chainId: number | undefined | null): string {
  if (chainId == null) return "Unknown network";
  return KNOWN_CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

export function isSupportedChain(chainId: number | undefined | null): boolean {
  return chainId != null && SUPPORTED_CHAIN_IDS.includes(chainId);
}

export function rpcUrl(): string {
  // Server may override (e.g. a private RPC); the browser always uses the public endpoint.
  if (typeof process !== "undefined" && process.env?.MEZO_RPC_URL) return process.env.MEZO_RPC_URL;
  return MEZO_TESTNET.rpcUrl;
}

export const mezoTestnet: Chain = defineChain({
  id: MEZO_TESTNET.chainId,
  name: MEZO_TESTNET.name,
  nativeCurrency: MEZO_TESTNET.nativeCurrency,
  rpcUrls: {
    default: { http: [MEZO_TESTNET.rpcUrl], webSocket: MEZO_TESTNET.wsUrl ? [MEZO_TESTNET.wsUrl] : undefined },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: MEZO_TESTNET.explorerUrl, apiUrl: MEZO_TESTNET.explorerApiUrl },
  },
  testnet: true,
});

export const explorer = {
  tx: (hash: string) => `${SUPPORTED_NETWORK.explorerUrl}/tx/${hash}`,
  address: (address: string) => `${SUPPORTED_NETWORK.explorerUrl}/address/${address}`,
  token: (address: string) => `${SUPPORTED_NETWORK.explorerUrl}/token/${address}`,
  block: (n: number | bigint | string) => `${SUPPORTED_NETWORK.explorerUrl}/block/${n.toString()}`,
};

/** Parameters for wallet_addEthereumChain. */
export const addChainParams = {
  chainId: MEZO_TESTNET.hexChainId,
  chainName: MEZO_TESTNET.name,
  nativeCurrency: MEZO_TESTNET.nativeCurrency,
  rpcUrls: [MEZO_TESTNET.rpcUrl],
  blockExplorerUrls: [MEZO_TESTNET.explorerUrl],
};
