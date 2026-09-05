import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Pages under /admin set their own title; everything else gets the brand
  // name appended.
  title: { default: SITE_TITLE, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Celeste Cuestas" }],
  creator: "Celeste Cuestas",
  publisher: SITE_NAME,
  keywords: [
    "Cells Edition",
    "Celeste Cuestas",
    "video editor",
    "video editing",
    "video editor Honduras",
    "freelance video editor",
    "social media content",
    "Instagram Reels editor",
    "short form video",
    "post-production",
    "motion graphics",
    "DaVinci Resolve",
    "CapCut",
    "Adobe Premiere Pro",
    "After Effects",
    "showreel",
    "portfolio",
  ],
  alternates: { canonical: "/" },
  // The og:image / twitter:image tags come from app/opengraph-image.png, which
  // Next picks up by file convention.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-video-preview": -1 },
  },
  category: "Video Production",
};

// The page is a full-bleed black canvas, so the mobile browser chrome should
// match it rather than flashing white around it.
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Each page places its own logo: the carousel wants it pinned over a
          full-viewport canvas, the admin pages want it in normal flow above
          scrolling content. A fixed one here would follow the admin page's
          scroll and sit on top of its header. */}
      <body className="min-h-full">{children}</body>
    </html>
  );
}
