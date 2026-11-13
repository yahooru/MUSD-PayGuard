import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { MEZO_TESTNET, explorer } from "../../config/chains";
import { BURN_ADDRESSES, GAS_POLICY, KNOWN_SYSTEM_CONTRACTS, MUSD, PAYGUARD_ROUTER, gasLimitFor, musdAbi, routerAbi } from "../../config/contracts";
import { analyzeAddress } from "../engine/address";
import type {
  EngineConfig,
  FeeObservation,
  Observation,
  OnchainInvoiceObservation,
  PaymentPayload,
  PreflightContext,
  SimulationObservation,
  TokenObservation,
} from "../engine/types";
import { invoiceRefHash } from "../invoice";
import type { Settings } from "../settings";
import { describeRpcError, errorMessage, publicClient, withTimeout } from "./chain";
import { historyForEngine, listRecipients, requestSnapshot, toRequest, toSaved, getRequest } from "./data";
import { fetchAddressInfo, fetchCounterparties } from "./explorer";

export const ENGINE_CONFIG: EngineConfig = {
  chainId: MEZO_TESTNET.chainId,
  chainName: MEZO_TESTNET.name,
  token: { address: MUSD.address, ...MUSD.expected },
  burnAddresses: BURN_ADDRESSES,
  systemContracts: KNOWN_SYSTEM_CONTRACTS,
  explorerTx: explorer.tx,
  explorerAddress: explorer.address,
};

const RPC = "Mezo Testnet RPC";
const T = 9000;

async function observe<T>(label: string, fn: () => Promise<T>, source = RPC): Promise<Observation<T>> {
  try {
    const value = await withTimeout(fn(), T, label);
    return { ok: true, value, source, at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: errorMessage(e), source, at: new Date().toISOString() };
  }
}

export async function readToken(tokenAddress: Address): Promise<Observation<TokenObservation>> {
  const c = publicClient();
  return observe("token metadata", async () => {
    const [code, name, symbol, decimals] = await Promise.all([
      c.getCode({ address: tokenAddress }),
      c.readContract({ address: tokenAddress, abi: musdAbi, functionName: "name" }),
      c.readContract({ address: tokenAddress, abi: musdAbi, functionName: "symbol" }),
      c.readContract({ address: tokenAddress, abi: musdAbi, functionName: "decimals" }),
    ]);
    return { hasCode: !!code && code !== "0x", name, symbol, decimals: Number(decimals) };
  });
}

export interface GatherInput {
  userId: string;
  payload: PaymentPayload;
  walletChainId: number | null;
  selectedRecipientId: string | null;
  settings: Settings;
  reviewedPayloadHash?: string | null;
}

/**
 * Collect every observation the engine needs, in parallel, with timeouts.
 * Each observation records its source and whether it succeeded, so the engine can
 * report "could not be performed" instead of guessing.
 */
