import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

/**
 * NOTE: no private key is ever loaded here. The deploy script (scripts/deploy.ts) reads the
 * deployer key at runtime from DEPLOYER_ENV_FILE and signs with its own ethers Wallet, so
 * compile/test never need (or see) a key, and the key never lands in config, logs or artifacts.
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      hardfork: "london",
    },
    mezotestnet: {
      url: process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org",
      chainId: 31611,
      accounts: [],
    },
  },
  etherscan: {
    // Blockscout does not require an API key; hardhat-verify needs a non-empty placeholder.
    apiKey: { mezotestnet: "blockscout" },
    customChains: [
      {
        network: "mezotestnet",
        chainId: 31611,
        urls: {
          apiURL: "https://api.explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "1",
  },
};

export default config;
