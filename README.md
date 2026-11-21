# Cells Edition

Portfolio site for Celeste Cuestas, a video editor from Honduras.

The landing page is a WebGL spiral of video cards: reels ride a vertical helix,
condense out of cloud banks at either end, and open into a fullscreen lightbox
on tap. Videos are hosted on Livepeer and played as adaptive HLS, decoded
straight into a three.js texture.

## Stack

- **Next.js 16** (App Router) on React 19
- **three.js** for the helix, with the card shaders in `lib/shaders/*.glsl`
  (loaded through `raw-loader`, configured in `next.config.ts`)
- **hls.js** for adaptive playback — Safari plays `.m3u8` natively, everything
  else needs the library to feed MediaSource
- **Livepeer** for video hosting, encoding and playback URLs
- **Upstash Redis** for the video library and hero settings
- **Vercel Blob** for the CV PDF
- **Tailwind 4** + shadcn/ui for the admin panel

## Layout

```
app/
  page.tsx              landing page — resolves cards, renders the carousel
  components/
    SpiralCarousel.tsx  the WebGL scene: helix, streams, lightbox
    CarouselExperience  loading gate in front of the scene
    HeroOverlay         tools, socials, CV download
  admin/                sign-in-gated dashboard
  api/admin/            upload, library and hero-settings routes
lib/
  library.ts            video library in Redis + card resolution
  livepeer.ts           Livepeer client and playback resolution
  hero-settings.ts      hero overlay content
  kv.ts                 shared Redis client
  admin-access.ts       the two accounts, sections and access levels
  admin-auth.ts         sign-in, member record and signed session cookie
proxy.ts                auth and per-section access for /admin and /api/admin
```

## Uploads

The browser mints a Livepeer asset through `/api/admin/livepeer-upload`, then
tus-uploads the file **directly to Livepeer** — the bytes never pass through
this app. The client polls `/api/admin/livepeer-upload/status` until the encode
is ready, then commits the entry to the library. `reconcileLibrary()` also runs
on every dashboard load, so assets added or removed in Livepeer Studio catch up
on their own.

### Watermark

Livepeer has no overlay feature for VOD, and the bytes never reach this app, so
the watermark is burned in **in the browser, before the tus upload**:
`lib/burn-watermark.ts` re-encodes the file with WebCodecs (via Mediabunny),
drawing the logo onto every frame. The logo (PNG/WebP) lives in Vercel Blob,
its placement settings in Redis (`lib/watermark-settings.ts`), and
`watermarkRect()` in `lib/watermark.ts` places it for both the admin preview
and the burn-in. Settings only apply to future uploads — a burned-in mark
can't be changed after the fact. Browsers without WebCodecs can still upload,
just without the watermark.

## Accounts

Two fixed accounts, listed in `lib/admin-access.ts`. The owner sees
everything and signs in with `ADMIN_PASSWORD` until it sets its own password.
The member's password and its access to each section (hidden, view or edit)
are set by the owner in the dashboard's Access section. Either account can
change its own password in Account, which signs its other devices out.
Passwords are stored in Redis as scrypt hashes (`admin:owner`,
`admin:member`); deleting `admin:owner` puts the owner back on
`ADMIN_PASSWORD` after a forgotten password. `proxy.ts` maps each `/api/admin` route to
a section: reads need "view", writes need "edit", and an unmapped route is
owner-only.

## Environment

```
ADMIN_PASSWORD          # owner's initial password (contact@cellsedition.com); also the HMAC key
LIVEPEER_API_KEY
KV_REST_API_URL         # Upstash Redis
KV_REST_API_TOKEN
BLOB_READ_WRITE_TOKEN   # Vercel Blob, for the CV
NEXT_PUBLIC_SITE_URL    # optional; falls back to the Vercel production URL
```

## Development

```bash
pnpm install
pnpm dev
```

To open the dev server from a phone on the same network, add its IP to
`allowedDevOrigins` in `next.config.ts` — Next 16's dev CSRF guard rejects
non-localhost origins otherwise.
