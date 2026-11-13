import type { Metadata } from "next";
import { PayClient } from "./pay-client";

export const metadata: Metadata = {
  title: "Payment request",
  description: "Review a MUSD payment request. PayGuard re-validates it against Mezo Testnet every time it is opened.",
  robots: { index: false },
};

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 md:px-6">
      <PayClient id={id} />
    </div>
  );
}
