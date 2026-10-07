"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const PrivyGate = dynamic(() => import("./privy-gate").then((mod) => mod.PrivyGate), { ssr: false });

function needsWallet(pathname: string): boolean {
  return (
    pathname === "/lifeline" ||
    pathname.startsWith("/lifeline/") ||
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname.startsWith("/dev/")
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (!needsWallet(pathname)) return children;
  return <PrivyGate>{children}</PrivyGate>;
}
