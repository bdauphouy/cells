"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { SaveControl, SectionHeader } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  WATERMARK_LIMITS,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  watermarkRect,
  type WatermarkPosition,
  type WatermarkSettings,
} from "@/lib/watermark";
import { cn } from "@/lib/utils";

type Props = {
  settings: WatermarkSettings;
  onChange: (next: WatermarkSettings) => void;
};

// Two nominal frames, one per orientation a reel actually comes in. The
// placement maths is the same watermarkRect() the burn-in uses, so the
// preview is exact up to the logo's own pixels.
const PREVIEW_FRAMES = [
  { label: "9:16", width: 1080, height: 1920, className: "h-56" },
  { label: "16:9", width: 1920, height: 1080, className: "h-32" },
];

// Where each position sits on the 3×3 picker grid.
const POSITION_CELLS: Record<WatermarkPosition, string> = {
  "top-left": "col-start-1 row-start-1",
  "top-right": "col-start-3 row-start-1",
  center: "col-start-2 row-start-2",
  "bottom-left": "col-start-1 row-start-3",
  "bottom-right": "col-start-3 row-start-3",
};

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
            <figcaption className="text-xs text-muted-foreground">
              {frame.label}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-foreground"
      />
    </div>
  );
}

export default function WatermarkSettingsCard({ settings, onChange }: Props) {
  // Edited locally and only pushed up on save, so an unsaved tweak never
  // leaks into an upload started in the meantime.
  const [draft, setDraft] = useState(settings);
  const [logoSize, setLogoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);

  // `settings` is what's live; the logo is persisted on upload, so only the
  // fields behind "Save changes" can make these differ.
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

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
      const res = await fetch("/api/admin/watermark/logo", {
        method: "POST",
        body,
      });
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
      const res = await fetch("/api/admin/watermark/logo", {
        method: "DELETE",
      });
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
    <>
      <SectionHeader
        title="Watermark"
        description="Burned into each video in the browser before it uploads. Changes apply to future uploads only."
        actions={
          <SaveControl
            dirty={dirty}
            saving={saving}
            saved={saved}
            onSave={save}
          />
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>
                PNG or WebP with a transparent background, up to 2MB. Saved as
                soon as it&apos;s uploaded.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <input
                ref={logoInputRef}
                id="watermark-logo"
                type="file"
                accept="image/png,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadLogo(file);
                }}
              />
              {draft.logo ? (
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-zinc-800 p-1.5">
                    {/* Also probes the logo's natural size, which the
                        preview needs to place it the way the burn-in will. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={draft.logo.url}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                      onLoad={(e) =>
                        setLogoSize({
                          width: e.currentTarget.naturalWidth,
                          height: e.currentTarget.naturalHeight,
                        })
                      }
                    />
                  </div>
                  <a
                    href={draft.logo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
                  >
                    {draft.logo.filename}
                  </a>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove logo"
                    onClick={removeLogo}
                    disabled={logoBusy}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  No logo — uploads go through without a watermark.
                </p>
              )}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ImagePlus />
                  )}
                  {draft.logo ? "Replace" : "Upload logo"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Placement</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => edit({ enabled: e.target.checked })}
                  className="accent-foreground"
                />
                Watermark new uploads by default
              </label>

              <div className="grid gap-2">
                <Label id="watermark-position-label">Position</Label>
                <div className="flex items-center gap-4">
                  <div
                    role="radiogroup"
                    aria-labelledby="watermark-position-label"
                    className="grid aspect-video w-28 shrink-0 grid-cols-3 grid-rows-3 gap-1 rounded-md bg-muted p-1 ring-1 ring-foreground/10"
                  >
                    {WATERMARK_POSITIONS.map((position) => {
                      const active = draft.position === position;
                      return (
                        <button
                          key={position}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={WATERMARK_POSITION_LABELS[position]}
                          title={WATERMARK_POSITION_LABELS[position]}
                          onClick={() => edit({ position })}
                          className={cn(
                            "rounded-sm transition-colors",
                            POSITION_CELLS[position],
                            active
                              ? "bg-foreground"
                              : "bg-foreground/15 hover:bg-foreground/40",
                          )}
                        />
                      );
                    })}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {WATERMARK_POSITION_LABELS[draft.position]}
                  </span>
                </div>
              </div>

              <Slider
                id="watermark-scale"
                label="Size"
                display={`${draft.scale}% of width`}
                value={draft.scale}
                min={WATERMARK_LIMITS.scale.min}
                max={WATERMARK_LIMITS.scale.max}
                step={1}
                onChange={(scale) => edit({ scale })}
              />
              <Slider
                id="watermark-opacity"
                label="Opacity"
                display={`${Math.round(draft.opacity * 100)}%`}
                value={draft.opacity}
                min={WATERMARK_LIMITS.opacity.min}
                max={WATERMARK_LIMITS.opacity.max}
                step={0.05}
                onChange={(opacity) => edit({ opacity })}
              />
              <Slider
                id="watermark-margin"
                label="Margin"
                display={`${draft.margin}%`}
                value={draft.margin}
                min={WATERMARK_LIMITS.margin.min}
                max={WATERMARK_LIMITS.margin.max}
                step={0.5}
                onChange={(margin) => edit({ margin })}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-10">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              Reflects unsaved changes, on both frame orientations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {draft.logo ? (
              <Preview settings={draft} logoSize={logoSize} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Upload a logo to see a preview.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
