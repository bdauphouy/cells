"use client";

import { useEffect, useState } from "react";
import { SaveControl, SectionHeader } from "@/components/admin/AdminShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  ACCESS_LEVELS,
  ADMIN_SECTIONS,
  MIN_PASSWORD_LENGTH,
  SECTION_LABELS,
  VIEW_ONLY_SECTIONS,
  type AccessLevel,
  type Permissions,
} from "@/lib/admin-access";
import { cn } from "@/lib/utils";

type Member = { email: string; hasPassword: boolean; permissions: Permissions };

const LEVEL_LABELS: Record<AccessLevel, string> = {
  hidden: "Hidden",
  view: "View",
  edit: "Edit",
};

async function putAccess(body: object): Promise<Member> {
  const res = await fetch("/api/admin/access", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as Member;
}

// Owner-only: what the second account can see and change, and its password.
export default function AccessSection({ active }: { active: boolean }) {
  const [member, setMember] = useState<Member | null>(null);
  const [draft, setDraft] = useState<Permissions | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNote, setPasswordNote] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/admin/access")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<Member>;
      })
      .then((data) => {
        if (cancelled) return;
        setMember(data);
        setDraft(data.permissions);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [active]);

  const dirty =
    !!member &&
    !!draft &&
    ADMIN_SECTIONS.some((s) => draft[s] !== member.permissions[s]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const next = await putAccess({ permissions: draft });
      setMember(next);
      setDraft(next.permissions);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordBusy(true);
    setPasswordNote("");
    setError("");
    try {
      setMember(await putAccess({ password }));
      setPassword("");
      setPasswordNote("Password set. Any session signed in with the old one is now signed out.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirmRevoke) {
      setConfirmRevoke(true);
      return;
    }
    setPasswordBusy(true);
    setError("");
    try {
      setMember(await putAccess({ revoke: true }));
      setPasswordNote("Access revoked. Set a new password to give it back.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPasswordBusy(false);
      setConfirmRevoke(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="Access"
        description="Choose what the second account can open in this dashboard. Hidden sections disappear from its menu, View shows them without letting it change anything. Changes apply on its next page load."
        actions={<SaveControl dirty={dirty} saving={saving} saved={saved && !dirty} onSave={save} />}
      />

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Sections</CardTitle>
            <CardDescription>{member?.email ?? <Skeleton className="h-4 w-32" />}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="-mt-(--card-spacing) divide-y divide-border">
              {ADMIN_SECTIONS.map((section) => (
                <li key={section} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-sm font-medium">{SECTION_LABELS[section]}</span>
                  {draft ? (
                    <div
                      className="flex rounded-lg bg-muted p-0.5"
                      role="radiogroup"
                      aria-label={`Access to ${SECTION_LABELS[section]}`}
                    >
                      {ACCESS_LEVELS.filter(
                        (level) => level !== "edit" || !VIEW_ONLY_SECTIONS.has(section),
                      ).map((level) => {
                        const selected = draft[section] === level;
                        return (
                          <button
                            key={level}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => {
                              setDraft({ ...draft, [section]: level });
                              setSaved(false);
                            }}
                            className={cn(
                              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                              selected
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {LEVEL_LABELS[level]}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <Skeleton className="h-7 w-36 rounded-lg" />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              {!member
                ? "Loading…"
                : member.hasPassword
                  ? "This account can sign in. Setting a new password signs it out everywhere."
                  : "No password yet: this account can't sign in until you set one."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={setNewPassword} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="member-password">New password</Label>
                <Input
                  id="member-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                />
              </div>
              <Button type="submit" disabled={passwordBusy || password.length < MIN_PASSWORD_LENGTH}>
                {member?.hasPassword ? "Change password" : "Set password"}
              </Button>
              {member?.hasPassword && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={revoke}
                  onBlur={() => setConfirmRevoke(false)}
                  disabled={passwordBusy}
                >
                  {confirmRevoke ? "Click again to revoke" : "Revoke access"}
                </Button>
              )}
              {passwordNote && (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {passwordNote}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
