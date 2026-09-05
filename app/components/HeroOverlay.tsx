import Image from "next/image";
import { Download } from "lucide-react";
import HeroBio from "@/components/HeroBio";
import { Button } from "@/components/ui/button";
import { SOCIAL_CATALOG, TOOL_CATALOG, socialHref } from "@/lib/hero-catalog";
import type { HeroSettings } from "@/lib/hero-settings";

// Sits between the canvas/cloud layers (z-1/2) and the fullscreen video
// lightbox (z-40+ in SpiralCarousel), so the lightbox backdrop naturally
// covers this chrome instead of it needing its own visibility logic.
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
      {/* z-20 on mobile only: the tools column shares this corner's left edge
          and comes later in the DOM, so at an equal z-index it would paint
          over the bio as it expands up into that band. Desktop keeps z-10 —
          the two never meet there, and the tools stay on top. */}
      {(bio || cv) && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[280px] sm:bottom-6 sm:left-6 sm:z-10 sm:max-w-[420px]">
          {/* On phones the bio sits directly over the video reels, where
              white-on-bright is unreadable, and it's long enough to want
              collapsing — both are HeroBio's job, and both stop at `sm`. */}
          {bio && <HeroBio bio={bio} />}
          {cv && (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<a href={cv.downloadUrl} download={cv.filename} />}
              /* Sized up on phones to a comfortable tap target, then back to
                 the `sm` variant's own metrics from the sm: breakpoint on. */
              className="pointer-events-auto mt-3 h-10 gap-2 border-white/15 bg-white/10 px-4 text-sm text-white/90 backdrop-blur-sm duration-200 hover:border-white/60 hover:bg-white/10 hover:text-white sm:h-7 sm:gap-1 sm:px-2.5 sm:text-[0.8rem]"
            >
              <Download aria-hidden className="size-4 sm:size-3.5" />
              Download CV
            </Button>
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
                  className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm sm:h-9 sm:w-9"
                >
                  {/* The tool marks are app icons that fill their tile far more
                      than the social glyphs do, so they scale on their own
                      ratio (~73% of the box) rather than the socials' 55%. */}
                  <Image
                    src={meta.src}
                    alt={meta.name}
                    width={32}
                    height={32}
                    className="h-8 w-8 sm:h-[23.4px] sm:w-[23.4px]"
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
                className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 sm:h-9 sm:w-9"
              >
                <Image src={meta.src} alt="" aria-hidden width={24} height={24} className="h-6 w-6 sm:h-5 sm:w-5" />
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
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/10 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 sm:h-9 sm:w-9"
            >
              <Image
                src={SOCIAL_CATALOG.whatsapp.src}
                alt=""
                aria-hidden
                width={24}
                height={24}
                className="h-6 w-6 sm:h-5 sm:w-5"
              />
            </a>
          )}
        </div>
      )}
    </>
  );
}
