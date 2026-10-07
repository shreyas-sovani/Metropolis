/** Vitest stand-in. Wrangler tests still run the real Durable Object runtime. */
export class DurableObject<Env> {
  ctx: unknown;
  env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
