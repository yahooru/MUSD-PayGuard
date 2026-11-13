import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { HistoryClient } from "./history-client";

export const metadata: Metadata = { title: "Transaction history" };

export default function HistoryPage() {
  return (
    <RequireSession title="Sign in to see your history">
      <HistoryClient />
    </RequireSession>
  );
}
