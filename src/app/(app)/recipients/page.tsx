import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "@/components/shell/app-shell";
import { RecipientsClient } from "./recipients-client";

export const metadata: Metadata = { title: "Recipients" };

export default function RecipientsPage() {
  return (
    <RequireSession title="Sign in to manage recipients">
      <Suspense>
        <RecipientsClient />
      </Suspense>
    </RequireSession>
  );
}
