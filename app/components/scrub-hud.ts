/* ── Scrub HUD ─────────────────────────────────────────────────────────────
 * The spiral is a timeline, so it gets what an editor's timeline has: a ruler
 * that slides under a fixed playhead as the strip is scrubbed, and a counter
 * for the clip currently at the front. One long tick per clip, so a tick
 * crossing the playhead is a card arriving face-on, and the counter turns over
 * half-way between two of them.
 *
 * Imperative for the same reason lightbox-controls is: it is driven from
 * SpiralCarousel's render loop, sixty times a second, and has no business
 * going through React to move a strip of ticks. Its looks live in globals.css
 * under `.scrub-*`.
 */

// Ruler px per clip. Must match the long-tick period in `.scrub-ticks`.
const CLIP_PX = 40;

export type ScrubHud = {
  el: HTMLDivElement;
  /** `position` is in clips along the endless strip, fractional. */
  update(position: number): void;
  destroy(): void;
};

export function createScrubHud(total: number): ScrubHud {
  const el = document.createElement("div");
  el.className = "scrub-hud";
  // Decoration over a canvas a screen reader can't see into anyway; a number
  // that changes many times a second is not something to announce.
  el.setAttribute("aria-hidden", "true");
  // Arrives with the rest of the chrome once the loader lifts; see
  // `chrome-enter` in globals.css.
  el.dataset.enter = "down";

  const ruler = document.createElement("div");
  ruler.className = "scrub-ruler";
  const ticks = document.createElement("div");
  ticks.className = "scrub-ticks";
  const playhead = document.createElement("div");
  playhead.className = "scrub-playhead";
  ruler.append(ticks, playhead);

  const count = document.createElement("div");
  count.className = "scrub-count";
  const current = document.createElement("span");
  current.className = "scrub-current";
  const of = document.createElement("span");
  of.className = "scrub-total";
  const width = Math.max(2, String(total).length);
  of.textContent = ` / ${String(total).padStart(width, "0")}`;
  count.append(current, of);

  el.append(ruler, count);

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Cached, so a frame only touches the DOM for what actually changed.
  let shownShift = NaN;
  let shownClip = -1;
  let lastPosition = NaN;
  let flip: Animation | undefined;

  const update = (position: number) => {
    // The strip repeats every clip, so the ruler only ever travels one period
    // before snapping back — invisibly, since every period looks the same.
    const shift =
      Math.round(-(position - Math.floor(position)) * CLIP_PX * 10) / 10;
    if (shift !== shownShift) {
      shownShift = shift;
      ticks.style.transform = `translate3d(${shift}px,0,0)`;
    }

    const clip = (((Math.round(position) % total) + total) % total) + 1;
    if (clip !== shownClip) {
      const first = shownClip === -1;
      shownClip = clip;
      current.textContent = String(clip).padStart(width, "0");
      // The number rolls in from the side the strip is travelling toward, like
      // a counter wheel. Skipped for the first value, which has nothing to
      // roll over from.
      if (!first && !reducedMotion) {
        const from = position >= lastPosition ? 5 : -5;
        flip?.cancel();
        flip = current.animate(
          [
            { transform: `translateY(${from}px)`, opacity: 0.3 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: 200, easing: "cubic-bezier(0.22,1,0.36,1)" },
        );
      }
    }
    lastPosition = position;
  };

  const destroy = () => {
    flip?.cancel();
    el.remove();
  };

  return { el, update, destroy };
}
