"use client";

import fragmentShader from "@/lib/shaders/card.frag.glsl";
import vertexShader from "@/lib/shaders/card.vert.glsl";
import Hls from "hls.js";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ResolvedCard = {
  hlsUrl: string;
  posterUrl?: string;
  aspectRatio: string;
  title: string;
};

/* ── Video source ──────────────────────────────────────────────────────────
 * Served from Livepeer as adaptive HLS. Safari plays an .m3u8 natively
 * through `src`; every other engine needs hls.js to feed the stream into the
 * same plain <video> element via MediaSource — so a video element stays an
 * ordinary <video> either way, which is what lets THREE.VideoTexture read it
 * at all (a player wrapper would hide its <video> in shadow DOM, out of
 * reach). URLs come resolved from Livepeer's playback-info endpoint rather
 * than templated from a playback id, which Livepeer warns against.
 */

// hls.js's cold-start bandwidth guess (its default abrEwmaDefaultEstimate)
// is 500 Kbps, below the bottom rung Livepeer generates (~770 Kbps for a
// portrait clip) — so every fresh Hls instance starts at the lowest
// rendition no matter the real connection speed, then climbs once it's
// measured actual segment downloads. A fresh instance is created on every
// card activation and every fullscreen open, so that low-then-better dip
// was repeating constantly rather than happening once. Assuming a decent
// connection up front (above the top rung, ~2.2 Mbps) starts at the best
// rendition immediately; ABR still steps down for anyone who's actually
// slower.
const INITIAL_BANDWIDTH_ESTIMATE = 3_000_000;

/* ...which is right for the lightbox and wrong for a card. A card on the helix
 * is drawn at roughly 120x200 css px on a phone, so the estimate above puts
 * several *top-rung* streams on screen at once — each one decoded in full and
 * uploaded to the GPU whole on every decoded frame, to be sampled down into a
 * postage stamp. That is download, decode and upload all spent on detail that
 * cannot land on those pixels, and it is spent on the frames where the spiral
 * is moving.
 *
 * The ladder these assets actually publish is two rungs, ~770 Kbps and
 * ~2.2 Mbps, and its master playlist carries no RESOLUTION at all — so a cap
 * written against `level.height` would find nothing to compare and quietly
 * fall through to whatever its no-match branch did. Bitrate is the attribute
 * that is always there; height is only consulted when a manifest bothers to
 * declare it. Cards take the highest rung inside both limits, the lightbox
 * passes limits wide enough to keep the top one.
 */
const CARD_MAX_BITRATE = 1_500_000;
const CARD_MAX_BITRATE_MOBILE = 1_000_000;
const CARD_MAX_HEIGHT = 480;
const CARD_MAX_HEIGHT_MOBILE = 360;

/* The cap alone can't be trusted for the *first* fragment: hls.js reads its
 * start level through firstAutoLevel, and while that does honour
 * autoLevelCapping, our MANIFEST_PARSED listener is registered after the
 * library's own, so the read may already have happened. Handing a card stream
 * an estimate that lands on a capped rung anyway makes the two agree, and
 * neither depends on which listener ran first. The lightbox keeps the
 * optimistic figure — there the top rendition is the point.
 */
const CARD_BANDWIDTH_ESTIMATE = 1_200_000;

/* Each live stream also holds its own forward buffer. The default 30s of it,
 * times the streams alive at once, is a lot of memory and a lot of
 * appendBuffer work on the main thread for clips that loop in a few seconds.
 */
const CARD_BUFFER_S = 8;

/* The best rung inside both limits, by bitrate — falling back to the cheapest
 * rung there is when nothing qualifies, since a cap that matched nothing used
 * to mean "no cap at all", which is the opposite of what was asked for.
 */
const levelCapFor = (
  levels: readonly { bitrate: number; height?: number }[],
  maxBitrate: number,
  maxHeight: number,
) => {
  let cap = -1;
  let cheapest = 0;
  for (let i = 0; i < levels.length; i++) {
    const { bitrate, height } = levels[i];
    if (bitrate < levels[cheapest].bitrate) cheapest = i;
    if (bitrate > maxBitrate) continue;
    if (height && height > maxHeight) continue;
    if (cap === -1 || bitrate > levels[cap].bitrate) cap = i;
  }
  return cap === -1 ? cheapest : cap;
};

type HlsOptions = {
  maxBitrate: number;
  maxHeight: number;
  card?: boolean;
  /* Where playback should begin. Handed to hls.js as config rather than set
   * on the element afterwards: assigning `currentTime` to a MediaSource that
   * has nothing buffered yet is a seek, so hls.js fetches a fragment at zero,
   * throws it away, and fetches another at the real position — two downloads
   * and a stall, landing on the frames the open animation needs. As config it
   * simply picks the right first fragment. -1 is the library's "from the
   * start" sentinel. */
  startPosition?: number;
};

function attachHls(
  el: HTMLVideoElement,
  src: string,
  { maxBitrate, maxHeight, card = false, startPosition = -1 }: HlsOptions,
): Hls | null {
  el.crossOrigin = "anonymous"; // cross-origin now; without this the WebGL
  // texture upload throws a tainted-canvas security error.
  if (Hls.isSupported()) {
    const hls = new Hls(
      card
        ? {
            abrEwmaDefaultEstimate: CARD_BANDWIDTH_ESTIMATE,
            maxBufferLength: CARD_BUFFER_S,
            backBufferLength: 0,
          }
        : { abrEwmaDefaultEstimate: INITIAL_BANDWIDTH_ESTIMATE, startPosition },
    );
    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error("hls.js error", data);
    });
    // Levels aren't known until the manifest lands.
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (hls.levels.length > 0)
        hls.autoLevelCapping = levelCapFor(hls.levels, maxBitrate, maxHeight);
    });
    hls.loadSource(src);
    hls.attachMedia(el);
    return hls;
  }
  // Safari (and anything else with native HLS support): no library needed.
  // Its own player picks the rendition and won't take a cap from us — the
  // start position it will take, but only once it knows the duration.
  el.src = src;
  if (startPosition > 0)
    el.addEventListener(
      "loadedmetadata",
      () => {
        el.currentTime = startPosition;
      },
      { once: true },
    );
  return null;
}

function parseAspect(aspectRatio: string): [number, number] {
  const [w, h] = aspectRatio.split(":").map(Number);
  return w > 0 && h > 0 ? [w, h] : [16, 9];
}

/* ── Helix ─────────────────────────────────────────────────────────────────
 * Cards ride a vertical helix: each one orbits the y axis a little further
 * round and climbs a little higher than the last, its plane kept tangent to
 * the cylinder so the strip reads as a spiral staircase from the camera.
 */
const CARD_H = 1.5;
const CARD_W = (CARD_H * 9) / 16; // Reels are 9:16
const ANGLE_GAP = 0.85; // radians of orbit per card
const SEGMENTS = 20;

