"use client";

import { useEffect, useRef } from "react";

/* ── Custom cursor ─────────────────────────────────────────────────────────
 * The site's pointer is a cell: a precise dot with a soft, slowly wobbling
 * ring trailing it, which swells into whatever the thing under it is for — a
 * play disc over a reel, a close mark over the lightbox backdrop, a small
 * white tag naming a tool or a profile.
 *
 * It knows nothing about the page. Everything it shows is read off the element
 * under the pointer:
 *
 *   data-cursor="…"        the state to take over that element (see the
 *                          `.cursor[data-state=…]` rules in globals.css). The
 *                          owner may rewrite it at any time — SpiralCarousel
 *                          does, every time the card under a still pointer
 *                          changes — so it is re-read every frame.
 *   data-cursor-label="…"  text for the tag that rides beside the pointer.
 *   data-magnetic          the element leans toward the pointer while hovered
 *                          (it must take its offset from --mx / --my, which
 *                          the `[data-magnetic]` rule in globals.css does).
 *
 * Mouse only. A touch screen has no pointer to dress, and a hybrid laptop gets
 * the cursor back the moment its mouse moves again.
 */

const FOLLOW = 0.22; // per-60Hz-frame pull of the ring toward the pointer
const PRESS_EASING = 0.3;
const PRESS_SHRINK = 0.18; // how much of the ring a held button squeezes out
// Squash and stretch along the direction of travel: the ring is a soft body,
// so it elongates when thrown. Per px of travel per 60Hz frame, and capped.
const STRETCH_PER_PX = 1 / 90;
const STRETCH_MAX = 0.32;

const MAGNET_PULL = 0.28; // share of the pointer's offset from centre a tile follows
const MAGNET_EASING = 0.2;

/* The page changes under a pointer that isn't moving — the lightbox opens over
 * the card that was just clicked, a tile finishes sliding in — and no event
 * says so. Asking the browser what is under the pointer is a hit test (and a
 * style flush when anything is dirty), so it is asked a few times a second
 * rather than every frame; a real pointermove always carries its own target.
 */
const RETARGET_MS = 120;

const TAG_OFFSET_X = 14;
const TAG_OFFSET_Y = 18;
const VIEWPORT_MARGIN = 8;
const CLICK_MOVE_THRESHOLD = 6; // px; past this a press was a drag, not a click

type Magnet = { cx: number; cy: number; x: number; y: number };

