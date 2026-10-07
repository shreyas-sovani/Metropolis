import { ImageResponse } from "next/og";

export const alt = "Lifeline";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#faf9f5",
          color: "#141413",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", fontSize: 72, fontWeight: 500, letterSpacing: "-1px" }}>Lifeline</div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 28, lineHeight: 1.35, maxWidth: 860 }}>
          Don't get liquidated with money in your account.
        </div>
        <svg width="740" height="52" viewBox="0 0 148 18" style={{ marginTop: 48 }}>
          <path
            d="M0 9 H28 L36 9 L44 3 L52 15 L60 9 H92 L100 9 L108 2 L116 16 L124 9 H148"
            fill="none"
            stroke="#d97757"
            strokeWidth="1.8"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
