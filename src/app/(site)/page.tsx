import { BadgeCheck, CodeXml, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LiveStats } from "@/components/landing/live-stats";
import { PreflightManifest } from "@/components/landing/preflight-manifest";
import { FLOW_STEPS } from "@/components/ui/flow-steps";
import { ButtonLink } from "@/components/ui/primitives";
import { SITE } from "@/config/site";
import { SUPPORTED_NETWORK, explorer } from "@/config/chains";
import { PAYGUARD_ROUTER } from "@/config/contracts";
import { CATALOGUE, CHECK_GROUP_LABELS } from "@/lib/engine/catalogue";
import type { CheckGroup } from "@/lib/engine/types";
import { LIMITATIONS } from "@/lib/limitations";

const MISTAKES = [
  ["A wrong or mistyped address", "Format, EIP-55 checksum and hidden-character checks; the full address is shown in groups for comparison."],
  ["A lookalike address planted in your history", "Address-poisoning detection against saved contacts, past payees and on-chain transfers."],
  ["The wrong network", "Your wallet's chain is checked and payments are only ever built for Mezo Testnet."],
  ["A token that only calls itself MUSD", "The contract address must match the official configuration, and its name, symbol and decimals are read on-chain."],
  ["Paying the same invoice twice", "References are compared with confirmed and pending payments, and optionally recorded on-chain."],
  ["Sending to a contract that can't move funds", "eth_getCode tells wallets from contracts; burn addresses and the token itself are blocked."],
  ["Assuming it worked", "Status stays pending until PayGuard reads the receipt and the exact MUSD Transfer event itself."],
  ["A fake payment screenshot", "Anyone can verify a transaction hash against the chain, without signing in."],
];

/** Same four steps, same names, as the progress bar inside the app. */
const STEP_DETAIL: Record<(typeof FLOW_STEPS)[number]["id"], string> = {
  details: "Pick a saved recipient or paste an address, then the amount and invoice reference. Nothing is signed.",
  review: "Every check runs against the live network and your history. Failures block sending; serious warnings need your acknowledgement.",
  sign: "PayGuard re-checks the exact payload you reviewed, then your wallet opens. Change anything and the review starts over.",
  verify: "PayGuard reads the receipt itself and says confirmed only when the sender, recipient, token and amount all match.",
};

