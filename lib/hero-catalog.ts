// The hero overlay only shows tools/socials the admin dashboard can actually
// toggle, so the catalog is a closed set (fixed name + local logo per id)
// rather than free-form entries — there's no arbitrary-logo upload flow, and
// it leaves the admin a single editable field per social: the handle.
export type ToolId = "davinci-resolve" | "capcut" | "after-effects" | "premiere-pro";
export type SocialId = "instagram" | "tiktok" | "whatsapp";

export const TOOL_CATALOG: Record<ToolId, { name: string; src: string }> = {
  "davinci-resolve": { name: "DaVinci Resolve", src: "/logos/davinci-resolve.svg" },
  capcut: { name: "CapCut", src: "/logos/capcut.svg" },
  "after-effects": { name: "After Effects", src: "/logos/after-effects.svg" },
  "premiere-pro": { name: "Premiere Pro", src: "/logos/premiere-pro.svg" },
};

export const SOCIAL_CATALOG: Record<
  SocialId,
  { name: string; src: string; handleLabel: string; handlePlaceholder: string }
> = {
  instagram: {
    name: "Instagram",
    src: "/logos/instagram.svg",
    handleLabel: "Username",
    handlePlaceholder: "@cells.edition",
  },
  tiktok: {
    name: "TikTok",
    src: "/logos/tiktok.svg",
    handleLabel: "Username",
    handlePlaceholder: "@celestecuestas_",
  },
  whatsapp: {
    name: "WhatsApp",
    src: "/logos/whatsapp.svg",
    handleLabel: "Phone number",
    handlePlaceholder: "+504 3271 7013",
  },
};

/**
 * Builds the outbound URL from the handle alone, so the admin only ever fills
 * in one field per platform and can't save a handle that points somewhere the
 * label doesn't match. Spaces, a leading `@` and phone-number punctuation are
 * all tolerated — they're how the handles read on the platforms themselves.
 *
 * Returns "" for a handle with nothing usable in it, which callers treat the
 * same as a disabled social (no tile rendered).
 */
export function socialHref(id: SocialId, handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return "";

  switch (id) {
    case "instagram": {
      const username = trimmed.replace(/^@/, "");
      return username ? `https://www.instagram.com/${username}` : "";
    }
    case "tiktok": {
      const username = trimmed.replace(/^@/, "");
      return username ? `https://www.tiktok.com/@${username}` : "";
    }
    case "whatsapp": {
      // wa.me wants digits only — no `+`, spaces or dashes.
      const digits = trimmed.replace(/\D/g, "");
      return digits ? `https://wa.me/${digits}` : "";
    }
  }
}
