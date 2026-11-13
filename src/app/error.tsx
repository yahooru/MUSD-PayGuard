"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-[70dvh] place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="display text-[30px]">This page hit an error</h1>
        <p className="mt-3 text-muted">
          Nothing was signed or sent because of it. If you had just approved a transaction, open History: its hash is tracked on the server.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button type="button" onClick={reset} className="link">Try again</button>
          <Link className="link" href="/history">Open history</Link>
        </div>
        {error.digest ? <p className="mono mt-4 text-[11px] text-faint">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
