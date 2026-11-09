"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import {
  CircleAlert,
  Film,
  LayoutGrid,
  Loader2,
  Pencil,
  Stamp,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import AdminShell, {
  SectionHeader,
  StatCard,
  type AdminNavItem,
} from "@/components/admin/AdminShell";
import HeroSettingsCard from "@/components/admin/HeroSettingsCard";
import WatermarkSettingsCard from "@/components/admin/WatermarkSettingsCard";
import { MIN_CARDS } from "@/lib/constants";
import type { LibraryVideo } from "@/lib/library";
import { canBurnWatermark, type WatermarkSettings } from "@/lib/watermark";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const POLL_MS = 2000;
const noopSubscribe = () => () => {};
const PAGE_SIZE = 8;

const SECTION_IDS = ["library", "hero", "watermark"] as const;
type SectionId = (typeof SECTION_IDS)[number];
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash.slice(1);

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type UploadJob = {
  id: string;
  title: string;
  description: string;
  file: File;
  // Snapshot of the settings at the moment the upload started, so a retry
  // burns the same mark even if the settings changed since. null = no mark.
  watermark: WatermarkSettings | null;
  state: "watermarking" | "uploading" | "processing" | "error";
  // Meaningful while watermarking and uploading — Livepeer's encoding step shows an
  // indeterminate loader instead, since it reports no progress at all while
  // queued and an unreliable one once transcoding starts.
  progress: number;
  error?: string;
  // Flips true once the bytes have actually reached Livepeer. Before that
  // the job is still being composed/sent and shows in the upload card;
  // after, it's treated as "in the library" (encoding in place) even if it
  // later errors, so errors during encoding surface there instead of
  // jumping back to the upload card.
  inLibrary: boolean;
  // Set once the asset exists on Livepeer's side (right after upload
  // starts), so a cancel mid-encode has something to delete.
  assetId?: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Each upload is tracked independently so starting a new one never has to
  // wait on a previous file's encode — uploading and encoding both run in
  // the background behind this list rather than gating the compose form.
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const [watermark, setWatermark] = useState<WatermarkSettings | null>(null);
  // null = follow the saved default; set once the admin toggles the box for
  // the upload being composed, and reset after it's submitted.
  const [watermarkOverride, setWatermarkOverride] = useState<boolean | null>(
    null,
  );
  // WebCodecs only exists in the browser: the server snapshot assumes
  // support so SSR and hydration agree, then the client reads the real value.
  const watermarkSupported = useSyncExternalStore(
    noopSubscribe,
    canBurnWatermark,
    () => true,
  );
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  const [editingVideo, setEditingVideo] = useState<LibraryVideo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/watermark");
      if (res.ok) setWatermark((await res.json()).settings);
    })();
    (async () => {
      const libRes = await fetch("/api/admin/videos");
      const { library } = await libRes.json();
      setLibrary(library);
      setLoaded(true);
    })();
    const polls = pollRefs.current;
    const aborts = abortRefs.current;
    return () => {
      polls.forEach((t) => clearTimeout(t));
      aborts.forEach((c) => c.abort());
    };
  }, []);

  const watermarkAvailable = watermarkSupported && !!watermark?.logo;
  const applyWatermark =
    watermarkAvailable && (watermarkOverride ?? !!watermark?.enabled);

  const sortedLibrary = useMemo(
    () => [...library].sort((a, b) => b.createdAt - a.createdAt),
    [library],
  );
  // Newest-started first, matching sortedLibrary's ordering, so a job
  // slots in above the real entries the same way a fresh upload would.
  const pendingJobs = useMemo(
    () => [...jobs].reverse().filter((j) => j.inLibrary),
    [jobs],
  );
  const pageCount = Math.max(1, Math.ceil(sortedLibrary.length / PAGE_SIZE));
  // Derived rather than synced via effect: a delete can shrink pageCount
  // below whatever page the admin was on, so clamp at read time instead.
  const currentPage = Math.min(page, pageCount);
  const pageItems = sortedLibrary.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const updateJob = useCallback(
    (
      id: string,
      patch: Partial<UploadJob> | ((j: UploadJob) => Partial<UploadJob>),
    ) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? { ...j, ...(typeof patch === "function" ? patch(j) : patch) }
            : j,
        ),
      );
    },
    [],
  );

  const removeJob = useCallback((id: string) => {
    const t = pollRefs.current.get(id);
    if (t) clearTimeout(t);
    pollRefs.current.delete(id);
    abortRefs.current.get(id)?.abort();
    abortRefs.current.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const onUploadSuccess = useCallback(
    (id: string, jobTitle: string, jobDescription: string, assetId: string) => {
      // The upload bar finished at 100%; the encode bar starts over at 0
      // rather than continuing that scale, since they're separate steps.
      updateJob(id, (j) =>
        j.state === "error"
          ? {}
          : { state: "processing", progress: 0, inLibrary: true },
      );

      const poll = async () => {
        const res = await fetch(
          `/api/admin/livepeer-upload/status?assetId=${assetId}`,
        );
        const data = await res.json();

        if (data.status === "ready") {
          const saveRes = await fetch("/api/admin/videos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: jobTitle,
              description: jobDescription || undefined,
              assetId: data.assetId,
              playbackId: data.playbackId,
              hlsUrl: data.hlsUrl,
              posterUrl: data.posterUrl,
              aspectRatio: data.aspectRatio,
            }),
          });
          if (!saveRes.ok) {
            updateJob(id, {
              state: "error",
              error: "Couldn't save the video to the library.",
            });
            return;
          }
          const { video } = await saveRes.json();
          setLibrary((prev) => [...prev, video]);
          setPage(1);
          removeJob(id);
        } else if (data.status === "errored") {
          updateJob(id, {
            state: "error",
            error: "Livepeer couldn't process this video.",
          });
        } else {
          pollRefs.current.set(id, setTimeout(poll, POLL_MS));
        }
      };
      pollRefs.current.set(id, setTimeout(poll, POLL_MS));
    },
    [updateJob, removeJob],
  );

  // The asset (and its upload endpoint) is minted only once a file is
  // actually chosen — creating it eagerly would burn an asset slot against
  // the account quota even for an upload that never happens. Each call adds
  // its own job and returns immediately, so the compose form is free the
  // moment this fires — a new upload can start while this one is still
  // uploading or encoding in the background.
  const startUpload = useCallback(
    async (
      original: File,
      jobTitle: string,
      jobDescription: string,
      jobWatermark: WatermarkSettings | null,
    ) => {
      const id =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      setJobs((prev) => [
        ...prev,
        {
          id,
          title: jobTitle,
          description: jobDescription,
          file: original,
          watermark: jobWatermark,
          state: jobWatermark ? "watermarking" : "uploading",
          progress: 0,
          inLibrary: false,
        },
      ]);

      // The mark is burned in before the Livepeer asset is minted, so a long
      // re-encode (or a cancel during it) never holds an asset slot.
      let file = original;
      if (jobWatermark?.logo) {
        const controller = new AbortController();
        abortRefs.current.set(id, controller);
        try {
          // Loaded on demand: the encoder library is only needed here.
          const { burnWatermark, loadWatermarkLogo } = await import(
            "@/lib/burn-watermark"
          );
          const logo = await loadWatermarkLogo(jobWatermark.logo.url);
          try {
            file = await burnWatermark(original, jobWatermark, logo, {
              signal: controller.signal,
              onProgress: (fraction) => {
                const pct = Math.round(fraction * 100);
                updateJob(id, (j) => ({ progress: Math.max(j.progress, pct) }));
              },
            });
          } finally {
            logo.close();
          }
        } catch (err) {
          // Cancelled: the job is already gone from the list.
          if (controller.signal.aborted) return;
          console.error("Watermarking failed", err);
          updateJob(id, {
            state: "error",
            error:
              err instanceof Error
                ? err.message
                : "Couldn't add the watermark.",
          });
          return;
        } finally {
          abortRefs.current.delete(id);
        }
        updateJob(id, { state: "uploading", progress: 0 });
      }

      let tusEndpoint: string;
      let assetId: string;
      try {
        const res = await fetch("/api/admin/livepeer-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: original.name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Couldn't start the upload.");
        }
        const data = await res.json();
        tusEndpoint = data.tusEndpoint;
        assetId = data.assetId;
        updateJob(id, { assetId });
      } catch (err) {
        updateJob(id, {
          state: "error",
          error:
            err instanceof Error ? err.message : "Couldn't start the upload.",
        });
        return;
      }

      const upload = new tus.Upload(file, {
        endpoint: tusEndpoint,
        metadata: { filename: file.name, filetype: file.type },
        uploadSize: file.size,
        onError: (err) => {
          updateJob(id, {
            state: "error",
            error: err.message || "Upload failed.",
          });
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const pct = Math.round((bytesUploaded / bytesTotal) * 100);
          updateJob(id, (j) => ({ progress: Math.max(j.progress, pct) }));
        },
        onSuccess: () => onUploadSuccess(id, jobTitle, jobDescription, assetId),
      });
      upload.start();
    },
    [onUploadSuccess, updateJob],
  );

  const retryJob = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id);
      if (!job) return;
      removeJob(id);
      void startUpload(job.file, job.title, job.description, job.watermark);
    },
    [removeJob, startUpload],
  );

  // Stops polling and drops the job locally right away — the encode running
  // on Livepeer's side isn't worth waiting on a response for — then best-
  // effort deletes the asset so it doesn't sit around against the quota.
  const cancelJob = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id);
      removeJob(id);
      if (job?.assetId) {
        void fetch(`/api/admin/livepeer-upload?assetId=${job.assetId}`, {
          method: "DELETE",
        }).catch(() => {});
      }
    },
    [removeJob],
  );

  // The two ways a file arrives — dropped on the zone or picked through the
  // hidden input — do the same thing with it, including clearing the fields
  // the job just took its title and description from.
  const submitFile = (file: File) => {
    void startUpload(
      file,
      title.trim(),
      description.trim(),
      applyWatermark ? watermark : null,
    );
    setTitle("");
    setDescription("");
    setWatermarkOverride(null);
  };

  const deleteVideo = async (id: string) => {
    await fetch(`/api/admin/videos/${id}`, { method: "DELETE" });
    setLibrary((prev) => prev.filter((v) => v.id !== id));
  };

  const openEdit = (video: LibraryVideo) => {
    setEditingVideo(video);
    setEditTitle(video.title);
    setEditDescription(video.description ?? "");
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingVideo || !editTitle.trim()) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/videos/${editingVideo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
        }),
      });
      if (!res.ok) {
        setEditError("Couldn't save changes.");
        return;
      }
      const { video } = await res.json();
      setLibrary((prev) => prev.map((v) => (v.id === video.id ? video : v)));
      setEditingVideo(null);
    } finally {
      setEditSaving(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const section: SectionId = SECTION_IDS.includes(hash as SectionId)
    ? (hash as SectionId)
    : "library";

  const activeJobs = jobs.filter((j) => j.state !== "error").length;
  const nav: AdminNavItem<SectionId>[] = [
    { id: "library", label: "Library", icon: Film, badge: activeJobs },
    { id: "hero", label: "Hero", icon: UserRound },
    { id: "watermark", label: "Watermark", icon: Stamp },
  ];

  const siteCards =
    library.length === 0 ? 0 : Math.max(MIN_CARDS, library.length);
  const watermarkStatus = !watermark
    ? "—"
    : !watermark.logo
      ? "No logo"
      : watermark.enabled
        ? "On"
        : "Off";

  return (
    <AdminShell nav={nav} active={section} onLogout={logout}>
      {/* Every section stays mounted and is only hidden, so uploads keep
          running and unsaved drafts survive switching between them. */}
      <section hidden={section !== "library"}>
        <SectionHeader
          title="Library"
          description={`Cards on the site fill from this library automatically — looped to reach ${MIN_CARDS} cards, or one card per video once you have more than that.`}
        />

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Videos"
            icon={Film}
            value={loaded ? library.length : <Skeleton className="h-8 w-10" />}
          />
          <StatCard
            label="In progress"
            icon={Loader2}
            value={activeJobs}
            hint={activeJobs ? "Keep this tab open" : "Nothing uploading"}
          />
          <StatCard
            label="Cards on site"
            icon={LayoutGrid}
            value={loaded ? siteCards : <Skeleton className="h-8 w-10" />}
          />
          <StatCard
            label="Watermark"
            icon={Stamp}
            value={watermarkStatus}
            hint={
              <a
                href="#watermark"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                Settings
              </a>
            }
          />
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="lg:sticky lg:top-10 lg:order-2">
            <CardHeader>
              <CardTitle>Upload a video</CardTitle>
              <CardDescription>
                Uploads run in the background — start as many as you like.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Required"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional"
                    className="min-h-16"
                  />
                </div>

                <label
                  className={`flex items-start gap-2 text-sm ${
                    watermarkAvailable ? "" : "text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={applyWatermark}
                    disabled={!watermarkAvailable}
                    onChange={(e) => setWatermarkOverride(e.target.checked)}
                    className="mt-0.5 accent-foreground"
                  />
                  <span className="grid gap-0.5">
                    Add watermark
                    {!watermarkSupported ? (
                      <span className="text-xs text-muted-foreground">
                        Not supported in this browser
                      </span>
                    ) : (
                      !watermark?.logo && (
                        <span className="text-xs text-muted-foreground">
                          Upload a logo in{" "}
                          <a
                            href="#watermark"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            Watermark
                          </a>{" "}
                          first
                        </span>
                      )
                    )}
                  </span>
                </label>

                {/* Uploads and encodes run in the background per job, so this
                    stays available the whole time — starting one never waits
                    on another. */}
                {title.trim() ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      const file = e.dataTransfer.files[0];
                      if (file) submitFile(file);
                    }}
                    className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors ${
                      dragging
                        ? "border-primary bg-muted"
                        : "border-border bg-muted/50"
                    }`}
                  >
                    <Upload className="size-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Drag a video file here, or
                    </span>
                    <Button
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose a file
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Reset so re-picking the same file still fires change.
                        e.target.value = "";
                        if (file) submitFile(file);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 p-4 text-center text-xs text-muted-foreground">
                    <Upload className="size-5" />
                    Enter a title to enable upload
                  </div>
                )}

                {/* Once a job's bytes reach Livepeer it moves over into the
                    Library list to encode in place — only jobs still being
                    sent (or that failed before ever reaching Livepeer) show
                    here. */}
                {jobs
                  .filter((job) => !job.inLibrary)
                  .map((job) => (
                    <div
                      key={job.id}
                      className="grid gap-2 rounded-lg border border-border p-3"
                    >
                      {job.state === "error" ? (
                        <>
                          <p className="flex items-start gap-2 text-sm text-destructive">
                            <CircleAlert className="mt-0.5 size-4 shrink-0" />
                            <span className="min-w-0">
                              {job.error ?? "Something went wrong."}{" "}
                              <span className="text-muted-foreground">
                                ({job.title})
                              </span>
                            </span>
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryJob(job.id)}
                            >
                              Try again
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeJob(job.id)}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="flex justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">
                              {job.title}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {Math.round(job.progress)}%
                            </span>
                          </p>
                          <Progress value={job.progress} />
                          <p className="flex justify-between gap-2 text-xs text-muted-foreground">
                            {job.state === "watermarking"
                              ? "Adding watermark…"
                              : "Uploading…"}
                            {job.state === "watermarking" && (
                              <button
                                type="button"
                                onClick={() => removeJob(job.id)}
                                className="underline underline-offset-2 hover:text-foreground"
                              >
                                Cancel
                              </button>
                            )}
                          </p>
                          {job.state === "watermarking" && (
                            <p className="text-xs text-muted-foreground">
                              Keep this tab open — the watermark is added on
                              this device before the upload starts.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:order-1">
            <CardHeader className="border-b">
              <CardTitle>Videos</CardTitle>
              <CardDescription>Newest first.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {!loaded ? (
                <div className="grid gap-3 px-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-14 w-9 rounded-md" />
                      <div className="grid flex-1 gap-1.5">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : sortedLibrary.length === 0 && pendingJobs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                  <Film className="size-6" />
                  No videos uploaded yet.
                </div>
              ) : (
                <div className="-mt-(--card-spacing) divide-y divide-border">
                  {/* Uploaded jobs land here the moment their bytes reach
                      Livepeer, encoding in place, only on the newest page —
                      they behave like a video that hasn't finished
                      processing yet, not a separate queue. */}
                  {currentPage === 1 &&
                    pendingJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="relative flex h-14 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/10">
                          {job.state === "error" ? (
                            <CircleAlert className="size-4 text-destructive" />
                          ) : (
                            <div className="loading-stripes absolute inset-0" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{job.title}</p>
                          {job.state === "error" ? (
                            <p className="truncate text-xs text-destructive">
                              {job.error ?? "Something went wrong."}
                            </p>
                          ) : (
                            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                              <Loader2 className="size-3 shrink-0 animate-spin" />
                              Encoding…
                            </p>
                          )}
                        </div>
                        {job.state === "error" ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryJob(job.id)}
                            >
                              Try again
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeJob(job.id)}
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelJob(job.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    ))}
                  {pageItems.map((video) => (
                    <div
                      key={video.id}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                    >
                      {video.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={video.posterUrl}
                          alt=""
                          className="h-14 w-9 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
                        />
                      ) : (
                        <div className="h-14 w-9 shrink-0 rounded-md bg-muted ring-1 ring-foreground/10" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {video.title}
                        </p>
                        {video.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {video.description}
                          </p>
                        )}
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{dateFormat.format(video.createdAt)}</span>
                          <span className="rounded bg-muted px-1 text-[0.65rem] tabular-nums">
                            {video.aspectRatio}
                          </span>
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit “${video.title}”`}
                        onClick={() => openEdit(video)}
                      >
                        <Pencil />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete “${video.title}”`}
                              className="hover:text-destructive"
                            />
                          }
                        >
                          <Trash2 />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete this video?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              “{video.title}” will be removed from the library
                              and deleted from Livepeer. This can’t be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => deleteVideo(video.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, sortedLibrary.length)} of{" "}
                  {sortedLibrary.length}
                </span>
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          setPage((p) => Math.max(1, p - 1));
                        }}
                        aria-disabled={currentPage === 1}
                        className={
                          currentPage === 1
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                      />
                    </PaginationItem>
                    {Array.from({ length: pageCount }).map((_, i) => (
                      <PaginationItem key={i}>
                        <PaginationLink
                          size="icon-sm"
                          isActive={currentPage === i + 1}
                          onClick={(e) => {
                            e.preventDefault();
                            setPage(i + 1);
                          }}
                        >
                          {i + 1}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          setPage((p) => Math.min(pageCount, p + 1));
                        }}
                        aria-disabled={currentPage === pageCount}
                        className={
                          currentPage === pageCount
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </Card>
        </div>
      </section>

      <section hidden={section !== "hero"}>
        <HeroSettingsCard />
      </section>

      <section hidden={section !== "watermark"}>
        {watermark ? (
          <WatermarkSettingsCard settings={watermark} onChange={setWatermark} />
        ) : (
          <>
            <SectionHeader title="Watermark" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </>
        )}
      </section>

      <Dialog
        open={!!editingVideo}
        onOpenChange={(open) => !open && setEditingVideo(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit video</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Required"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional"
                className="min-h-16"
              />
            </div>
            {editError && (
              <Alert variant="destructive">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingVideo(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={!editTitle.trim() || editSaving}
            >
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
