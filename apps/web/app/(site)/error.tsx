"use client";

import { ErrorState } from "../ui/error-state";

export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
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
  );
}
