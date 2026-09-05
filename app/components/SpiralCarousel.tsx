"use client";

import fragmentShader from "@/lib/shaders/card.frag.glsl";
import vertexShader from "@/lib/shaders/card.vert.glsl";
import Hls from "hls.js";
import { useEffect, useRef } from "react";
import * as THREE from "three";

// Type-only, so nothing from the library module (Redis, Livepeer) reaches the
// client bundle — the import is erased at compile time.
import type { ResolvedCard } from "@/lib/library";

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
/* Radians of orbit per card — the horizontal lever. The climb is well under
 * CARD_H, so consecutive cards already overlap vertically and the side-to-side
 * space you see between them is roughly radius * angleGap less CARD_W, at the
 * front of the orbit where the cards face the camera.
 *
 * Per device, because the no-crossing floor below is a function of the radius:
 * a wider orbit is flatter relative to a card, so the desktop pair can sit
 * 0.564 rad apart where the tighter mobile one needs 0.662. Held as one global
 * this was pinned to the mobile floor on every screen, which cost desktop
 * about 0.2 world units of needless air. Each is set just clear of its own
 * floor.
 */
const ANGLE_GAP = 0.6;
const ANGLE_GAP_MOBILE = 0.7;
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
 *
 * `depthRamp` sizes the whole dissolve off cardCount * verticalGap, so
 * tightening the gap packs the strip closer together and shortens the world
 * depth every card climbs through before wrapping, independent of how many
 * cards there are. The mobile figure was tuned against a loop held to 10
 * clips; CARD_COUNT_MOBILE below has since settled at 14, which widens that
 * dissolve zone proportionally and is still worth an eye rather than assumed
 * correct.
 */
const VERTICAL_GAP = 0.44;
const VERTICAL_GAP_MOBILE = 0.4;
const MOBILE_WIDTH = 768;
/* Originally matched to MAX_LIVE_MOBILE — past that many cards the live-stream
 * budget was refusing the rest a decoder anyway, so carrying their <video>
 * element and hls.js instance bought nothing. A touch device now runs a single
 * stream (see MAX_LIVE_TOUCH), so that reason is gone and the figure stands on
 * the two that are left: it is what VERTICAL_GAP_MOBILE and the
 * dissolve either side of it were tuned against, and every card past it is
 * another draw call and another poster in GPU memory for a strip that already
 * runs off both ends of a phone screen.
 */
const CARD_COUNT_MOBILE = 14;

/* No two cards may ever intersect. A curled card reaches its neighbour's plane
 * at (radius + CURL)*cos(a) + (CARD_W/2)*sin(a) - radius, which only stays
 * negative past 0.564 rad at the desktop radius and past 0.662 at the tighter
 * mobile one. Each angleGap sits ~0.036 clear of its own floor at the current
 * CURL, so neither has much room left to give.
 *
 * Some pairs do land back inside that wedge, since a multiple of angleGap
 * comes back near a multiple of 2*PI there — 10, 11, 21, 31 and 32 steps apart
 * on desktop, 9, 18, 26, 27, 35 and 36 on mobile. By then they sit far enough
 * apart vertically to clear CARD_H at full swell (2.55 world units): the
 * closest pair is 4.4 at the desktop climb and 3.6 at the mobile one.
 *
 * All three constants move together — CURL sets the wedge, ANGLE_GAP decides
 * which pairs land back inside it, verticalGap decides whether those pairs
 * are far enough apart to survive it — so retune none of them on its own, and
 * re-run the check rather than assuming these figures still hold. The speed
 * distortions in the shader are bounded so they preserve this margin.
 */

/* The card whose plane squarely faces the camera is the one a quarter turn
 * along the orbit, not the one at angle 0. That quarter turn used to be paid
 * for by dropping the whole helix by the climb it represents, which did land
 * the front card mid-viewport — but it also left the strip hanging below the
 * screen's middle by that same amount, and everything measured from the
 * strip's own centre (the wrap dissolve especially, which is keyed to
 * distance from slot 0) inherited the offset. The top of the spiral was
 * fading out barely above the middle of the screen while the bottom ran off
 * the edge still lit: it ended at the very bottom and never started at the
 * top.
 *
 * Spending the quarter turn as a phase on the orbit instead costs nothing and
 * leaves slot 0 at y = 0. The strip is then centred on the screen, reaches
 * equally far past both edges, and the dissolve at either end is the same
 * distance out. Relative angles and vertical spacing are untouched by a
 * constant phase, so the no-crossing analysis above still holds exactly.
 */
