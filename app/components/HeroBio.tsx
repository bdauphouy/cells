"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ESPRESSO_EVENT, isEspresso, toggleEspresso } from "@/lib/espresso";

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

const subscribeEspresso = (onChange: () => void) => {
  window.addEventListener(ESPRESSO_EVENT, onChange);
  return () => window.removeEventListener(ESPRESSO_EVENT, onChange);
};

/* The first mention of coffee in the bio, whichever language it was written
 * in. Bounded by letters rather than \b, which treats "é" as a non-word
 * character and would never find the end of "café". */
const COFFEE_WORD = /(?<!\p{L})(caf[eé]|coffee)(?!\p{L})/iu;

/* The word itself, made into the switch for espresso mode (lib/espresso.ts):
 * a wisp of steam over it says there is something here, the custom cursor
 * turns into a cup over it, and a press pours. A real <button> so a keyboard
 * or a screen reader gets to it too — it reads as the word, with its state.
 */
function CoffeeWord({ word }: { word: string }) {
  // Read straight off <html>, where the mode lives, rather than mirrored into
  // state — so the typed trigger and this button can never disagree.
  const on = useSyncExternalStore(subscribeEspresso, isEspresso, () => false);

  // No `title`: the custom cursor names it, and the two tooltips would say
  // the same thing at once (the reason the overlay tiles dropped theirs).
  return (
    <button
      type="button"
      aria-pressed={on}
      data-cursor="coffee"
      data-cursor-label={on ? "Back to work" : "Espresso?"}
      // The panel around it toggles the bio open on a tap; this tap is for
      // the coffee only.
      onClick={(e) => {
        e.stopPropagation();
        toggleEspresso();
      }}
      className="coffee-word"
    >
      {/* Three S-shaped wisps, each rising and thinning out on its own beat
          (see .coffee-steam in globals.css). */}
      <svg aria-hidden viewBox="0 0 20 18" className="coffee-steam">
        <path d="M5 17c-1.6-2 1.6-4 0-6s1.6-4 0-6" />
        <path d="M10 17c-1.6-2 1.6-4 0-6s1.6-4 0-6" />
        <path d="M15 17c-1.6-2 1.6-4 0-6s1.6-4 0-6" />
      </svg>
      {word}
    </button>
  );
}

function BioText({ bio }: { bio: string }) {
  const match = COFFEE_WORD.exec(bio);
  if (!match) return bio;
  const at = match.index;
  return (
    <>
      {bio.slice(0, at)}
      <CoffeeWord word={match[0]} />
      {bio.slice(at + match[0].length)}
    </>
  );
}

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
        className={`overflow-hidden text-[13px] leading-relaxed text-white/90 transition-[max-height] duration-300 ease-out motion-reduce:transition-none sm:mask-none sm:max-h-none sm:text-[14px] ${
          expanded
            ? "max-h-(--bio-full)"
            : `${COLLAPSED_CLASS} mask-[linear-gradient(to_bottom,#000_55%,transparent)]`
        }`}
      >
        <BioText bio={bio} />
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
