import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { TxClient } from "./tx-client";

export const metadata: Metadata = { title: "Payment details" };

export default async function TxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireSession title="Sign in to view this payment">
      <TxClient id={id} />
    </RequireSession>
  );
}