const HELIX_PHASE = Math.PI / 2;

/* ── Motion ────────────────────────────────────────────────────────────────
 * One eased scalar drives everything: `speed` (cards per 60Hz frame) chases
 * `targetSpeed`, which decays back to a slow idle drift. The spiral never
 * fully stops, like the reference.
 */
const EASING = 0.1;
const DECAY = 0.9;
const IDLE_SPEED = 0.0022;
const MAX_SPEED = 0.55;
const WHEEL_SENS = 0.0001;
/* A thumb swipe crosses most of a phone screen in one flick, so the desktop
 * pixels-to-cards rate sends the spiral past several cards at once — too fast
 * to read.
 *
 * Slower still than that first cut: a card is marked a live-stream candidate
 * while it's still mostly hazy (see the fog gate around `candidates.push`),
 * which only buys anything if the card then spends real time behind that
 * haze before it needs to show a frame. At the old cap a fast flick could
 * cross the whole dissolve zone in a few hundred ms — less than a manifest
 * fetch plus a first segment — so the stream was still spinning up when the
 * card arrived. The cap below roughly doubles that window.
 */
const DRAG_SENS = 0.0016;
const DRAG_SENS_MOBILE = 0.00055;
const MAX_SPEED_MOBILE = 0.2;

/* ── Distortion ──────────────────────────────────────────────────────────── */
/* How far the middle of a card bulges outward, always on. This is what sets
 * the no-crossing floor on ANGLE_GAP — a flatter card reaches less far round
 * the cylinder toward its neighbour's plane — so it was traded down from 0.18
 * to buy the room that pulls the cards closer together. See the no-crossing
 * note above before raising it again.
 */
const CURL = 0.1;
const LENS = 0.07; // parabolic bow: the spiral leans as it runs off-screen
const WHIP = 1.1; // lateral smear proportional to scroll speed
const SQUASH = 0.4; // vertical pinch under speed, capped in the shader

/* ── Cloud bank ────────────────────────────────────────────────────────────
 * Both ends of the spiral run into haze. A leaving card goes soft, milky and
 * then torn apart in wisps by the shader, while banks of drifting vapour sit
 * over the same stretch of screen — so it reads as a card swallowed by cloud
 * rather than a card being turned off.
 */
/* Measured in screen space, not world space: the helix's cards sit at every
 * depth, so the same world height is a different fraction of the way up the
 * screen for a near card than for a far one, and a world-height rule would
 * have some of them dissolving mid-viewport and others already gone over the
 * edge.
 *
 * Pushed out to 0.68/1.18 once the strip was centred (see HELIX_PHASE), on the
 * grounds that the clear stretch was what held the spiral in from the edges —
 * and pulled back in again because out there the interesting half of the morph
 * happened off-screen. The card is only fully a cloud at the top of
 * CLOUD_FOG_END, which at 0.68/1.18 fell at |ndc y| ≈ 1.01: past the edge. What
 * was left on screen was a reel going soft, never a puff. Slid inward, keeping
 * the ramp exactly 0.5 wide so its shape and the pace of the morph are
 * untouched — only where it happens moved. The card now finishes condensing at
 * ≈ 0.68, is a complete cloud by ≈ 0.75, and is torn up and gone by 0.92,
 * which is still deep enough into the painted bank (it reaches ndc 0.32) to
 * read as vapour swallowing the strip rather than the strip stopping short.
 *
 * Desktop-side in practice. A phone's frustum is tall enough that these
 * thresholds are barely reached — the wrap ramp below is what dissolves a card
 * there, and it still wins the max() at every depth on mobile at these values.
 */
const FOG_START = 0.42; // |ndc y| where the haze starts taking the card...
const FOG_END = 0.92; // ...and where it has taken all of it

