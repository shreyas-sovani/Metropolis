"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function Lookup() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  return (
    <form
      className="lookup"
      onSubmit={(event) => {
        event.preventDefault();
        const value = address.trim();
        if (value) router.push(`/a/${value}`);
      }}
    >
      <input
        name="address"
        aria-label="Account address"
        placeholder="0x…"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <button type="submit">Open</button>
    </form>
  );
}
