import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Lifeline",
  description: "Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
