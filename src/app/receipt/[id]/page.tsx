import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { ReceiptClient } from "./receipt-client";

export const metadata: Metadata = { title: "Payment receipt", robots: { index: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[820px] px-4 py-8 md:py-12">
      <RequireSession title="Sign in to view this receipt">
        <ReceiptClient id={id} />
      </RequireSession>
    </div>
  );
}
