import { ArrowRight, BadgeCheck, CodeXml, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Hero3D } from "@/components/hero/hero";
import { LiveStats } from "@/components/landing/live-stats";
import { ButtonLink } from "@/components/ui/primitives";
import { SUPPORTED_NETWORK } from "@/config/chains";
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

const STEPS = [
  ["Draft", "Enter recipient, amount and invoice reference. Nothing is signed."],
  ["Preflight", "Every check runs against the live network and your history, with evidence for each result."],
  ["Review", "Failures block sending. Serious warnings need your explicit acknowledgement."],
  ["Sign", "PayGuard re-checks the exact reviewed payload, then your wallet asks you to approve."],
  ["Verify", "The receipt, sender, recipient, token and amount are verified on-chain before it says confirmed."],
];

export default function Landing() {
  const groups = [...new Set(CATALOGUE.map((c) => c.group))] as CheckGroup[];
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-6 px-4 pb-10 pt-12 md:px-6 lg:grid-cols-[1fr_1.15fr] lg:pb-16 lg:pt-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-[12px] font-medium text-warn">
              Testnet: runs on {SUPPORTED_NETWORK.name} with test MUSD that has no value
            </p>
            <h1 className="display mt-5 text-[46px] sm:text-[60px] lg:text-[72px]">Check before you send.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
              PayGuard sits between you and your wallet. It checks the recipient, network, token, balance and earlier payments before you sign a MUSD
              transfer, then confirms the payment only after reading the receipt from the chain itself.
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
          <Hero3D className="h-[300px] sm:h-[380px] lg:h-[520px]" />
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
            From draft to verified receipt
          </h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="hull relative p-5">
                <span className="mono text-[12px] text-cyan">{String(i + 1).padStart(2, "0")}</span>
                <p className="heading mt-2 text-[18px]">{t}</p>
                <p className="mt-2 text-[14px] text-muted">{d}</p>
                {i < STEPS.length - 1 ? <ArrowRight className="absolute -right-3 top-1/2 hidden size-5 -translate-y-1/2 text-line-strong md:block" aria-hidden /> : null}
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
          </div>
          <pre className="inset mono overflow-x-auto p-5 text-[12.5px] leading-relaxed text-muted">
            <code>{`curl -s https://musd-payguard.vercel.app/api/v1/verify \\
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
      </div>
    </>
  );
}
