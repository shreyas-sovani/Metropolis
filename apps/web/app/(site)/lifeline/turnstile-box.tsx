"use client";

import { useEffect, useRef, useState } from "react";

/** Managed widget. `interaction-only` stays blank unless Cloudflare asks for a check. */
export function TurnstileBox({
  onToken,
  force = false,
  onWidget,
}: {
  onToken: (token: string) => void;
  force?: boolean;
  onWidget?: (widget: { reset: () => void }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const onWidgetRef = useRef(onWidget);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState("");
  onTokenRef.current = onToken;
  onWidgetRef.current = onWidget;

  useEffect(() => {
    let gone = false;
    let widgetId = "";
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const start = window.setTimeout(() => {
      if (gone) return;
      script.onload = () => {
        void fetch("/api/turnstile")
          .then((response) => response.json())
          .then((body: { siteKey?: string }) => {
            if (gone || !body.siteKey || !host.current || !window.turnstile) return;
            widgetId =
              window.turnstile.render(host.current, {
                sitekey: body.siteKey,
                appearance: force ? "always" : "interaction-only",
                callback: (token: string) => {
                  setReady(true);
                  onTokenRef.current(token);
                },
                "error-callback": () => setProblem("challenge"),
              }) ?? "";
            onWidgetRef.current?.({
              reset: () => {
                if (widgetId && window.turnstile?.reset) window.turnstile.reset(widgetId);
              },
            });
          })
          .catch(() => undefined);
      };
      document.head.appendChild(script);
    }, 0);
    return () => {
      gone = true;
      window.clearTimeout(start);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      script.remove();
    };
  }, [force]);

  return (
    <div>
      {force ? <p>Please confirm you're human.</p> : null}
      <div ref={host} data-testid="turnstile" data-turnstile={ready ? "ready" : "wait"} data-appearance={force ? "always" : "interaction-only"} data-turnstile-error={problem} />
    </div>
  );
}
