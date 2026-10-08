import type { Metadata } from "next";
import { ProtectApp } from "./protect-app";

export const metadata: Metadata = {
  title: "Protect a position",
  description: "A testnet practice account with a live 15× BTC position and idle AUSD.",
};

export default function ProtectPage() {
  return <ProtectApp />;
}
