"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { SUPPORTED_NETWORK } from "@/config/chains";
import { api, ApiError } from "@/lib/client/api";

interface SessionInfo {
  authenticated: boolean;
  address?: string;
  userId?: string;
}

interface SessionCtx {
  status: "loading" | "authenticated" | "unauthenticated";
  address: string | null;
  /** Connected wallet account differs from the signed-in account. */
  accountMismatch: boolean;
  signingIn: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { address: connected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [signingIn, setSigningIn] = useState(false);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<SessionInfo>("/api/auth/session"),
    staleTime: 60_000,
  });

  const signIn = useCallback(async () => {
    if (!connected) {
      toast.error("Connect a wallet first.");
      return false;
    }
    setSigningIn(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        domain: window.location.host,
        address: getAddress(connected),
        statement:
          "Sign in to MUSD PayGuard. This signature only proves you control this wallet. It does not send a transaction, approve tokens or cost gas.",
        uri: window.location.origin,
        version: "1",
        chainId: SUPPORTED_NETWORK.chainId,
        nonce,
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60 * 1000),
      });
      const signature = await signMessageAsync({ message });
      await api("/api/auth/verify", { method: "POST", json: { message, signature } });
      await qc.invalidateQueries();
      toast.success("Signed in. Your recipient book and history are now available.");
      return true;
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : /reject|denied|cancel/i.test(String((e as Error)?.message))
            ? "You declined the sign-in request in your wallet. Nothing was signed."
            : "Sign-in failed. Try again.";
      toast.error(msg);
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [connected, signMessageAsync, qc]);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", json: {} });
    } finally {
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["session"] });
    }
  }, [qc]);

  const value = useMemo<SessionCtx>(() => {
    const data = session.data;
    const status = session.isLoading ? "loading" : data?.authenticated ? "authenticated" : "unauthenticated";
    const address = data?.authenticated ? data.address ?? null : null;
    return {
      status,
      address,
      accountMismatch: !!address && !!connected && connected.toLowerCase() !== address.toLowerCase(),
      signingIn,
      signIn,
      signOut,
    };
  }, [session.data, session.isLoading, connected, signingIn, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