function startCursor(root: HTMLDivElement, reducedMotion: boolean) {
  const dot = root.querySelector<HTMLElement>(".cursor-dot")!;
  const cell = root.querySelector<HTMLElement>(".cursor-cell")!;
  const shape = root.querySelector<HTMLElement>(".cursor-shape")!;
  const tag = root.querySelector<HTMLElement>(".cursor-tag")!;
  const tagText = root.querySelector<HTMLElement>(".cursor-tag-text")!;
  const pulse = root.querySelector<HTMLElement>(".cursor-pulse")!;

  let x = 0;
  let y = 0;
  let cx = 0; // the ring, trailing (x, y)
  let cy = 0;
  let seen = false; // no position is known until the first mouse event
  let visible = false;
  let pressed = false;
  let press = 0;
  let downX = 0;
  let downY = 0;
  let target: Element | null = null;
  let targetAt = 0;
  let state = "default";
  let label = "";
  let tagW = 0;
  let tagH = 0;
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  // Last values written, so a still pointer costs no style work at all.
  let shownDot = "";
  let shownCell = "";
  let shownShape = "";
  let shownTag = "";

  const magnets = new Map<HTMLElement, Magnet>();
  let activeMagnet: HTMLElement | null = null;

  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    root.dataset.visible = String(next);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      setVisible(false);
      return;
    }
    x = e.clientX;
    y = e.clientY;
    if (!seen) {
      // Start on the pointer rather than gliding in from the corner.
      seen = true;
      cx = x;
      cy = y;
      /* What hides the native pointer, and only now: until the mouse has
       * moved there is nowhere to draw this one, and a page that hid the
       * system cursor at load would leave a still mouse with no pointer at
       * all. A class rather than a media query for the same reason — the
       * system cursor is only ever given up while this loop is alive to
       * replace it. */
      document.documentElement.classList.add("has-cursor");
    }
    target = e.target instanceof Element ? e.target : null;
    targetAt = performance.now();
    setVisible(true);
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    pressed = true;
    downX = e.clientX;
    downY = e.clientY;
  };

  const onUp = (e: PointerEvent) => {
    if (!pressed) return;
    pressed = false;
    if (reducedMotion || e.type === "pointercancel") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MOVE_THRESHOLD)
      return;
    // A click lets go of a ring, like a drop landing.
    const at = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
    pulse.animate(
      [
        { transform: `${at} scale(0.6)`, opacity: 0.7 },
        { transform: `${at} scale(2.1)`, opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(0.22,1,0.36,1)" },
    );
  };

  const onLeave = () => setVisible(false);
  const onResize = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });
  window.addEventListener("resize", onResize);
  document.documentElement.addEventListener("mouseleave", onLeave);

  let raf = 0;
  let last = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Normalised to 60Hz, like the spiral, so the trail is the same length on
    // a 120Hz display.
    const step = Math.min((now - last) / 1000, 0.05) * 60;
    last = now;
    if (!seen) return;

    // Not while a button is held: a drag owns its target (pointer capture),
    // and what happens to be under the pointer mid-drag is beside the point.
    if (!pressed && now - targetAt > RETARGET_MS) {
      targetAt = now;
      target = document.elementFromPoint(x, y);
    }

    const zone = target?.closest<HTMLElement>("[data-cursor]") ?? null;
    const interactive =
      target?.closest<HTMLElement>(
        "a, button, [role='slider'], [data-magnetic]",
      ) ?? null;
    // A control inside a zone is the more specific of the two — unless the
    // zone is the control itself, which is a control asking for its own look.
    const nextState =
      interactive &&
      (!zone || (zone !== interactive && zone.contains(interactive)))
        ? "link"
        : (zone?.dataset.cursor ?? "default");
    if (nextState !== state) {
      state = nextState;
      root.dataset.state = state;
    }

    const nextLabel =
      target?.closest<HTMLElement>("[data-cursor-label]")?.dataset
        .cursorLabel ?? "";
    if (nextLabel !== label) {
      label = nextLabel;
      // The old text is left in place on the way out, so the tag fades with
      // its words still in it. Measured here, once per label, not per frame.
      if (label) {
        tagText.textContent = label;
        tagW = tagText.offsetWidth;
        tagH = tagText.offsetHeight;
      }
      root.dataset.tag = String(!!label);
    }

    /* Magnetic tiles. The hovered one leans toward the pointer; any other that
     * is still displaced eases home and is then forgotten, so at rest this
     * loop holds no elements and writes nothing. The tile follows the pointer,
     * so the pointer can't fall out of it by the tile moving — it only leaves
     * when the pointer does. */
    const magnet = reducedMotion
      ? null
      : (target?.closest<HTMLElement>("[data-magnetic]") ?? null);
    if (magnet !== activeMagnet) {
      activeMagnet = magnet;
      if (magnet && !magnets.has(magnet)) {
        const rect = magnet.getBoundingClientRect();
        magnets.set(magnet, {
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          x: 0,
          y: 0,
        });
      }
    }
    if (magnets.size > 0) {
      const k = 1 - Math.pow(1 - MAGNET_EASING, step);
      for (const [el, m] of magnets) {
        const held = el === activeMagnet;
        m.x += ((held ? (x - m.cx) * MAGNET_PULL : 0) - m.x) * k;
        m.y += ((held ? (y - m.cy) * MAGNET_PULL : 0) - m.y) * k;
        if (!held && Math.abs(m.x) < 0.05 && Math.abs(m.y) < 0.05) {
          el.style.removeProperty("--mx");
          el.style.removeProperty("--my");
          magnets.delete(el);
          continue;
        }
        el.style.setProperty("--mx", `${m.x.toFixed(2)}px`);
        el.style.setProperty("--my", `${m.y.toFixed(2)}px`);
      }
    }

    const follow = reducedMotion ? 1 : 1 - Math.pow(1 - FOLLOW, step);
    const px = cx;
    const py = cy;
    cx += (x - cx) * follow;
    cy += (y - cy) * follow;
    press +=
      ((pressed ? 1 : 0) - press) * (1 - Math.pow(1 - PRESS_EASING, step));

    const dotAt = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    if (dotAt !== shownDot) {
      shownDot = dotAt;
      dot.style.transform = dotAt;
    }
    const cellAt = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
    if (cellAt !== shownCell) {
      shownCell = cellAt;
      cell.style.transform = cellAt;
    }

    /* Stretch along the direction of travel, squeeze across it. Written as the
     * one symmetric matrix that does both rather than rotate-scale-unrotate:
     * the ring isn't round (it wobbles), so an explicit rotation would spin
     * its outline every time a slow pointer changed heading. This one fades to
     * the identity as the speed does, whatever the heading. */
    const vx = (cx - px) / step;
    const vy = (cy - py) / step;
    const v = Math.hypot(vx, vy);
    const stretch = reducedMotion ? 0 : Math.min(v * STRETCH_PER_PX, STRETCH_MAX);
    const size = 1 - press * PRESS_SHRINK;
    const along = size * (1 + stretch);
    const across = size * (1 - stretch * 0.5);
    const dx = v > 0.001 ? vx / v : 1;
    const dy = v > 0.001 ? vy / v : 0;
    const skew = ((along - across) * dx * dy).toFixed(3);
    const shapeAt =
      `matrix(${(across + (along - across) * dx * dx).toFixed(3)},${skew},` +
      `${skew},${(across + (along - across) * dy * dy).toFixed(3)},0,0)`;
    if (shapeAt !== shownShape) {
      shownShape = shapeAt;
      shape.style.transform = shapeAt;
    }

    if (label) {
      // Below and to the right of the pointer, like any tooltip — flipped to
      // the other side wherever that would run it off the screen, which for
      // the social tiles on the right edge is always.
      let tx = cx + TAG_OFFSET_X;
      let ty = cy + TAG_OFFSET_Y;
      if (tx + tagW > vw - VIEWPORT_MARGIN) tx = cx - TAG_OFFSET_X - tagW;
      if (ty + tagH > vh - VIEWPORT_MARGIN) ty = cy - TAG_OFFSET_Y - tagH;
      const tagAt = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0)`;
      if (tagAt !== shownTag) {
        shownTag = tagAt;
        tag.style.transform = tagAt;
      }
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("resize", onResize);
    document.documentElement.removeEventListener("mouseleave", onLeave);
    document.documentElement.classList.remove("has-cursor");
    for (const el of magnets.keys()) {
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
    }
    root.dataset.visible = "false";
  };
}

export default function Cursor() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Both can change under a mounted page — a mouse plugged into a tablet, a
    // system setting flipped — so the engine is rebuilt on either rather than
    // deciding once.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stop: (() => void) | undefined;
    const sync = () => {
      stop?.();
      stop = fine.matches ? startCursor(root, reduced.matches) : undefined;
    };
    sync();
    fine.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      stop?.();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="cursor"
      aria-hidden
      data-state="default"
      data-visible="false"
      data-tag="false"
    >
      <div className="cursor-pulse" />
      <div className="cursor-cell">
        <div className="cursor-shape" />
        <svg className="cursor-icon cursor-icon--play" viewBox="0 0 24 24">
          <path d="M8.5 5.6v12.8a.6.6 0 0 0 .92.5l10-6.4a.6.6 0 0 0 0-1L9.42 5.1a.6.6 0 0 0-.92.5Z" />
        </svg>
        <svg className="cursor-icon cursor-icon--pause" viewBox="0 0 24 24">
          <rect x="6.5" y="5" width="4" height="14" rx="1" />
          <rect x="13.5" y="5" width="4" height="14" rx="1" />
        </svg>
        <svg
          className="cursor-icon cursor-icon--close cursor-icon--stroke"
          viewBox="0 0 24 24"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
        <svg
          className="cursor-icon cursor-icon--coffee cursor-icon--stroke"
          viewBox="0 0 24 24"
        >
          <path className="cursor-steam" d="M9 2.5c-.8 1 .8 1.6 0 2.6" />
          <path className="cursor-steam" d="M12.5 2.5c-.8 1 .8 1.6 0 2.6" />
          <path d="M4.5 8.5h12v5.2a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z" />
          <path d="M16.5 10h1.3a2.2 2.2 0 0 1 0 4.4h-1.6" />
          <path d="M3.5 21h15" />
        </svg>
        <svg
          className="cursor-icon cursor-icon--scroll cursor-icon--stroke"
          viewBox="0 0 24 24"
        >
          <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
        </svg>
      </div>
      <div className="cursor-dot" />
      <div className="cursor-tag">
        <div className="cursor-tag-text pill pill--sm" />
      </div>
    </div>
  );
}
