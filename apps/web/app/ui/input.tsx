import type { InputHTMLAttributes } from "react";
import "./field.css";

export function Input({ mono = false, className, ...props }: { mono?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const names = ["ui-input", mono ? "ui-input-mono" : "", className].filter(Boolean).join(" ");
  return <input className={names} {...props} />;
}
