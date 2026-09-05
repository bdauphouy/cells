"use client";

import { useEffect, useId, useRef, useState } from "react";

// The bio runs long enough to eat a third of a phone screen, so on mobile it
// opens clamped to a few lines and the reader extends it. From `sm` up there's
// room for the whole thing at once, so every part of this — the clamp, the
// fade, the toggle — drops away and the text renders exactly as it did before.
//
// The collapsed clamp is a plain class rather than an inline style so the
// first server-rendered paint is already correct at both widths; only the
// expanded height has to be measured, and it arrives as a CSS variable that
// `sm:max-h-none` overrides anyway.
const COLLAPSED_CLASS = "max-h-[4.25rem]";
const COLLAPSED_PX = 68;

export default function HeroBio({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  // Assumed true so the common case (a bio that does overflow) needs no
  // correction after mount; a short one loses the toggle a frame later.
  const [overflows, setOverflows] = useState(true);
  const [fullHeight, setFullHeight] = useState<string>();
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // scrollHeight is the full text height whether or not the clamp is on, so
    // re-measuring after an expand settles on the same number instead of
    // feeding the observer a new one.
    const measure = () => {
      setFullHeight(`${el.scrollHeight}px`);
      setOverflows(el.scrollHeight > COLLAPSED_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bio]);

  return (
    /* Expanded, this panel rides up over the tools column, so the frost has to
     * do more work than it did over video alone: at only 2px of blur a covered
     * tile still reads as a recognisable smudge. A heavier blur dissolves it
     * while keeping the scrim itself as see-through as before.
     *
     * The whole scrim is the target, not just the label under it: a 10px word
     * is a poor thing to hit on a phone, and the panel is the obvious thing to
     * press. Pointer events are taken back at `sm`, where there is nothing left
     * to open — the panel lies over the canvas, and a box this size swallowing
     * events would be taking the drag that spins the spiral. That also settles
     * the click handler, which can't fire on a layer nothing reaches.
     */
    <div
      onClick={() => setExpanded((open) => !open)}
      className={`group rounded-xl bg-black/45 px-3 py-2.5 backdrop-blur-md sm:pointer-events-none sm:cursor-auto sm:rounded-none sm:bg-transparent sm:p-0 sm:backdrop-blur-none ${
        overflows ? "pointer-events-auto cursor-pointer" : ""
      }`}
    >
      <p
        ref={textRef}
        id={textId}
        style={
          fullHeight
            ? ({ "--bio-full": fullHeight } as React.CSSProperties)
            : undefined
        }
        className={`overflow-hidden text-[13px] leading-relaxed text-white/90 transition-[max-height] duration-300 ease-out motion-reduce:transition-none sm:max-h-none sm:text-[14px] sm:[mask-image:none] ${
          expanded
            ? "max-h-[var(--bio-full)]"
            : `${COLLAPSED_CLASS} [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]`
        }`}
      >
        {bio}
      </p>
      {/* Deliberately handler-less: the click it emits — from a tap or from
          Enter/Space — bubbles to the panel, which is the one place the toggle
          lives. It stays a real <button> rather than becoming a caption
          because it is what carries the control's semantics: something
          focusable, named, and announcing the collapsed state. Putting those
          on the panel instead would fold the entire bio into the button's own
          accessible name, which is how a screen reader would then read it. */}
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          className="mt-2 text-[10px] uppercase text-white/60 transition-colors duration-200 group-hover:text-white sm:hidden"
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}
