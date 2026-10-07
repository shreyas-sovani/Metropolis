"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ADDRESS_ERROR, HERO_PLACEHOLDER } from "../../../lib/landing";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

export function HeroCheck() {
  const router = useRouter();
  const [error, setError] = useState("");

  function go(value: string) {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setError(ADDRESS_ERROR);
      return;
    }
    setError("");
    router.push(`/a/${getAddress(trimmed)}?chain=143`);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go(String(new FormData(event.currentTarget).get("address") ?? ""));
  }

  function onCheck(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const form = event.currentTarget.form;
    const field = form?.elements.namedItem("address");
    go(field instanceof HTMLInputElement ? field.value : "");
  }

  return (
    <div className="landing-check">
      <form onSubmit={onSubmit} noValidate>
        <label className="sr" htmlFor="hero-address">
          Perpl account address
        </label>
        <Input
          id="hero-address"
          name="address"
          mono
          placeholder={HERO_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "hero-address-error" : undefined}
        />
        <Button type="submit" variant="secondary" onClick={onCheck}>
          Check
        </Button>
      </form>
      {error ? (
        <p id="hero-address-error" className="ui-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
