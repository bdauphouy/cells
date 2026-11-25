"use client";

import { useEffect, useRef, useState } from "react";
import {
  COFFEE_BREAK_EVENT,
  ESPRESSO_EVENT,
  setEspresso,
  toggleEspresso,
} from "@/lib/espresso";

/* The coffee in the site, besides the bio's own button (see lib/espresso.ts):
 *
 * - typing "cafe" anywhere toggles espresso mode, and every switch of it,
 *   from here or from the bio, is announced with a pill;
 * - left alone long enough, the site takes a coffee break: the spiral coasts
 *   to a stop and a pill with a steaming cup says so, until the first sign of
 *   life.
 *
 * Both pills share one slot at the top of the screen; a new one replaces
 * whatever is there.
 */

// Accented or not, and the English word too: whoever finds this is typing
// blind, and should not be failed on a dead key.
const TRIGGER = /(?:caf[eé]|coffee)$/;
const BUFFER = 8; // chars kept; the longest trigger is six
const TOAST_MS = 2200;
const LEAVE_MS = 300; // matches the fade on `.coffee-toast[data-leaving]`

/* Long enough that nobody reading the bio or watching the strip go by gets
 * interrupted, short enough that someone who has stepped away still comes
 * back to it. */
const BREAK_AFTER_MS = 30_000;
// pointermove fires per frame; the timer only needs resetting now and then.
const ACTIVITY_THROTTLE_MS = 500;
const ACTIVITY_EVENTS = [
  "pointermove",
  "pointerdown",
  "wheel",
  "keydown",
  "touchstart",
] as const;

// Module-level, like VisitTracker's flag, so React's dev double-invoked
// effects still greet once.
let greeted = false;

type Notice = { text: string; key: number; cup: boolean; leaving: boolean };

export default function CoffeeMode() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const typed = useRef("");

  useEffect(() => {
    let hideTimer = 0;
    let leaveTimer = 0;
    const show = (text: string, cup: boolean, ms?: number) => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(leaveTimer);
      setNotice({ text, cup, key: performance.now(), leaving: false });
      if (ms) hideTimer = window.setTimeout(hide, ms);
    };
    const hide = () => {
      window.clearTimeout(hideTimer);
      setNotice((n) => n && { ...n, leaving: true });
      leaveTimer = window.setTimeout(() => setNotice(null), LEAVE_MS);
    };

    /* ── Coffee break ── */
    const root = document.documentElement;
    let onBreak = false;
    let idleTimer = 0;
    let lastActivity = 0;
    const setBreak = (on: boolean) => {
      onBreak = on;
      window.dispatchEvent(
        new CustomEvent<boolean>(COFFEE_BREAK_EVENT, { detail: on }),
      );
    };
    const startBreak = () => {
      // Not over a playing video (someone watching is not idle), and not in a
      // tab nobody is looking at: try again later instead.
      if (document.hidden || root.dataset.lightbox !== undefined) {
        idleTimer = window.setTimeout(startBreak, BREAK_AFTER_MS);
        return;
      }
      setBreak(true);
      show("Pausa para el café.", true);
    };
    const onActivity = () => {
      if (onBreak) {
        setBreak(false);
        hide();
      } else {
        const now = performance.now();
        if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
        lastActivity = now;
      }
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(startBreak, BREAK_AFTER_MS);
    };

    /* ── Espresso ── */
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      typed.current = (typed.current + e.key.toLowerCase()).slice(-BUFFER);
      if (TRIGGER.test(typed.current)) {
        typed.current = "";
        toggleEspresso();
      }
    };
    const onSwitch = (e: Event) => {
      const on = (e as CustomEvent<boolean>).detail;
      // The bio ends on the first sip; the way back is the working day.
      show(on ? "Primer sorbo." : "De vuelta al trabajo.", false, TOAST_MS);
    };

    // Activity first: a key that ends a break and also completes "cafe" must
    // clear the break's pill before the espresso one goes up, not after.
    for (const type of ACTIVITY_EVENTS)
      window.addEventListener(type, onActivity, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener(ESPRESSO_EVENT, onSwitch);
    idleTimer = window.setTimeout(startBreak, BREAK_AFTER_MS);

    // For whoever opens the console on a portfolio — which is to say, other
    // people who build these. Once per page load, dev remounts included.
    if (!greeted) {
      greeted = true;
      console.log(
        "%cHecho con café.%c\nEscribe «cafe» en la página.",
        "font: 600 14px system-ui; color: #c48c5c",
        "font: 12px system-ui; color: inherit",
      );
    }

    return () => {
      for (const type of ACTIVITY_EVENTS)
        window.removeEventListener(type, onActivity);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(ESPRESSO_EVENT, onSwitch);
      window.clearTimeout(idleTimer);
      window.clearTimeout(hideTimer);
      window.clearTimeout(leaveTimer);
      // A remount (dev refresh, navigation back) starts the page plain.
      if (onBreak) setBreak(false);
      setEspresso(false);
    };
  }, []);

  return (
    // Polite: each pill confirms something that just happened to the page,
    // and is the only sign a screen-reader user gets of it.
    <div role="status" aria-live="polite" className="coffee-toast-slot">
      {notice && (
        <div
          key={notice.key}
          className="coffee-toast pill"
          data-leaving={notice.leaving || undefined}
        >
          {notice.cup && (
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="coffee-toast-cup"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path className="cup-steam" d="M9 2.5c-.8 1 .8 1.6 0 2.6" />
              <path className="cup-steam" d="M12.5 2.5c-.8 1 .8 1.6 0 2.6" />
              <path d="M4.5 8.5h12v5.2a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z" />
              <path d="M16.5 10h1.3a2.2 2.2 0 0 1 0 4.4h-1.6" />
              <path d="M3.5 21h15" />
            </svg>
          )}
          {notice.text}
        </div>
      )}
    </div>
  );
}
