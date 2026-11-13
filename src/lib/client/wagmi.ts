"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { MEZO_TESTNET, mezoTestnet } from "@/config/chains";

/**
 * Wallet connectivity: injected wallets discovered through EIP-6963 (MetaMask, Rabby, OKX, …)
 * plus a generic injected fallback. Only Mezo Testnet is configured, so wagmi refuses to send
 * a transaction while the wallet is on any other chain.
 */
export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [mezoTestnet.id]: http(MEZO_TESTNET.rpcUrl, { timeout: 12_000, retryCount: 2 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
