"use client";

import { useState } from "react";
import { addressUrl, txUrl } from "../../lib/explorer";
import { shortenHex } from "../../lib/format";
import "./tx-link.css";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" className="ui-chip-copy" onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  return (
    <span className="ui-chip">
      <span className="ui-chip-value">{shortenHex(hash)}</span>
      <CopyButton value={hash} />
      <a href={txUrl(chainId, hash)} target="_blank" rel="noopener noreferrer">
        Explorer
      </a>
    </span>
  );
}

export function AddressChip({ address, chainId }: { address: string; chainId: number }) {
  return (
    <span className="ui-chip">
      <span className="ui-chip-value">{shortenHex(address)}</span>
      <CopyButton value={address} />
      <a href={addressUrl(chainId, address)} target="_blank" rel="noopener noreferrer">
        Explorer
      </a>
    </span>
  );
}
