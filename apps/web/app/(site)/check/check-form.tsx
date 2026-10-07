"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CHECK_H1, CHECK_SUB, checkTarget, type ReportChain } from "../../../lib/report";
import { Button } from "../../ui/button";
import { Field } from "../../ui/field";
import { Input } from "../../ui/input";
import { Select } from "../../ui/select";
import { ExampleLinks } from "./example-links";
import "./check.css";

export function CheckForm() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<ReportChain>("143");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = checkTarget(address, chain);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    router.push(result.href);
  }

  return (
    <div className="ui-scope">
      <main className="container check-page">
        <header className="check-head">
          <h1>{CHECK_H1}</h1>
          <p className="check-sub body-lg">{CHECK_SUB}</p>
        </header>
        <form onSubmit={onSubmit} noValidate data-ready={ready ? "yes" : "no"}>
          <div className="check-form">
            <Field label="Address" htmlFor="check-address">
              <Input
                id="check-address"
                name="address"
                mono
                value={address}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "check-address-error" : undefined}
                onChange={(event) => {
                  setAddress(event.target.value);
                  if (error) setError("");
                }}
              />
            </Field>
            <Field label="Chain" htmlFor="check-chain">
              <Select
                id="check-chain"
                value={chain}
                onChange={(event) => setChain(event.target.value === "10143" ? "10143" : "143")}
              >
                <option value="143">Mainnet</option>
                <option value="10143">Testnet</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              Check
            </Button>
          </div>
          {error ? (
            <p id="check-address-error" className="ui-field-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <ExampleLinks />
      </main>
    </div>
  );
}
