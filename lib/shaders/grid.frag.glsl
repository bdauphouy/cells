/* ── Background grid ─────────────────────────────────────────────────────────
 * The graph paper behind the spiral. At rest it is exactly what two CSS
 * gradient sheets used to draw — 1 css px white lines every uGridSize px, a
 * faint base layer and a brighter one masked to a disc around the pointer —
 * and it is drawn here instead so it can be bent: the paper sags into a well
 * under the pointer, lines crowding in toward it, deeper while the strip is
 * being scrubbed, then springs back flat (see the grid block in
 * SpiralCarousel's loop).
 *
 * Everything is in css pixels, y down, origin at the canvas's top-left — the
 * frame the old sheets lived in — so the constants carried over unchanged.
 */

uniform vec2 uResolution; // canvas size, css px
uniform float uPixelRatio; // device px per css px
uniform float uGridSize;
uniform float uShift; // parallax slide, css px, already wrapped to one cell
uniform float uBaseAlpha;
uniform float uSpotAlpha;
uniform float uSpotRadius;
uniform vec2 uPointer; // css px
uniform float uSpot; // 0..1, the spotlight's fade
uniform vec2 uCenter; // css px: the bottom of the well, under the pointer
uniform float uRadius; // css px: how far out the well reaches
uniform float uPinch; // 0 flat .. 1 fully drawn in; may dip under 0 on rebound

/* Coverage of a 1 css px line along one axis of grid coordinate `g`. fwidth is
 * how many grid units a device pixel spans here, which under the warp changes
 * from place to place — measuring distance in it is what keeps every line one
 * pixel wide however hard the paper is squeezed. Lines crowded closer than a
 * few device pixels would turn to moiré, so there they are faded into the
 * average they would have produced: the paper goes evenly brighter instead of
 * shimmering.
 */
float lineCoverage(float g) {
  float fw = max(fwidth(g), 1e-5);
  float dist = abs(fract(g + 0.5) - 0.5) / fw;
  float halfWidth = 0.5 * uPixelRatio;
  float crisp = clamp(halfWidth + 0.5 - dist, 0.0, 1.0);
  float average = min(2.0 * halfWidth * fw, 1.0);
  float spacing = 1.0 / fw;
  return mix(average, crisp, smoothstep(2.5, 6.0, spacing));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y * uPixelRatio - gl_FragCoord.y) / uPixelRatio;

  /* The well. Each pixel shows the paper from further out along its own
   * radius than it sits — so a small disc around the pointer shows a large
   * patch of grid, which is the lines being gathered in. Two falloffs: a broad
   * one that bows the paper around the pointer, and a tight core that makes
   * the bottom of it read as a hole rather than a lens. Both are gone a couple
   * of radii out, so the rest of the sheet stays flat. Purely radial: every
   * line is drawn straight in toward the pointer, none is turned.
   */
  vec2 d = p - uCenter;
  float r2 = dot(d, d);
  float broad = exp(-r2 / (uRadius * uRadius));
  float core = exp(-r2 / (0.09 * uRadius * uRadius));
  d *= 1.0 + uPinch * (0.5 * broad + 0.4 * core);
  vec2 q = uCenter + d;

  // The sheets painted each line on the first pixel of its cell; +0.5 puts
  // the line's centre there, so at rest every line lands on the same pixel.
  vec2 g = vec2(q.x - 0.5, q.y - 0.5 - uShift) / uGridSize;
  float cx = lineCoverage(g.x);
  float cy = lineCoverage(g.y);

  // Gathered-in lines also gather light.
  float base = uBaseAlpha * (1.0 + max(uPinch, 0.0) * 0.5 * broad);
  // The old mask: radial-gradient(circle R at pointer, black, transparent).
  float spot = uSpotAlpha * uSpot * clamp(1.0 - length(p - uPointer) / uSpotRadius, 0.0, 1.0);

  // Four layers composited the way the browser stacked the two sheets of
  // two gradients each.
  float alpha = 1.0 - (1.0 - base * cx) * (1.0 - base * cy) * (1.0 - spot * cx) * (1.0 - spot * cy);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}
