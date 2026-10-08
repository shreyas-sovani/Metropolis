"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { RISK_EXAMPLE, riskCurl, runPanel, type RunPanel } from "../../../lib/api-docs";
import { ADDRESS_ERROR } from "../../../lib/landing";
import { Button } from "../../ui/button";
import { Field } from "../../ui/field";
import { Input } from "../../ui/input";
import { Select } from "../../ui/select";

export function RiskRunner() {
  const [address, setAddress] = useState(RISK_EXAMPLE);
  const [chain, setChain] = useState<"143" | "10143">("143");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<RunPanel | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const curl = riskCurl(address.trim(), chain === "10143" ? 10143 : 143);

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
    } catch {
      const area = document.createElement("textarea");
      area.value = curl;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
  }

  async function run() {
    const next = address.trim();
    if (!isAddress(next)) {
      setError(ADDRESS_ERROR);
      setResult(null);
      return;
    }
    setError("");
    setBusy(true);
    const started = performance.now();
    try {
      const response = await fetch(`/api/v1/risk/${next}?chain=${chain}`);
      const body = await response.text();
      setResult(runPanel(response.status, body, performance.now() - started));
    } catch {
      setResult(runPanel(502, "", performance.now() - started));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-run">
      <div className="dev-curl">
        <pre>
          <code data-testid="curl">{curl}</code>
        </pre>
        <Button variant="secondary" data-ready={ready ? "yes" : "no"} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="dev-run-row">
        <Field label="Address" htmlFor="risk-address" error={error}>
          <Input
            id="risk-address"
            mono
            value={address}
            spellCheck={false}
            aria-describedby={error ? "risk-address-error" : undefined}
            onChange={(event) => {
              setAddress(event.target.value);
              setCopied(false);
            }}
          />
        </Field>
        <Field label="Chain" htmlFor="risk-chain">
          <Select id="risk-chain" value={chain} onChange={(event) => setChain(event.target.value === "10143" ? "10143" : "143")}>
            <option value="143">Mainnet</option>
            <option value="10143">Testnet</option>
          </Select>
        </Field>
        <Button variant="primary" data-ready={ready ? "yes" : "no"} onClick={() => void run()} busy={busy} busyLabel="Running…">
          Run
        </Button>
      </div>
      {result ? (
        <div data-testid="risk-run">
          <p className="dev-meta" data-testid="risk-status">
            {result.status} · {result.latency}
          </p>
          {result.message ? (
            <p className="dev-limit" data-testid="risk-message" role="alert">
              {result.message}
            </p>
          ) : null}
          <pre>
            <code data-testid="risk-json">{result.json}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}
