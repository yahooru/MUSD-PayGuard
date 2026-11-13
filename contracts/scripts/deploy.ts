/**
 * Deploys PayGuardRouter to Mezo testnet (chainId 31611).
 *
 *   npx hardhat run scripts/deploy.ts --network mezotestnet
 *
 * Security:
 *  - The deployer key is read AT RUNTIME from DEPLOYER_ENV_FILE (default: contracts/.env.deployer,
 *    which is git-ignored; line `PRIVATE_KEY=<hex>`). It is never logged, written to disk, or placed
 *    in Hardhat config.
 *  - The previous deployment record is kept under `previousDeployments`, so receipts for payments
 *    made through an earlier router can still be verified.
 *  - Explicit gas limit on every write (Mezo enforces the EIP-7623 calldata floor and the public RPC
 *    has returned bogus low estimates): gas = max(estimate * 1.3, 1_500_000); estimates < 30k are ignored.
 *  - Nonce-safe retries: the same deployer is used concurrently by other tools, so on
 *    "nonce too low" / "replacement underpriced" / "already known" we re-fetch the pending nonce and retry (5x, backoff).
 */
import hre from "hardhat";
import { ethers } from "ethers";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CHAIN_ID = 31611n;
const RPC_URL = process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org";
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const GAS_FLOOR = 1_500_000n;
const DEFAULT_ENV_FILE = path.resolve(__dirname, "..", ".env.deployer");

function loadDeployerKey(): string {
  const file = process.env.DEPLOYER_ENV_FILE ?? DEFAULT_ENV_FILE;
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^\s*PRIVATE_KEY\s*=\s*["']?(0x)?([0-9a-fA-F]{64})["']?\s*$/m);
  if (!m) throw new Error(`PRIVATE_KEY line not found or malformed in ${file}`);
  return "0x" + m[2];
}

const RETRYABLE = /nonce too low|replacement (transaction )?underpriced|already known|nonce has already been used|NONCE_EXPIRED|REPLACEMENT_UNDERPRICED/i;

function errText(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string; info?: unknown; error?: { message?: string } };
  return [any?.shortMessage, any?.message, any?.error?.message, JSON.stringify(any?.info ?? "")].filter(Boolean).join(" | ");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true });
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`Unexpected chainId ${net.chainId} (expected ${CHAIN_ID})`);

  const wallet = new ethers.Wallet(loadDeployerKey(), provider);
  const deployer = await wallet.getAddress();
  console.log(`Deployer: ${deployer}`);
  console.log(`Native balance: ${ethers.formatEther(await provider.getBalance(deployer))} BTC`);

  // Sanity-check the token before pointing an immutable router at it.
  const token = new ethers.Contract(
    MUSD,
    ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"],
    provider,
  );
  const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
  if (name !== "Mezo USD" || symbol !== "MUSD" || Number(decimals) !== 18) {
    throw new Error(`Token sanity check failed: ${name}/${symbol}/${decimals}`);
  }
  console.log(`Token OK: ${name} (${symbol}, ${decimals} dec) @ ${MUSD}`);

  const artifact = await hre.artifacts.readArtifact("PayGuardRouter");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(MUSD);

  let estimate = 0n;
  try {
    estimate = await provider.estimateGas({ ...deployTx, from: deployer });
  } catch (e) {
    console.log(`estimateGas failed (${errText(e).slice(0, 160)}); using floor`);
  }
  let gasLimit = estimate >= 30_000n ? (estimate * 13n) / 10n : 0n;
  if (gasLimit < GAS_FLOOR) gasLimit = GAS_FLOOR;
  console.log(`Gas estimate: ${estimate} -> explicit gasLimit ${gasLimit}`);

  const feeData = await provider.getFeeData();

  let sent: ethers.TransactionResponse | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = await provider.getTransactionCount(deployer, "pending");
    try {
      const req: ethers.TransactionRequest = { ...deployTx, nonce, gasLimit, chainId: CHAIN_ID };
      if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
        // Generous headroom; gas price on Mezo testnet is ~150 wei so this costs nothing.
        req.maxFeePerGas = feeData.maxFeePerGas * 2n + 1000n;
        req.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas + 100n;
      } else {
        req.gasPrice = (feeData.gasPrice ?? 1000n) * 2n;
      }
      sent = await wallet.sendTransaction(req);
      console.log(`Deploy tx sent (attempt ${attempt}, nonce ${nonce}): ${sent.hash}`);
      break;
    } catch (e) {
      const msg = errText(e);
      if (attempt < 5 && RETRYABLE.test(msg)) {
        const wait = 1500 * attempt;
        console.log(`Retryable nonce error on attempt ${attempt}: ${msg.slice(0, 160)} — retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  if (!sent) throw new Error("Deploy transaction was not sent");

  const receipt = await sent.wait(1, 180_000);
  if (!receipt || receipt.status !== 1) throw new Error(`Deploy failed: ${JSON.stringify(receipt)}`);
  const address = receipt.contractAddress;
  if (!address) throw new Error("No contractAddress in receipt");
  console.log(`Deployed at ${address} in block ${receipt.blockNumber} (gasUsed ${receipt.gasUsed})`);

  // Post-deploy verification (RPC reads can lag a block: retry briefly).
  const router = new ethers.Contract(address, artifact.abi, provider);
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    try {
      const code = await provider.getCode(address);
      const onchainToken: string = await router.token();
      ok = code !== "0x" && onchainToken.toLowerCase() === MUSD.toLowerCase();
    } catch {
      /* lagging RPC */
    }
    if (!ok) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ok) throw new Error("Post-deploy check failed: code missing or token() mismatch");
  console.log("Post-deploy check OK: code present, token() == MUSD");

  const root = path.resolve(__dirname, "..");
  mkdirSync(path.join(root, "deployments"), { recursive: true });
  mkdirSync(path.join(root, "abi"), { recursive: true });
  const solc = hre.config.solidity.compilers[0];
  const deploymentFile = path.join(root, "deployments", "mezo-testnet.json");
  const previous = existsSync(deploymentFile) ? JSON.parse(readFileSync(deploymentFile, "utf8")) : null;
  const previousDeployments: Array<Record<string, unknown>> = previous
    ? [
        ...(previous.previousDeployments ?? []),
        {
          address: previous.address,
          txHash: previous.txHash,
          blockNumber: previous.blockNumber,
          deployer: previous.deployer,
          deployedAt: previous.deployedAt,
        },
      ].filter((d) => String(d.address).toLowerCase() !== address.toLowerCase())
    : [];
  const deployment = {
    contract: "PayGuardRouter",
    network: "mezo-testnet",
    chainId: Number(CHAIN_ID),
    address,
    txHash: sent.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployer,
    token: MUSD,
    constructorArgs: [MUSD],
    deployedAt: new Date().toISOString(),
    explorer: {
      address: `https://explorer.test.mezo.org/address/${address}`,
      tx: `https://explorer.test.mezo.org/tx/${sent.hash}`,
    },
    compiler: {
      version: solc.version,
      evmVersion: solc.settings?.evmVersion,
      optimizerRuns: solc.settings?.optimizer?.runs,
    },
    verified: false,
    previousDeployments,
  };
  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + "\n");
  writeFileSync(path.join(root, "abi", "PayGuardRouter.json"), JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log("Wrote deployments/mezo-testnet.json and abi/PayGuardRouter.json");
}

main().catch((e) => {
  console.error(`Deploy failed: ${errText(e).slice(0, 500)}`);
  process.exitCode = 1;
});