/* How wide the helix orbits, and how far back the camera sits. A portrait
 * phone frustum is roughly half as wide as it is tall, so the desktop pair
 * pushes the cards either side of the front one clean off the left and right
 * edges — and a card whose centre never enters the NDC square never earns a
 * live stream either, which is what made clips sit on their poster for
 * seconds at a time. Narrowing the orbit and backing the camera off fits the
 * whole width of the spiral on screen; the two move together because backing
 * off alone would shrink the front card past the point it reads.
 */
const RADIUS = 2;
const RADIUS_MOBILE = 1.6;
const CAMERA_Z = 8;
const CAMERA_Z_MOBILE = 9.2;

/* World units of climb per card. A phone is narrow, so the same climb that
 * reads as a comfortable stride on a desktop leaves the cards stranded far
 * apart on a tall screen — the spiral stops reading as one strip. The angular
 * gap is the one that keeps cards from crossing, so only the climb is
 * shortened; see the no-crossing note below for what that costs.
 */
const VERTICAL_GAP = 0.62;
const VERTICAL_GAP_MOBILE = 0.38;
const MOBILE_WIDTH = 768;

/* How many distinct clips the mobile spiral cycles through before looping —
 * see the note by `cardCount` for why fewer total cards is its own perf lever
 * on a phone, separate from how many of them are live at once.
 */
const CARD_COUNT_MOBILE = 10;

/* No two cards may ever intersect. A curled card reaches its neighbour's plane
 * at (radius + CURL)*cos(a) + (CARD_W/2)*sin(a) - radius, which only stays
 * negative past 0.640 rad at the desktop radius and past 0.737 at the tighter
 * mobile one — so ANGLE_GAP clears it either way. Pairs 7, 8 and 15 steps
 * apart do land back inside that wedge, since a multiple of ANGLE_GAP comes
 * back near a multiple of 2*PI there, but by then they sit far enough apart
 * vertically to clear CARD_H at full swell (2.55 world units) — 4.3 at the
 * desktop climb, and 2.66 at the shorter mobile one, which is what floors
 * VERTICAL_GAP_MOBILE. The speed distortions in the shader are bounded so
 * they preserve this margin.
 */

/* The card whose plane squarely faces the camera is the one a quarter turn
 * along, not the one at angle 0 — and by then the helix has already climbed.
 * Drop the helix by that much to land it mid-viewport, plus a little more by
 * eye. (The reference hardcodes -0.8, which is this same figure for its own
 * constants.)
 */
const centerYFor = (verticalGap: number) =>
  (-Math.PI / 2 / ANGLE_GAP) * verticalGap;

/* ── Motion ────────────────────────────────────────────────────────────────
 * One eased scalar drives everything: `speed` (cards per 60Hz frame) chases
 * `targetSpeed`, which decays back to a slow idle drift. The spiral never
 * fully stops, like the reference.
 */
const EASING = 0.1;
const DECAY = 0.9;
const IDLE_SPEED = 0.0022;
const MAX_SPEED = 0.85;
const WHEEL_SENS = 0.00016;
/* A thumb swipe crosses most of a phone screen in one flick, so the desktop
 * pixels-to-cards rate sends the spiral past several cards at once — too fast
 * to read, and fast enough to keep tripping the BUSY_SPEED gate that holds
 * new streams back.
 *
 * Slower still than that first cut: a card is marked a live-stream candidate
 * while it's still mostly hazy (see the fog gate around `candidates.push`),
 * which only buys anything if the card then spends real time behind that
 * haze before it needs to show a frame. At the old cap a fast flick could
 * cross the whole dissolve zone in a few hundred ms — less than a manifest
 * fetch plus a first segment — so the stream was still spinning up when the
 * card arrived. The cap below roughly doubles that window.
 */
const DRAG_SENS = 0.0024;
const DRAG_SENS_MOBILE = 0.0008;
const MAX_SPEED_MOBILE = 0.3;

/* ── Distortion ──────────────────────────────────────────────────────────── */
const CURL = 0.18; // how far the middle of a card bulges outward, always on
const LENS = 0.07; // parabolic bow: the spiral leans as it runs off-screen
const WHIP = 1.1; // lateral smear proportional to scroll speed
const SQUASH = 0.4; // vertical pinch under speed, capped in the shader

/* ── Cloud bank ────────────────────────────────────────────────────────────
 * Both ends of the spiral run into haze. A leaving card goes soft, milky and
 * then torn apart in wisps by the shader, while banks of drifting vapour sit
 * over the same stretch of screen — so it reads as a card swallowed by cloud
 * rather than a card being turned off.
 */
/* Measured in screen space, not world space: the helix hangs below the origin
 * and its cards sit at every depth, so a world-height rule would have one end
 * dissolving mid-viewport and the other already gone over the edge. */
const FOG_START = 0.55; // |ndc y| where the haze starts taking the card...
const FOG_END = 1.05; // ...and where it has taken all of it

/* The same dissolve keyed to raw helix height, taken as a floor, so a card
 * that reaches the wrap without leaving the screen — a far one on a tall
 * viewport — still goes to cloud rather than simply stopping.
 *
 * Written as fractions of the depth a card is fully gone by, rather than as
 * world distances squeezed to fit inside it. The distinction is what the top
 * of a phone screen turned on. The screen-space ramp above is symmetric in
 * |ndc y| while the helix hangs below the origin, so its two ends reach very
 * different heights: on a phone the bottom of the spiral gets to about -0.9
 * and hazes properly, and the top only reaches +0.77 — never leaving the
 * ramp's first third. Everything visible at the top was therefore left to
 * this ramp, which as absolute distances landed at 81%-98% of the reachable
 * depth: a dissolve a slot and a half wide, finishing after the hard cutoff
 * had already started fading the card out. What you saw was the fade.
 *
 * As fractions it spans the same share of the spiral whatever the climb, so
 * the dissolve is three or four cards deep at both ends and on both device
 * classes, and the cutoff begins only once the vapour has finished — it is
 * insurance that the wrap point stays hidden, not part of the effect.
 * Desktop is unchanged in practice: its screen-space ramp still reaches 1
 * well before this one contributes anything.
 */
const WRAP_FOG_START = 0.55;
const WRAP_FOG_END = 0.94;
const CUT_END = 1;

const depthRamp = (cardCount: number, verticalGap: number) => {
  // The deepest a card is allowed to still be visible at: `b` runs from
  // -(cardCount - 1)/2 slots, and anything past that is fully cut already.
  const limit = ((cardCount - 1) / 2) * verticalGap;
  return {
    wrapFogStart: WRAP_FOG_START * limit,
    wrapFogEnd: WRAP_FOG_END * limit,
    cutStart: WRAP_FOG_END * limit,
    cutEnd: CUT_END * limit,
  };
};

