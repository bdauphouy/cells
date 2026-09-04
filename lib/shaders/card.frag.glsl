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
/* 0 is a resolved 9:16 card; 1 is a formless puff of vapour with no card in it
 * at all. Everything between is the morph — silhouette, fill and lighting all
 * cross over on this one number. It is driven from two places (see
 * SpiralCarousel): a card is born as a cloud and condenses into its reel over
 * a couple of seconds, and it goes back to being a cloud whenever it drifts
 * into a bank at either end of the spiral. */
uniform float uCloud;
/* Per-card constant. Two clouds side by side built from the same lobes read as
 * a repeated stamp, which is the one thing vapour never looks like. */
uniform float uSeed;
/* How much bigger than the card its own plane is. The vertex stage grows the
 * geometry by this, and everything here is measured in the card's own space
 * inside it — so the extra is transparent margin, room for a border that has
 * gone soft enough to spill past where the card's edge used to be, and for a
 * cloud that is half again as wide as the card it will become. Without it the
 * puff would be sliced off in a straight line at the quad. */
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

/* Smooth minimum. A plain min() of two circles unions them with a crease down
 * the seam, and a cloud built that way reads as a row of bubbles. Blending the
 * two fields over a band of width k is what fuses the lobes into one mass. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float lobe(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}

/* The cloud's silhouette, in the same aspect-corrected space as the card's
 * rounded rect below — one unit is one card height, so the card itself is
 * 0.5625 x 1.0 and centred on the origin.
 *
 * Deliberately the opposite shape: about 0.72 wide and 0.43 tall, so it is
 * wider than it is tall where the card is much taller than it is wide, and
 * there is no reading of it as a reel until the morph is well under way. The
 * width is the constrained axis — the plane only swells to 1.7x the card, and
 * it cannot swell much past that without cards reaching each other's planes
 * (see the no-crossing note in SpiralCarousel) — so 0.36 of half-width is
 * close to the ceiling, and what is left over is the soft edge's budget.
 *
 * Mass sits below the midline with the smaller puffs riding on top, which is
 * what makes a heap of circles read as cumulus rather than as a flower. */
