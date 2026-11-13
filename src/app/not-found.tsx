import Link from "next/link";
import { LogoMark } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <LogoMark className="mx-auto size-10" />
        <h1 className="display mt-6 text-[34px]">Nothing at this address</h1>
        <p className="mt-3 text-muted">This page does not exist. If you followed a payment link, check it with the person who sent it before paying anything.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link className="link" href="/">Home</Link>
          <Link className="link" href="/dashboard">Dashboard</Link>
          <Link className="link" href="/help">Help</Link>
        </div>
      </div>
    </main>
  );
}
