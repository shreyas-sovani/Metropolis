"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { StatusPill } from "./status-pill";
import { LifelineTrace } from "./trace";
import "./site-header.css";

const LINKS = [
  { href: "/radar", label: "Market risk", prefetch: undefined },
  { href: "/check", label: "Check an address", prefetch: false },
  { href: "/proof", label: "Proof", prefetch: false },
  { href: "/developers", label: "Developers", prefetch: false },
] as const;

function current(href: string, pathname: string): "page" | undefined {
  return pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = [...panel.querySelectorAll<HTMLElement>("a, button")];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || nodes.length === 0) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="site-brand">
          <span className="site-brand-name">Lifeline</span>
          <LifelineTrace height={20} />
        </Link>
        <button
          ref={menuRef}
          type="button"
          className="site-menu-btn"
          aria-expanded={open}
          aria-controls="site-menu"
          data-hydrated={hydrated ? "yes" : "no"}
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>
        <nav ref={panelRef} id="site-menu" className={open ? "site-nav is-open" : "site-nav"} aria-label="Primary">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} prefetch={link.prefetch} aria-current={current(link.href, pathname)}>
              {link.label}
            </Link>
          ))}
          <Link className="site-nav-extra" href="/tour" prefetch={false}>
            Judge tour
          </Link>
          <Button className="site-nav-extra" href="/app" variant="primary" prefetch={false}>
            Protect a position
          </Button>
        </nav>
        <div className="site-tools">
          <StatusPill />
          <Link className="site-tour" href="/tour" prefetch={false}>
            Judge tour
          </Link>
          <Button className="site-cta" href="/app" variant="primary" prefetch={false}>
            Protect a position
          </Button>
        </div>
      </div>
    </header>
  );
}
