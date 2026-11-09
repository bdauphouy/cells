"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WATERMARK_LIMITS,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  watermarkRect,
  type WatermarkSettings,
} from "@/lib/watermark";

type Props = {
  settings: WatermarkSettings;
  onChange: (next: WatermarkSettings) => void;
};

// Two nominal frames, one per orientation a reel actually comes in. The
// placement maths is the same watermarkRect() the burn-in uses, so the
// preview is exact up to the logo's own pixels.
const PREVIEW_FRAMES = [
  { label: "9:16", width: 1080, height: 1920, className: "h-48" },
  { label: "16:9", width: 1920, height: 1080, className: "h-48" },
];

function Preview({
  settings,
  logoSize,
}: {
  settings: WatermarkSettings;
  logoSize: { width: number; height: number } | null;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      {PREVIEW_FRAMES.map((frame) => {
        const rect = logoSize ? watermarkRect(frame, logoSize, settings) : null;
        return (
          <figure key={frame.label} className="grid gap-1">
            <div
              className={`relative overflow-hidden rounded-md bg-linear-to-br from-zinc-700 via-zinc-800 to-zinc-950 ring-1 ring-foreground/10 ${frame.className}`}
              style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
            >
              {rect && settings.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.logo.url}
                  alt=""
                  className="absolute"
                  style={{
                    left: `${(rect.x / frame.width) * 100}%`,
                    top: `${(rect.y / frame.height) * 100}%`,
                    width: `${(rect.width / frame.width) * 100}%`,
                    opacity: settings.opacity,
                  }}
                />
              )}
            </div>
            <figcaption className="text-xs text-muted-foreground">{frame.label}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export default function WatermarkSettingsCard({ settings, onChange }: Props) {
  // Edited locally and only pushed up on save, so an unsaved tweak never
  // leaks into an upload started in the meantime.
  const [draft, setDraft] = useState(settings);
  const [logoSize, setLogoSize] = useState<{ width: number; height: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState("");

  const edit = (patch: Partial<WatermarkSettings>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  // The logo endpoint persists the pointer itself, so the result goes both
  // into the draft and straight up to the page.
  const applyLogo = (logo: WatermarkSettings["logo"]) => {
    setLogoSize(null);
    setDraft((d) => ({ ...d, logo }));
    onChange({ ...settings, logo });
  };

  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/watermark/logo", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't upload the logo.");
        return;
      }
      applyLogo(data.logo);
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/watermark/logo", { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't remove the logo.");
        return;
      }
      applyLogo(null);
    } finally {
      setLogoBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/admin/watermark", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setError("Couldn't save the watermark settings.");
        return;
      }
      const { settings: next } = await res.json();
      setDraft(next);
      onChange(next);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Watermark</CardTitle>
        <CardDescription>
          Burned into each video in the browser before it uploads. Changes apply to
          future uploads only — videos already in the library keep the watermark
          they were uploaded with.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
            className="accent-foreground"
          />
          Watermark new uploads by default
        </label>

        <div className="grid gap-2">
          <Label htmlFor="watermark-logo">Logo</Label>
          <Input
            id="watermark-logo"
            type="file"
            accept="image/png,image/webp"
            disabled={logoBusy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadLogo(file);
            }}
          />
          {logoBusy && <p className="text-xs text-muted-foreground">Working...</p>}
          {draft.logo ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <a
                href={draft.logo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {draft.logo.filename}
              </a>
              <button
                type="button"
                onClick={removeLogo}
                disabled={logoBusy}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Remove
              </button>
              {/* Hidden probe for the logo's natural size, which the
                  preview needs to place it the way the burn-in will. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={draft.logo.url}
                alt=""
                hidden
                onLoad={(e) =>
                  setLogoSize({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
              />
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No logo — uploads go through without a watermark. PNG or WebP with a
              transparent background, up to 2MB.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label>Position</Label>
          <div className="flex flex-wrap gap-2">
            {WATERMARK_POSITIONS.map((position) => (
              <Button
                key={position}
                type="button"
                size="sm"
                variant={draft.position === position ? "default" : "outline"}
                onClick={() => edit({ position })}
              >
                {WATERMARK_POSITION_LABELS[position]}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="watermark-scale">Size — {draft.scale}% of width</Label>
            <input
              id="watermark-scale"
              type="range"
              min={WATERMARK_LIMITS.scale.min}
              max={WATERMARK_LIMITS.scale.max}
              step={1}
              value={draft.scale}
              onChange={(e) => edit({ scale: Number(e.target.value) })}
              className="accent-foreground"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="watermark-opacity">
              Opacity — {Math.round(draft.opacity * 100)}%
            </Label>
            <input
              id="watermark-opacity"
              type="range"
              min={WATERMARK_LIMITS.opacity.min}
              max={WATERMARK_LIMITS.opacity.max}
              step={0.05}
              value={draft.opacity}
              onChange={(e) => edit({ opacity: Number(e.target.value) })}
              className="accent-foreground"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="watermark-margin">Margin — {draft.margin}%</Label>
            <input
              id="watermark-margin"
              type="range"
              min={WATERMARK_LIMITS.margin.min}
              max={WATERMARK_LIMITS.margin.max}
              step={0.5}
              value={draft.margin}
              onChange={(e) => edit({ margin: Number(e.target.value) })}
              className="accent-foreground"
            />
          </div>
        </div>

        {draft.logo && <Preview settings={draft} logoSize={logoSize} />}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
          {saved && <span className="text-xs text-muted-foreground">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
