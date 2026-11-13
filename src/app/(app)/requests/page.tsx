import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireSession } from "@/components/shell/app-shell";
import { RequestsClient } from "./requests-client";

export const metadata: Metadata = { title: "Payment requests" };

export default function RequestsPage() {
  return (
    <RequireSession title="Sign in to manage payment requests">
      <Suspense>
        <RequestsClient />
      </Suspense>
    </RequireSession>
  );
}
