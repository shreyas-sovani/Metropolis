import type { MetadataRoute } from "next";
import { SITE } from "../lib/bounties";

const PATHS = ["", "/app", "/radar", "/check", "/proof", "/twins", "/replay", "/methodology", "/developers", "/tour", "/tour/evidence"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: `${SITE}${path || "/"}`,
    lastModified: new Date(),
  }));
}