/* The same dissolve keyed to raw helix height, taken as a floor, so a card
 * that reaches the wrap without leaving the screen — a far one on a tall
 * viewport — still goes to cloud rather than simply stopping.
 *
 * Written as fractions of the depth a card is fully gone by, rather than as
 * world distances squeezed to fit inside it. The distinction is what a phone
 * screen turned on: a narrow, tall frustum holds the whole climb inside the
 * screen-space ramp's first stretch, so on mobile it is this ramp that does
 * essentially all the dissolving. As absolute distances it landed at 81%-98%
 * of the reachable depth — a dissolve a slot and a half wide, finishing after
 * the hard cutoff had already started fading the card out. What you saw was
 * the fade.
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

/* How much the plane outgrows its card while it is a cloud, to leave the soft
 * border somewhere to spill and the puff room to be wider than the card. This
 * is what caps the cloud's width in card.frag.glsl, and it is bounded by the
 * same no-crossing rule as everything else: a card only reaches its
 * neighbour's plane past 1.77x its width.
 */
const FOG_SWELL = 0.7;

/* Where in the fog ramp a card stops being a card. Held off the very start of
 * the haze so a card goes soft and milky first and only then loses its shape —
 * the two reading as one continuous thing rather than the silhouette letting
 * go the instant the fog does. Complete well before the fog ramp ends, which
 * leaves the top of that ramp to the dispersal in the shader: form the puff,
 * then tear it up.
 */
const CLOUD_FOG_START = 0.18;
const CLOUD_FOG_END = 0.72;

/* ── Reveal ──────────────────────────────────────────────────────────────── */
const REVEAL_EASING = 0.055;
const REVEAL_STAGGER = 0.05; // seconds between each card's entrance

/* A card is born as a puff of vapour and condenses into its reel. Much slower
 * than REVEAL_EASING on purpose: the entrance — flying in from the axis and
 * fading up — is over in about a second, and the condensation carries on well
 * past it, so what you watch after the cards have landed is the shape
 * resolving rather than the arrival. At 0.014 a card is ~95% formed after
 * three and a half seconds and the tail is slower still.
 */
const FORM_EASING = 0.014;

/* A hovered card only counts as truly clickable — worth naming — once it's
 * fully settled: past its entrance, not yet dissolving into a cloud bank,
 * and not fading for the lightbox. Raycasting alone doesn't know any of
 * this, since it hits a card's geometry even where the shader has already
 * discarded that card down to a wisp. */
const TITLE_REVEAL_MIN = 0.97;
const TITLE_FOG_MAX = 0.15;
const TITLE_CLOUD_MAX = 0.12;
const TITLE_OPACITY_MIN = 0.9;

/* ── Live video activation ────────────────────────────────────────────────
 * Every card has its own clip now, so decoding all of them at once isn't an
 * option — bandwidth and browser decode limits both break well before 18
 * concurrent streams. Each card shows a static thumbnail by default and
 * only gets a real <video> + hls.js decode once it's actually on screen (or
 * hovered, which implies on screen too). Cards spend most of the spiral off
 * in the cloud banks at either end, so only a handful are ever live at once
 * despite there being no hard cap.
 *
 * A touch device gets exactly one of them, on whichever card is passing the
 * middle of the screen — see MAX_LIVE_TOUCH.
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
 * set above the number of cards that clear the cloud banks at either end (11
 * on a phone, 11 on a desktop, over an 18-card spiral), so in practice it
 * never binds and the whole visible stretch of the spiral is live at once.
 *
 * Desktop's figure went up with the centred strip and the wider clear stretch
 * (see HELIX_PHASE and FOG_START): the same spiral now shows a couple more
 * cards at a time, and the old cap of 10 would have started binding — which
 * shows up as the card nearest an edge sitting on its poster while everything
 * around it plays.
 *
 * This is deliberately more than the device would choose for itself; the
 * texture uploads are already paid only on frames the decoder actually
 * produced, since three's VideoTexture drives them off
 * requestVideoFrameCallback rather than off the render loop. If a device does
 * run out of decoders the symptom is cards stalling on a half-decoded frame,
 * and these are the numbers to lower.
 */
const MAX_LIVE = 13;
const MAX_LIVE_MOBILE = 14;

