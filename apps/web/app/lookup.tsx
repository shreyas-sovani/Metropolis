"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function Lookup() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<"143" | "10143">("143");
  return (
    <form
      className="lookup"
      onSubmit={(event) => {
        event.preventDefault();
        const value = address.trim();
        if (value) router.push(`/a/${value}?chain=${chain}`);
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
      <select aria-label="Chain" value={chain} onChange={(event) => setChain(event.target.value === "10143" ? "10143" : "143")}>
        <option value="143">Mainnet</option>
        <option value="10143">Testnet</option>
      </select>
      <button type="submit">Open</button>
    </form>
  );
}
