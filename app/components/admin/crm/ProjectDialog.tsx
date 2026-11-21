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
  CURRENCIES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  centsToInput,
  formatMoney,
  parseMoney,
  type Client,
  type Currency,
  type Project,
  type ProjectStatus,
} from "@/lib/crm-model";
import { NativeSelect } from "./fields";

const NEW_CLIENT = "__new__";

export type ProjectDraft =
  | { mode: "edit"; project: Project }
  | { mode: "new"; status: ProjectStatus; clientId?: string };

type Props = {
  draft: ProjectDraft | null;
  clients: Client[];
  defaultCurrency: Currency;
  // Where a card lands when it's created in, or moved to, a column.
  nextOrder: (status: ProjectStatus) => number;
  onClose: () => void;
  onSaved: (project: Project, client: Client | null) => void;
  onDeleted: (id: string) => void;
};

export default function ProjectDialog({ draft, onClose, ...rest }: Props) {
  const key = draft?.mode === "edit" ? draft.project.id : draft ? `new:${draft.status}` : "";
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed so the form starts fresh every time a card is opened. */}
        {draft && <ProjectForm key={key} draft={draft} onClose={onClose} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  draft,
  clients,
  defaultCurrency,
  nextOrder,
  onClose,
  onSaved,
  onDeleted,
}: Props & { draft: ProjectDraft }) {
  const existing = draft.mode === "edit" ? draft.project : null;
  const initialClient =
    existing?.clientId ??
    (draft.mode === "new" ? draft.clientId : undefined) ??
    (clients.length ? clients[0].id : NEW_CLIENT);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [clientId, setClientId] = useState(initialClient);
  const [newClientName, setNewClientName] = useState("");
  const [status, setStatus] = useState<ProjectStatus>(
    existing?.status ?? (draft.mode === "new" ? draft.status : "pending"),
  );
  const [price, setPrice] = useState(centsToInput(existing?.priceCents ?? 0));
  const [paid, setPaid] = useState(centsToInput(existing?.paidCents ?? 0));
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? defaultCurrency);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const priceCents = parseMoney(price);
  const paidCents = parseMoney(paid);
  const balance =
    priceCents !== null && paidCents !== null ? Math.max(0, priceCents - paidCents) : null;
  const creatingClient = clientId === NEW_CLIENT;
  const canSave =
    !!title.trim() &&
    (!creatingClient || !!newClientName.trim()) &&
    priceCents !== null &&
    paidCents !== null &&
    !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    const body = {
      title: title.trim(),
      ...(creatingClient ? { newClientName: newClientName.trim() } : { clientId }),
      status,
      priceCents,
      paidCents,
      currency,
      dueDate: dueDate || null,
      notes,
      // A card that changes column goes to the bottom of its new one.
      ...(!existing || existing.status !== status ? { order: nextOrder(status) } : {}),
    };
    try {
      const res = await fetch(
        existing ? `/api/admin/crm/projects/${existing.id}` : "/api/admin/crm/projects",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onSaved(data.project, data.client ?? null);
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
    const res = await fetch(`/api/admin/crm/projects/${existing.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      setError(`Delete failed (${res.status})`);
      setSaving(false);
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
        <DialogTitle>{existing ? "Edit project" : "New project"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="project-title">Project</Label>
          <Input
            id="project-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 3 reels for the spring launch"
            autoFocus={!existing}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="project-client">Client</Label>
            <NativeSelect
              id="project-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CLIENT}>+ New client…</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-status">Status</Label>
            <NativeSelect
              id="project-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {creatingClient && (
          <div className="grid gap-1.5">
            <Label htmlFor="project-new-client">New client name</Label>
            <Input
              id="project-new-client"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Brand or person"
            />
            <p className="text-xs text-muted-foreground">
              Contact details can be added later from the Clients view.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="project-price">Price</Label>
            <Input
              id="project-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              aria-invalid={priceCents === null}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="project-paid">Paid so far</Label>
              {!!priceCents && paidCents !== priceCents && (
                <button
                  type="button"
                  className="text-xs leading-none text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setPaid(price)}
                >
                  Paid in full
                </button>
              )}
            </div>
            <Input
              id="project-paid"
              inputMode="decimal"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder="0"
              aria-invalid={paidCents === null}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-currency">Currency</Label>
            <NativeSelect
              id="project-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="w-20"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Still owed</span>
          <span
            className={
              balance ? "font-medium text-amber-400 tabular-nums" : "text-muted-foreground"
            }
          >
            {balance === null ? "—" : formatMoney(balance, currency)}
          </span>
        </div>

        <div className="grid gap-1.5 sm:w-1/2">
          <Label htmlFor="project-due">Due date</Label>
          <Input
            id="project-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="project-notes">Notes</Label>
          <Textarea
            id="project-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Brief, deliverables, links…"
            className="min-h-20"
          />
        </div>

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
            disabled={saving}
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
            {saving ? "Saving…" : existing ? "Save" : "Add project"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