/* A phone gets one. Everything above is a budget for how many decoders a
 * device can be *asked* for, and a dozen was well past what a phone can answer:
 * each live card is an hls.js instance appending buffers on the main thread and
 * a full frame uploaded to the GPU every time its decoder produces one, and a
 * dozen of those leaves nothing for the spiral itself. That was the stutter
 * under a swipe.
 *
 * Since `priority` is already distance from the centre of the screen, a budget
 * of one resolves to the card passing through the middle — the one being
 * looked at. Every other card sits on its poster, which for a Livepeer asset is
 * the clip's first keyframe (see resolvePlayback), so the rest of the strip
 * reads as stills and the middle of it plays. Tapping any card still opens the
 * lightbox, which is its own stream and unaffected by this.
 *
 * Keyed to the input device rather than to viewport width, unlike the two caps
 * above: a desktop window dragged narrow is still a machine that can decode a
 * dozen streams, and there the fully live spiral is the whole effect.
 */
const MAX_LIVE_TOUCH = 1;

/* ...but not while the spiral is moving. At a budget of one, "the middle card"
 * is a different card every few frames during a flick, and handing the slot
 * down the strip that fast means building a MediaSource and fetching a manifest
 * for a card that has already left the middle by the time the first segment
 * lands — the exact churn RECONCILE_MS and LIVE_GRACE_MS exist to damp, but
 * arriving through the budget instead of through the reconcile rate. So starts
 * wait for the strip to be near enough to settled to be worth reading; the
 * threshold is a little above IDLE_SPEED, so the perpetual idle drift still
 * counts as settled and the middle card plays without ever being touched.
 * A stream that already exists is resumed regardless — that is free.
 */
const TOUCH_START_MAX_SPEED = 0.01; // cards per 60Hz frame

/* Reconciling at 60Hz meant a fast flick tore down and rebuilt streams every
 * few frames, and building one is expensive enough (MediaSource attach,
 * manifest fetch, first segment) to be felt as a stutter. Deciding at 10Hz
 * rather than every frame, and letting a card that has left keep its stream
 * (paused) long enough to cover a flick and its coast, is what keeps that
 * from happening — coming back costs nothing.
 */
const RECONCILE_MS = 100;
const LIVE_GRACE_MS = 2500; // a departed card keeps its stream this long
/* Several at a time rather than one: at 10Hz, one-at-a-time took over a second
 * to fill a phone's worth of cards, which is the whole of a first impression
 * spent watching posters. Still not all at once — a dozen MediaSource attaches
 * in a single tick is one long frame, and this spreads them over three.
 */
const ACTIVATIONS_PER_TICK = 4;