/* How much the plane outgrows its card at full fog, to leave the soft border
 * somewhere to spill. Bounded by the same no-crossing rule as everything else:
 * a card only reaches its neighbour's plane past 1.77x its width.
 */
const FOG_SWELL = 0.7;

/* ── Reveal ──────────────────────────────────────────────────────────────── */
const REVEAL_EASING = 0.055;
const REVEAL_STAGGER = 0.05; // seconds between each card's entrance

/* A hovered card only counts as truly clickable — worth naming — once it's
 * fully settled: past its entrance, not yet dissolving into a cloud bank,
 * and not fading for the lightbox. Raycasting alone doesn't know any of
 * this, since it hits a card's geometry even where the shader has already
 * discarded that card down to a wisp. */
const TITLE_REVEAL_MIN = 0.97;
const TITLE_FOG_MAX = 0.15;
const TITLE_OPACITY_MIN = 0.9;

/* ── Live video activation ────────────────────────────────────────────────
 * Every card has its own clip now, so decoding all of them at once isn't an
 * option — bandwidth and browser decode limits both break well before 18
 * concurrent streams. Each card shows a static thumbnail by default and
 * only gets a real <video> + hls.js decode once it's actually on screen (or
 * hovered, which implies on screen too). Cards spend most of the spiral off
 * in the cloud banks at either end, so only a handful are ever live at once
 * despite there being no hard cap.
 */
const VIEWPORT_ACTIVATE = 0.92; // NDC radius a card must enter to start decoding
const VIEWPORT_DEACTIVATE = 1.08; // ...and must drift back past to stop — the
// gap between the two is hysteresis, so a card sitting near the edge doesn't
// restart its stream every frame.
/* Measured on the card's centre, so a tall card that is half on screen still
 * counts as out. On a phone that meant a clip only began decoding once it was
 * most of the way to the middle, then needed its manifest and first segment on
 * top of that. Starting a little before the card lands gives the stream that
 * head start; the live-stream budget below still decides who actually gets one.
 */
const VIEWPORT_ACTIVATE_MOBILE = 1.1;
const VIEWPORT_DEACTIVATE_MOBILE = 1.3;

/* Every card you can see is meant to be playing. The cap exists only so a
 * pathological viewport can't ask for an unbounded number of decoders — it is
 * set above the number of cards that clear the cloud banks at either end (13
 * on a phone, 9 on a desktop, over an 18-card spiral), so in practice it never
 * binds and the whole visible stretch of the spiral is live at once.
 *
 * This is deliberately more than the device would choose for itself. Each live
 * card is a MediaSource decode, and mobile takes the bottom rung of the ladder
 * (see CARD_MAX_BITRATE_MOBILE) precisely so a dozen of them fit; the texture
 * uploads are already paid only on frames the decoder actually produced, since
 * three's VideoTexture drives them off requestVideoFrameCallback rather than
 * off the render loop. If a device does run out of decoders the symptom is
 * cards stalling on a half-decoded frame, and these are the numbers to lower.
 */
const MAX_LIVE = 10;
const MAX_LIVE_MOBILE = 14;

/* Reconciling at 60Hz meant a fast flick tore down and rebuilt streams every
 * few frames, and building one is expensive enough (MediaSource attach,
 * manifest fetch, first segment) to be felt as a stutter. Three things keep
 * that from happening: decide at 10Hz rather than every frame, hold new
 * streams back while the spiral is moving fast enough that nothing on it can
 * be read anyway, and let a card that has left keep its stream (paused) long
 * enough to cover a flick and its coast, so coming back costs nothing.
 */
const RECONCILE_MS = 100;
/* Cards/frame above which new streams wait. Sits at mobile's own speed cap
 * (MAX_SPEED_MOBILE), so this gate is now effectively a desktop-only guard —
 * mobile's cap is the thing doing the work there, slow enough that starting a
 * stream mid-scroll is never a bad bet. Left shared rather than split by
 * device, since desktop's faster cap is what still needs a threshold to duck
 * under.
 */
const BUSY_SPEED = 0.3;
const LIVE_GRACE_MS = 2500; // a departed card keeps its stream this long
/* Several at a time rather than one: at 10Hz, one-at-a-time took over a second
 * to fill a phone's worth of cards, which is the whole of a first impression
 * spent watching posters. Still not all at once — a dozen MediaSource attaches
 * in a single tick is one long frame, and this spreads them over three.
 */
const ACTIVATIONS_PER_TICK = 4;

/* ── Fullscreen ────────────────────────────────────────────────────────────
 * A tap grows the card from its exact on-screen rect into a real
 * <video controls> element — a lightbox, not a modal bolted on top. The
 * card's mesh hides the instant the clone appears in its place, so the
 * handoff reads as one continuous shape rather than a swap.
 */
/* ── Background grid ──────────────────────────────────────────────────────
 * A faint white grid sits behind the cards at all times; a brighter patch
 * tracks the pointer, like a flashlight passing over graph paper.
 */
const GRID_SIZE = 48; // px between lines
const GRID_BASE_ALPHA = 0.08; // always-on grid line opacity, everywhere
const GRID_SPOT_ALPHA = 0.06; // extra opacity layered on near the pointer
const GRID_SPOT_RADIUS = 320; // px, spotlight falloff radius

const OPEN_MS = 600;
const CLOSE_MS = 480;
const CARD_RADIUS_PX = 14; // how rounded the player looks while still card-sized
const SWAP_MS = 150; // crossfade between the curled mesh and the flat player
const CLOSE_FADE_LEAD_MS = 120; // finish the close fade this long before the shrink stops moving
const HIDE_EASING = 0.25; // per-frame pull toward the crossfade target
const CLICK_MOVE_THRESHOLD = 6; // px of drag before a tap stops counting as a click
const CLICK_TIME_THRESHOLD = 350; // ms

type Card = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  index: number;
  delay: number;
  reveal: number;
  hover: number;
  hiding: number;
  hlsUrl: string;
  title: string;
  posterTexture: THREE.Texture;
  aspectW: number;
  aspectH: number;
  liveVideo?: HTMLVideoElement;
  liveHls?: Hls | null;
  liveTexture?: THREE.VideoTexture;
  // When the card stopped qualifying for a live stream. Undefined while it
  // still qualifies; the stream is torn down once this is old enough.
  idleSince?: number;
  // Distance from the middle of the screen, in NDC — how the limited number
  // of live streams is handed out. Recomputed every frame.
  priority: number;
  // Whether the last reconciliation pass gave this card one of them.
  wantsLive: boolean;
};

