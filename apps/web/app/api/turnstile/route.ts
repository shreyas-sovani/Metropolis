import { readSecret } from "../../../lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const siteKey = readSecret("TURNSTILE_SITE_KEY");
  if (!siteKey) return Response.json({ error: "turnstile" }, { status: 503 });
  return Response.json({ siteKey });
}
