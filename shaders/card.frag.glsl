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
