import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./button.css";

type Variant = "primary" | "secondary" | "quiet";

type Common = {
  variant?: Variant;
  busy?: boolean;
  busyLabel?: string;
  className?: string;
  children: ReactNode;
};

type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { href?: undefined };

type LinkProps = Common & { href: string; prefetch?: boolean };

function classes(variant: Variant, className?: string): string {
  return ["ui-button", `ui-button-${variant}`, className].filter(Boolean).join(" ");
}

function label(busy: boolean, busyLabel: string | undefined, children: ReactNode): ReactNode {
  if (!busy) return children;
  return (
    <>
      <span className="ui-spinner" aria-hidden="true" />
      {busyLabel ?? children}
    </>
  );
}

export function Button(props: ButtonProps | LinkProps) {
  const variant = props.variant ?? "primary";
  const busy = props.busy === true;
  const className = classes(variant, props.className);
  const content = label(busy, props.busyLabel, props.children);
  if ("href" in props && props.href) {
    if (busy) return <span className={className} aria-disabled="true">{content}</span>;
    return (
      <Link href={props.href} className={className} prefetch={props.prefetch}>
        {content}
      </Link>
    );
  }
  const { variant: _variant, busy: _busy, busyLabel: _busyLabel, className: _className, children: _children, href: _href, disabled, type, ...rest } =
    props as ButtonProps & { href?: string };
  return (
    <button type={type ?? "button"} className={className} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {content}
    </button>
  );
}
