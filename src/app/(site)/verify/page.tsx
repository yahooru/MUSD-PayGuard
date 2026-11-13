import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyClient } from "./verify-client";

export const metadata: Metadata = {
  title: "Verify a payment",
  description: "Don't trust a screenshot. Check any MUSD payment on Mezo Testnet against its on-chain receipt and Transfer event.",
};

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-[920px] px-4 py-12 md:px-6">
      <h1 className="display text-[34px] md:text-[44px]">Don&apos;t trust the screenshot</h1>
      <p className="mt-3 max-w-2xl text-[16px] text-muted">
        Someone says they paid you? Paste the transaction hash and what you expected. PayGuard reads the receipt and the MUSD Transfer event straight from
        Mezo Testnet and tells you whether that exact payment happened. No sign-in needed.
      </p>
      <Suspense>
        <VerifyClient />
      </Suspense>
    </div>
  );
}
