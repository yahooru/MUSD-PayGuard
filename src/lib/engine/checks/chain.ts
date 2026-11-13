import { chainName } from "../../../config/chains";
import { sameAddress } from "../address";
import { result } from "../result";
import type { CheckResult, PreflightContext } from "../types";

export function networkChecks(ctx: PreflightContext): CheckResult[] {
  const { config, wallet, payload } = ctx;
  const out: CheckResult[] = [];

  if (wallet.connectedChainId == null) {
    out.push(
      result("network.wallet", {
        status: "unavailable",
        severity: "high",
        explanation: "PayGuard cannot tell which network your wallet is on, so it will not build a transaction.",
        recommendation: "Connect your wallet and make sure it is unlocked.",
      }),
    );
  } else if (wallet.connectedChainId !== config.chainId) {
    out.push(
      result("network.wallet", {
        status: "fail",
        severity: "critical",
        explanation: `Your wallet is connected to ${chainName(wallet.connectedChainId)} (chain ${wallet.connectedChainId}). PayGuard only sends MUSD on ${config.chainName} (chain ${config.chainId}). The same address on another network holds different assets.`,
        recommendation: `Switch your wallet to ${config.chainName}. PayGuard can add the network to your wallet for you.`,
        evidence: [
          { label: "Wallet network", value: `${chainName(wallet.connectedChainId)} (${wallet.connectedChainId})`, kind: "chain" },
          { label: "Required network", value: `${config.chainName} (${config.chainId})`, kind: "chain" },
        ],
      }),
    );
  } else {
    out.push(
      result("network.wallet", {
        status: "pass",
        severity: "info",
        explanation: `Your wallet is on ${config.chainName} (chain ${config.chainId}).`,
        recommendation: "Stay on this network until the payment is confirmed.",
        evidence: [{ label: "Wallet network", value: `${config.chainName} (${config.chainId})`, kind: "chain" }],
      }),
    );
  }

  if (payload.chainId !== config.chainId) {
    out.push(
      result("network.payment", {
        status: "fail",
        severity: "critical",
        explanation: `This payment was prepared for ${chainName(payload.chainId)} (chain ${payload.chainId}), which PayGuard does not support. PayGuard never falls back to a different network.`,
        recommendation: `Create the payment again on ${config.chainName}.`,
        evidence: [
          { label: "Payment network", value: `${chainName(payload.chainId)} (${payload.chainId})`, kind: "chain" },
          { label: "Supported network", value: `${config.chainName} (${config.chainId})`, kind: "chain" },
        ],
      }),
    );
  } else {
    out.push(
      result("network.payment", {
        status: "pass",
        severity: "info",
        explanation: `The payment is built for ${config.chainName}, the configured network.`,
        recommendation: "No action needed.",
      }),
    );
  }
  return out;
}

export function tokenChecks(ctx: PreflightContext): CheckResult[] {
  const { config, payload } = ctx;
  const out: CheckResult[] = [];
  const configMatch = sameAddress(payload.token, config.token.address);
  out.push(
    configMatch
      ? result("token.config", {
          status: "pass",
          severity: "info",
          explanation: `The token is the MUSD contract from PayGuard's verified configuration for ${config.chainName}.`,
          recommendation: "No action needed.",
          evidence: [
            { label: "MUSD contract", value: config.token.address, kind: "address", href: config.explorerAddress(config.token.address) },
          ],
        })
      : result("token.config", {
          status: "fail",
          severity: "critical",
          explanation:
            "The token contract is not the configured MUSD contract. A token can call itself MUSD without being MUSD; PayGuard only trusts the configured address.",
          recommendation: "Do not pay with this token. Start a new payment from PayGuard so the verified MUSD contract is used.",
          evidence: [
            { label: "Token in payment", value: payload.token, kind: "address" },
            { label: "Configured MUSD", value: config.token.address, kind: "address" },
          ],
        }),
  );

  const obs = ctx.token;
  if (!obs.ok) {
    out.push(
      result("token.onchain", {
        status: "unavailable",
        severity: "high",
        explanation: `PayGuard could not read the token contract (${obs.error}). It will not send a payment with a token it cannot verify.`,
        recommendation: "Retry in a moment. If the RPC stays unavailable, wait before paying.",
        evidence: [{ label: "Source", value: obs.source, kind: "text" }],
      }),
    );
    return out;
  }
  const t = obs.value;
  const exp = config.token;
  const mismatches: string[] = [];
  if (!t.hasCode) mismatches.push("no contract code at the address");
  if (t.name !== exp.name) mismatches.push(`name is “${t.name}”, expected “${exp.name}”`);
  if (t.symbol !== exp.symbol) mismatches.push(`symbol is “${t.symbol}”, expected “${exp.symbol}”`);
  if (t.decimals !== exp.decimals) mismatches.push(`decimals is ${t.decimals}, expected ${exp.decimals}`);
  const evidence = [
    { label: "Name", value: t.name || "—", kind: "text" as const },
    { label: "Symbol", value: t.symbol || "—", kind: "text" as const },
    { label: "Decimals", value: String(t.decimals), kind: "number" as const },
  ];
  out.push(
    mismatches.length > 0
      ? result("token.onchain", {
          status: "fail",
          severity: "critical",
          explanation: `The token contract's on-chain properties do not match MUSD: ${mismatches.join("; ")}.`,
          recommendation: "Do not send. Report this; the configuration or the network may be compromised.",
          evidence,
        })
      : result("token.onchain", {
          status: "pass",
          severity: "info",
          explanation: `Read from the chain: ${t.name} (${t.symbol}), ${t.decimals} decimals — exactly as configured.`,
          recommendation: "No action needed.",
          evidence,
        }),
  );
  return out;
}
