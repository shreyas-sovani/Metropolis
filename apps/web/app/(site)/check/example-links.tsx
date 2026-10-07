import { CHECK_EXAMPLES, exampleHref } from "../../../lib/report";
import { Button } from "../../ui/button";

export function ExampleLinks() {
  return (
    <div className="check-chips">
      {CHECK_EXAMPLES.map((example) => (
        <Button key={example.address} href={exampleHref(example)} variant="secondary" prefetch={false}>
          {example.label}
        </Button>
      ))}
    </div>
  );
}
