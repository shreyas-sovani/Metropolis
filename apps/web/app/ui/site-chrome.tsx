"use client";

import type { ReactNode } from "react";
import { OpsHealthProvider } from "./ops-health";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { StatusBanner } from "./status-banner";
import { ToastProvider } from "./toast";
import { TourHost } from "./tour-state";

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <OpsHealthProvider>
      <ToastProvider>
        <div className="site">
          <a className="skip" href="#content">
            Skip to content
          </a>
          <SiteHeader />
          <StatusBanner />
          <div id="tour-rail">
            <TourHost />
          </div>
          <div className="legacy" id="content" tabIndex={-1}>
            {children}
          </div>
          <SiteFooter />
        </div>
      </ToastProvider>
    </OpsHealthProvider>
  );
}
