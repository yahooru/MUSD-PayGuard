import { ImageResponse } from "next/og";

export const alt = "MUSD PayGuard: check before you send";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const gates = [
    ["Address", "#52e0a1"],
    ["Network", "#52e0a1"],
    ["Token", "#52e0a1"],
    ["Balance", "#52e0a1"],
    ["Duplicate", "#f7bd52"],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#060a13", padding: 72, color: "#e8eef8", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, color: "#9aaac2" }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#45d9ec" }} />
          MUSD PayGuard on Mezo
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -2 }}>Check before you send.</div>
          <div style={{ fontSize: 32, color: "#9aaac2", marginTop: 18, maxWidth: 900 }}>
            Every MUSD payment passes documented safety checks before you sign, and is verified on-chain before it is called confirmed.
          </div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {gates.map(([l, c]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, border: `2px solid ${c}`, color: c, borderRadius: 999, padding: "10px 22px", fontSize: 26 }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
