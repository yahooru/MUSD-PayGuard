"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/client/wagmi";
import { SessionProvider } from "./session";
import { ConnectDialogProvider } from "./wallet/connect-dialog";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 10_000 },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ConnectDialogProvider>
            {children}
            <Toaster
              theme="dark"
              position="bottom-right"
              closeButton
              offset={{ bottom: "var(--toast-offset-bottom)", right: "24px" }}
              mobileOffset={{ bottom: "var(--toast-offset-bottom)" }}
              toastOptions={{
                style: {
                  background: "var(--surface-2)",
                  border: "1px solid var(--line-strong)",
                  color: "var(--text)",
                  fontFamily: "var(--font-archivo)",
                },
              }}
            />
          </ConnectDialogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
