import CarouselExperience from "@/components/CarouselExperience";
import HeroOverlay from "@/components/HeroOverlay";
import { socialHref } from "@/lib/hero-catalog";
import { getHeroSettings, type HeroSettings } from "@/lib/hero-settings";
import { resolveCards } from "@/lib/library";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import Image from "next/image";

// The admin page writes to Redis without redeploying, so this route can't be
// statically frozen at build time — it has to re-read on every request.
export const dynamic = "force-dynamic";

// Nearly everything on this page is drawn into a WebGL canvas, so the markup a
// crawler sees is thin. This spells the same thing out in a form search
// engines can read, and it's built from the live hero settings so the profile
// links can't drift from the ones the overlay renders.
function profileJsonLd(settings: HeroSettings) {
  const sameAs = settings.socials
    .filter((social) => social.enabled)
    .map((social) => socialHref(social.id, social.handle))
    // WhatsApp is a contact method, not a profile a crawler should follow.
    .filter((href) => href && !href.startsWith("https://wa.me/"));

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    mainEntity: {
      "@type": "Person",
      name: "Celeste Cuestas",
      alternateName: SITE_NAME,
      jobTitle: "Video Editor",
      description: settings.bio,
      image: `${SITE_URL}/opengraph-image.png`,
      address: { "@type": "PostalAddress", addressCountry: "HN" },
      knowsAbout: [
        "Video editing",
        "Post-production",
        "Social media content",
        "Instagram Reels",
        "Motion graphics",
      ],
      ...(sameAs.length > 0 && { sameAs }),
    },
  };
}

export default async function Home() {
  const [cards, heroSettings] = await Promise.all([resolveCards(), getHeroSettings()]);
  return (
    <main
      // The hook globals.css uses to paint the overscroll gutter behind this
      // page in the brand black rather than the default light `--background`;
      // see the rule by the `.dark` block there.
      data-hero
      className="fixed inset-0 flex flex-col overflow-hidden bg-brand"
    >
      <script
        type="application/ld+json"
        // `<` is escaped so a stray `</script>` in an admin-authored bio can't
        // close this tag early.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(profileJsonLd(heroSettings)).replace(/</g, "\\u003c"),
        }}
      />
      {/* The only h1 on the page: the wordmark is the site's name, and without
          it a crawler sees a heading-less document. */}
      <h1 className="pointer-events-none absolute top-4 left-4 z-10 sm:top-6 sm:left-6">
        <Image
          src="/logo.svg"
          alt={`${SITE_NAME} — Celeste Cuestas, video editor`}
          width={140}
          height={91}
          className="h-10 w-auto sm:h-14"
          priority
        />
      </h1>
      <HeroOverlay settings={heroSettings} />
      <CarouselExperience cards={cards} />
    </main>
  );
}
