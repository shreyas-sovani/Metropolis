import type { ReactNode } from "react";

export const metadata = {
  title: "Lifeline",
  description: "Liquidation radar and margin defender for Perpl on Monad.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
