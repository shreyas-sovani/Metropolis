import type { ReactNode } from "react";
import { JetBrains_Mono, Lora, Poppins } from "next/font/google";
import { SITE } from "../lib/bounties";
import { ONE_LINER } from "../lib/copy";
import { Providers } from "./providers";
import "./styles/tokens.css";
import "./globals.css";
import "./styles/base.css";
import "./styles/motion.css";

const display = Poppins({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-display",
  display: "swap",
});

const body = Lora({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

const data = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-data",
  display: "swap",
});

const H1 = "Don't get liquidated with money in your account.";

export const metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Lifeline", template: "%s · Lifeline" },
  description: ONE_LINER,
  openGraph: {
    title: "Lifeline",
    description: H1,
    type: "website" as const,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
