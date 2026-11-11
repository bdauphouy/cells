"use client";

import { useEffect } from "react";

// Module-level so React's dev double-invoked effects still send one beacon.
let sent = false;

// Counting from the browser rather than in the page's server render means
// link-preview crawlers and anything that doesn't run JS never get counted.
export default function VisitTracker() {
  useEffect(() => {
    if (sent) return;
    sent = true;
    const body = JSON.stringify({ referrer: document.referrer });
    if (!navigator.sendBeacon?.("/api/track", body)) {
      fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  }, []);
  return null;
}
