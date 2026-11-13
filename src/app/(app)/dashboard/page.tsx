import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <RequireSession title="Sign in to open your dashboard">
      <DashboardClient />
    </RequireSession>
  );
}
