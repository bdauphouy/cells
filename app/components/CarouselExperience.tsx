"use client";

import { useCallback, useEffect, useState } from "react";
import AnimatedLogo from "@/components/AnimatedLogo";
import SpiralCarousel from "@/components/SpiralCarousel";
import type { ResolvedCard } from "@/lib/library";

// The scene is usually ready well under this on desktop, but the mark's
// intro is itself ~2.4s — cutting away right as it lands reads as an
// interruption rather than a completed motion, so the loader holds for at
// least one full beat regardless of how fast the scene actually was.
const MIN_LOADER_MS = 4000;
// How long the fade-out takes, in ms — kept in sync with the transition
// duration class below so the loader unmounts right as it finishes, not
// before (a visible pop) or long after (idle rAF work for nothing).
const FADE_MS = 500;

export default function CarouselExperience({ cards }: { cards: ResolvedCard[] }) {
  const [sceneReady, setSceneReady] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [loaderMounted, setLoaderMounted] = useState(true);
  // Mounting the scene in the same commit as the loader means their two
  // mount effects run back to back, synchronously, before either gets to
  // paint — and the scene's setup (shader compilation, per-card textures
  // and geometry) is heavy enough that it was blocking the loader's own
  // first frame from ever reaching the screen. One rAF defers the scene's
  // mount to the next commit, so the loader's effect runs and paints first.
  const [mountScene, setMountScene] = useState(false);

  const handleReady = useCallback(() => setSceneReady(true), []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMountScene(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setMinTimeElapsed(true), MIN_LOADER_MS);
    return () => clearTimeout(id);
  }, []);

  const reveal = sceneReady && minTimeElapsed;

  useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => setLoaderMounted(false), FADE_MS);
    return () => clearTimeout(id);
  }, [reveal]);

  return (
    <>
      {/* `started` is the same flag as the fade, not a later one: the cards
          arrive as clouds and take a few seconds to condense into reels, so
          beginning that while the loader is still on its way out means the
          first thing to come through the fade is already in motion. */}
      {mountScene && (
        <SpiralCarousel cards={cards} onReady={handleReady} started={reveal} />
      )}
      {loaderMounted && (
        <div
          aria-hidden={reveal}
          className={`bg-brand fixed inset-0 z-50 transition-opacity duration-500 ease-out ${
            reveal ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          {/* AnimatedLogo's own background fill shrinks along with it under
              scale-25, so this wrapper carries the full-viewport brand fill
              instead — the mark just floats centered on top of it. */}
          <AnimatedLogo controls={false} background="transparent" className="scale-25" />
        </div>
      )}
    </>
  );
}