export default function Landing() {
  const groups = [...new Set(CATALOGUE.map((c) => c.group))] as CheckGroup[];
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-16 pt-12 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-[12px] font-medium text-warn">
              {SUPPORTED_NETWORK.name} only. Test MUSD has no value.
            </p>
            <h1 className="display mt-6 text-[48px] sm:text-[64px] lg:text-[80px]">Check before you send.</h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted">
              Stablecoin payments can&apos;t be undone. PayGuard checks the recipient, network, token, balance and your earlier payments before your
              wallet signs a MUSD transfer, then reads the receipt from the chain, so paid means paid.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/send" variant="primary" size="lg" icon={<ShieldCheck className="size-4" aria-hidden />}>
                Start a checked payment
              </ButtonLink>
              <ButtonLink href="/verify" variant="secondary" size="lg" icon={<BadgeCheck className="size-4" aria-hidden />}>
                Verify a payment
              </ButtonLink>
            </div>
            <p className="mt-5 max-w-lg text-[13px] text-faint">
              Non-custodial: PayGuard never holds funds or keys, and cannot reverse a transfer. It reduces common mistakes; it cannot prove who controls an
              address.
            </p>
          </div>
          <PreflightManifest className="mx-auto w-full max-w-[520px] lg:mr-0" />
        </div>
      </section>

      <div className="mx-auto max-w-[1240px] px-4 md:px-6">
        <section className="mt-12" aria-labelledby="live-h">
          <h2 id="live-h" className="mb-3 text-[13px] font-medium text-muted">
            Live from {SUPPORTED_NETWORK.name}, read through the same RPC PayGuard uses for every check
          </h2>
          <LiveStats />
        </section>

        <section className="mt-24 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]" aria-labelledby="problem-h">
          <div>
            <h2 id="problem-h" className="display text-[34px] md:text-[42px]">
              Stablecoin payments have no undo button.
            </h2>
            <p className="mt-4 max-w-md text-muted">
              Most lost payments are not hacks. They are ordinary mistakes made in a hurry, at the one moment that cannot be taken back. These are the ones
              PayGuard looks for, and how.
            </p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-2">
            {MISTAKES.map(([m, how]) => (
              <div key={m} className="bg-surface p-5">
                <dt className="font-medium">{m}</dt>
                <dd className="mt-1.5 text-[14px] text-muted">{how}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-24" aria-labelledby="how-h">
          <h2 id="how-h" className="display text-[34px] md:text-[42px]">
            From details to verified receipt
          </h2>
          <p className="mt-3 max-w-2xl text-muted">Four steps, and the app shows you which one you are on.</p>
          <ol className="relative mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
            <span className="absolute left-[13px] top-3 bottom-3 w-px bg-line-strong md:left-3 md:right-3 md:top-[13px] md:bottom-auto md:h-px md:w-auto" aria-hidden />
            {FLOW_STEPS.map((s, i) => (
              <li key={s.id} className="relative pl-11 md:pl-0">
                <span
                  className={
                    "absolute left-0 top-0 grid size-[27px] place-items-center rounded-full border bg-bg text-[12px] font-semibold md:static " +
                    (s.id === "sign" ? "border-violet/70 text-violet" : "border-cyan/70 text-cyan")
                  }
                >
                  {i + 1}
                </span>
                <p className="heading text-[19px] md:mt-5">{s.label}</p>
                <p className="mt-2 max-w-[30ch] text-[14px] leading-relaxed text-muted">{STEP_DETAIL[s.id]}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-24" aria-labelledby="checks-h">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="checks-h" className="display text-[34px] md:text-[42px]">
              {CATALOGUE.length} documented checks
            </h2>
            <Link href="/help#checks" className="link text-sm">
              Read every rule
            </Link>
          </div>
          <p className="mt-3 max-w-2xl text-muted">
            Each returns passed, warning, failed or not performed, with the evidence it used. A failed check is a confirmed problem and blocks sending. A
            warning is a pattern to review. Not performed means the check could not run, and PayGuard says so.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((g) => (
              <div key={g} className="card p-5">
                <p className="heading text-[16px]">{CHECK_GROUP_LABELS[g]}</p>
                <ul className="mt-3 space-y-1.5 text-[13px] text-muted">
                  {CATALOGUE.filter((c) => c.group === g).map((c) => (
                    <li key={c.id}>{c.title}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-24 grid gap-10 lg:grid-cols-2" aria-labelledby="limits-h">
          <div>
            <h2 id="limits-h" className="display text-[34px] md:text-[42px]">
              What it won&apos;t pretend to do
            </h2>
            <p className="mt-4 max-w-md text-muted">A safety tool that overstates itself is a risk of its own. These limits are shown inside the product too.</p>
          </div>
          <ul className="space-y-3">
            {LIMITATIONS.slice(0, 5).map((l) => (
              <li key={l} className="card p-4 text-[14px] text-muted">
                {l}
              </li>
            ))}
          </ul>
        </section>

        <section className="hull mt-24 grid gap-8 p-6 md:p-10 lg:grid-cols-[1fr_1.1fr]" aria-labelledby="dev-h">
          <div>
            <CodeXml className="size-6 text-violet" aria-hidden />
            <h2 id="dev-h" className="display mt-4 text-[30px] md:text-[36px]">
              Verify payments from your own app
            </h2>
            <p className="mt-3 text-muted">
              Merchants can check an incoming MUSD payment with one public request: receipt status, the exact Transfer event and, for PayGuardRouter
              payments, the on-chain invoice reference.
            </p>
            <ButtonLink href="/developers" className="mt-6" icon={<CodeXml className="size-4" aria-hidden />}>
              Read the API docs
            </ButtonLink>
            <div className="mt-8 border-t border-line pt-5 text-[13px]">
              <p className="flex items-center gap-2 font-medium">
                <BadgeCheck className="size-4 text-violet" aria-hidden />
                PayGuardRouter source is verified on the Mezo explorer
              </p>
              <p className="mt-1.5 text-muted">
                No owner, no fees, never holds funds. Payments through it record the invoice reference on-chain, so paying the same invoice twice
                reverts.
              </p>
              <a
                className="link mono mt-2 inline-flex items-center gap-1.5 break-all text-[12px]"
                href={explorer.address(PAYGUARD_ROUTER.address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {PAYGUARD_ROUTER.address}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            </div>
          </div>
          <pre className="inset mono overflow-x-auto p-5 text-[12.5px] leading-relaxed text-muted">
            <code>{`curl -s ${SITE.url}/api/v1/verify \\
  -H 'content-type: application/json' \\
  -d '{
    "txHash": "0x…",
    "expected": {
      "recipient": "0x…",
      "amount": "2.00",
      "invoiceRef": "INV-0042"
    }
  }'

{ "verdict": "verified", "verified": true,
  "steps": [ … receipt, sender, Transfer log … ] }`}</code>
          </pre>
        </section>

        <section className="mt-24 flex flex-col items-start justify-between gap-6 border-t border-line pt-12 md:flex-row md:items-end" aria-labelledby="cta-h">
          <div>
            <h2 id="cta-h" className="display text-[34px] md:text-[42px]">
              Run your next payment through it.
            </h2>
            <p className="mt-3 max-w-xl text-muted">
              Connect a wallet on {SUPPORTED_NETWORK.name}, sign in with a free signature, and send a small test payment. Every check is shown as it
              runs.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <ButtonLink href="/send" variant="primary" size="lg" icon={<ShieldCheck className="size-4" aria-hidden />}>
              Start a checked payment
            </ButtonLink>
            <ButtonLink href="/verify" size="lg" icon={<BadgeCheck className="size-4" aria-hidden />}>
              Verify a payment
            </ButtonLink>
          </div>
        </section>
      </div>
    </>
  );
}
