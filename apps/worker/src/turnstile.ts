export type TurnstilePlan = { action: "skip" } | { action: "reject" } | { action: "verify"; token: string };

/** Admin calls already hold the operator secret. Guest claims and sandbox arms do not. */
export function planTurnstile(admin: boolean, token: string): TurnstilePlan {
  if (admin) return { action: "skip" };
  if (!token) return { action: "reject" };
  return { action: "verify", token };
}

export function turnstileOk(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && "success" in body && body.success === true);
}

export function turnstileDenied(): Response {
  return Response.json({ error: "turnstile" }, { status: 403 });
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !secret) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!response.ok) return false;
  return turnstileOk(await response.json());
}

export function tokenFrom(header: string | null, body: { turnstileToken?: string } | null): string {
  return body?.turnstileToken?.trim() || header?.trim() || "";
}
