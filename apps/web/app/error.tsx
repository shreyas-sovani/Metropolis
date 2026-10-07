"use client";

import { ErrorState } from "./ui/error-state";
import { SiteChrome } from "./ui/site-chrome";

export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <SiteChrome>
      <div className="ui-scope">
        <div className="container section">
          <ErrorState
            title="This page didn't load"
            sentence="Reload it. Your funds are safe."
            action="Try again"
            onAction={reset}
          />
        </div>
      </div>
    </SiteChrome>
  );
}
