"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { SaveControl, SectionHeader } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  SOCIAL_CATALOG,
  TOOL_CATALOG,
  socialHref,
  type SocialId,
  type ToolId,
} from "@/lib/hero-catalog";
import type { HeroSettings } from "@/lib/hero-settings";
import { cn } from "@/lib/utils";

export default function HeroSettingsCard() {
  const [settings, setSettings] = useState<HeroSettings | null>(null);
  // What the server currently holds, to tell an untouched form from one
  // with edits waiting on "Save changes".
  const [persisted, setPersisted] = useState<HeroSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [cvBusy, setCvBusy] = useState(false);
  const [cvError, setCvError] = useState("");
  const cvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/hero");
      const { settings } = await res.json();
      setSettings(settings);
      setPersisted(settings);
    })();
  }, []);

  if (!settings || !persisted) {
    return (
      <>
        <SectionHeader title="Hero" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  const dirty = JSON.stringify(settings) !== JSON.stringify(persisted);

  const edit = (next: HeroSettings) => {
    setSaved(false);
    setSettings(next);
  };

  const toggleTool = (id: ToolId) =>
    edit({
      ...settings,
      tools: settings.tools.map((t) =>
        t.id === id ? { ...t, enabled: !t.enabled } : t,
      ),
    });

  const updateSocial = (
    id: SocialId,
    patch: Partial<HeroSettings["socials"][number]>,
  ) =>
    edit({
      ...settings,
      socials: settings.socials.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });

  // The CV endpoint persists the pointer itself, so the result goes into
  // both the draft and the persisted copy — it never shows as unsaved.
  const applyCv = (cv: HeroSettings["cv"]) => {
    setSettings((prev) => (prev ? { ...prev, cv } : prev));
    setPersisted((prev) => (prev ? { ...prev, cv } : prev));
  };

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
      applyCv(data.cv);
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
      applyCv(null);
    } finally {
      setCvBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/admin/hero", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        setError("Couldn't save the hero settings.");
        return;
      }
      const { settings: next } = await res.json();
      setSettings(next);
      setPersisted(next);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const enabledTools = settings.tools.filter((t) => t.enabled).length;

  return (
    <>
      <SectionHeader
        title="Hero"
        description="The overlay shown on top of the carousel: bio, CV download, tools and social links."
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
            <CardDescription>Short bio shown in the hero.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="hero-bio" className="sr-only">
              Bio
            </Label>
            <Textarea
              id="hero-bio"
              value={settings.bio}
              onChange={(e) => edit({ ...settings, bio: e.target.value })}
              placeholder="A few words about you"
              className="min-h-32"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CV</CardTitle>
            <CardDescription>
              PDF, up to 10MB. Saved as soon as it&apos;s uploaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              ref={cvInputRef}
              id="hero-cv"
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset the input so re-picking the same file still fires change.
                e.target.value = "";
                if (file) uploadCv(file);
              }}
            />
            {settings.cv ? (
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <FileText className="size-4 text-muted-foreground" />
                </div>
                <a
                  href={settings.cv.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
                >
                  {settings.cv.filename}
                </a>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove CV"
                  onClick={removeCv}
                  disabled={cvBusy}
                >
                  <Trash2 />
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                No CV uploaded — the download button stays hidden.
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => cvInputRef.current?.click()}
                disabled={cvBusy}
              >
                {cvBusy ? <Loader2 className="animate-spin" /> : <Upload />}
                {settings.cv ? "Replace" : "Upload PDF"}
              </Button>
              {cvError && (
                <span className="text-xs text-destructive">{cvError}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>
              {enabledTools} of {settings.tools.length} shown in the hero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {settings.tools.map((tool) => {
                const meta = TOOL_CATALOG[tool.id];
                return (
                  <button
                    key={tool.id}
                    type="button"
                    aria-pressed={tool.enabled}
                    onClick={() => toggleTool(tool.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      tool.enabled
                        ? "border-foreground/30 bg-muted text-foreground"
                        : "border-border text-muted-foreground opacity-60 hover:opacity-100",
                    )}
                  >
                    <Image
                      src={meta.src}
                      alt=""
                      width={16}
                      height={16}
                      className="h-4 w-4"
                    />
                    {meta.name}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Social links</CardTitle>
            <CardDescription>
              A link only shows once it&apos;s enabled and has a handle.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y divide-border border-t border-border">
              {settings.socials.map((social) => {
                const meta = SOCIAL_CATALOG[social.id];
                const href = socialHref(social.id, social.handle);
                const inputId = `social-${social.id}`;
                return (
                  <div
                    key={social.id}
                    className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]"
                  >
                    <label className="flex items-center gap-2.5 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={social.enabled}
                        onChange={() =>
                          updateSocial(social.id, { enabled: !social.enabled })
                        }
                        className="accent-foreground"
                      />
                      <Image
                        src={meta.src}
                        alt=""
                        width={16}
                        height={16}
                        className="h-4 w-4"
                      />
                      {meta.name}
                    </label>
                    <div className="grid gap-1">
                      <Label htmlFor={inputId} className="sr-only">
                        {meta.name} {meta.handleLabel}
                      </Label>
                      <Input
                        id={inputId}
                        value={social.handle}
                        onChange={(e) =>
                          updateSocial(social.id, { handle: e.target.value })
                        }
                        placeholder={meta.handlePlaceholder}
                      />
                      {/* The link is derived, so show what it resolves to
                          rather than asking for a second field to keep in sync. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {href
                          ? `Links to ${href}`
                          : `${meta.handleLabel} — hidden until filled in`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
