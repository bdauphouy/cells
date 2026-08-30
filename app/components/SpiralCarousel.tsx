"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import Hls from "hls.js";
import vertexShader from "@/lib/shaders/card.vert.glsl";
import fragmentShader from "@/lib/shaders/card.frag.glsl";

export type ResolvedCard = { playbackId: string; aspectRatio: string };

/* ── Video source ──────────────────────────────────────────────────────────
 * Served from Mux as adaptive HLS. Safari plays an .m3u8 natively through
 * `src`; every other engine needs hls.js to feed the stream into the same
 * plain <video> element via MediaSource — so a video element stays an
 * ordinary <video> either way, which is what lets THREE.VideoTexture read it
 * at all (a wrapper like <mux-player> hides its <video> in shadow DOM, out of
 * reach).
 */
const streamUrl = (playbackId: string) =>
  `https://stream.mux.com/${playbackId}.m3u8`;
const posterUrl = (playbackId: string) =>
  `https://image.mux.com/${playbackId}/thumbnail.jpg?width=640`;

function attachHls(el: HTMLVideoElement, src: string): Hls | null {
  el.crossOrigin = "anonymous"; // cross-origin now; without this the WebGL
  // texture upload throws a tainted-canvas security error.
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error("hls.js error", data);
    });
    hls.loadSource(src);
    hls.attachMedia(el);
    return hls;
  }
  // Safari (and anything else with native HLS support): no library needed.
  el.src = src;
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
const RADIUS = 2;
const ANGLE_GAP = 0.85; // radians of orbit per card
const VERTICAL_GAP = 0.62; // world units of climb per card
const SEGMENTS = 20;

/* No two cards may ever intersect. A curled card reaches its neighbour's plane
 * at (RADIUS + CURL)*cos(a) + (CARD_W/2)*sin(a) - RADIUS, which only stays
 * negative for a > 0.640 rad — so ANGLE_GAP clears it by 0.244. Pairs 7, 8 and
 * 15 steps apart do land back inside that wedge, since a multiple of ANGLE_GAP
 * comes back near a multiple of 2*PI there, but by then they sit 4.3+ apart
 * vertically, far beyond CARD_H. The speed distortions in the shader are
 * bounded so they preserve this margin.
 */

/* The card whose plane squarely faces the camera is the one a quarter turn
 * along, not the one at angle 0 — and by then the helix has already climbed.
 * Drop the helix by that much to land it mid-viewport, plus a little more by
 * eye. (The reference hardcodes -0.8, which is this same figure for its own
 * constants.)
 */
const CENTER_Y = (-Math.PI / 2 / ANGLE_GAP) * VERTICAL_GAP;

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
const DRAG_SENS = 0.0024;

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
 * viewport — still goes to cloud rather than simply stopping. */
const WRAP_FOG_START = 3.8;
const WRAP_FOG_END = 4.6;
const CUT_START = 4.4; // hard cutoff, insurance behind the dissolve: by here
const CUT_END = 4.7; // nothing is left to see, so the wrap point stays hidden
/* How much the plane outgrows its card at full fog, to leave the soft border
 * somewhere to spill. Bounded by the same no-crossing rule as everything else:
 * a card only reaches its neighbour's plane past 1.77x its width.
 */
const FOG_SWELL = 0.7;

/* ── Reveal ──────────────────────────────────────────────────────────────── */
const REVEAL_EASING = 0.055;
const REVEAL_STAGGER = 0.05; // seconds between each card's entrance

/* ── Live video activation ────────────────────────────────────────────────
 * Every card has its own clip now, so decoding all of them at once isn't an
 * option — bandwidth and browser decode limits both break well before 18
 * concurrent streams. Each card shows a static Mux thumbnail by default and
 * only gets a real <video> + hls.js decode once it's actually on screen (or
 * hovered, which implies on screen too). Cards spend most of the spiral off
 * in the cloud banks at either end, so only a handful are ever live at once
 * despite there being no hard cap.
 */
