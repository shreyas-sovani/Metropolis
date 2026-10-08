import type { MetadataRoute } from "next";
import { SITE } from "../lib/bounties";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dev/", "/api/"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
