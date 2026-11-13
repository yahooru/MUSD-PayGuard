import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { SecurityClient } from "./security-client";

export const metadata: Metadata = { title: "Security Centre" };

export default function SecurityPage() {
  return (
    <RequireSession title="Sign in to open the Security Centre">
      <SecurityClient />
    </RequireSession>
  );
}
