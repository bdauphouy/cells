"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ── Helix ─────────────────────────────────────────────────────────────────
 * Cards ride a vertical helix: each one orbits the y axis a little further
 * round and climbs a little higher than the last, its plane kept tangent to
 * the cylinder so the strip reads as a spiral staircase from the camera.
 */
const COUNT = 18;
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
const FADE_START = 3.1; // |y| where cards start dissolving...
const FADE_END = 4.7; // ...and where they are gone, hiding the loop point

/* ── Reveal ──────────────────────────────────────────────────────────────── */
const REVEAL_EASING = 0.055;
const REVEAL_STAGGER = 0.05; // seconds between each card's entrance

const vertexShader = /* glsl */ `
  #define PI 3.14159265359

  uniform vec2 uPlaneSizes;
  uniform float uCurl;
  uniform float uScrollSpeed;

  varying vec2 vUv;
  varying float vShade;

  void main() {
    // Motion smear: the card pinches vertically and spreads sideways with
    // speed. Capped so it can never widen past its angular wedge.
    float rush = min(abs(uScrollSpeed), 0.6);

    vec3 pos = position;
    pos.x *= 1.0 + rush * ${SQUASH.toFixed(3)} * 0.6;
    pos.y *= 1.0 - rush * ${SQUASH.toFixed(3)};

    // Curl the sheet outward from the cylinder. Bulging along the local z
    // leaves the angular wedge untouched, so cards still cannot cross.
    float curl = sin(uv.x * PI);
    pos.z += curl * uCurl;

    vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;

    // Screen-space warps. These shift the projected x only — view depth is
    // untouched, so the cards still sort correctly against each other.
    // Bow is measured from the helix's visual centre, not the world origin.
    float bowY = worldPosition.y - ${CENTER_Y.toFixed(3)};
    viewPosition.x += bowY * bowY * ${LENS.toFixed(4)};
    viewPosition.x += sin(uv.y * PI) * uScrollSpeed * ${WHIP.toFixed(3)};

    gl_Position = projectionMatrix * viewPosition;

    // Fake lighting off the curl, so the bend actually reads as a bend.
    float slope = uCurl * PI * cos(uv.x * PI) / uPlaneSizes.x;
    vec3 n = normalize(mat3(modelMatrix) * normalize(vec3(-slope, 0.0, 1.0)));
    vec3 toCamera = normalize(cameraPosition - worldPosition);
    vShade = mix(0.72, 1.08, abs(dot(n, toCamera)));

    vUv = uv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uPlaneSizes;
  uniform vec2 uImageSizes;
  uniform float uZoom;
  uniform float uReveal;
  uniform float uOpacity;
  uniform float uHighlight;

  varying vec2 vUv;
  varying float vShade;

  void main() {
    // Cover-fit the video into the 9:16 card without stretching it.
    vec2 ratio = vec2(
      min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
      min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
    );
    vec2 uv = vUv * ratio + (1.0 - ratio) * 0.5;
    vec2 zoomedUv = (uv - 0.5) / uZoom + 0.5;

    vec4 color;
    if (gl_FrontFacing) {
      color = texture2D(uTexture, zoomedUv);
    } else {
      // The back of a card is the same footage read through the sheet. The
      // mirroring comes free from looking at the geometry from behind; the
      // rest is what diffusion does — spread, drained contrast, cooled tint.
      float o = 0.028;
      float w = o * 2.0;
      vec4 c = texture2D(uTexture, uv) * 4.0;
      c += texture2D(uTexture, uv + vec2(-o, -o));
      c += texture2D(uTexture, uv + vec2( o, -o));
      c += texture2D(uTexture, uv + vec2(-o,  o));
      c += texture2D(uTexture, uv + vec2( o,  o));
      c += texture2D(uTexture, uv + vec2(0.0, -o)) * 2.0;
      c += texture2D(uTexture, uv + vec2(0.0,  o)) * 2.0;
      c += texture2D(uTexture, uv + vec2(-o, 0.0)) * 2.0;
      c += texture2D(uTexture, uv + vec2( o, 0.0)) * 2.0;
      c += texture2D(uTexture, uv + vec2(0.0, -w));
      c += texture2D(uTexture, uv + vec2(0.0,  w));
      c += texture2D(uTexture, uv + vec2(-w, 0.0));
      c += texture2D(uTexture, uv + vec2( w, 0.0));

      vec3 diffused = c.rgb / 20.0;
      diffused = mix(vec3(dot(diffused, vec3(0.299, 0.587, 0.114))), diffused, 0.55);
      diffused = mix(diffused, vec3(0.16, 0.18, 0.24), 0.28);
      color = vec4(diffused * 0.62, 1.0);
    }

    // Rounded-rect mask, measured in an aspect-corrected space so the corners
    // stay circular on a tall card. Shrinks while the card is still arriving.
    vec2 aspect = vec2(uPlaneSizes.x / uPlaneSizes.y, 1.0);
    vec2 halfSize = 0.5 * aspect * mix(0.7, 1.0, uReveal);
    float radius = 0.055;
    vec2 d = abs((vUv - 0.5) * aspect) - halfSize + radius;
    float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
    float alpha = 1.0 - smoothstep(0.0, fwidth(sdf) * 1.5, sdf);

    alpha *= smoothstep(0.0, 0.6, uReveal) * uOpacity;
    if (alpha < 0.001) discard;

    gl_FragColor = vec4(color.rgb * vShade * (1.0 + uHighlight * 0.35), alpha);
  }
`;

