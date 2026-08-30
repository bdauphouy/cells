uniform sampler2D uTexture;
uniform vec2 uPlaneSizes;
uniform vec2 uImageSizes;
uniform float uZoom;
uniform float uReveal;
uniform float uOpacity;
uniform float uHighlight;
uniform float uFog; // 0 in clear air, 1 lost in the cloud bank
uniform float uFogDir; // +1 leaving through the top, -1 through the bottom
uniform vec3 uFogColor;
uniform float uTime;
/* How much bigger than the card its own plane is. The vertex stage grows the
 * geometry by this, and everything here is measured in the card's own space
 * inside it — so the extra is transparent margin, room for a border that has
 * gone soft enough to spill past where the card's edge used to be. Without it
 * the blur would be sliced off in a straight line at the quad. */
uniform float uSwell;

varying vec2 vUv;
varying float vShade;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/* Four octaves is enough to read as vapour rather than as a texture. Two is
 * not, quite — the wisps come out coarser — but this runs per fragment over
 * every card that is anywhere near a cloud bank, and on a phone the coarser
 * vapour is the better trade. LOW_QUALITY is set from the device class in
 * SpiralCarousel; see the material's `defines`.
 */
#ifdef LOW_QUALITY
#define FBM_OCTAVES 2
#else
#define FBM_OCTAVES 4
#endif

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM_OCTAVES; i++) {
    v += a * valueNoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Cover-fit the video into the 9:16 card without stretching it.
  vec2 ratio = vec2(
    min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
    min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
  );
  // The card's own uv, undoing the plane's swell so the footage stays locked
  // to the card at its true size however much margin is around it.
  vec2 cardUv = (vUv - 0.5) * uSwell + 0.5;
  vec2 uv = cardUv * ratio + (1.0 - ratio) * 0.5;
  vec2 zoomedUv = (uv - 0.5) / uZoom + 0.5;

  vec4 color;
  if (gl_FrontFacing) {
    color = texture2D(uTexture, zoomedUv);

    // Haze in front of the card scatters it before it hides it, so the
    // picture goes out of focus on the way into the bank. The card is being
    // drained of colour and torn apart by the same fog, so the two-tap
    // version below is close enough to pass where fill rate is scarce.
    if (uFog > 0.001) {
      float o = uFog * 0.022;
#ifdef LOW_QUALITY
      vec4 c = texture2D(uTexture, zoomedUv + vec2(-o, -o));
      c += texture2D(uTexture, zoomedUv + vec2(o, o));
      color = mix(color, c * 0.5, uFog);
#else
      vec4 c = texture2D(uTexture, zoomedUv + vec2(-o, -o));
      c += texture2D(uTexture, zoomedUv + vec2(o, -o));
      c += texture2D(uTexture, zoomedUv + vec2(-o, o));
      c += texture2D(uTexture, zoomedUv + vec2(o, o));
      color = mix(color, c * 0.25, uFog);
#endif
    }
  } else {
    // The back of a card is the same footage read through the sheet. The
    // mirroring comes free from looking at the geometry from behind; the
    // rest is what diffusion does — spread, drained contrast, cooled tint.
    // Half the cards on the helix face away at any moment, so this kernel is
    // paid for over a lot of the screen: the reduced one keeps the same
    // radius and total weight, just fewer taps across it.
    float o = 0.028;
#ifdef LOW_QUALITY
    vec4 c = texture2D(uTexture, uv) * 4.0;
    c += texture2D(uTexture, uv + vec2(0.0, -o)) * 2.0;
    c += texture2D(uTexture, uv + vec2(0.0,  o)) * 2.0;
    c += texture2D(uTexture, uv + vec2(-o, 0.0)) * 2.0;
    c += texture2D(uTexture, uv + vec2( o, 0.0)) * 2.0;

    vec3 diffused = c.rgb / 12.0;
#else
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
#endif
    diffused = mix(vec3(dot(diffused, vec3(0.299, 0.587, 0.114))), diffused, 0.55);
    diffused = mix(diffused, vec3(0.16, 0.18, 0.24), 0.28);
    color = vec4(diffused * 0.62, 1.0);
  }

  // Rounded-rect mask, measured in an aspect-corrected space so the corners
  // stay circular on a tall card. Shrinks while the card is still arriving.
  vec2 aspect = vec2(uPlaneSizes.x / uPlaneSizes.y, 1.0);
  vec2 halfSize = 0.5 * aspect * mix(0.7, 1.0, uReveal);

  // Deep in the bank a card has no edge to speak of: its corners open out
  // until the rectangle is nearer a lozenge, its outline is pushed around by
  // the same vapour that eats it, and the border is soft enough to have no
  // line at all. Coming the other way — out of the cloud and into the middle
  // of the screen — all three tighten back down, and the shape resolves into
  // the crisp 9:16 card. Capped against the arriving card's smaller box, which
  // a full-fog radius would otherwise overrun.
  float radius = min(mix(0.055, 0.24, uFog), min(halfSize.x, halfSize.y) * 0.9);
  vec2 d = abs((cardUv - 0.5) * aspect) - halfSize + radius;
  float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
  sdf +=
    (fbm(cardUv * vec2(3.5, 5.5) - uTime * vec2(0.05, 0.09)) - 0.45) *
    uFog *
    0.12;
  float soft = fwidth(sdf) * 1.5 + uFog * 0.16;
  float alpha = 1.0 - smoothstep(-soft * 0.5, soft * 0.5, sdf);

  alpha *= smoothstep(0.0, 0.6, uReveal) * uOpacity;

  vec3 rgb = color.rgb * vShade * (1.0 + uHighlight * 0.35);

  if (uFog > 0.001) {
    // Colour drains and takes on the light of the bank itself, so what is
    // left of the card is already made of cloud before it stops being there.
    // The bank is lit from within: shading is let go of on the way in, and
    // the last of the card glows rather than dims.
    float milk = smoothstep(0.0, 0.95, uFog);
    rgb = mix(rgb, vec3(dot(rgb, vec3(0.299, 0.587, 0.114))), milk * 0.5);
    rgb /= mix(1.0, vShade, milk);
    rgb = mix(rgb, uFogColor, milk * 0.85);
    rgb += uFogColor * milk * 0.22;

    // The cloud eats the card in torn patches rather than dimming it flat,
    // and it eats from the edge that entered first — the top one for a card
    // climbing out, the bottom one for a card sinking away.
    float lead = clamp(mix(1.0 - cardUv.y, cardUv.y, step(0.0, uFogDir)), 0.0, 1.0);
    float wisp = fbm(
      vec2(cardUv.x * 3.0, cardUv.y * 4.0) + uTime * vec2(0.06, 0.13)
    );
    float bite = uFog * (0.75 + 0.75 * lead);
    alpha *= smoothstep(bite - 0.3, bite + 0.25, wisp * 0.85 + 0.28);
    // A high-noise patch could otherwise survive the bite; this closes the
    // last of it inside the same ramp, so nothing pops at the wrap point.
    alpha *= 1.0 - smoothstep(0.86, 1.0, uFog);
  }

  if (alpha < 0.001) discard;

  gl_FragColor = vec4(rgb, alpha);
}
