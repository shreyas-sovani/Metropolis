import { evaluate } from "@lifeline/core";

/** Worker-side handle on the runtime-agnostic core. The Durable Object calls this, not a copy of the math. */
export function coreEvaluator(): typeof evaluate {
  return evaluate;
}
