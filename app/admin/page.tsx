"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Loader2 } from "lucide-react";
import { MIN_CARDS } from "@/lib/constants";
import type { LibraryVideo } from "@/lib/library";
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
const PAGE_SIZE = 5;

type UploadJob = {
  id: string;
  title: string;
  description: string;
  file: File;
  state: "uploading" | "processing" | "error";
  // Only meaningful while uploading — Livepeer's encoding step shows an
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
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const [editingVideo, setEditingVideo] = useState<LibraryVideo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const libRes = await fetch("/api/admin/videos");
      const { library } = await libRes.json();
      setLibrary(library);
      setLoaded(true);
    })();
    return () => {
      pollRefs.current.forEach((t) => clearTimeout(t));
    };
  }, []);

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
    async (file: File, jobTitle: string, jobDescription: string) => {
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
          file,
          state: "uploading",
          progress: 0,
          inLibrary: false,
        },
      ]);

      let tusEndpoint: string;
      let assetId: string;
      try {
        const res = await fetch("/api/admin/livepeer-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name }),
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
      void startUpload(job.file, job.title, job.description);
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

  return (
    <main className="dark min-h-dvh bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto w-full max-w-3xl">
        <Image
          src="/logo.svg"
          alt="Logo"
          width={140}
          height={91}
          className="mb-8 h-10 w-auto"
          priority
        />
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Video library</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/" />}
            >
              View site
            </Button>
            <Button variant="outline" size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Upload a video</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <div>
                <Label htmlFor="title" className="sr-only">
                  Title
                </Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                />
              </div>
              <div>
                <Label htmlFor="description" className="sr-only">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="min-h-16"
                />
              </div>

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
                    if (file) {
                      void startUpload(file, title.trim(), description.trim());
                      setTitle("");
                      setDescription("");
                    }
                  }}
                  className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors ${
                    dragging
                      ? "border-primary bg-muted"
                      : "border-border bg-muted/50"
                  }`}
                >
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
                      if (file) {
                        void startUpload(
                          file,
                          title.trim(),
                          description.trim(),
                        );
                        setTitle("");
                        setDescription("");
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center text-xs text-muted-foreground">
                  Enter a title to enable upload
                </div>
              )}

              {/* Once a job's bytes reach Livepeer it moves down into the
                  Library list to encode in place — only jobs still being
                  sent (or that failed before ever reaching Livepeer) show
                  here. */}
              {jobs
                .filter((job) => !job.inLibrary)
                .map((job) => (
                  <div key={job.id} className="grid gap-2">
                    {job.state === "error" ? (
                      <>
                        <Alert variant="destructive">
                          <AlertDescription>
                            {job.error ?? "Something went wrong."} ({job.title})
                          </AlertDescription>
                        </Alert>
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
                        <p className="flex justify-between text-sm text-muted-foreground">
                          <span>{`Uploading "${job.title}"…`}</span>
                          <span>{Math.round(job.progress)}%</span>
                        </p>
                        <Progress value={job.progress} />
                      </>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Library</CardTitle>
            <CardDescription>
              Cards on the site fill from this library automatically — looped to
              reach {MIN_CARDS} cards, or one card per video once you have more
              than that.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {!loaded ? (
              <div className="grid gap-3 px-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-14 w-9 rounded-md" />
                    <div className="flex-1 grid gap-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sortedLibrary.length === 0 && pendingJobs.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">
                No videos uploaded yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
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
                      <div className="relative flex h-14 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-[10px] tabular-nums text-muted-foreground ring-1 ring-foreground/10">
                        {job.state === "error" ? (
                          "!"
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
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    {video.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.posterUrl}
                        alt={video.title}
                        className="h-14 w-9 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
                      />
                    ) : (
                      <div className="h-14 w-9 shrink-0 rounded-md bg-muted ring-1 ring-foreground/10" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{video.title}</p>
                      {video.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {video.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(video.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(video)}
                    >
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={<Button variant="ghost" size="sm" />}
                      >
                        Delete
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete this video?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            “{video.title}” will be removed from the library and
                            deleted from Livepeer. This can’t be undone.
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
            <div className="border-t px-4 py-3">
              <Pagination>
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

      <Dialog
        open={!!editingVideo}
        onOpenChange={(open) => !open && setEditingVideo(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit video</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="edit-title" className="sr-only">
                Title
              </Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
            </div>
            <div>
              <Label htmlFor="edit-description" className="sr-only">
                Description
              </Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
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
    </main>
  );
}
