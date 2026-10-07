import type { SelectHTMLAttributes } from "react";
import "./field.css";

export function Select({ mono = false, className, children, ...props }: { mono?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  const names = ["ui-select", mono ? "ui-select-mono" : "", className].filter(Boolean).join(" ");
  return (
    <select className={names} {...props}>
      {children}
    </select>
  );
}
