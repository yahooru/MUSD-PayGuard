import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <RequireSession title="Sign in to change settings">
      <SettingsClient />
    </RequireSession>
  );
}
