import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/review/", "/tx/", "/receipt/", "/pay/"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
