"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
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
// Livepeer only reports a progress fraction once transcoding actually
// starts — while queued ("waiting") it reports none at all. The second leg
// of the bar creeps toward this ceiling as a placeholder until then, so it
// never sits still, but defers to the real figure the moment one arrives.
const UPLOAD_SHARE = 70;
const ENCODING_CEILING = 96;

type UploadState = "idle" | "uploading" | "processing" | "error";

export default function AdminPage() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);

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
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Second leg of the unified bar: while queued, Livepeer reports no
  // progress at all, so creep asymptotically toward the ceiling just to
  // show motion. The moment a real fraction arrives (transcoding started),
  // this stands down and the real figure drives the bar instead.
  const hasRealEncodingProgress = useRef(false);
  useEffect(() => {
    if (uploadState !== "processing") return;
    const id = setInterval(() => {
      if (hasRealEncodingProgress.current) return;
      setProgress((p) =>
        p >= ENCODING_CEILING ? p : p + (ENCODING_CEILING - p) * 0.08,
      );
    }, 400);
    return () => clearInterval(id);
  }, [uploadState]);

  const sortedLibrary = useMemo(
    () => [...library].sort((a, b) => b.createdAt - a.createdAt),
    [library],
  );
  const pageCount = Math.max(1, Math.ceil(sortedLibrary.length / PAGE_SIZE));
  // Derived rather than synced via effect: a delete can shrink pageCount
  // below whatever page the admin was on, so clamp at read time instead.
  const currentPage = Math.min(page, pageCount);
  const pageItems = sortedLibrary.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const assetIdRef = useRef<string | null>(null);

  const finishUpload = useCallback(() => {
    setUploadState("idle");
    setUploadError(null);
    setTitle("");
    setDescription("");
    setProgress(0);
    hasRealEncodingProgress.current = false;
  }, []);

  const retryUpload = useCallback(() => {
    setUploadState("idle");
    setUploadError(null);
    setProgress(0);
    hasRealEncodingProgress.current = false;
  }, []);

  const onUploadSuccess = useCallback(() => {
    setUploadState((s) => (s === "error" ? s : "processing"));
    setProgress((p) => Math.max(p, UPLOAD_SHARE));
    const assetId = assetIdRef.current;
    if (!assetId) return;
    if (pollRef.current) clearTimeout(pollRef.current);

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
            title: titleRef.current.trim(),
            description: descriptionRef.current.trim() || undefined,
            assetId: data.assetId,
            playbackId: data.playbackId,
            hlsUrl: data.hlsUrl,
            posterUrl: data.posterUrl,
            aspectRatio: data.aspectRatio,
          }),
        });
        if (!saveRes.ok) {
          setUploadState("error");
          setUploadError("Couldn't save the video to the library.");
          return;
        }
        const { video } = await saveRes.json();
        setProgress(100);
        setLibrary((prev) => [...prev, video]);
        setPage(1);
        finishUpload();
      } else if (data.status === "errored") {
        setUploadState("error");
        setUploadError("Livepeer couldn't process this video.");
      } else {
        if (typeof data.progress === "number") {
          hasRealEncodingProgress.current = true;
          const pct = Math.min(
            ENCODING_CEILING,
            UPLOAD_SHARE + data.progress * (100 - UPLOAD_SHARE),
          );
          setProgress((p) => Math.max(p, pct));
        }
        pollRef.current = setTimeout(poll, POLL_MS);
      }
    };
    pollRef.current = setTimeout(poll, POLL_MS);
  }, [finishUpload]);

  // The asset (and its upload endpoint) is minted only once a file is
  // actually chosen — creating it eagerly would burn an asset slot against
  // the account quota even for an upload that never happens.
  const startUpload = useCallback(
    async (file: File) => {
      setUploadState("uploading");
      setUploadError(null);
      setProgress(0);
      hasRealEncodingProgress.current = false;

      let tusEndpoint: string;
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
        assetIdRef.current = data.assetId;
      } catch (err) {
        setUploadState("error");
        setUploadError(
          err instanceof Error ? err.message : "Couldn't start the upload.",
        );
        return;
      }

      const upload = new tus.Upload(file, {
        endpoint: tusEndpoint,
        metadata: { filename: file.name, filetype: file.type },
        uploadSize: file.size,
        onError: (err) => {
          setUploadState("error");
          setUploadError(err.message || "Upload failed.");
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const pct = Math.round((bytesUploaded / bytesTotal) * UPLOAD_SHARE);
          setProgress((p) => Math.max(p, pct));
        },
        onSuccess: onUploadSuccess,
      });
      upload.start();
    },
    [onUploadSuccess],
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
    <main className="dark flex h-dvh flex-col overflow-hidden bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
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

        <Card className="mb-6 shrink-0">
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
                  disabled={uploadState !== "idle"}
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
                  disabled={uploadState !== "idle"}
                />
              </div>

              {uploadState === "idle" &&
                (title.trim() ? (
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
                      if (file) void startUpload(file);
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
                        if (file) void startUpload(file);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center text-xs text-muted-foreground">
                    Enter a title to enable upload
                  </div>
                ))}

              {(uploadState === "uploading" || uploadState === "processing") && (
                <div className="grid gap-2">
                  <p className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      {uploadState === "uploading" && `Uploading "${title}"…`}
                      {uploadState === "processing" && `Encoding "${title}"…`}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </p>
                  <Progress value={progress} />
                </div>
              )}

              {uploadState === "error" && (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>
                      {uploadError ?? "Something went wrong."}
                    </AlertDescription>
                  </Alert>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={retryUpload}
                    className="justify-self-start"
                  >
                    Try again
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="shrink-0">
            <CardTitle>Library</CardTitle>
            <CardDescription>
              Cards on the site fill from this library automatically — looped
              to reach {MIN_CARDS} cards, or one card per video once you have
              more than that.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto px-0">
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
            ) : sortedLibrary.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">
                No videos uploaded yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
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
                          <AlertDialogTitle>Delete this video?</AlertDialogTitle>
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
            <div className="shrink-0 border-t px-4 py-3">
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
