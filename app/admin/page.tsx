"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MuxUploader from "@mux/mux-uploader-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
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

const POLL_MS = 2000;

type PendingUpload = { uploadUrl: string; uploadId: string };
type UploadState = "idle" | "uploading" | "processing" | "error";

export default function AdminPage() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryVideo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [title, setTitle] = useState("");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

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

  const startUpload = async () => {
    if (!title.trim()) return;
    const res = await fetch("/api/admin/mux-upload", { method: "POST" });
    const { uploadUrl, uploadId } = await res.json();
    setPending({ uploadUrl, uploadId });
    setUploadState("uploading");
    setUploadError(null);
  };

  const resetUpload = () => {
    setPending(null);
    setUploadState("idle");
    setUploadError(null);
    setTitle("");
  };

  const onUploadSuccess = useCallback(() => {
    setUploadState((s) => (s === "error" ? s : "processing"));
    setPending((current) => {
      if (!current) return current;
      const uploadId = current.uploadId;
      if (pollRef.current) clearTimeout(pollRef.current);

      const poll = async () => {
        const res = await fetch(
          `/api/admin/mux-upload/status?uploadId=${uploadId}`,
        );
        const data = await res.json();

        if (data.status === "ready") {
          const saveRes = await fetch("/api/admin/videos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: titleRef.current.trim(),
              assetId: data.assetId,
              playbackId: data.playbackId,
              aspectRatio: data.aspectRatio,
            }),
          });
          if (!saveRes.ok) {
            setUploadState("error");
            setUploadError("Couldn't save the video to the library.");
            return;
          }
          const { video } = await saveRes.json();
          setLibrary((prev) => [...prev, video]);
          resetUpload();
        } else if (data.status === "errored") {
          setUploadState("error");
          setUploadError("Mux couldn't process this video.");
        } else {
          pollRef.current = setTimeout(poll, POLL_MS);
        }
      };
      pollRef.current = setTimeout(poll, POLL_MS);
      return current;
    });
  }, []);

  const deleteVideo = async (id: string) => {
    await fetch(`/api/admin/videos/${id}`, { method: "DELETE" });
    setLibrary((prev) => prev.filter((v) => v.id !== id));
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  return (
    <main className="dark min-h-screen bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto max-w-3xl">
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
            {!pending ? (
              <div className="flex gap-3">
                <div className="flex-1">
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
                <Button onClick={startUpload} disabled={!title.trim()}>
                  Start upload
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {uploadState === "uploading" && `Uploading "${title}"…`}
                  {uploadState === "processing" && `Encoding "${title}"…`}
                  {uploadState === "error" &&
                    (uploadError ?? "Something went wrong.")}
                </p>
                {uploadState === "uploading" && (
                  <MuxUploader
                    endpoint={pending.uploadUrl}
                    onSuccess={onUploadSuccess}
                    onUploadError={() => {
                      setUploadState("error");
                      setUploadError("Upload failed.");
                    }}
                    className="mux-uploader-shell"
                  >
                    <Button type="button" size="sm" slot="file-select">
                      Choose a file
                    </Button>
                  </MuxUploader>
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
                      onClick={resetUpload}
                      className="justify-self-start"
                    >
                      Try again
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Library</CardTitle>
            <CardDescription>
              Cards on the site fill from this library automatically — looped
              to reach {MIN_CARDS} cards, or one card per video once you have
              more than that.
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
            ) : library.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">
                No videos uploaded yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {library.map((video) => (
                  <div
                    key={video.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://image.mux.com/${video.playbackId}/thumbnail.jpg?width=100`}
                      alt={video.title}
                      className="h-14 w-9 rounded-md object-cover ring-1 ring-foreground/10"
                    />
                    <div className="flex-1">
                      <p className="text-sm">{video.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(video.createdAt).toLocaleString()}
                      </p>
                    </div>
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
                            and deleted from Mux. This can’t be undone.
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
        </Card>
      </div>
    </main>
  );
}