export async function gatherContext(input: GatherInput): Promise<{ ctx: PreflightContext; fee: FeeObservation | null }> {
  const { payload } = input;
  const c = publicClient();
  const from = getAddress(payload.from);
  const addr = analyzeAddress(payload.to);
  const to = addr.valid ? (getAddress(addr.lower!) as Address) : null;
  let amount: bigint | null = null;
  try {
    amount = BigInt(payload.amount);
  } catch {
    amount = null;
  }
  // Only ever touch the configured token address on-chain; a mismatching payload is failed by token.config.
  const tokenAddress = MUSD.address;
  const transferData: Hex | null =
    to && amount !== null ? encodeFunctionData({ abi: musdAbi, functionName: "transfer", args: [to, amount] }) : null;

  const tokenP = readToken(tokenAddress);
  const balancesP = observe("balances", async () => {
    const [musd, native] = await Promise.all([
      c.readContract({ address: tokenAddress, abi: musdAbi, functionName: "balanceOf", args: [from] }),
      c.getBalance({ address: from }),
    ]);
    return { musd, native };
  });
  const codeP: Promise<Observation<{ code: string | null }>> = to
    ? observe("recipient code", async () => ({ code: (await c.getCode({ address: to })) ?? null }))
    : Promise.resolve({ ok: false as const, error: "invalid recipient", source: RPC });

  const kind = payload.method === "router" ? "routerPayWithPermit" : "erc20Transfer";
  const feeP: Promise<Observation<FeeObservation>> = observe("fee estimate", async () => {
    const fees = await c.estimateFeesPerGas().catch(async () => ({ maxFeePerGas: (await c.getGasPrice()) * 2n }));
    const maxFeePerGas = fees.maxFeePerGas ?? (await c.getGasPrice()) * 2n;
    let estimate: bigint | null = null;
    let estimateError: FeeObservation["estimateError"];
    if (payload.method === "direct" && transferData) {
      try {
        estimate = await c.estimateGas({ account: from, to: tokenAddress, data: transferData });
      } catch (e) {
        estimateError = describeRpcError(e);
      }
    }
    const { gas, estimateUsable } = gasLimitFor(kind, estimate);
    return { estimate, estimateError, gasLimit: gas, estimateUsable, maxFeePerGas, maxFee: gas * maxFeePerGas };
  });

  const simP: Promise<Observation<SimulationObservation>> = transferData
    ? observe("simulation", async (): Promise<SimulationObservation> => {
        const blockNumber = await c.getBlockNumber();
        const note =
          payload.method === "router"
            ? "The MUSD transfer leg (from your wallet to the recipient) succeeds when simulated against the latest block; the full router call is simulated again with your permit right before sending."
            : undefined;
        try {
          const res = await c.call({ account: from, to: tokenAddress, data: transferData, blockNumber });
          const returned = res.data ? BigInt(res.data) === 1n : null;
          if (returned === false) return { success: false, returned, blockNumber: blockNumber.toString(), note };
          return { success: true, returned, blockNumber: blockNumber.toString(), note };
        } catch (e) {
          const info = describeRpcError(e);
          if (!info.isRevert) throw e; // transport error -> "could not be simulated"
          return { success: false, revert: info, blockNumber: blockNumber.toString(), note };
        }
      })
    : Promise.resolve({ ok: false as const, error: "the recipient or amount is invalid", source: RPC });

  const counterpartiesP = input.settings.security.useExplorerHistory
    ? fetchCounterparties(from)
    : Promise.resolve({ ok: false as const, error: "disabled in your settings", source: "Mezo explorer API" });
  const explorerInfoP = to ? fetchAddressInfo(to) : Promise.resolve(undefined);

  const refHash = payload.invoiceRef ? invoiceRefHash(payload.invoiceRef) : null;
  const onchainP: Promise<Observation<OnchainInvoiceObservation> | null> =
    to && refHash
      ? observe("router registry", async () => {
          const [paid, amt, , blockNumber] = await c.readContract({
            address: PAYGUARD_ROUTER.address,
            abi: routerAbi,
            functionName: "getPayment",
            args: [from, to, refHash],
          });
          return { paid, amount: amt.toString(), blockNumber: blockNumber.toString() };
        }, "PayGuardRouter.getPayment")
      : Promise.resolve(null);

  const recipientsP = listRecipients(input.userId);
  const historyP = historyForEngine(input.userId);
  const requestP = payload.requestId ? getRequest(payload.requestId) : Promise.resolve(null);

  const [token, balances, recipientCode, fee, simulation, counterparties, explorerInfo, onchainInvoice, recipients, history, requestRow] =
    await Promise.all([tokenP, balancesP, codeP, feeP, simP, counterpartiesP, explorerInfoP, onchainP, recipientsP, historyP, requestP]);

  const ctx: PreflightContext = {
    payload,
    now: Date.now(),
    config: ENGINE_CONFIG,
    wallet: { connectedChainId: input.walletChainId },
    token,
    balances,
    recipientCode,
    fee,
    simulation,
    savedRecipients: recipients.map(toSaved),
    selectedRecipientId: input.selectedRecipientId,
    history,
    counterparties,
    explorerInfo,
    request: requestRow ? requestSnapshot(toRequest(requestRow)) : null,
    onchainInvoice,
    reviewedPayloadHash: input.reviewedPayloadHash ?? null,
  };
  return { ctx, fee: fee.ok ? fee.value : null };
}

export function feeDto(fee: FeeObservation | null) {
  if (!fee) return null;
  return {
    gasLimit: fee.gasLimit.toString(),
    maxFeePerGas: fee.maxFeePerGas.toString(),
    maxFee: fee.maxFee.toString(),
    estimate: fee.estimate?.toString() ?? null,
  };
}

export { GAS_POLICY };
