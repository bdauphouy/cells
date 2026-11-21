"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  STATUS_LABELS,
  balanceCents,
  formatMoney,
  type Client,
  type Project,
} from "@/lib/crm-model";
import { StatusPill } from "./fields";

export type ClientDraft = { mode: "edit"; client: Client } | { mode: "new" };

type Props = {
  draft: ClientDraft | null;
  projects: Project[];
  onClose: () => void;
  onSaved: (client: Client) => void;
  onDeleted: (id: string) => void;
  onOpenProject: (project: Project) => void;
  onNewProject: (clientId: string) => void;
};

export default function ClientDialog({ draft, onClose, ...rest }: Props) {
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {draft && (
          <ClientForm
            key={draft.mode === "edit" ? draft.client.id : "new"}
            draft={draft}
            onClose={onClose}
            {...rest}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const FIELDS = [
  { key: "name", label: "Name", placeholder: "Brand or person", type: "text" },
  { key: "email", label: "Email", placeholder: "name@example.com", type: "email" },
  { key: "phone", label: "Phone / WhatsApp", placeholder: "+33 6 12 34 56 78", type: "tel" },
  { key: "social", label: "Instagram / TikTok", placeholder: "@handle", type: "text" },
] as const;

function ClientForm({
  draft,
  projects,
  onClose,
  onSaved,
  onDeleted,
  onOpenProject,
  onNewProject,
}: Props & { draft: ClientDraft }) {
  const existing = draft.mode === "edit" ? draft.client : null;
  const [values, setValues] = useState({
    name: existing?.name ?? "",
    email: existing?.email ?? "",
    phone: existing?.phone ?? "",
    social: existing?.social ?? "",
    notes: existing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const theirProjects = existing ? projects.filter((p) => p.clientId === existing.id) : [];
  const canSave = !!values.name.trim() && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        existing ? `/api/admin/crm/clients/${existing.id}` : "/api/admin/crm/clients",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onSaved(data.client);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/admin/crm/clients/${existing.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Delete failed (${res.status})`);
      setSaving(false);
      setConfirmDelete(false);
      return;
    }
    onDeleted(existing.id);
    onClose();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? existing.name : "New client"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`client-${f.key}`}>{f.label}</Label>
              <Input
                id={`client-${f.key}`}
                type={f.type}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoFocus={!existing && f.key === "name"}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="client-notes">Notes</Label>
          <Textarea
            id="client-notes"
            value={values.notes}
            onChange={(e) => setValues({ ...values, notes: e.target.value })}
            placeholder="How you met, preferences, billing details…"
            className="min-h-16"
          />
        </div>

        {existing && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Projects</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onNewProject(existing.id)}
              >
                + Add project
              </Button>
            </div>
            {theirProjects.length ? (
              <ul className="grid max-h-48 gap-1 overflow-y-auto">
                {theirProjects.map((p) => {
                  const due = balanceCents(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onOpenProject(p)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted"
                      >
                        <span className="grid min-w-0">
                          <span className="truncate">{p.title}</span>
                          <StatusPill status={p.status} label={STATUS_LABELS[p.status]} />
                        </span>
                        <span
                          className={
                            due
                              ? "shrink-0 text-xs text-amber-400 tabular-nums"
                              : "shrink-0 text-xs text-muted-foreground tabular-nums"
                          }
                        >
                          {due
                            ? `${formatMoney(due, p.currency)} owed`
                            : p.priceCents
                              ? "Paid"
                              : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No projects yet.</p>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        {existing ? (
          <Button
            type="button"
            variant="destructive"
            onClick={remove}
            disabled={saving || theirProjects.length > 0}
            title={theirProjects.length ? "Delete or reassign their projects first" : undefined}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 />
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave}>
            {saving ? "Saving…" : existing ? "Save" : "Add client"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