type Card = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  index: number;
  delay: number;
  reveal: number;
  hover: number;
};

export default function SpiralCarousel() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* One <video> shared by every card — a single decode feeds all 18 planes. */
    const video = document.createElement("video");
    video.src = "/rick.mp4";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // iOS Safari refuses to decode a detached element, so keep it in the tree.
    video.style.cssText =
      "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
    host.appendChild(video);
    const play = () => void video.play().catch(() => {});
    play();
    // Some browsers still gate autoplay; the first interaction unblocks it.
    window.addEventListener("pointerdown", play, { once: true });

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x0a0a0a, 1);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    const geometry = new THREE.PlaneGeometry(
      CARD_W,
      CARD_H,
      SEGMENTS,
      SEGMENTS,
    );
    const planeSizes = new THREE.Vector2(CARD_W, CARD_H);
    const imageSizes = new THREE.Vector2(16, 9);

    const cards: Card[] = [];
    for (let i = 0; i < COUNT; i++) {
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        uniforms: {
          uTexture: { value: texture },
          uPlaneSizes: { value: planeSizes },
          uImageSizes: { value: imageSizes },
          uCurl: { value: CURL },
          uScrollSpeed: { value: 0 },
          uZoom: { value: 1 },
          uReveal: { value: 0 },
          uOpacity: { value: 1 },
          uHighlight: { value: 0 },
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
      });
    }
    const meshes = cards.map((c) => c.mesh);

    const onMeta = () => imageSizes.set(video.videoWidth, video.videoHeight);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.videoWidth) onMeta();

    /* ── Sizing ───────────────────────────────────────────────────────────── */
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < 900 ? 45 : 35;
      camera.updateProjectionMatrix();
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
    let lastPointerY = 0;
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
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (!dragging) return;
      push(-(e.clientY - lastPointerY) * DRAG_SENS);
      lastPointerY = e.clientY;
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
    };
    const onPointerLeave = () => pointer.set(2, 2);

    canvas.addEventListener("wheel", onWheel, { passive: true });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", onPointerLeave);

    /* ── Loop ─────────────────────────────────────────────────────────────── */
    const raycaster = new THREE.Raycaster();
    const clock = new THREE.Clock();
    let elapsed = 0;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      // Normalised to 60Hz, so the feel is identical on a 120Hz display.
      const dt = Math.min(clock.getDelta(), 0.05);
      const step = dt * 60;
      elapsed += dt;

      speed += (targetSpeed - speed) * (1 - Math.pow(1 - EASING, step));
      offset += speed * step;
      if (Math.abs(targetSpeed) < IDLE_SPEED)
        targetSpeed = direction * IDLE_SPEED;
      targetSpeed *= Math.pow(DECAY, step);

      // The helix moves under a still pointer, so this has to re-run every
      // frame; it stays cheap because three rejects most meshes on their
      // bounding sphere before touching a triangle.
      raycaster.setFromCamera(pointer, camera);
      const hovered = dragging
        ? undefined
        : raycaster.intersectObjects(meshes)[0]?.object;
      canvas.style.cursor = dragging
        ? "grabbing"
        : hovered
          ? "pointer"
          : "grab";

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

        const hidden = 1 - card.reveal;
        // Wrap into [0, COUNT) so a fixed set of meshes loops forever.
        const slot = (((card.index - offset) % COUNT) + COUNT) % COUNT;
        const b = slot - (COUNT - 1) / 2;

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
        // Faded on the un-offset height, so CENTER_Y can't bias which end wraps.
        u.uOpacity.value =
          card.reveal *
          (1 -
            THREE.MathUtils.smoothstep(
              Math.abs(b * VERTICAL_GAP),
              FADE_START,
              FADE_END,
            ));
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointerdown", play);
      video.removeEventListener("loadedmetadata", onMeta);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      video.pause();
      video.removeAttribute("src");
      video.remove();
      for (const card of cards) card.mesh.material.dispose();
      geometry.dispose();
      texture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative min-h-0 w-full flex-1 touch-none overflow-hidden bg-[#0a0a0a]"
    />
  );
}