const VIEWPORT_ACTIVATE = 0.92; // NDC radius a card must enter to start decoding
const VIEWPORT_DEACTIVATE = 1.08; // ...and must drift back past to stop — the
// gap between the two is hysteresis, so a card sitting near the edge doesn't
// restart its stream every frame.

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
  playbackId: string;
  posterTexture: THREE.Texture;
  aspectW: number;
  aspectH: number;
  liveVideo?: HTMLVideoElement;
  liveHls?: Hls | null;
  liveTexture?: THREE.VideoTexture;
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(new THREE.Color(brand), 0);
    const canvas = renderer.domElement;
    canvas.style.cssText =
      "position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%";

    const gridLines = (alpha: number) =>
      `linear-gradient(rgba(255,255,255,${alpha}) 1px, transparent 1px),` +
      `linear-gradient(90deg, rgba(255,255,255,${alpha}) 1px, transparent 1px)`;
    const gridBase = document.createElement("div");
    gridBase.style.cssText = `position:absolute;inset:0;z-index:0;pointer-events:none;background-image:${gridLines(GRID_BASE_ALPHA)};background-size:${GRID_SIZE}px ${GRID_SIZE}px;`;
    const gridSpot = document.createElement("div");
    gridSpot.style.cssText = `position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 0.4s ease;background-image:${gridLines(GRID_SPOT_ALPHA)};background-size:${GRID_SIZE}px ${GRID_SIZE}px;`;
    host.appendChild(gridBase);
    host.appendChild(gridSpot);
    host.appendChild(canvas);

    // Vapour over both ends of the spiral. Two layers per bank, drifting at
    // different speeds, so the haze keeps moving without ever reading as a
    // repeating pattern.
    const banks = (["top", "bottom"] as const).map((side) => {
      const bank = document.createElement("div");
      bank.className = `cloud-bank cloud-bank--${side}`;
      for (let layer = 0; layer < 2; layer++) {
        const puffs = document.createElement("div");
        puffs.className = `cloud-puffs cloud-puffs--${layer === 0 ? "near" : "far"}`;
        bank.appendChild(puffs);
      }
      host.appendChild(bank);
      return bank;
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
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

    // The library drives the card count directly: fewer than MIN_CARDS
    // videos loop round to reach it, MIN_CARDS or more get one card each.
    const cardCount = videos.length;

    const cards: Card[] = [];
    for (let i = 0; i < cardCount; i++) {
      const video = videos[i];
      const [aspectW, aspectH] = parseAspect(video.aspectRatio);
      const posterTexture = textureLoader.load(posterUrl(video.playbackId));
      posterTexture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        uniforms: {
          uTexture: { value: posterTexture },
          uPlaneSizes: { value: planeSizes },
          uImageSizes: { value: new THREE.Vector2(aspectW, aspectH) },
          uCurl: { value: CURL },
          uSquash: { value: SQUASH },
          uCenterY: { value: CENTER_Y },
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
        playbackId: video.playbackId,
        posterTexture,
        aspectW,
        aspectH,
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
      const hls = attachHls(el, streamUrl(card.playbackId));
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
    };

    /* ── Fullscreen lightbox ──────────────────────────────────────────────── */
    const backdrop = document.createElement("div");
    backdrop.style.cssText =
      "position:fixed;inset:0;z-index:40;background:rgba(0,0,0,0);display:none;transition:background-color 0.5s ease;";
    const fsVideo = document.createElement("video");
    fsVideo.controls = true;
    fsVideo.playsInline = true;
    fsVideo.style.cssText =
      "position:fixed;z-index:41;display:none;object-fit:cover;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,0.6);outline:none;";
    let fsHls: Hls | null = null;
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close video");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
      "position:fixed;top:20px;right:20px;z-index:42;width:40px;height:40px;border-radius:9999px;border:none;background:rgba(20,20,20,0.6);color:#fff;font-size:16px;line-height:1;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.3s ease;";
    document.body.appendChild(backdrop);
    document.body.appendChild(fsVideo);
    document.body.appendChild(closeBtn);

    const cardScreenRect = (mesh: THREE.Mesh) => {
      const canvasRect = canvas.getBoundingClientRect();
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

    const applyRect = (
      rect: { left: number; top: number; width: number; height: number },
      radius: string,
    ) => {
      fsVideo.style.left = `${rect.left}px`;
      fsVideo.style.top = `${rect.top}px`;
      fsVideo.style.width = `${rect.width}px`;
      fsVideo.style.height = `${rect.height}px`;
      fsVideo.style.borderRadius = radius;
    };

    let openCard: Card | null = null;
    let mediaOpacity = 0; // crossfade target for fsVideo; the mesh fades to match

    const openVideo = (card: Card) => {
      if (openCard) return;
      openCard = card;
      mediaOpacity = 1;
      frozen = true;

      fsVideo.style.transition = "none";
      applyRect(cardScreenRect(card.mesh), "14px");
      fsVideo.style.opacity = "0";
      backdrop.style.display = "block";
      fsVideo.style.display = "block";
      closeBtn.style.display = "block";
      backdrop.style.pointerEvents = "auto";
      fsVideo.style.pointerEvents = "auto";

      fsHls?.destroy();
      fsHls = attachHls(fsVideo, streamUrl(card.playbackId));
      fsVideo.currentTime = card.liveVideo?.currentTime ?? 0;
      fsVideo.muted = false;
      void fsVideo.play().catch(() => {});

      // Force layout so the browser commits the start rect before it
      // transitions to the end rect, instead of collapsing both into one.
      fsVideo.getBoundingClientRect();
      requestAnimationFrame(() => {
        fsVideo.style.transition = `opacity ${SWAP_MS}ms ease, left ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), top ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), width ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), height ${OPEN_MS}ms cubic-bezier(0.22,1,0.36,1), border-radius ${OPEN_MS}ms ease`;
        applyRect(fullscreenRect(), "0px");
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

      // The shrink itself must stay visible, so the opacity crossfade is
      // deferred until near the end — and finishes with room to spare
      // before the motion stops, so nothing pops at the moment it settles.
      const fadeDelay = CLOSE_MS - SWAP_MS - CLOSE_FADE_LEAD_MS;
      fsVideo.style.transition = `opacity ${SWAP_MS}ms ease ${fadeDelay}ms, left ${CLOSE_MS}ms cubic-bezier(0.4,0,0.2,1), top ${CLOSE_MS}ms cubic-bezier(0.4,0,0.2,1), width ${CLOSE_MS}ms cubic-bezier(0.4,0,0.2,1), height ${CLOSE_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${CLOSE_MS}ms ease`;
      applyRect(cardScreenRect(card.mesh), "14px");
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < 900 ? 45 : 35;
      camera.updateProjectionMatrix();
      // Keep the open player filling the viewport through a resize; snap
      // rather than transition since this isn't a user-driven open/close.
      if (openCard) applyRect(fullscreenRect(), "0px");
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
    let lastPointerY = 0;
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    const pointer = new THREE.Vector2(2, 2); // parked off-screen until a move

    const push = (delta: number) => {
      if (delta === 0) return;
      targetSpeed = THREE.MathUtils.clamp(
        targetSpeed + delta,
        -MAX_SPEED,
        MAX_SPEED,
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
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const mask = `radial-gradient(circle ${GRID_SPOT_RADIUS}px at ${e.clientX - rect.left}px ${e.clientY - rect.top}px, black, transparent)`;
      gridSpot.style.maskImage = mask;
      gridSpot.style.webkitMaskImage = mask;
      gridSpot.style.opacity = "1";
      if (!dragging) return;
      push(-(e.clientY - lastPointerY) * DRAG_SENS);
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
        const rect = canvas.getBoundingClientRect();
        pointer.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(meshes)[0]?.object;
        const card = cards.find((c) => c.mesh === hit);
        if (card) openVideo(card);
      }
    };
    const onPointerLeave = () => {
      pointer.set(2, 2);
      gridSpot.style.opacity = "0";
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
      // bounding sphere before touching a triangle.
      raycaster.setFromCamera(pointer, camera);
      const hovered =
        dragging || frozen
          ? undefined
          : raycaster.intersectObjects(meshes)[0]?.object;
      const hoveredCard = cards.find((c) => c.mesh === hovered);
      canvas.style.cursor = dragging
        ? "grabbing"
        : hovered
          ? "pointer"
          : "grab";

      const desired = new Set<Card>();
      if (hoveredCard) desired.add(hoveredCard);

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
        const radius = RADIUS * (1 - hidden / 2);
        const y = b * VERTICAL_GAP + CENTER_Y + hidden * 1.5;

        mesh.position.set(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius,
        );
        mesh.rotation.y = -angle + Math.PI / 2;

        u.uScrollSpeed.value = speed;
        u.uZoom.value = 1 + 0.06 * card.hover;
        u.uHighlight.value = card.hover;
        u.uReveal.value = card.reveal;
        u.uTime.value = elapsed;

        const ndcPoint = ndc.copy(mesh.position).project(camera);
        const ndcY = ndcPoint.y;
        const depth = Math.abs(b * VERTICAL_GAP);
        const fog = Math.max(
          THREE.MathUtils.smoothstep(Math.abs(ndcY), FOG_START, FOG_END),
          THREE.MathUtils.smoothstep(depth, WRAP_FOG_START, WRAP_FOG_END),
        );
        u.uFog.value = fog;
        u.uSwell.value = 1 + fog * FOG_SWELL;
        u.uFogDir.value = ndcY >= 0 ? 1 : -1;
        u.uOpacity.value =
          card.reveal *
          (1 - THREE.MathUtils.smoothstep(depth, CUT_START, CUT_END)) *
          (1 - card.hiding);

        // A card counts as "on screen" once its centre falls inside the NDC
        // square; already-live cards get the looser of the two radii so they
        // don't drop out and restart on the same frame they cross the edge.
        const edge = Math.max(Math.abs(ndcPoint.x), Math.abs(ndcY));
        const inViewport = card.liveVideo
          ? edge < VIEWPORT_DEACTIVATE
          : edge < VIEWPORT_ACTIVATE;
        if (inViewport && u.uOpacity.value > 0.05) desired.add(card);
      }

      for (const card of cards) {
        const shouldBeActive = desired.has(card);
        if (shouldBeActive && !card.liveVideo) activateCard(card);
        else if (!shouldBeActive && card.liveVideo) deactivateCard(card);
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
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
      for (const card of cards) {
        deactivateCard(card);
        card.posterTexture.dispose();
        card.mesh.material.dispose();
      }
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      gridBase.remove();
      gridSpot.remove();
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
