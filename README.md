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
  admin/                password-gated dashboard
  api/admin/            upload, library and hero-settings routes
lib/
  library.ts            video library in Redis + card resolution
  livepeer.ts           Livepeer client and playback resolution
  hero-settings.ts      hero overlay content
  kv.ts                 shared Redis client
  admin-auth.ts         password check and signed session cookie
proxy.ts                auth gate for /admin and /api/admin
```

## Uploads

The browser mints a Livepeer asset through `/api/admin/livepeer-upload`, then
tus-uploads the file **directly to Livepeer** — the bytes never pass through
this app. The client polls `/api/admin/livepeer-upload/status` until the encode
is ready, then commits the entry to the library. `reconcileLibrary()` also runs
on every dashboard load, so assets added or removed in Livepeer Studio catch up
on their own.

## Environment

```
ADMIN_PASSWORD          # single shared admin password; also the HMAC key
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
