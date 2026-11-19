/* ── Lightbox player controls ─────────────────────────────────────────────
 * The chrome for SpiralCarousel's fullscreen player: play/pause, a timeline
 * that can be dragged freely with a mouse or a finger, elapsed/total time and
 * a mute toggle. Built imperatively, like the rest of the lightbox, because
 * the player itself is a plain <video> that lives outside React.
 *
 * Not the browser's native controls: those differ per engine, can't be
 * restyled, and on iOS are drawn in a layer above the page that wins any
 * overlap with the lightbox's own chrome. These sit in the same bottom-left
 * dock as the title panel and fade with it.
 *
 * Idle behaviour: while the clip plays, the chrome fades out after IDLE_MS
 * without pointer or key activity (and the cursor hides over the video); it
 * stays up while paused, while scrubbing and while the mouse is over the bar.
 * A tap on the video toggles playback — except on a touch screen when the
 * chrome is hidden, where the first tap only brings it back, so a viewer
 * reaching for the timeline doesn't pause the clip on the way.
 */

const IDLE_MS = 2500;
const SEEK_STEP_S = 5;

const svg = (body: string, filled = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${
    filled
      ? 'fill="currentColor"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  }>${body}</svg>`;

const ICON_PLAY = svg(
  '<path d="M7 4.6v14.8a1 1 0 0 0 1.53.85l11.6-7.4a1 1 0 0 0 0-1.7L8.53 3.75A1 1 0 0 0 7 4.6z"/>',
  true,
);
const ICON_PAUSE = svg(
  '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  true,
);
// lucide's volume-2 / volume-x, so they belong to the same set as the X.
const SPEAKER =
  '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>';
const ICON_SOUND = svg(
  SPEAKER +
    '<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
);
const ICON_MUTED = svg(
  SPEAKER + '<path d="M22 9l-6 6"/><path d="M16 9l6 6"/>',
);

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const formatTime = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
) => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

export type LightboxControls = {
  /** The control bar; the caller places it in the dock. */
  bar: HTMLDivElement;
  /** Reset to the start state and begin tracking the video. */
  open(): void;
  /** Stop tracking and hand the pointer back; the caller fades the dock. */
  close(): void;
  destroy(): void;
};

/**
 * @param video  the lightbox's <video>
 * @param chrome the element faded out when idle — the bar's container, so the
 *               title panel goes with it
 */
export function createLightboxControls(
  video: HTMLVideoElement,
  chrome: HTMLElement,
): LightboxControls {
  const bar = el("div", "lightbox-bar");

  const playBtn = el("button", "lightbox-btn");
  playBtn.type = "button";

  const elapsed = el("span", "lightbox-time");
  const total = el("span", "lightbox-time");

  const track = el("div", "lightbox-track");
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Seek");
  track.setAttribute("aria-valuemin", "0");
  const rail = el("div", "lightbox-rail");
  const buffered = el("div", "lightbox-buffered");
  const progress = el("div", "lightbox-progress");
  rail.append(buffered, progress);
  const thumb = el("div", "lightbox-thumb");
  const bubble = el("div", "lightbox-bubble");
  track.append(rail, thumb, bubble);

  const muteBtn = el("button", "lightbox-btn");
  muteBtn.type = "button";

  bar.append(playBtn, elapsed, track, total, muteBtn);

  let isOpen = false;
  let visible = true;
  let idleTimer = 0;
  let raf = 0;
  let overBar = false;

  let scrubbing = false;
  let wasPlaying = false;
  let scrubTime = 0;
  // Latest position asked for mid-drag, applied once the previous seek has
  // landed — setting currentTime on every pointermove would queue a fragment
  // fetch per event and the picture would trail the finger by seconds.
  let pendingSeek: number | null = null;
  let trackRect = new DOMRect();

  // Cached so the per-frame render only touches the DOM when a value changes.
  let shownElapsed = "";
  let shownTotal = "";
  let shownProgress = -1;
  let shownBuffered = -1;

  const duration = () =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

  /* ── Visibility ─────────────────────────────────────────────────────── */
  const setVisible = (v: boolean) => {
    if (visible === v) return;
    visible = v;
    chrome.classList.toggle("is-idle", !v);
    video.style.cursor = v ? "" : "none";
  };

  const mustStayVisible = () => video.paused || scrubbing || overBar;

  const poke = () => {
    if (!isOpen) return;
    setVisible(true);
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (isOpen && !mustStayVisible()) setVisible(false);
    }, IDLE_MS);
  };

  /* ── Rendering ──────────────────────────────────────────────────────── */
  const syncPlay = () => {
    // Mid-drag the video is paused on purpose; the button keeps showing what
    // will happen once the finger lifts.
    const playing = scrubbing ? wasPlaying : !video.paused && !video.ended;
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  const syncMute = () => {
    const muted = video.muted || video.volume === 0;
    muteBtn.innerHTML = muted ? ICON_MUTED : ICON_SOUND;
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  };

  const bufferedEnd = (t: number) => {
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= t + 0.25 && t <= ranges.end(i)) return ranges.end(i);
    }
    return 0;
  };

  const render = (t: number) => {
    const d = duration();
    const r = d ? clamp(t / d, 0, 1) : 0;
    if (r !== shownProgress) {
      shownProgress = r;
      progress.style.transform = `scaleX(${r})`;
      thumb.style.left = `${r * 100}%`;
    }
    const b = d ? clamp(bufferedEnd(t) / d, 0, 1) : 0;
    if (b !== shownBuffered) {
      shownBuffered = b;
      buffered.style.transform = `scaleX(${b})`;
    }
    const e = formatTime(t);
    if (e !== shownElapsed) {
      shownElapsed = e;
      elapsed.textContent = e;
      track.setAttribute("aria-valuenow", String(Math.floor(t)));
      track.setAttribute("aria-valuetext", `${e} of ${formatTime(d)}`);
    }
    const tot = formatTime(d);
    if (tot !== shownTotal) {
      shownTotal = tot;
      total.textContent = tot;
      track.setAttribute("aria-valuemax", String(Math.floor(d)));
    }
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (pendingSeek !== null && !video.seeking) {
      video.currentTime = pendingSeek;
      pendingSeek = null;
    }
    render(scrubbing ? scrubTime : video.currentTime);
  };

  /* ── Actions ────────────────────────────────────────────────────────── */
  const togglePlay = () => {
    if (video.paused || video.ended) void video.play().catch(() => {});
    else video.pause();
  };

  const toggleMute = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
  };

  const seekTo = (t: number) => {
    const d = duration();
    if (!d) return;
    video.currentTime = clamp(t, 0, d);
  };

  /* ── Timeline ───────────────────────────────────────────────────────── */
  const ratioAt = (clientX: number) =>
    trackRect.width > 0
      ? clamp((clientX - trackRect.left) / trackRect.width, 0, 1)
      : 0;

  const placeBubble = (r: number) => {
    bubble.style.left = `${r * 100}%`;
    bubble.textContent = formatTime(r * duration());
  };

  const scrubTo = (clientX: number) => {
    const r = ratioAt(clientX);
    scrubTime = r * duration();
    pendingSeek = scrubTime;
    placeBubble(r);
  };

  const onTrackDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!duration()) return;
    // No text selection, no synthetic mouse events, no page gesture.
    e.preventDefault();
    trackRect = track.getBoundingClientRect();
    track.setPointerCapture(e.pointerId);
    wasPlaying = !video.paused && !video.ended;
    scrubbing = true;
    video.pause();
    bar.classList.add("is-scrubbing");
    scrubTo(e.clientX);
    syncPlay();
    poke();
  };

  const onTrackMove = (e: PointerEvent) => {
    if (scrubbing) {
      scrubTo(e.clientX);
      return;
    }
    if (e.pointerType === "mouse" && duration()) placeBubble(ratioAt(e.clientX));
  };

  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    pendingSeek = null;
    bar.classList.remove("is-scrubbing");
    video.currentTime = scrubTime;
    // Released on the very end: playing from there would restart the clip.
    if (wasPlaying && scrubTime < duration() - 0.05)
      void video.play().catch(() => {});
    syncPlay();
    poke();
  };

  const onTrackEnter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    trackRect = track.getBoundingClientRect();
    track.classList.add("is-hover");
  };
  const onTrackLeave = () => track.classList.remove("is-hover");

  /* ── Bar & video pointer ────────────────────────────────────────────── */
  const onBarEnter = (e: PointerEvent) => {
    if (e.pointerType === "mouse") overBar = true;
  };
  const onBarLeave = () => {
    overBar = false;
    poke();
  };

  let tapRevealsOnly = false;
  const onVideoDown = (e: PointerEvent) => {
    // Runs before the window listener below has had a chance to show the
    // chrome, so `visible` is still what the viewer was looking at.
    tapRevealsOnly = e.pointerType !== "mouse" && !visible;
  };
  const onVideoClick = () => {
    if (!isOpen) return;
    if (tapRevealsOnly) {
      tapRevealsOnly = false;
      return;
    }
    togglePlay();
  };

  const onPlayClick = () => {
    togglePlay();
    poke();
  };
  const onMuteClick = () => {
    toggleMute();
    poke();
  };

  /* ── Keyboard ───────────────────────────────────────────────────────── */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    switch (e.key) {
      case " ":
        // A focused button already turns Space into its own click.
        if (onButton) return;
        togglePlay();
        break;
      case "k":
      case "K":
        togglePlay();
        break;
      case "ArrowLeft":
        seekTo(video.currentTime - SEEK_STEP_S);
        break;
      case "ArrowRight":
        seekTo(video.currentTime + SEEK_STEP_S);
        break;
      case "Home":
        if (e.target !== track) return;
        seekTo(0);
        break;
      case "End":
        if (e.target !== track) return;
        seekTo(duration());
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      default:
        return;
    }
    e.preventDefault();
    poke();
  };

  /* ── Video state ────────────────────────────────────────────────────── */
  const onPlay = () => {
    syncPlay();
    poke();
  };
  const onPause = () => {
    syncPlay();
    if (isOpen) setVisible(true);
  };

  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("ended", onPause);
  video.addEventListener("volumechange", syncMute);
  video.addEventListener("pointerdown", onVideoDown);
  video.addEventListener("click", onVideoClick);
  playBtn.addEventListener("click", onPlayClick);
  muteBtn.addEventListener("click", onMuteClick);
  track.addEventListener("pointerdown", onTrackDown);
  track.addEventListener("pointermove", onTrackMove);
  track.addEventListener("pointerup", endScrub);
  track.addEventListener("pointercancel", endScrub);
  track.addEventListener("lostpointercapture", endScrub);
  track.addEventListener("pointerenter", onTrackEnter);
  track.addEventListener("pointerleave", onTrackLeave);
  bar.addEventListener("pointerenter", onBarEnter);
  bar.addEventListener("pointerleave", onBarLeave);

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    scrubbing = false;
    pendingSeek = null;
    overBar = false;
    tapRevealsOnly = false;
    shownElapsed = shownTotal = "";
    shownProgress = shownBuffered = -1;
    bar.classList.remove("is-scrubbing");
    track.classList.remove("is-hover");
    visible = false; // force setVisible to apply
    setVisible(true);
    render(video.currentTime || 0);
    syncPlay();
    syncMute();
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    window.addEventListener("keydown", onKeyDown);
    cancelAnimationFrame(raf);
    tick();
    poke();
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    scrubbing = false;
    pendingSeek = null;
    bar.classList.remove("is-scrubbing");
    window.clearTimeout(idleTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", poke);
    window.removeEventListener("pointerdown", poke);
    window.removeEventListener("keydown", onKeyDown);
    video.style.cursor = "";
    // Out of reach while the dock fades away.
    chrome.classList.add("is-idle");
    visible = false;
  };

  const destroy = () => {
    close();
    video.removeEventListener("play", onPlay);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("ended", onPause);
    video.removeEventListener("volumechange", syncMute);
    video.removeEventListener("pointerdown", onVideoDown);
    video.removeEventListener("click", onVideoClick);
    bar.remove();
  };

  return { bar, open, close, destroy };
}
