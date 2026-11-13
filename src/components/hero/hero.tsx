"use client";

import dynamic from "next/dynamic";
import { CircleCheck, TriangleAlert, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../ui/primitives";
import { HERO_GATES } from "./gates";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => <Poster /> });

/** Static fallback (reduced motion, small screens, and while the 3D scene loads). Same story, no motion. */
export function Poster({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex h-full w-full items-center justify-center overflow-hidden", className)}>
      <div className="grid-bg absolute inset-0" aria-hidden />
      <ol className="relative flex w-full max-w-[560px] items-center justify-between gap-1 px-4" aria-label="Preflight gates">
        {HERO_GATES.map((g) => (
          <li key={g.label} className="flex flex-col items-center gap-2">
            <span
              className={cn(
                "grid size-12 place-items-center rounded-full border-2 bg-bg/60 md:size-14",
                g.tone === "warn" ? "border-warn/70 text-warn" : "border-pass/60 text-pass",
              )}
            >
              {g.tone === "warn" ? <TriangleAlert className="size-5" aria-hidden /> : <CircleCheck className="size-5" aria-hidden />}
            </span>
            <span className={cn("text-[11px] font-medium md:text-[12px]", g.tone === "warn" ? "text-warn" : "text-pass")}>{g.label}</span>
          </li>
        ))}
        <li className="flex flex-col items-center gap-2">
          <span className="grid size-12 place-items-center rounded-[12px] border-2 border-violet/60 bg-bg/60 text-violet md:size-14">
            <Wallet className="size-5" aria-hidden />
          </span>
          <span className="text-[11px] font-medium text-violet md:text-[12px]">Wallet</span>
        </li>
      </ol>
    </div>
  );
}

/**
 * Lazy 3D hero. Pauses when off-screen or when the tab is hidden, caps DPR, and falls back to a
 * static poster for reduced motion and small screens.
 */
export function Hero3D({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"pending" | "3d" | "poster">("pending");
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 767px)").matches;
    let webgl = false;
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
    setMode(reduced || small || !webgl ? "poster" : "3d");
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.05 });
    if (ref.current) io.observe(ref.current);
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {mode === "3d" ? (
        <>
          <HeroScene active={visible && tabVisible} onStage={setStage} />
          <ol className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-wrap justify-center gap-2 px-2" aria-hidden>
            {HERO_GATES.map((g, i) => {
              const lit = stage > i;
              return (
                <li
                  key={g.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border bg-bg/80 px-2.5 py-1 text-[12px] font-medium backdrop-blur-sm transition-colors duration-300",
                    lit ? (g.tone === "warn" ? "border-warn/60 text-warn" : "border-pass/50 text-pass") : "border-line text-faint",
                  )}
                >
                  {lit ? g.tone === "warn" ? <TriangleAlert className="size-3.5" /> : <CircleCheck className="size-3.5" /> : <span className="size-3 rounded-full border border-current" />}
                  {g.label}
                </li>
              );
            })}
            <li
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-bg/80 px-2.5 py-1 text-[12px] font-medium backdrop-blur-sm",
                stage > 5 ? "border-violet/60 text-violet" : "border-line text-faint",
              )}
            >
              <Wallet className="size-3.5" />
              {stage > 5 ? "Your review, then your signature" : "Wallet"}
            </li>
          </ol>
        </>
      ) : (
        <Poster />
      )}
      <p className="sr-only">
        Illustration: a payment passes five gates — address, network, token, balance and duplicate check. The duplicate gate shows a warning before the
        payment reaches the wallet.
      </p>
    </div>
  );
}
