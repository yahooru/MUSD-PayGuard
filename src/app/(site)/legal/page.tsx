import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms, privacy and risk disclosure" };

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-12 md:px-6">
      <h1 className="display text-[36px]">Terms, privacy and risk</h1>
      <p className="mt-3 text-sm text-faint">Plain-language terms for a testnet demonstration product.</p>

      <section id="terms" className="mt-10 scroll-mt-24 space-y-3 text-[15px] text-muted">
        <h2 className="heading text-[22px] text-text">Terms of use</h2>
        <p>MUSD PayGuard is a testnet demonstration. It operates on Mezo Testnet with test tokens that have no monetary value.</p>
        <p>PayGuard is non-custodial software. You keep control of your wallet; every signature and transaction is approved by you in your own wallet.</p>
        <p>PayGuard is provided as is, without warranties. Its checks reduce common mistakes but can be wrong or incomplete, and you remain responsible for every payment you approve.</p>
      </section>

      <section id="privacy" className="mt-10 scroll-mt-24 space-y-3 text-[15px] text-muted">
        <h2 className="heading text-[22px] text-text">Privacy</h2>
        <p>Stored: your wallet address, saved recipients and notes, payment drafts, review results, transaction hashes and verification results, payment requests you create, preferences, and a security audit log. A one-way hash of your IP address is kept for rate limiting and abuse prevention.</p>
        <p>Never collected: seed phrases, private keys, names, emails or phone numbers.</p>
        <p>Your records are only returned to a session signed by your wallet. Payment-request links show that request to anyone who has the link.</p>
        <p>To look for address-poisoning lookalikes, PayGuard&apos;s server queries the public Mezo block explorer for your public MUSD transfers. You can turn this off in Settings.</p>
        <p>Hosting analytics (Vercel Web Analytics) record anonymous page views without cookies.</p>
      </section>

      <section id="risk" className="mt-10 scroll-mt-24 space-y-3 text-[15px] text-muted">
        <h2 className="heading text-[22px] text-text">Risk disclosure</h2>
        <p>Blockchain transfers are irreversible. PayGuard cannot reverse, cancel or refund a transfer once it is confirmed.</p>
        <p>A valid address, a saved contact or a previous payment does not prove who controls an address. Always confirm important addresses through a channel you trust.</p>
        <p>“Low observed risk” means no configured check found a problem. It never means a payment is guaranteed safe.</p>
        <p>Simulation and fee estimates come from public RPC infrastructure and can differ from the final result.</p>
        <p>The PayGuardRouter contract is unaudited demonstration code. The direct transfer path does not depend on it.</p>
      </section>
    </div>
  );
}
