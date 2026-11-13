import type { Metadata } from "next";
import { CheckCatalogue, RiskRules } from "@/app/(app)/security/security-client";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { MUSD, PAYGUARD_ROUTER } from "@/config/contracts";
import { STATUS_LABEL, STATUS_MEANING, type TxStatus } from "@/lib/engine/status";
import { LIMITATIONS } from "@/lib/limitations";

export const metadata: Metadata = { title: "Help and FAQ", description: "How PayGuard checks MUSD payments, what each status means, common wallet errors and limitations." };

const WALLET_ERRORS = [
  ["“User rejected the request”", "You declined in your wallet. Nothing was signed or sent. You can review and try again."],
  ["“Chain mismatch” or wrong network", `Your wallet is on another network. Use “Switch network”; PayGuard adds ${SUPPORTED_NETWORK.name} if your wallet does not know it.`],
  ["“Insufficient funds for gas”", "You need a little BTC on Mezo Testnet for fees. MUSD cannot pay gas. Use the faucet."],
  ["“Gas limit below EIP-7623 floor”", "Mezo enforces a minimum calldata gas. PayGuard always sends an explicit, floored gas limit to avoid this."],
  ["“Execution reverted”", "The token rejected the transfer, for example because of an insufficient balance. PayGuard simulates first and shows the decoded reason."],
  ["Transaction pending for a long time", "Open the payment and press “Check now”. If the network never saw the hash, the status becomes Unknown after 15 minutes."],
];

const FAQ = [
  ["Does PayGuard hold my funds?", "No. Payments go directly from your wallet to the recipient. The optional PayGuardRouter moves MUSD from you to the recipient in the same transaction and never holds a balance."],
  ["Is a saved recipient verified?", "No. It only means you saved it. PayGuard uses it to notice when a later address differs or merely looks similar."],
  ["Why does a first payment to someone show Caution?", "Because PayGuard has nothing to compare it with. Confirm the address through a channel you trust, and consider a small test payment."],
  ["Can PayGuard stop a scam?", "It can catch many common mistakes and suspicious patterns, but it cannot know who controls an address. Treat its warnings as evidence, not a verdict."],
  ["Why do I have to tick boxes for some warnings?", "Serious but inconclusive findings (for example a possible duplicate) need an explicit acknowledgement so you cannot click past them by accident."],
  ["What does the on-chain invoice option do?", "It pays through PayGuardRouter with a one-time permit signature and records the invoice reference on-chain, so paying the same reference to the same recipient again reverts, from any device or app."],
  ["Is there an AI deciding my risk?", "No. Every result comes from documented rules. The plain-language summary is generated from those rule results and can never override them."],
];

export default function HelpPage() {
  const statuses: TxStatus[] = ["pending", "confirmed", "failed", "verification_delayed", "unknown"];
  return (
    <div className="mx-auto max-w-[980px] px-4 py-12 md:px-6">
      <h1 className="display text-[38px] md:text-[48px]">Help and FAQ</h1>
      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[13px]">
        {[
          ["#how", "How it works"],
          ["#statuses", "Transaction status"],
          ["#errors", "Wallet errors"],
          ["#network", "Network setup"],
          ["#checks", "Every check"],
          ["#limits", "Limitations"],
          ["#faq", "FAQ"],
        ].map(([h, l]) => (
          <a key={h} href={h} className="rounded-full border border-line px-3 py-1 text-muted hover:border-line-strong hover:text-text">
            {l}
          </a>
        ))}
      </nav>

      <section id="how" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">How PayGuard works</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
          <li>You connect a wallet and sign in with a free signature (Sign-In With Ethereum). No transaction, no gas.</li>
          <li>You enter a payment. It is saved as a draft: not a transaction.</li>
          <li>PayGuard gathers live evidence (balances, token contract, recipient code, gas estimate, simulation, your history, on-chain transfers) and runs every check.</li>
          <li>The review binds to a hash of the exact payment. Failures block sending; serious warnings need your acknowledgement.</li>
          <li>When you confirm, PayGuard re-runs every check, re-verifies the hash and the transaction data, then your wallet asks you to sign.</li>
          <li>The transaction hash is stored immediately, so tracking survives a refresh or a closed tab.</li>
          <li>PayGuard reads the receipt itself and marks the payment confirmed only if the MUSD Transfer event matches the reviewed sender, recipient and amount.</li>
        </ol>
      </section>

      <section id="statuses" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Understanding transaction status</h2>
        <dl className="mt-4 divide-y divide-line rounded-[14px] border border-line">
          {statuses.map((s) => (
            <div key={s} className="grid gap-1 p-4 sm:grid-cols-[200px_1fr]">
              <dt className="font-medium">{STATUS_LABEL[s]}</dt>
              <dd className="text-[14px] text-muted">{STATUS_MEANING[s]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-faint">A draft or a payment request is never a transaction. Only entries in History were submitted on-chain.</p>
      </section>

      <section id="errors" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Common wallet errors</h2>
        <dl className="mt-4 grid gap-3 md:grid-cols-2">
          {WALLET_ERRORS.map(([e, d]) => (
            <div key={e} className="card p-4">
              <dt className="font-medium">{e}</dt>
              <dd className="mt-1 text-[14px] text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="network" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Adding Mezo Testnet manually</h2>
        <dl className="card mt-4 divide-y divide-line text-[14px]">
          {[
            ["Network name", SUPPORTED_NETWORK.name],
            ["RPC URL", SUPPORTED_NETWORK.rpcUrl],
            ["Chain ID", `${SUPPORTED_NETWORK.chainId}`],
            ["Currency symbol", "BTC"],
            ["Block explorer", SUPPORTED_NETWORK.explorerUrl],
            ["MUSD token", MUSD.address],
            ["PayGuardRouter", PAYGUARD_ROUTER.address],
          ].map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_1fr]">
              <dt className="text-muted">{k}</dt>
              <dd className="mono break-all text-[13px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[14px] text-muted">
          Get testnet BTC for fees from the{" "}
          <a className="link" href={SUPPORTED_NETWORK.faucetUrl} target="_blank" rel="noopener noreferrer">
            Mezo faucet
          </a>
          . Test MUSD is borrowed against BTC in the Mezo app or received from another tester.
        </p>
      </section>

      <section id="checks" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Every check, and its rule</h2>
        <div className="mt-4">
          <CheckCatalogue />
        </div>
        <h3 className="heading mt-8 text-[18px]">How the risk category is decided</h3>
        <div className="mt-3">
          <RiskRules />
        </div>
      </section>

      <section id="limits" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Security limitations</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-muted">
          {LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section id="faq" className="mt-14 scroll-mt-24">
        <h2 className="heading text-[24px]">Frequently asked questions</h2>
        <div className="mt-4 space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="card group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-[14px] text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
