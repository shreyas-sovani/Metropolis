import type { ReactNode } from "react";
import { ONE_LINER } from "../lib/copy";
import "./globals.css";

export const metadata = {
  title: { default: "Lifeline", template: "%s · Lifeline" },
  description: ONE_LINER,
  openGraph: {
    title: "Lifeline",
    description: ONE_LINER,
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
