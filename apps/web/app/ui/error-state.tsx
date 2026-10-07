import { StateAction, StateFrame } from "./empty-state";
import "./error-state.css";

export function ErrorState({
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
    <div role="alert">
      <StateFrame title={title} sentence={sentence}>
        <StateAction action={action} href={href} onAction={onAction} />
      </StateFrame>
    </div>
  );
}
