// Absolute URLs (og:image, canonical, sitemap) need an origin, and it differs
// per deployment. Vercel injects the production domain into
// VERCEL_PROJECT_PRODUCTION_URL, so previews and production both point at the
// canonical host without it being hardcoded here; NEXT_PUBLIC_SITE_URL takes
// over once a custom domain is attached.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_NAME = "Cells Edition";
export const SITE_TITLE = "Cells Edition — Celeste Cuestas, Video Editor";
export const SITE_DESCRIPTION =
  "Portfolio of Celeste Cuestas, a creative video editor from Honduras: social media content, Instagram Reels and polished video productions cut in DaVinci Resolve, CapCut, Premiere Pro and After Effects.";
