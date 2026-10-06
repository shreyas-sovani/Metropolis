export async function handleE2E(_request: Request): Promise<Response> {
  return Response.json({ error: "not found" }, { status: 404 });
}