export default function SpiralCarousel({
  cards: videos,
}: {
  cards: ResolvedCard[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const brand = getComputedStyle(document.documentElement)
      .getPropertyValue("--brand")
      .trim();
    // Cloud is lit, not shaded: the brand hue kept, but taken almost all the
    // way to white, so a card dissolves into light rather than into the dark.
    const fogColor = new THREE.Color(brand).lerp(
      new THREE.Color(0xffffff),
      0.8,
    );

    /* Device class, fixed for the life of the mount. A phone doesn't stop
     * being a phone on rotation, and the two things keyed off this — the
     * shader's quality branch and the antialias buffer — are both baked in at
     * WebGL context/program creation, so re-deciding them later would mean
     * recompiling shaders mid-scroll. The viewport-width decisions (climb,
     * field of view, live-stream budget) are separate and do follow resizes.
     */
    const touchOnly = window.matchMedia("(hover: none)").matches;
    const lowPower = touchOnly || window.innerWidth < MOBILE_WIDTH;

    const renderer = new THREE.WebGLRenderer({
      // The card edges are drawn by the fragment shader's own signed-distance
      // falloff, so MSAA only smooths the geometry seams behind them — not
      // worth a multisampled buffer's fill cost on a phone.
      antialias: !lowPower,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(new THREE.Color(brand), 0);
    const canvas = renderer.domElement;
    canvas.style.cssText =
      "position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%";

    const gridLines = (alpha: number) =>
      `linear-gradient(rgba(255,255,255,${alpha}) 1px, transparent 1px),` +
      `linear-gradient(90deg, rgba(255,255,255,${alpha}) 1px, transparent 1px)`;
    const gridBase = document.createElement("div");
    gridBase.style.cssText = `position:absolute;inset:0;z-index:0;pointer-events:none;background-image:${gridLines(GRID_BASE_ALPHA)};background-size:${GRID_SIZE}px ${GRID_SIZE}px;`;
    // The spotlight follows a pointer that a touch device doesn't have. It
    // costs a full-viewport masked repaint per pointer event, so on touch it
    // is never created rather than sitting at 0 opacity waiting for one.
    const gridSpot = touchOnly ? null : document.createElement("div");
    if (gridSpot)
      gridSpot.style.cssText = `position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 0.4s ease;background-image:${gridLines(GRID_SPOT_ALPHA)};background-size:${GRID_SIZE}px ${GRID_SIZE}px;`;
    host.appendChild(gridBase);
    if (gridSpot) host.appendChild(gridSpot);
    host.appendChild(canvas);

    // Hovered card's title, as a fixed pill anchored to the bottom of the
    // page rather than tracking the card — the card is mid-spiral, curling
    // and dissolving, so anchoring text to it would fight the motion instead
    // of reading calmly.
    const titleLabel = document.createElement("div");
    titleLabel.style.cssText =
      "position:fixed;z-index:30;left:50%;bottom:32px;pointer-events:none;background:#fff;color:#111;font-size:13px;font-weight:500;letter-spacing:0.01em;padding:10px 20px;border-radius:9999px;box-shadow:0 10px 30px rgba(0,0,0,0.18);opacity:0;transform:translate(-50%,6px);transition:opacity 0.25s ease,transform 0.25s ease;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(titleLabel);

    // Vapour over both ends of the spiral. Two layers per bank, drifting at
    // different speeds, so the haze keeps moving without ever reading as a
    // repeating pattern — except on a phone, where each layer is one more
    // `screen`-blended element the compositor has to read the canvas back
    // for. The far layer is the faint one, so that is the one dropped.
    const bankLayers = lowPower ? 1 : 2;
    const banks = (["top", "bottom"] as const).map((side) => {
      const bank = document.createElement("div");
      bank.className = `cloud-bank cloud-bank--${side}${lowPower ? " cloud-bank--flat" : ""}`;
      for (let layer = 0; layer < bankLayers; layer++) {
        const puffs = document.createElement("div");
        puffs.className = `cloud-puffs cloud-puffs--${layer === 0 ? "near" : "far"}`;
        bank.appendChild(puffs);
      }
      host.appendChild(bank);
      return bank;
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, CAMERA_Z);
    // The loop projects card centres before the first render, which is what
    // would otherwise fill this in.
    camera.updateMatrixWorld();

    const geometry = new THREE.PlaneGeometry(
      CARD_W,
      CARD_H,
      SEGMENTS,
      SEGMENTS,
    );
    const planeSizes = new THREE.Vector2(CARD_W, CARD_H);

    const textureLoader = new THREE.TextureLoader();

    // Livepeer doesn't guarantee a thumbnail for every asset, so a card
    // without one shows a flat fog-toned fill until its video activates.
    const makeFallbackTexture = () => {
      const { r, g, b } = fogColor;
      const pixel = new Uint8Array([r * 255, g * 255, b * 255, 255]);
      const texture = new THREE.DataTexture(pixel, 1, 1);
      texture.needsUpdate = true;
      return texture;
    };

    /* The library drives the card count directly: fewer than MIN_CARDS videos
     * loop round to reach it, MIN_CARDS or more get one card each — except on
     * a phone, where a shorter loop means fewer distinct <video> elements and
     * hls.js instances ever exist at once, not just fewer live at a time. The
     * spiral's visible window is a fixed share of the loop regardless of its
     * length (radius, gap and camera are unrelated to card count), so a
     * shorter loop doesn't show less of the spiral — it just cycles through
     * fewer clips to fill it, and caps how much the app ever has to hold in
     * memory. Gated on `lowPower`, not the reactive `mobile` resize() derives:
     * this decides how many meshes exist at all, which happens once at mount
     * alongside the geometry itself.
     */
    const cardCount = lowPower
      ? Math.min(videos.length, CARD_COUNT_MOBILE)
      : videos.length;

    // Layout that follows the viewport rather than the device, filled in by
    // the first resize() below and kept current from then on.
    let verticalGap = VERTICAL_GAP;
    let centerY = centerYFor(verticalGap);
    let ramp = depthRamp(cardCount, verticalGap);
    let maxLive = MAX_LIVE;
    let cardMaxHeight = CARD_MAX_HEIGHT;
    let cardMaxBitrate = CARD_MAX_BITRATE;
    let radius = RADIUS;
    let dragSens = DRAG_SENS;
    let maxSpeed = MAX_SPEED;
    let viewportActivate = VIEWPORT_ACTIVATE;
    let viewportDeactivate = VIEWPORT_DEACTIVATE;

    const cards: Card[] = [];
    for (let i = 0; i < cardCount; i++) {
      const video = videos[i];
      const [aspectW, aspectH] = parseAspect(video.aspectRatio);
      const posterTexture = video.posterUrl
        ? textureLoader.load(video.posterUrl)
        : makeFallbackTexture();
      posterTexture.colorSpace = THREE.SRGBColorSpace;
      /* Sampled exactly like the video texture that replaces it, so the swap
       * is a swap and not a change of look. TextureLoader's defaults are a
       * mipmapped minFilter, and gl.generateMipmap box-filters the stored
       * bytes — which for an sRGB texture means averaging gamma-encoded
       * values, so every level down comes out darker than a correct average.
       * A card is a postage stamp: the sampler sits a level or two down the
       * chain there, well into the darkening, while the video texture has no
       * chain at all. That is the dark filter that lifts the moment a clip
       * starts — the same frames, correctly exposed for the first time.
       */
      posterTexture.minFilter = THREE.LinearFilter;
      posterTexture.magFilter = THREE.LinearFilter;
      posterTexture.generateMipmaps = false;

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        // Both of the fragment shader's expensive passes — the 13-tap
        // diffusion behind a card and the vapour noise that tears it apart —
        // are cut down under this. See card.frag.glsl.
        defines: lowPower ? { LOW_QUALITY: "" } : {},
        uniforms: {
          uTexture: { value: posterTexture },
          uPlaneSizes: { value: planeSizes },
          uImageSizes: { value: new THREE.Vector2(aspectW, aspectH) },
          uCurl: { value: CURL },
          uSquash: { value: SQUASH },
          uCenterY: { value: centerY },
          uLens: { value: LENS },
          uWhip: { value: WHIP },
          uScrollSpeed: { value: 0 },
          uZoom: { value: 1 },
          uReveal: { value: 0 },
          uOpacity: { value: 1 },
          uHighlight: { value: 0 },
          uFog: { value: 0 },
          uSwell: { value: 1 },
          uFogDir: { value: 1 },
          uFogColor: { value: fogColor },
          uTime: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      cards.push({
        mesh,
        index: i,
        delay: (i % 4) * REVEAL_STAGGER,
        reveal: 0,
        hover: 0,
        hiding: 0,
        hlsUrl: video.hlsUrl,
        title: video.title,
        posterTexture,
        aspectW,
        aspectH,
        priority: Infinity,
        wantsLive: false,
      });
    }
    const meshes = cards.map((c) => c.mesh);

    const activateCard = (card: Card) => {
      if (card.liveVideo) return;
      const el = document.createElement("video");
      el.loop = true;
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
      host.appendChild(el);
      const hls = attachHls(el, card.hlsUrl, {
        maxBitrate: cardMaxBitrate,
        maxHeight: cardMaxHeight,
        card: true,
      });
      void el.play().catch(() => {});

      const texture = new THREE.VideoTexture(el);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      card.liveVideo = el;
      card.liveHls = hls;
      card.liveTexture = texture;
      // Swap once there's an actual frame to show, so activating a card
      // doesn't flash black before the first frame decodes.
      const swap = () => {
        card.mesh.material.uniforms.uTexture.value = texture;
      };
      if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) swap();
      else el.addEventListener("loadeddata", swap, { once: true });
    };

    // Leaving the viewport pauses the stream immediately — that is what frees
    // the decoder — but the element and its hls.js instance are kept for a
    // moment by the caller, since rebuilding them is the expensive half and a
    // card that drifted off the edge often drifts straight back on.
    const suspendCard = (card: Card) => {
      card.liveVideo?.pause();
    };

    const resumeCard = (card: Card) => {
      if (card.liveVideo?.paused) void card.liveVideo.play().catch(() => {});
    };

    const deactivateCard = (card: Card) => {
      if (!card.liveVideo) return;
      card.liveHls?.destroy();
      card.liveVideo.pause();
      card.liveVideo.removeAttribute("src");
      card.liveVideo.remove();
      card.liveTexture?.dispose();
      card.mesh.material.uniforms.uTexture.value = card.posterTexture;
      card.liveVideo = undefined;
      card.liveHls = undefined;
      card.liveTexture = undefined;
      card.idleSince = undefined;
    };

    /* ── Fullscreen lightbox ──────────────────────────────────────────────── */
    const backdrop = document.createElement("div");
    backdrop.style.cssText =
      "position:fixed;inset:0;z-index:40;background:rgba(0,0,0,0);display:none;transition:background-color 0.5s ease;";
    const fsVideo = document.createElement("video");
    fsVideo.controls = true;
    fsVideo.playsInline = true;
    /* Laid out once at its fullscreen size and never resized again: the open
     * and close animations move it with a transform instead. left/top/width/
     * height are layout properties, so animating them puts a layout, a paint
     * and a re-fit of the video frame on the main thread for every frame of
     * the transition — and the main thread is, at that exact moment, also
     * building a fresh hls.js stream. A transform belongs to the compositor,
     * which keeps animating it at full rate no matter how busy the main
     * thread gets. `transform-origin` at the top-left is what lets a plain
     * translate+scale map the fullscreen box onto any rect on screen.
     */
    fsVideo.style.cssText =
      "position:fixed;z-index:41;display:none;object-fit:cover;box-shadow:0 30px 80px rgba(0,0,0,0.6);outline:none;transform-origin:0 0;will-change:transform;";
    let fsHls: Hls | null = null;
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close video");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
      "position:fixed;top:20px;right:20px;z-index:42;width:40px;height:40px;border-radius:9999px;border:none;background:rgba(20,20,20,0.6);color:#fff;font-size:16px;line-height:1;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.3s ease;";
    document.body.appendChild(backdrop);
    document.body.appendChild(fsVideo);
    document.body.appendChild(closeBtn);

    /* The canvas fills a fixed, full-viewport host, so its box only moves
     * when the viewport does. Reading it back from the DOM instead — which
     * pointermove used to do on every event — forces a synchronous layout in
     * the middle of a gesture, which is exactly when there is no time for
     * one. Cached here and refreshed by resize().
     */
    let canvasRect = new DOMRect(0, 0, 1, 1);

    const cardScreenRect = (mesh: THREE.Mesh) => {
      const hw = CARD_W / 2;
      const hh = CARD_H / 2;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const corner = new THREE.Vector3();
      for (const [cx, cy] of [
        [-hw, -hh],
        [hw, -hh],
        [-hw, hh],
        [hw, hh],
      ]) {
        corner.set(cx, cy, 0).applyMatrix4(mesh.matrixWorld).project(camera);
        const px = (corner.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
        const py =
          (1 - (corner.y * 0.5 + 0.5)) * canvasRect.height + canvasRect.top;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    };

    const fullscreenRect = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const aspect = openCard ? openCard.aspectW / openCard.aspectH : 16 / 9;
      let width = vh * aspect;
      let height = vh;
      if (width > vw) {
        width = vw;
        height = vw / aspect;
      }
      return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
    };

    // The box the player is actually laid out in — always the fullscreen one.
    // Every other size it appears at is that box under a transform.
    const fsBox = { left: 0, top: 0, width: 1, height: 1 };

    const layoutFullscreen = () => {
      Object.assign(fsBox, fullscreenRect());
      fsVideo.style.left = `${fsBox.left}px`;
      fsVideo.style.top = `${fsBox.top}px`;
      fsVideo.style.width = `${fsBox.width}px`;
      fsVideo.style.height = `${fsBox.height}px`;
    };

    // Maps the laid-out fullscreen box onto an arbitrary screen rect.
    const placeOver = (rect: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) => {
      const sx = rect.width / fsBox.width;
      const sy = rect.height / fsBox.height;
      fsVideo.style.transform =
        `translate(${rect.left - fsBox.left}px,${rect.top - fsBox.top}px)` +
        ` scale(${sx},${sy})`;
      // The radius is drawn in the player's own (fullscreen) space and then
      // shrunk along with everything else, so it has to be divided back out
      // to still *look* like the card's 14px while the player is card-sized.
      fsVideo.style.borderRadius = `${CARD_RADIUS_PX / Math.min(sx, sy)}px`;
    };

    const placeFullscreen = () => {
      fsVideo.style.transform = "translate(0px,0px) scale(1,1)";
      fsVideo.style.borderRadius = "0px";
    };

    let openCard: Card | null = null;
    let mediaOpacity = 0; // crossfade target for fsVideo; the mesh fades to match
    let coverTimer = 0;

    const openVideo = (card: Card) => {
      if (openCard) return;
      openCard = card;
      mediaOpacity = 1;
      frozen = true;

      fsVideo.style.transition = "none";
      layoutFullscreen(); // reads openCard's aspect, so it goes after the assign
      placeOver(cardScreenRect(card.mesh));
      fsVideo.style.opacity = "0";
      backdrop.style.display = "block";
      fsVideo.style.display = "block";
      closeBtn.style.display = "block";
      backdrop.style.pointerEvents = "auto";
      fsVideo.style.pointerEvents = "auto";

      /* Nothing on the spiral is visible from here — the backdrop is on its
       * way to opaque black over all of it. Every card's decoder is therefore
       * work with no viewer, and it is competing for the main thread with the
       * fullscreen stream being built on the very frames the open animation
       * runs on. Paused rather than torn down: the hls.js instances and their
       * buffers survive, so closing brings the spiral straight back instead of
       * rebuilding a dozen streams. The render loop itself stops once the
       * backdrop has finished covering it; see `covered`.
       */
      for (const other of cards) suspendCard(other);
      window.clearTimeout(coverTimer);
      coverTimer = window.setTimeout(() => {
        covered = true;
        syncRunning();
      }, OPEN_MS);

      fsHls?.destroy();
      // Fullscreen: the top rung is the whole point, so both limits are set
      // past anything a ladder is likely to hold. Picking up where the card
      // left off is a config value, not a seek — see HlsOptions.startPosition.
      fsHls = attachHls(fsVideo, card.hlsUrl, {
        maxBitrate: Infinity,
        maxHeight: Infinity,
        startPosition: card.liveVideo?.currentTime ?? -1,
      });
      fsVideo.muted = false;
      void fsVideo.play().catch(() => {});

      // Force a style flush so the browser commits the start transform before
      // it transitions to the end one, instead of collapsing both into one.
      fsVideo.getBoundingClientRect();
      requestAnimationFrame(() => {
        fsVideo.style.transition = `opacity ${SWAP_MS}ms ease, transform ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), border-radius ${OPEN_MS}ms ease`;
        placeFullscreen();
        fsVideo.style.opacity = "1";
        backdrop.style.background = "rgba(0,0,0,0.92)";
        closeBtn.style.opacity = "1";
        closeBtn.style.pointerEvents = "auto";
      });
    };

    const closeVideo = () => {
      const card = openCard;
      if (!card) return;
      mediaOpacity = 0;

      // The spiral has to be running again before the shrink starts: it is
      // what fades the card's mesh back in underneath the player, and what
      // hands the cards their streams back.
      window.clearTimeout(coverTimer);
      covered = false;
      syncRunning();

      // The shrink itself must stay visible, so the opacity crossfade is
      // deferred until near the end — and finishes with room to spare
      // before the motion stops, so nothing pops at the moment it settles.
      const fadeDelay = CLOSE_MS - SWAP_MS - CLOSE_FADE_LEAD_MS;
      fsVideo.style.transition = `opacity ${SWAP_MS}ms ease ${fadeDelay}ms, transform ${CLOSE_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${CLOSE_MS}ms ease`;
      placeOver(cardScreenRect(card.mesh));
      fsVideo.style.opacity = "0";
      backdrop.style.background = "rgba(0,0,0,0)";
      backdrop.style.pointerEvents = "none";
      fsVideo.style.pointerEvents = "none";
      closeBtn.style.opacity = "0";
      closeBtn.style.pointerEvents = "none";

      fsVideo.muted = true;

      window.setTimeout(() => {
        fsVideo.pause();
        fsVideo.style.display = "none";
        backdrop.style.display = "none";
        closeBtn.style.display = "none";
        openCard = null;
        frozen = false;
      }, CLOSE_MS);
    };

    closeBtn.addEventListener("click", closeVideo);
    backdrop.addEventListener("click", closeVideo);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeVideo();
    };
    window.addEventListener("keydown", onKeyDown);

    /* ── Sizing ───────────────────────────────────────────────────────────── */
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      const mobile = w < MOBILE_WIDTH;
      // A phone's device pixel ratio is routinely 3, and every one of those
      // pixels runs the full card shader. 1.5 is still past the point the
      // card edges read as soft rather than stepped.
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, mobile ? 1.5 : 2),
      );
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = mobile ? 45 : 35;
      camera.position.z = mobile ? CAMERA_Z_MOBILE : CAMERA_Z;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      verticalGap = mobile ? VERTICAL_GAP_MOBILE : VERTICAL_GAP;
      centerY = centerYFor(verticalGap);
      ramp = depthRamp(cardCount, verticalGap);
      maxLive = mobile ? MAX_LIVE_MOBILE : MAX_LIVE;
      cardMaxHeight = mobile ? CARD_MAX_HEIGHT_MOBILE : CARD_MAX_HEIGHT;
      cardMaxBitrate = mobile ? CARD_MAX_BITRATE_MOBILE : CARD_MAX_BITRATE;
      radius = mobile ? RADIUS_MOBILE : RADIUS;
      dragSens = mobile ? DRAG_SENS_MOBILE : DRAG_SENS;
      maxSpeed = mobile ? MAX_SPEED_MOBILE : MAX_SPEED;
      viewportActivate = mobile ? VIEWPORT_ACTIVATE_MOBILE : VIEWPORT_ACTIVATE;
      viewportDeactivate = mobile
        ? VIEWPORT_DEACTIVATE_MOBILE
        : VIEWPORT_DEACTIVATE;
      for (const card of cards)
        card.mesh.material.uniforms.uCenterY.value = centerY;

      canvasRect = canvas.getBoundingClientRect();
      // Keep the open player filling the viewport through a resize; snap
      // rather than transition since this isn't a user-driven open/close.
      if (openCard) {
        layoutFullscreen();
        placeFullscreen();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    /* ── Input ────────────────────────────────────────────────────────────── */
    let offset = 0;
    let speed = 0;
    let targetSpeed = 0;
    let direction = 1;
    let dragging = false;
    let frozen = false; // true while the lightbox is open or animating
    // ...and this once the lightbox has finished opening *over* the spiral, at
    // which point there is nothing behind it left to draw. See setRunning.
    let covered = false;
    let lastPointerY = 0;
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    const pointer = new THREE.Vector2(2, 2); // parked off-screen until a move

    const push = (delta: number) => {
      if (delta === 0) return;
      targetSpeed = THREE.MathUtils.clamp(
        targetSpeed + delta,
        -maxSpeed,
        maxSpeed,
      );
      direction = delta > 0 ? 1 : -1;
    };

    const onWheel = (e: WheelEvent) => {
      push(
        (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) *
          WHEEL_SENS,
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      // The spiral climbs, so a vertical drag is the one that reads.
      lastPointerY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      downTime = performance.now();
      canvas.setPointerCapture(e.pointerId);
    };
    const setPointerFrom = (e: PointerEvent) => {
      pointer.set(
        ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
        -((e.clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
      );
    };
    const parkPointer = () => pointer.set(2, 2);

    const onPointerMove = (e: PointerEvent) => {
      /* Only a real pointer leaves a hover behind it. A finger that has been
       * lifted has no position, but the events still carry the last one it
       * touched — and left in `pointer` it becomes a fixed hot spot that
       * every card brightens and zooms through as the spiral drifts past,
       * which is not a hover at all, just a flicker.
       */
      if (e.pointerType === "mouse") {
        setPointerFrom(e);
        if (gridSpot) {
          const mask = `radial-gradient(circle ${GRID_SPOT_RADIUS}px at ${e.clientX - canvasRect.left}px ${e.clientY - canvasRect.top}px, black, transparent)`;
          gridSpot.style.maskImage = mask;
          gridSpot.style.webkitMaskImage = mask;
          gridSpot.style.opacity = "1";
        }
      }
      if (!dragging) return;
      push(-(e.clientY - lastPointerY) * dragSens);
      lastPointerY = e.clientY;
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);

      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      const held = performance.now() - downTime;
      if (moved < CLICK_MOVE_THRESHOLD && held < CLICK_TIME_THRESHOLD) {
        setPointerFrom(e);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(meshes)[0]?.object;
        const card = cards.find((c) => c.mesh === hit);
        if (card) openVideo(card);
      }
      if (e.pointerType !== "mouse") parkPointer();
    };
    const onPointerLeave = () => {
      parkPointer();
      if (gridSpot) gridSpot.style.opacity = "0";
    };

    canvas.addEventListener("wheel", onWheel, { passive: true });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", onPointerLeave);

    /* ── Loop ─────────────────────────────────────────────────────────────── */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector3(); // scratch, for each card's screen height
    const timer = new THREE.Timer();
    let elapsed = 0;
    let frame = 0;
    let cursor = ""; // last value written to canvas.style.cursor
    let titleShown = false; // ...and to the title pill, so neither is rewritten
    // Scratch for the live-stream reconciliation, reused rather than
    // reallocated: it runs several times a second, forever.
    const candidates: Card[] = [];
    let nextReconcile = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      timer.update();
      // Normalised to 60Hz, so the feel is identical on a 120Hz display.
      const dt = Math.min(timer.getDelta(), 0.05);
      const step = dt * 60;
      elapsed += dt;

      if (!frozen) {
        speed += (targetSpeed - speed) * (1 - Math.pow(1 - EASING, step));
        offset += speed * step;
        if (Math.abs(targetSpeed) < IDLE_SPEED)
          targetSpeed = direction * IDLE_SPEED;
        targetSpeed *= Math.pow(DECAY, step);
      }

      // The helix moves under a still pointer, so this has to re-run every
      // frame; it stays cheap because three rejects most meshes on their
      // bounding sphere before touching a triangle. Skipped outright when the
      // pointer is parked off-screen, which on a touch device is always.
      const canHover =
        !dragging && !frozen && pointer.x >= -1 && pointer.x <= 1;
      let hovered: THREE.Object3D | undefined;
      if (canHover) {
        raycaster.setFromCamera(pointer, camera);
        hovered = raycaster.intersectObjects(meshes)[0]?.object;
      }
      const hoveredCard = hovered
        ? cards.find((c) => c.mesh === hovered)
        : undefined;

      // Written on change only: a style write on a canvas every frame is a
      // style recalculation the compositor did not need.
      const wantCursor = dragging ? "grabbing" : hovered ? "pointer" : "grab";
      if (wantCursor !== cursor) {
        cursor = wantCursor;
        canvas.style.cursor = cursor;
      }

      for (const card of cards) {
        const { mesh } = card;
        const u = mesh.material.uniforms;

        if (elapsed > card.delay) {
          card.reveal +=
            (1 - card.reveal) * (1 - Math.pow(1 - REVEAL_EASING, step));
        }
        card.hover +=
          ((mesh === hovered ? 1 : 0) - card.hover) *
          (1 - Math.pow(1 - 0.09, step));
        const hideTarget = card === openCard ? mediaOpacity : 0;
        card.hiding +=
          (hideTarget - card.hiding) * (1 - Math.pow(1 - HIDE_EASING, step));

        const hidden = 1 - card.reveal;
        // Wrap into [0, cardCount) so a fixed set of meshes loops forever.
        const slot =
          (((card.index - offset) % cardCount) + cardCount) % cardCount;
        const b = slot - (cardCount - 1) / 2;

        const angle = b * ANGLE_GAP;
        // Cards fly in from the axis and settle down into place.
        const r = radius * (1 - hidden / 2);
        const y = b * verticalGap + centerY + hidden * 1.5;

        mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
        mesh.rotation.y = -angle + Math.PI / 2;

        u.uScrollSpeed.value = speed;
        u.uZoom.value = 1 + 0.06 * card.hover;
        u.uHighlight.value = card.hover;
        u.uReveal.value = card.reveal;
        u.uTime.value = elapsed;

        const ndcPoint = ndc.copy(mesh.position).project(camera);
        const ndcY = ndcPoint.y;
        const depth = Math.abs(b * verticalGap);
        const fog = Math.max(
          THREE.MathUtils.smoothstep(Math.abs(ndcY), FOG_START, FOG_END),
          THREE.MathUtils.smoothstep(depth, ramp.wrapFogStart, ramp.wrapFogEnd),
        );
        u.uFog.value = fog;
        u.uSwell.value = 1 + fog * FOG_SWELL;
        u.uFogDir.value = ndcY >= 0 ? 1 : -1;
        u.uOpacity.value =
          card.reveal *
          (1 - THREE.MathUtils.smoothstep(depth, ramp.cutStart, ramp.cutEnd)) *
          (1 - card.hiding);

        /* A card the fragment stage would discard in full still costs a draw
         * call, its uniforms, and every fragment of a quad that has swollen to
         * 1.7x — all to reach `discard` on the last line. The two ways a card
         * goes to nothing are the opacity cut and full fog, so skip it here
         * instead. Raycasting doesn't consult `visible`, so hover and tap
         * targets are unaffected — and the uniforms above are already current
         * for the frame either way. */
        mesh.visible = u.uOpacity.value > 0.002 && fog < 1;

        // A card counts as "on screen" once its centre falls inside the NDC
        // square; already-live cards get the looser of the two radii so they
        // don't drop out and restart on the same frame they cross the edge.
        const edge = Math.max(Math.abs(ndcPoint.x), Math.abs(ndcY));
        const inViewport = card.liveVideo
          ? edge < viewportDeactivate
          : edge < viewportActivate;
        // The middle of the screen wins the streams; a hovered card is about
        // to be opened, so it outranks everything.
        card.priority = card === hoveredCard || card === openCard ? -1 : edge;
        /* A card's centre can sit well inside the NDC square while the card
         * itself is four-fifths eaten by a cloud bank — the helix is longer
         * than the clear stretch of it. Those don't need a decoder, and
         * leaving them out is what makes "every visible card is live" a
         * budget a phone can actually meet. It also puts every activation
         * inside the haze: a card wins its stream while it is still mostly
         * vapour, and is in clear air by the time there is anything to see.
         */
        if (inViewport && u.uOpacity.value > 0.05 && fog < 0.85)
          candidates.push(card);
      }

      // Uniforms above are current for this frame, so this check runs after
      // that loop rather than off the raycast hit alone — a card can be the
      // nearest hit and still be mid-entrance or half into a cloud bank.
      const hu = hoveredCard?.mesh.material.uniforms;
      const showTitle =
        !!hu &&
        hu.uReveal.value > TITLE_REVEAL_MIN &&
        hu.uFog.value < TITLE_FOG_MAX &&
        hu.uOpacity.value > TITLE_OPACITY_MIN;
      if (showTitle !== titleShown) {
        titleShown = showTitle;
        titleLabel.style.opacity = showTitle ? "1" : "0";
        titleLabel.style.transform = `translate(-50%,${showTitle ? 0 : 6}px)`;
      }
      if (showTitle) titleLabel.textContent = hoveredCard!.title;

      reconcileStreams(candidates);
      candidates.length = 0;

      renderer.render(scene, camera);
    };

    /* Which cards get a live stream. Runs off the current frame's numbers but
     * only every RECONCILE_MS — the decision is about what to spend the next
     * fraction of a second on, and re-taking it 60 times a second is how a
     * flick ends up tearing streams down and building them straight back.
     */
    const reconcileStreams = (inView: Card[]) => {
      const now = performance.now();
      if (now < nextReconcile) return;
      nextReconcile = now + RECONCILE_MS;

      inView.sort((a, b) => a.priority - b.priority);
      const budget = Math.min(inView.length, maxLive);
      for (const card of cards) card.wantsLive = false;
      for (let i = 0; i < budget; i++) inView[i].wantsLive = true;

      let starts = ACTIVATIONS_PER_TICK;
      const busy = Math.abs(speed) > BUSY_SPEED;
      for (const card of cards) {
        if (card.wantsLive) {
          card.idleSince = undefined;
          if (card.liveVideo) resumeCard(card);
          // Nothing is started mid-flick: by the time the manifest and first
          // segment land the card is somewhere else entirely, and the work of
          // building the stream lands on the frames that can least afford it.
          else if (!busy && starts > 0) {
            activateCard(card);
            starts--;
          }
          continue;
        }
        // A card that lost its slot — off the edge, or simply out-ranked by
        // one nearer the middle — is suspended rather than destroyed, and
        // only torn down once it has stayed unwanted for the whole grace
        // window. Coming straight back costs nothing that way.
        if (!card.liveVideo) continue;
        if (card.idleSince === undefined) card.idleSince = now;
        suspendCard(card);
        if (now - card.idleSince > LIVE_GRACE_MS && card !== openCard)
          deactivateCard(card);
      }
    };

    /* ── Idling ───────────────────────────────────────────────────────────
     * Nothing here is worth a single frame of work when the canvas isn't on
     * screen: a backgrounded tab keeps its video decoders and its WebGL
     * context alive, and a spiral scrolled past keeps animating into a
     * compositor layer nobody is looking at. An opaque lightbox on top of it
     * is the same situation by a different route. All three stop the loop.
     */
    let onScreen = true;
    let running = true;
    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (running) {
        timer.update(); // discard the gap, so nothing jumps on the first frame
        frame = requestAnimationFrame(tick);
        return;
      }
      cancelAnimationFrame(frame);
      // Nothing is drawing, so nothing needs decoding. Whether the streams are
      // also handed back is decided in syncRunning, on its own terms.
      for (const card of cards) suspendCard(card);
    };

    const syncRunning = () => {
      /* Handing the streams back is keyed to the page going away, not to the
       * loop stopping — the lightbox may already have stopped the loop by the
       * time the tab is backgrounded, and a loop that is stopped for one
       * reason must not be what stands between a backgrounded tab and its
       * decoders. A spiral merely covered by the lightbox keeps its hls.js
       * instances (paused), since that is the difference between the spiral
       * being live the moment it reappears and a dozen streams being rebuilt
       * from scratch behind it.
       */
      if (!onScreen || document.hidden)
        for (const card of cards) deactivateCard(card);
      setRunning(onScreen && !document.hidden && !covered);
    };

    const visibility = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        syncRunning();
      },
      { threshold: 0 },
    );
    visibility.observe(host);
    document.addEventListener("visibilitychange", syncRunning);

    tick();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(coverTimer);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", syncRunning);
      window.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      closeBtn.removeEventListener("click", closeVideo);
      backdrop.removeEventListener("click", closeVideo);
      fsHls?.destroy();
      fsVideo.pause();
      fsVideo.removeAttribute("src");
      fsVideo.remove();
      backdrop.remove();
      closeBtn.remove();
      titleLabel.remove();
      for (const card of cards) {
        deactivateCard(card);
        card.posterTexture.dispose();
        card.mesh.material.dispose();
      }
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      gridBase.remove();
      gridSpot?.remove();
      for (const bank of banks) bank.remove();
    };
  }, [videos]);

  return (
    <div
      ref={hostRef}
      className="relative isolate min-h-0 w-full flex-1 touch-none overflow-hidden bg-brand"
    />
  );
}
