import Image from "next/image";
import { SOCIAL_CATALOG, TOOL_CATALOG, socialHref } from "@/lib/hero-catalog";
import type { HeroSettings } from "@/lib/hero-settings";

// Sits between the canvas/cloud layers (z-1/2) and the fullscreen video
// lightbox (z-40+ in SpiralCarousel), so the lightbox backdrop naturally
// covers this chrome instead of it needing its own visibility logic.
const CORNER_LABEL = "text-[10px] uppercase tracking-[0.16em] text-white/50";

export default function HeroOverlay({ settings }: { settings: HeroSettings }) {
  const bio = settings.bio.trim();
  const cv = settings.cv;
  const tools = settings.tools.filter((t) => t.enabled);
  // A handle that yields no link (empty, or punctuation only) is treated the
  // same as a disabled social — there's nothing to point the tile at.
  const socials = settings.socials
    .filter((s) => s.id !== "whatsapp" && s.enabled)
    .map((s) => ({ ...s, href: socialHref(s.id, s.handle) }))
    .filter((s) => s.href);
  const whatsapp = settings.socials
    .filter((s) => s.id === "whatsapp" && s.enabled)
    .map((s) => ({ ...s, href: socialHref(s.id, s.handle) }))
    .find((s) => s.href);

  return (
    <>
      {(bio || cv) && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[280px] sm:bottom-6 sm:left-6 sm:max-w-[420px]">
          {bio && (
            <>
              <p className={CORNER_LABEL}>About</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/90 sm:text-[14px]">{bio}</p>
            </>
          )}
          {cv && (
            <a
              href={cv.downloadUrl}
              download={cv.filename}
              className="pointer-events-auto mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[12px] text-white/90 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 hover:text-white"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden className="h-3.5 w-3.5">
                <path
                  d="M8 2v8m0 0 3-3m-3 3-3-3M3 13h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download CV
            </a>
          )}
        </div>
      )}

      {tools.length > 0 && (
        <div className="pointer-events-none absolute top-1/2 left-4 z-10 -translate-y-1/2 sm:left-6">
          <div className="flex flex-col items-start gap-2">
            {tools.map((tool) => {
              const meta = TOOL_CATALOG[tool.id];
              return (
                <div
                  key={tool.id}
                  title={meta.name}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm sm:h-9 sm:w-9"
                >
                  <Image
                    src={meta.src}
                    alt={meta.name}
                    width={23}
                    height={23}
                    className="h-[23.4px] w-[23.4px]"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mirrors the tools column on the opposite edge. WhatsApp is the last
          tile here rather than its own floating button, so every social shares
          one box style and the stack stays aligned on a single edge. */}
      {(socials.length > 0 || whatsapp) && (
        <div className="pointer-events-none absolute top-1/2 right-4 z-20 flex -translate-y-1/2 flex-col items-end gap-2 sm:right-6">
          {socials.map((social) => {
              const meta = SOCIAL_CATALOG[social.id];
            return (
              <a
                key={social.id}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                title={social.handle}
                aria-label={social.handle}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 sm:h-9 sm:w-9"
              >
                <Image src={meta.src} alt="" aria-hidden width={20} height={20} className="h-5 w-5" />
              </a>
            );
          })}

          {whatsapp && (
            <a
              href={whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
              title={whatsapp.handle || "WhatsApp"}
              aria-label={whatsapp.handle || "WhatsApp"}
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 sm:h-9 sm:w-9"
            >
              <Image
                src={SOCIAL_CATALOG.whatsapp.src}
                alt=""
                aria-hidden
                width={20}
                height={20}
                className="h-5 w-5"
              />
            </a>
          )}
        </div>
      )}
    </>
  );
}
