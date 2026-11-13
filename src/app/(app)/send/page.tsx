import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "@/components/shell/app-shell";
import { SendForm } from "./send-form";

export const metadata: Metadata = { title: "Send MUSD" };

export default function SendPage() {
  return (
    <RequireSession title="Sign in to send MUSD">
      <Suspense>
        <SendForm />
      </Suspense>
    </RequireSession>
  );
}
