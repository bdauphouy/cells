import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// One public route: the carousel. /admin is private and stays out.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
