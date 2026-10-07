import type { ReactNode } from "react";
import { Button } from "./button";
import "./empty-state.css";

export function EmptyState({
  title,
  sentence,
  action,
  href,
  onAction,
}: {
  title: string;
  sentence: string;
  action?: string;
  href?: string;
  onAction?: () => void;
}) {
  return (
    <div className="ui-state">
      <h3>{title}</h3>
      <p>{sentence}</p>
      <StateAction action={action} href={href} onAction={onAction} />
    </div>
  );
}

export function StateAction({ action, href, onAction }: { action?: string; href?: string; onAction?: () => void }) {
  if (!action) return null;
  if (href) return <Button href={href} variant="secondary">{action}</Button>;
  return (
    <Button variant="secondary" onClick={onAction}>
      {action}
    </Button>
  );
}

export function StateFrame({ title, sentence, children }: { title: string; sentence: string; children?: ReactNode }) {
  return (
    <div className="ui-state">
      <h3>{title}</h3>
      <p>{sentence}</p>
      {children}
    </div>
  );
}