float cloudSdf(vec2 p, float seed, float t) {
  // Per-card jitter, so the lobes are never in the same arrangement twice.
  vec2 j = vec2(hash(vec2(seed, 1.7)), hash(vec2(seed, 4.3))) - 0.5;

  // Each lobe breathes on its own phase: the mass keeps changing shape
  // without ever travelling anywhere.
  vec2 d0 = vec2(sin(t * 0.31 + seed * 6.3), cos(t * 0.24 + seed * 4.1)) * 0.020;
  vec2 d1 = vec2(cos(t * 0.27 + seed * 5.2), sin(t * 0.33 + seed * 2.7)) * 0.022;
  float s = 1.12 + 0.05 * sin(t * 0.4 + seed * 7.7);

  /* The fusing width is deliberately narrower than it could be: fused hard
   * enough the lobes stop being lobes and the whole thing comes out a potato.
   * What is wanted is one mass you can still count the puffs in. */
  float d = lobe(p, vec2(-0.02 + j.x * 0.04, -0.035) * s, 0.180 * s);
  d = smin(d, lobe(p, (vec2(-0.19 + j.x * 0.05, -0.055) + d0) * s, 0.145 * s), 0.075);
  d = smin(d, lobe(p, (vec2( 0.18 - j.y * 0.05, -0.06) - d0) * s, 0.138 * s), 0.075);
  d = smin(d, lobe(p, (vec2(-0.10 + j.y * 0.06,  0.085) + d1) * s, 0.126 * s), 0.07);
  d = smin(d, lobe(p, (vec2( 0.09 + j.x * 0.06,  0.10) - d1) * s, 0.116 * s), 0.07);

  /* Cumulus sits on a flat base — that is the one line in a cloud, where it
   * meets the level the air condenses at, and without it a heap of circles
   * reads as popcorn. Smooth-intersected with the half-plane rather than
   * clipped, so the base is a soft shelf and not a cut. */
  float floorPlane = -(p.y + 0.175 * s);
  d = -smin(-d, -floorPlane, 0.075);
  return d;
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

  float cloud = clamp(uCloud, 0.0, 1.0);
  // Eased, so the card holds its true rectangle for a moment before it starts
  // letting go and the last of the condensation is the slowest part of it.
  float form = smoothstep(0.0, 1.0, cloud);

  vec4 color = vec4(0.0);
  /* A fully formed cloud has no card left inside it to sample, and at the
   * intro every card on the spiral is one — so this skips the taps rather
   * than paying for a texture read that `form` is about to weigh at zero.
   * uCloud is a uniform, so the branch is coherent across the draw call. */
  if (cloud < 0.995) {
    if (gl_FrontFacing) {
      color = texture2D(uTexture, zoomedUv);

      // Haze in front of the card scatters it before it hides it, so the
      // picture goes out of focus on the way into the bank. The card is being
      // drained of colour and pulled apart by the same fog, so the two-tap
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
  }

  // Aspect-corrected card space: one unit is one card height, origin at the
  // middle of the card, so corners stay circular on a tall card and the cloud
  // above is measured in the same units.
  vec2 aspect = vec2(uPlaneSizes.x / uPlaneSizes.y, 1.0);
  vec2 p = (cardUv - 0.5) * aspect;

  // Rounded-rect mask. Shrinks while the card is still arriving.
  vec2 halfSize = 0.5 * aspect * mix(0.7, 1.0, uReveal);
  float radius = min(mix(0.055, 0.20, form), min(halfSize.x, halfSize.y) * 0.9);
  vec2 d = abs(p) - halfSize + radius;
  float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;

  /* The morph itself. Both fields are true distances, so interpolating them
   * carries the silhouette through the intermediate shapes rather than
   * cross-fading two pictures of it: the puff stretches upward, its lobes
   * flatten into sides, and the last of the bulges settle into corners.
   *
   * Running the noise costs several sin() per fragment, and in clear air it
   * would be multiplied straight back to zero on every crisp card on screen —
   * so the whole vapour path sits behind a uniform branch. */
  /* Everything that makes an edge look like vapour rather than like an edge —
   * the ragged displacement and the wide falloff — is weighted on form
   * squared, not form. Linearly weighted, a card three quarters of the way
   * back to being a card still carries a quarter of the fraying, and a nearly
   * resolved reel with wobbling sides and a mushy border reads as a rendering
   * fault rather than as the tail of a morph. Squared, the last stretch snaps
   * clean while the cloud end keeps all of it. */
  float wisps = form * form;

  if (form > 0.002) {
    sdf = mix(sdf, cloudSdf(p, uSeed, uTime), form);
    // Ragged boundary. Two scales: the coarse one puts bulges and hollows in
    // the outline, the fine one frays it.
    sdf += (fbm(p * vec2(4.0, 5.0) + uSeed * 13.0 - uTime * vec2(0.05, 0.09)) - 0.5)
      * wisps * 0.075;
    sdf += (fbm(p * vec2(11.0, 13.0) + uSeed * 7.0 + uTime * vec2(0.11, -0.07)) - 0.5)
      * wisps * 0.035;
  }

  // A cloud has no line anywhere on it, so the edge widens with the morph
  // until the falloff is most of what you see of the boundary.
  float soft = fwidth(sdf) * 1.5 + wisps * 0.10 + uFog * 0.05;
  float alpha = 1.0 - smoothstep(-soft * 0.5, soft * 0.5, sdf);

  alpha *= smoothstep(0.0, 0.6, uReveal) * uOpacity;

  vec3 rgb = color.rgb * vShade * (1.0 + uHighlight * 0.35);

  if (form > 0.002) {
    /* Cloud light. A cumulus is near-white along the top of every billow and
     * keeps its colour only underneath, so the shading is a vertical ramp
     * pushed around by the same noise that makes the billows — which is what
     * stops it reading as a flat gradient laid over a blob.
     *
     * The bank is lit from within: the card's own geometric shading is let go
     * of on the way in, so the last of the card glows rather than dims. */
    float billow = fbm(p * vec2(6.0, 8.0) + vec2(uSeed * 5.0, -uTime * 0.045));
    float top = smoothstep(-0.22, 0.20, p.y + (billow - 0.5) * 0.18);
    vec3 lit = mix(uFogColor * 0.74, min(uFogColor * 1.4, vec3(1.0)), top);
    lit *= 0.88 + 0.26 * billow;
    // Thin vapour at the fringe passes more light than the body does.
    lit *= mix(1.12, 1.0, smoothstep(0.0, 0.14, -sdf));

    /* The fill lags the silhouette. Weighted on `form` alone the footage
     * starts showing through while the thing is still shaped like a cloud,
     * and a cloud with a video playing inside it reads as a bug; held back
     * like this the puff stays opaque vapour through the first half of the
     * morph and the picture only surfaces once there is a card to put it on.
     */
    float fill = smoothstep(0.25, 0.70, cloud);
    rgb = mix(rgb, vec3(dot(rgb, vec3(0.299, 0.587, 0.114))), fill * 0.5);
    rgb /= mix(1.0, vShade, fill);
    rgb = mix(rgb, lit, fill);
  }

  if (uFog > 0.001) {
    /* Dispersal, distinct from the morph above: by the time a card is deep
     * enough in a bank to be at the wrap point it is already a cloud, and this
     * is that cloud coming apart. It eats from the edge that entered the bank
     * first — the top one for a card climbing out, the bottom one for a card
     * sinking away — and holds off until the puff has fully formed, so the
     * shape is never tattered on the way in.
     */
    float lead = clamp(mix(1.0 - cardUv.y, cardUv.y, step(0.0, uFogDir)), 0.0, 1.0);
    float wisp = fbm(
      vec2(cardUv.x * 3.0, cardUv.y * 4.0) + uTime * vec2(0.06, 0.13)
    );
    float bite = smoothstep(0.45, 1.0, uFog) * (0.75 + 0.75 * lead);
    alpha *= smoothstep(bite - 0.3, bite + 0.25, wisp * 0.85 + 0.28);
    // A high-noise patch could otherwise survive the bite; this closes the
    // last of it inside the same ramp, so nothing pops at the wrap point.
    alpha *= 1.0 - smoothstep(0.86, 1.0, uFog);
  }

  if (alpha < 0.001) discard;

  gl_FragColor = vec4(rgb, alpha);
}