/* ── Fullscreen ────────────────────────────────────────────────────────────
 * A tap grows the card from its exact on-screen rect into a real <video>
 * element — a lightbox, not a modal bolted on top. The card's mesh hides the
 * instant the clone appears in its place, so the handoff reads as one
 * continuous shape rather than a swap. The player carries no controls of its
 * own; the only chrome over it is this component's close button and info
 * panel.
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
  form: number;
  hover: number;
  hiding: number;
  hlsUrl: string;
  title: string;
  description?: string;
  posterTexture: THREE.Texture;
  // The same still as a plain URL, for the lightbox's `poster` — see openVideo.
  posterUrl?: string;
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
  onReady,
  started = true,
}: {
  cards: ResolvedCard[];
  /** Called once the scene has painted its first frame. */
  onReady?: () => void;
  /**
   * Whether the cards are allowed to start condensing out of the clouds they
   * are born as. The scene mounts under a loading screen and spends several
   * seconds there flying its cards in and warming up their streams — all of
   * which should stay hidden — but the morph is the one part of the arrival
   * meant to be watched, so it is held back until the caller says the way is
   * clear. Everything else still runs on the scene's own clock.
   */
  started?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Read through a ref rather than the effect's deps: a caller passing an
  // inline callback shouldn't tear down and rebuild the whole WebGL scene
  // on every one of its own re-renders.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  // Same reasoning: flipping this must not remount the scene it is gating.
  const startedRef = useRef(started);
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

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
      "position:fixed;z-index:30;left:50%;bottom:32px;pointer-events:none;background:#fff;color:#111;font-size:13px;font-weight:500;letter-spacing:0.01em;padding:10px 20px;border-radius:9999px;opacity:0;transform:translate(-50%,6px);transition:opacity 0.25s ease,transform 0.25s ease;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;";
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

    /* Livepeer doesn't guarantee a thumbnail for every asset, so a card
     * without one shows a flat fog-toned fill until its video activates.
     *
     * These bytes are fogColor's own channels, which three keeps in linear
     * working space — the same numbers the shader gets through uFogColor. So
     * this fill and the vapour a card is born from are the same colour only
     * while the texture is left untagged, which is now the rule for every card
     * texture anyway (see posterTexture). Tagged sRGB, as it used to be, it was
     * decoded once more on sample and the flat cards sat visibly darker than
     * the cloud around them.
     */
    const makeFallbackTexture = () => {
      const { r, g, b } = fogColor;
      const pixel = new Uint8Array([r * 255, g * 255, b * 255, 255]);
      const texture = new THREE.DataTexture(pixel, 1, 1);
      texture.needsUpdate = true;
      return texture;
    };

    // The library drives the card count directly on desktop. Mobile caps it
    // at CARD_COUNT_MOBILE — every card in the loop gets its own <video>
    // element regardless of whether it ever wins a decoder, just from sitting
    // in the DOM waiting its turn.
    const cardCount = lowPower
      ? Math.min(videos.length, CARD_COUNT_MOBILE)
      : videos.length;

    // Layout that follows the viewport rather than the device, filled in by
    // the first resize() below and kept current from then on.
    let verticalGap = VERTICAL_GAP;
    let angleGap = ANGLE_GAP;
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
      /* NOT SRGBColorSpace, however much it looks like it should be — that is
       * the tag that made a poster darker than the clip it stands in for.
       *
       * This shader is a bare ShaderMaterial that writes gl_FragColor itself
       * and includes no <colorspace_fragment>, so nothing re-encodes on the way
       * out; whatever the sampler returns is what reaches the screen. That puts
       * the whole scene in sRGB-encoded space, and a texture is right here only
       * if the GPU hands its bytes over untouched.
       *
       * A video texture always does. three passes `texture.isVideoTexture` as
       * getInternalFormat's `forceLinearTransfer` (WebGLTextures.js), so a
       * VideoTexture is allocated RGBA8 and sampled raw no matter what its
       * colorSpace says — the tag below is inert on the video and was only ever
       * honoured on the poster, which got SRGB8_ALPHA8 and a hardware
       * sRGB->linear decode on every sample. A mid-grey came back at 0.21
       * instead of 0.5 and was never encoded back. That is the whole of the
       * jump: the poster was a stop and a half under the clip, and the picture
       * lifted the moment the video texture took over.
       *
       * Left untagged, both arrive in the same space and the swap is invisible.
       * Fixing it the other way — tagging both sRGB and adding the output
       * conversion — would be the colour-managed pipeline, but every constant
       * in card.frag.glsl was tuned by eye against these values, so it would
       * relight the whole scene to correct a mismatch nothing else depends on.
       */
      posterTexture.colorSpace = THREE.NoColorSpace;
      /* Filtered exactly like the video texture too, for the same reason.
       * TextureLoader's defaults are a mipmapped minFilter, and
       * gl.generateMipmap box-filters the stored bytes — which for
       * gamma-encoded values means averaging them in the wrong space, so every
       * level down comes out darker than a correct average. A card is a postage
       * stamp: the sampler sits a level or two down the chain there, well into
       * the darkening, while the video texture has no chain at all. This was a
       * second darkening stacked on the one above, and closing it alone left a
       * smaller version of the same jump.
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
          uLens: { value: LENS },
          uWhip: { value: WHIP },
          uScrollSpeed: { value: 0 },
          uZoom: { value: 1 },
          uReveal: { value: 0 },
          uOpacity: { value: 1 },
          uHighlight: { value: 0 },
          uFog: { value: 0 },
          uSwell: { value: 1 + FOG_SWELL },
          uFogDir: { value: 1 },
          uFogColor: { value: fogColor },
          uTime: { value: 0 },
          // Every card starts life as a cloud, so the first frame it is ever
          // drawn on is already one — no rectangle flashes before the morph.
          uCloud: { value: 1 },
          /* Golden-ratio spacing rather than Math.random: neighbouring cards
           * get seeds far apart, so no two clouds next to each other come out
           * of the same corner of the noise, and the scene is the same shape
           * on every load. */
          uSeed: { value: (i * 0.6180339887) % 1 },
        },
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      cards.push({
        mesh,
        index: i,
        delay: (i % 4) * REVEAL_STAGGER,
        reveal: 0,
        form: 0,
        hover: 0,
        hiding: 0,
        hlsUrl: video.hlsUrl,
        title: video.title,
        description: video.description,
        posterTexture,
        posterUrl: video.posterUrl,
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
      // Matched to the poster it replaces, and honest about what three does
      // with a video texture either way — see the note on posterTexture. This
      // line has never had any effect; it now says so.
      texture.colorSpace = THREE.NoColorSpace;
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
    /* No native controls. These are reels a few seconds long that open on a
     * tap and are meant to be watched, not scrubbed, and every browser's
     * chrome — timeline, mute, fullscreen, PiP — is a second set of furniture
     * laid over footage that already fills the screen. On iOS it is also drawn
     * in a layer above the page, so it wins any overlap with this component's
     * own chrome rather than sitting under it.
     *
     * Two things it did carry that the page still owes the viewer: a way out,
     * which is the close button, the backdrop, Escape, and now a tap on the
     * video itself (see the listener by closeVideo); and a way to start
     * playback if autoplay is refused, which is the muted retry in openVideo.
     */
    fsVideo.controls = false;
    // Still required, and now for the only reason that was ever load-bearing:
    // without it iOS hands the clip to its own fullscreen player on play, and
    // that player comes with the full control set this just turned off.
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
      "position:fixed;z-index:41;display:none;object-fit:cover;outline:none;transform-origin:0 0;will-change:transform;";
    let fsHls: Hls | null = null;
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close video");
    // A drawn X, not the ✕ character it used to be. A <button> doesn't inherit
    // font-family, so that glyph was resolved in iOS's default button font,
    // which doesn't carry U+2715 — Safari fell through to a symbol fallback and
    // drew it at its own size, off the centre the flex box had lined up for it.
    // The same two strokes as HeroOverlay's lucide icons, so it belongs to the
    // set; currentColor keeps it on the class's hover transition.
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg>';
    // Everything the button looks like *and* where it sits lives in
    // .lightbox-close, which is the HeroOverlay tile at a breakpoint-dependent
    // size. What stays here is only what the open and close animations drive.
    closeBtn.className = "lightbox-close";
    closeBtn.style.cssText = "display:none;opacity:0;pointer-events:none;";

    /* Title + description for the open video, anchored bottom-left over the
     * backdrop like the close button is anchored top-right — both fade in on
     * the same schedule once the player has finished expanding.
     *
     * Scrimmed like the bio panel (see HeroBio) rather than set straight on the
     * footage: the text sits over whatever the video happens to be showing, and
     * a bright frame underneath left it unreadable. Same black/45 + blur, so
     * the two panels read as the same piece of furniture.
     *
     * Back on the same 20px inset as the rest of the chrome. It spent a while
     * lifted to 72px to clear the native control bar iOS anchors inside the
     * bottom of the video — the description ran straight through the timeline —
     * but with the controls gone that bar does not exist and the corner is the
     * panel's own. The safe-area term stays: the home indicator is still there.
     */
    const infoPanel = document.createElement("div");
    infoPanel.style.cssText =
      "position:fixed;left:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:42;box-sizing:border-box;max-width:min(480px,calc(100vw - 40px));padding:10px 12px;border-radius:12px;background:rgba(0,0,0,0.45);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity 0.3s ease,transform 0.3s ease;";
    const infoTitle = document.createElement("div");
    infoTitle.style.cssText =
      "color:#fff;font-size:16px;font-weight:600;letter-spacing:0.01em;";
    const infoDescription = document.createElement("div");
    infoDescription.style.cssText =
      "margin-top:4px;color:rgba(255,255,255,0.75);font-size:13px;line-height:1.5;";
    infoPanel.appendChild(infoTitle);
    infoPanel.appendChild(infoDescription);

    document.body.appendChild(backdrop);
    document.body.appendChild(fsVideo);
    document.body.appendChild(closeBtn);
    document.body.appendChild(infoPanel);

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
      // flex, not block: the tile centres its glyph (see .lightbox-close).
      closeBtn.style.display = "flex";
      backdrop.style.pointerEvents = "auto";
      fsVideo.style.pointerEvents = "auto";

      infoTitle.textContent = card.title;
      infoDescription.textContent = card.description ?? "";
      infoDescription.style.display = card.description ? "block" : "none";
      infoPanel.style.display = "block";

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
      /* The still the card was showing, held under the player until its first
       * frame decodes. On desktop the card usually hands over a warm stream and
       * this is never seen; on a touch device there is no warm stream by design,
       * so without it the tap grows a black rectangle out of a picture. With it,
       * the poster expands and the video takes over underneath it. */
      if (card.posterUrl) fsVideo.poster = card.posterUrl;
      else fsVideo.removeAttribute("poster");
      // Fullscreen: the top rung is the whole point, so both limits are set
      // past anything a ladder is likely to hold. Picking up where the card
      // left off is a config value, not a seek — see HlsOptions.startPosition.
      fsHls = attachHls(fsVideo, card.hlsUrl, {
        maxBitrate: Infinity,
        maxHeight: Infinity,
        startPosition: card.liveVideo?.currentTime ?? -1,
      });
      /* Unmuted playback is only allowed off a user gesture, and this is one —
       * openVideo runs synchronously out of the pointerup that tapped the card.
       * When it is refused anyway the clip used to sit on its poster until the
       * viewer pressed play, which is no longer an option they have: with the
       * controls gone a refusal is a dead end. Muted always plays, so fall back
       * to it rather than leave a still frame with no way forward.
       */
      fsVideo.muted = false;
      void fsVideo.play().catch(() => {
        fsVideo.muted = true;
        void fsVideo.play().catch(() => {});
      });

      // Force a style flush so the browser commits the start transform before
      // it transitions to the end one, instead of collapsing both into one.
      // A single rAF isn't a reliable enough gate for that commit on its
      // own — it can still land before the frame that paints the start state
      // gets to the screen, especially with a card's worth of decoders and
      // fullscreen's own hls.js attach competing for the same frame — so the
      // end-state change waits a second rAF, one full painted frame later.
      fsVideo.getBoundingClientRect();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fsVideo.style.transition = `opacity ${SWAP_MS}ms ease, transform ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), border-radius ${OPEN_MS}ms ease`;
          placeFullscreen();
          fsVideo.style.opacity = "1";
          backdrop.style.background = "rgba(0,0,0,0.92)";
          closeBtn.style.opacity = "1";
          closeBtn.style.pointerEvents = "auto";
          infoPanel.style.opacity = "1";
          infoPanel.style.transform = "translateY(0)";
        });
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
      infoPanel.style.opacity = "0";
      infoPanel.style.transform = "translateY(6px)";

      fsVideo.muted = true;

      window.setTimeout(() => {
        fsVideo.pause();
        fsVideo.style.display = "none";
        backdrop.style.display = "none";
        closeBtn.style.display = "none";
        infoPanel.style.display = "none";
        openCard = null;
        frozen = false;
      }, CLOSE_MS);
    };

    closeBtn.addEventListener("click", closeVideo);
    backdrop.addEventListener("click", closeVideo);
    // The player covers most of the screen and, without controls, would
    // otherwise be the one part of it a tap does nothing to — the backdrop it
    // sits over is a sibling, so those taps never reach that handler. Closing
    // on it makes the whole lightbox dismiss the same way wherever it is hit.
    fsVideo.addEventListener("click", closeVideo);
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
      angleGap = mobile ? ANGLE_GAP_MOBILE : ANGLE_GAP;
      ramp = depthRamp(cardCount, verticalGap);
      maxLive = touchOnly
        ? MAX_LIVE_TOUCH
        : mobile
          ? MAX_LIVE_MOBILE
          : MAX_LIVE;
      cardMaxHeight = mobile ? CARD_MAX_HEIGHT_MOBILE : CARD_MAX_HEIGHT;
      cardMaxBitrate = mobile ? CARD_MAX_BITRATE_MOBILE : CARD_MAX_BITRATE;
      radius = mobile ? RADIUS_MOBILE : RADIUS;
      dragSens = mobile ? DRAG_SENS_MOBILE : DRAG_SENS;
      maxSpeed = mobile ? MAX_SPEED_MOBILE : MAX_SPEED;
      viewportActivate = mobile ? VIEWPORT_ACTIVATE_MOBILE : VIEWPORT_ACTIVATE;
      viewportDeactivate = mobile
        ? VIEWPORT_DEACTIVATE_MOBILE
        : VIEWPORT_DEACTIVATE;

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
    // Time since the morph was allowed to start, which is not the same as
    // time since the scene mounted — see the `started` prop. Only the
    // cloud-to-card condensation reads this one; the fly-in, the spin and the
    // vapour's own drift all stay on `elapsed`.
    let entrance = 0;
    let frame = 0;
    // Shader compilation, geometry and the per-card texture setup are all
    // synchronous work ahead of the first paint, and slow enough on a phone
    // to be worth a caller-side loading screen — this is what tells it the
    // wait is over.
    let firstFrame = true;
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
      if (startedRef.current) entrance += dt;

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
        if (entrance > card.delay) {
          card.form += (1 - card.form) * (1 - Math.pow(1 - FORM_EASING, step));
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

        const angle = b * angleGap + HELIX_PHASE;
        // Cards fly in from the axis and settle down into place.
        const r = radius * (1 - hidden / 2);
        const y = b * verticalGap + hidden * 1.5;

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
        /* Two ways to be a cloud, and a card is as much of one as the stronger
         * of them says: it has not finished condensing out of the one it was
         * born as, or it has drifted far enough into a bank to be going back.
         * Taking the max rather than adding them means a card that is still
         * forming while it drifts into the haze never over-swells past the
         * no-crossing margin. */
        const cloud = Math.max(
          1 - card.form,
          THREE.MathUtils.smoothstep(fog, CLOUD_FOG_START, CLOUD_FOG_END),
        );
        u.uCloud.value = cloud;
        // The plane has to be big enough to hold whichever shape is current;
        // the cloud is the wide one, so it is the cloud that sizes it.
        u.uSwell.value = 1 + cloud * FOG_SWELL;
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
        /* Distance from the middle of the screen, which is what the budget is
         * handed out by — and at a budget of one (see MAX_LIVE_TOUCH) it is
         * the whole rule: smallest `edge` wins, so the slot follows the card
         * passing through the centre. A hovered card is about to be opened, so
         * it outranks even that.
         */
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
        // A card still condensing is a puff of vapour with a hit box: it
        // reaches full reveal about two seconds before it looks like a card
        // you could click, and naming it before then labels a cloud.
        hu.uCloud.value < TITLE_CLOUD_MAX &&
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
      if (firstFrame) {
        firstFrame = false;
        onReadyRef.current?.();
      }
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

      // See TOUCH_START_MAX_SPEED: with one slot to hand out, a moving strip
      // would spend it on a card that has left the middle before the stream is
      // ready. Resumes are exempt; only new streams wait for the strip to slow.
      let starts =
        touchOnly && Math.abs(speed) > TOUCH_START_MAX_SPEED
          ? 0
          : ACTIVATIONS_PER_TICK;
      for (const card of cards) {
        if (card.wantsLive) {
          card.idleSince = undefined;
          if (card.liveVideo) resumeCard(card);
          else if (starts > 0) {
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
      fsVideo.removeEventListener("click", closeVideo);
      fsHls?.destroy();
      fsVideo.pause();
      fsVideo.removeAttribute("src");
      fsVideo.remove();
      backdrop.remove();
      closeBtn.remove();
      infoPanel.remove();
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
    <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-brand">
      <div
        ref={hostRef}
        className="absolute inset-0 isolate touch-none overflow-hidden"
      />
    </div>
  );
}
