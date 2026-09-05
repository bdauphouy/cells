"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SOCIAL_CATALOG, TOOL_CATALOG, socialHref, type SocialId, type ToolId } from "@/lib/hero-catalog";
import type { HeroSettings } from "@/lib/hero-settings";

export default function HeroSettingsCard() {
  const [settings, setSettings] = useState<HeroSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvError, setCvError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/hero");
      const { settings } = await res.json();
      setSettings(settings);
    })();
  }, []);

  if (!settings) return null;

  const toggleTool = (id: ToolId) => {
    setSaved(false);
    setSettings({
      ...settings,
      tools: settings.tools.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    });
  };

  const updateSocial = (id: SocialId, patch: Partial<HeroSettings["socials"][number]>) => {
    setSaved(false);
    setSettings({
      ...settings,
      socials: settings.socials.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  // The CV endpoint persists the pointer itself, so this only mirrors the
  // result into local state — the next "Save changes" then round-trips the
  // same value harmlessly rather than reverting it.
  const uploadCv = async (file: File) => {
    setCvBusy(true);
    setCvError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/cv", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCvError(data?.error ?? "Couldn't upload the CV.");
        return;
      }
      setSettings((prev) => (prev ? { ...prev, cv: data.cv } : prev));
    } finally {
      setCvBusy(false);
    }
  };

  const removeCv = async () => {
    setCvBusy(true);
    setCvError("");
    try {
      const res = await fetch("/api/admin/cv", { method: "DELETE" });
      if (!res.ok) {
        setCvError("Couldn't remove the CV.");
        return;
      }
      setSettings((prev) => (prev ? { ...prev, cv: null } : prev));
    } finally {
      setCvBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/hero", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const { settings: next } = await res.json();
        setSettings(next);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Hero overlay</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="hero-bio">About</Label>
          <Textarea
            id="hero-bio"
            value={settings.bio}
            onChange={(e) => {
              setSaved(false);
              setSettings({ ...settings, bio: e.target.value });
            }}
            placeholder="Short bio shown in the hero"
            className="min-h-20"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="hero-cv">CV</Label>
          <Input
            id="hero-cv"
            type="file"
            accept="application/pdf"
            disabled={cvBusy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset the input so re-picking the same file still fires change.
              e.target.value = "";
              if (file) uploadCv(file);
            }}
          />
          {cvBusy && <p className="text-xs text-muted-foreground">Working...</p>}
          {cvError && <p className="text-xs text-destructive">{cvError}</p>}
          {settings.cv ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <a
                href={settings.cv.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {settings.cv.filename}
              </a>
              <button
                type="button"
                onClick={removeCv}
                disabled={cvBusy}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Remove
              </button>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No CV uploaded — the download button stays hidden. PDF, up to 10MB.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label>Tools</Label>
          <div className="flex flex-wrap gap-3">
            {settings.tools.map((tool) => {
              const meta = TOOL_CATALOG[tool.id];
              return (
                <label
                  key={tool.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={() => toggleTool(tool.id)}
                    className="accent-foreground"
                  />
                  <Image src={meta.src} alt="" width={16} height={16} className="h-4 w-4" />
                  {meta.name}
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3">
          <Label>Social links</Label>
          {settings.socials.map((social) => {
            const meta = SOCIAL_CATALOG[social.id];
            const href = socialHref(social.id, social.handle);
            return (
              <div key={social.id} className="grid gap-2 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={social.enabled}
                    onChange={() => updateSocial(social.id, { enabled: !social.enabled })}
                    className="accent-foreground"
                  />
                  <Image src={meta.src} alt="" width={16} height={16} className="h-4 w-4" />
                  {meta.name}
                  <span className="text-xs font-normal text-muted-foreground">{meta.handleLabel}</span>
                </label>
                <Input
                  value={social.handle}
                  onChange={(e) => updateSocial(social.id, { handle: e.target.value })}
                  placeholder={meta.handlePlaceholder}
                />
                {/* The link is derived, so show what it resolves to rather
                    than asking the admin to keep a second field in sync. */}
                <p className="text-xs text-muted-foreground">
                  {href ? `Links to ${href}` : "No link — the tile stays hidden until this is filled in."}
                </p>
              </div>
            );
          })}
        </div>

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
