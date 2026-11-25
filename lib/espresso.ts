/* ── Espresso mode ──────────────────────────────────────────────────────────
 * The bio ends on coffee — "las mejores ideas casi siempre llegan después del
 * primer sorbo" — so the site keeps one: typing "cafe" anywhere, or pressing
 * the word "café" in the bio, takes the whole page from black to espresso and
 * its clouds to crema. Press or type it again to go back.
 *
 * The state is an attribute on <html>, which the CSS keys the palette off
 * (see `html[data-espresso]` in globals.css), plus an event for the parts that
 * cannot follow CSS: the WebGL clouds in SpiralCarousel, the toast in
 * CoffeeMode, the pressed state on the bio's button. Not persisted — it is a
 * moment, not a preference.
 */

export const ESPRESSO_EVENT = "cells:espresso";

export const isEspresso = () =>
  document.documentElement.dataset.espresso !== undefined;

export function setEspresso(on: boolean) {
  if (on === isEspresso()) return;
  const root = document.documentElement;
  if (on) root.dataset.espresso = "";
  else delete root.dataset.espresso;
  window.dispatchEvent(
    new CustomEvent<boolean>(ESPRESSO_EVENT, { detail: on }),
  );
}

export const toggleEspresso = () => setEspresso(!isEspresso());

/* ── Coffee break ───────────────────────────────────────────────────────────
 * Left alone long enough, the site takes one: CoffeeMode notices the visitor
 * has stopped touching anything, says so, and SpiralCarousel lets its idle
 * drift go so the strip coasts to a standstill. The first sign of life ends
 * it. `detail` is whether the break is on.
 */
export const COFFEE_BREAK_EVENT = "cells:coffee-break";
