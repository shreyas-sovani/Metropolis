import { DurableObject } from "cloudflare:workers";

/** The G3 soak keeps inserting a tick row every 2s. This build ends that alarm without deleting stored rows. */
export class Keeper extends DurableObject {
  override async alarm(): Promise<void> {}

  override async fetch(_request: Request): Promise<Response> {
    return Response.json({ stopped: true });
  }
}

export default {
  fetch(): Response {
    return Response.json({ stopped: true });
  },
};
