import type { Metadata } from "next";
import { RequireSession } from "@/components/shell/app-shell";
import { ReviewClient } from "./review-client";

export const metadata: Metadata = { title: "Security review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireSession title="Sign in to review this payment">
      <ReviewClient id={id} />
    </RequireSession>
  );
}
