"use client";

import { Fragment, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  CalendarDays,
  HandCoins,
  Plus,
  RefreshCw,
  Search,
  SquareKanban,
  Users,
  Wallet,
} from "lucide-react";
import { SectionHeader, StatCard } from "@/components/admin/AdminShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_CURRENCY,
  PROJECT_STATUSES,
  STATUS_LABELS,
  balanceCents,
  formatMoney,
  sumByCurrency,
  type Client,
  type Project,
  type ProjectStatus,
} from "@/lib/crm-model";
import { cn } from "@/lib/utils";
import ClientDialog, { type ClientDraft } from "./ClientDialog";
import ProjectDialog, { type ProjectDraft } from "./ProjectDialog";
import { STATUS_DOT, StatusPill, formatDue, todayIso } from "./fields";

type View = "board" | "clients";
// The Done column only grows, so it shows the latest few unless asked.
const DONE_PREVIEW = 8;

// readOnly: the board and the dialogs still open, but nothing can be added,
// moved or saved (the proxy refuses those writes anyway).
export default function CrmSection({
  active,
  readOnly = false,
}: {
  active: boolean;
  readOnly?: boolean;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [showAllDone, setShowAllDone] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: ProjectStatus; index: number } | null>(
    null,
  );

  // Refetched whenever the section is opened, like Analytics, so the board
  // reflects edits made from another device in the meantime.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/admin/crm")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<{ clients: Client[]; projects: Project[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setClients(data.clients);
        setProjects(data.projects);
        setLoaded(true);
        setError("");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [active, reloadKey]);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const clientName = (id: string) => clientById.get(id)?.name ?? "Unknown client";

  const q = query.trim().toLowerCase();
  const visible = q
    ? projects.filter(
        (p) => p.title.toLowerCase().includes(q) || clientName(p.clientId).toLowerCase().includes(q),
      )
    : projects;
  const columns = PROJECT_STATUSES.map((status) => ({
    status,
    cards: visible.filter((p) => p.status === status).sort((a, b) => a.order - b.order),
  }));

  // New projects default to whatever currency was used last.
  const defaultCurrency =
    [...projects].sort((a, b) => b.createdAt - a.createdAt)[0]?.currency ?? DEFAULT_CURRENCY;
  const nextOrder = (status: ProjectStatus) =>
    Math.max(0, ...projects.filter((p) => p.status === status).map((p) => p.order)) + 1;

  const upsertClient = (client: Client) =>
    setClients((list) =>
      [...list.filter((c) => c.id !== client.id), client].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  const upsertProject = (project: Project) =>
    setProjects((list) => [...list.filter((p) => p.id !== project.id), project]);

  // Optimistic: the card moves immediately and snaps back if the save fails.
  const moveProject = async (id: string, status: ProjectStatus, order: number) => {
    const before = projects;
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, status, order } : p)));
    try {
      const res = await fetch(`/api/admin/crm/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, order }),
      });
      if (!res.ok) throw new Error(`Couldn't move the card (${res.status})`);
      upsertProject((await res.json()).project);
    } catch (e) {
      setProjects(before);
      setError((e as Error).message);
    }
  };

  // ---- Drag and drop (native HTML5; on touch screens the card's dialog has
  // a status picker instead) ----

  const dropIndexAt = (e: DragEvent<HTMLElement>) => {
    const cards = e.currentTarget.querySelectorAll<HTMLElement>("[data-card-id]");
    let index = 0;
    for (const card of cards) {
      if (card.dataset.cardId === dragId) continue;
      const rect = card.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) index++;
    }
    return index;
  };

  const onColumnDragOver = (e: DragEvent<HTMLElement>, status: ProjectStatus) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = dropIndexAt(e);
    if (dropTarget?.status !== status || dropTarget.index !== index) {
      setDropTarget({ status, index });
    }
  };

  const onColumnDrop = (e: DragEvent<HTMLElement>, status: ProjectStatus, cards: Project[]) => {
    e.preventDefault();
    const id = dragId;
    const index = dropIndexAt(e);
    setDragId(null);
    setDropTarget(null);
    if (!id) return;

    const others = cards.filter((p) => p.id !== id);
    const prev = others[index - 1];
    const next = others[index];
    const order =
      prev && next
        ? (prev.order + next.order) / 2
        : prev
          ? prev.order + 1
          : next
            ? next.order - 1
            : nextOrder(status);

    // Dropping a card back where it was is a no-op, not a save.
    const current = projects.find((p) => p.id === id);
    const unchanged = current?.status === status && cards.findIndex((p) => p.id === id) === index;
    if (current && !unchanged) moveProject(id, status, order);
  };

  // ---- Totals ----

  const open = projects.filter((p) => p.status !== "done");
  const owing = projects.filter((p) => balanceCents(p) > 0);
  const awaiting = projects.filter((p) => p.status === "awaiting_payment");

  const viewToggle = (
    <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="View">
      {(["board", "clients"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setView(v)}
          aria-pressed={v === view}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            v === view
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "board" ? "Board" : "Clients"}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <SectionHeader
        title="Clients"
        description="Your projects as a board, from first contact to paid and delivered. Drag a card to another column, or open it to change its status, amounts and notes."
        actions={
          <>
            {viewToggle}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw />
            </Button>
            {readOnly ? null : view === "board" ? (
              <Button onClick={() => setProjectDraft({ mode: "new", status: "pending" })}>
                <Plus />
                New project
              </Button>
            ) : (
              <Button onClick={() => setClientDraft({ mode: "new" })}>
                <Plus />
                New client
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Still owed"
          icon={Wallet}
          value={
            loaded ? (
              <span className="text-xl">
                {sumByCurrency(owing, (p) => ({ cents: balanceCents(p), currency: p.currency }))}
              </span>
            ) : (
              <Skeleton className="h-8 w-20" />
            )
          }
          hint={loaded ? `Across ${owing.length} project${owing.length === 1 ? "" : "s"}` : null}
        />
        <StatCard
          label="Awaiting payment"
          icon={HandCoins}
          value={loaded ? awaiting.length : <Skeleton className="h-8 w-10" />}
        />
        <StatCard
          label="Open projects"
          icon={SquareKanban}
          value={loaded ? open.length : <Skeleton className="h-8 w-10" />}
        />
        <StatCard
          label="Clients"
          icon={Users}
          value={loaded ? clients.length : <Skeleton className="h-8 w-10" />}
        />
      </div>

      {view === "board" ? (
        <>
          <div className="relative mb-4 max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects or clients"
              className="pl-8"
              aria-label="Search projects or clients"
            />
          </div>

          {/* Scrolls sideways on its own when the columns don't fit, so the
              page itself never does. */}
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="grid min-w-[56rem] grid-cols-4 items-start gap-3">
              {columns.map(({ status, cards }) => {
                const isDone = status === "done";
                const capped = isDone && !showAllDone && !q && cards.length > DONE_PREVIEW;
                // Cards are appended when they arrive, so the tail is what
                // was finished most recently.
                const shown = capped ? cards.slice(-DONE_PREVIEW) : cards;
                // Drop slots count every card except the one being dragged,
                // matching how dropIndexAt measures them.
                const slotOf = new Map(
                  shown.filter((p) => p.id !== dragId).map((p, i) => [p.id, i]),
                );
                const due = cards.filter((p) => balanceCents(p) > 0);
                const target = dropTarget?.status === status ? dropTarget.index : -1;
                const offset = cards.length - shown.length;

                return (
                  <section
                    key={status}
                    aria-label={STATUS_LABELS[status]}
                    onDragOver={(e) => onColumnDragOver(e, status)}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDropTarget((t) => (t?.status === status ? null : t));
                      }
                    }}
                    onDrop={(e) => onColumnDrop(e, status, shown)}
                    className={cn(
                      "flex min-h-40 flex-col gap-2 rounded-xl bg-muted/40 p-2 ring-1 ring-foreground/5 transition-colors",
                      target !== -1 && "bg-muted/70 ring-foreground/15",
                    )}
                  >
                    <header className="flex items-center gap-2 px-1.5 pt-1">
                      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                      <h2 className="text-sm font-medium">{STATUS_LABELS[status]}</h2>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {cards.length}
                      </span>
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto"
                          aria-label={`Add a project to ${STATUS_LABELS[status]}`}
                          onClick={() => setProjectDraft({ mode: "new", status })}
                        >
                          <Plus />
                        </Button>
                      )}
                    </header>
                    {due.length > 0 && !isDone && (
                      <p className="-mt-1 px-1.5 text-xs text-muted-foreground tabular-nums">
                        {sumByCurrency(due, (p) => ({
                          cents: balanceCents(p),
                          currency: p.currency,
                        }))}{" "}
                        owed
                      </p>
                    )}

                    {!loaded ? (
                      <Skeleton className="h-20 rounded-lg" />
                    ) : (
                      <>
                        {capped && (
                          <button
                            type="button"
                            onClick={() => setShowAllDone(true)}
                            className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            Show {offset} older
                          </button>
                        )}
                        {shown.map((p) => (
                          <Fragment key={p.id}>
                            {target !== -1 && slotOf.get(p.id) === target && <DropLine />}
                            <ProjectCard
                              project={p}
                              clientName={clientName(p.clientId)}
                              dragging={dragId === p.id}
                              draggable={!readOnly}
                              onOpen={() => setProjectDraft({ mode: "edit", project: p })}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", p.id);
                                e.dataTransfer.effectAllowed = "move";
                                setDragId(p.id);
                              }}
                              onDragEnd={() => {
                                setDragId(null);
                                setDropTarget(null);
                              }}
                            />
                          </Fragment>
                        ))}
                        {target !== -1 && target >= slotOf.size && <DropLine />}
                        {!shown.length && target === -1 && (
                          <p className="px-1.5 py-4 text-center text-xs text-muted-foreground">
                            {q ? "No match" : "Nothing here"}
                          </p>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <ClientsTable
          loaded={loaded}
          clients={clients}
          projects={projects}
          onOpen={(client) => setClientDraft({ mode: "edit", client })}
        />
      )}

      <ProjectDialog
        readOnly={readOnly}
        draft={projectDraft}
        clients={clients}
        defaultCurrency={defaultCurrency}
        nextOrder={nextOrder}
        onClose={() => setProjectDraft(null)}
        onSaved={(project, client) => {
          if (client) upsertClient(client);
          upsertProject(project);
        }}
        onDeleted={(id) => setProjects((list) => list.filter((p) => p.id !== id))}
      />

      <ClientDialog
        readOnly={readOnly}
        draft={clientDraft}
        projects={projects}
        onClose={() => setClientDraft(null)}
        onSaved={upsertClient}
        onDeleted={(id) => setClients((list) => list.filter((c) => c.id !== id))}
        onOpenProject={(project) => {
          setClientDraft(null);
          setProjectDraft({ mode: "edit", project });
        }}
        onNewProject={(clientId) => {
          setClientDraft(null);
          setProjectDraft({ mode: "new", status: "pending", clientId });
        }}
      />
    </>
  );
}

function DropLine() {
  return <div className="h-0.5 shrink-0 rounded-full bg-primary" aria-hidden />;
}

function ProjectCard({
  project: p,
  clientName,
  dragging,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  project: Project;
  clientName: string;
  dragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const owed = balanceCents(p);
  const overdue = !!p.dueDate && p.status !== "done" && p.dueDate < todayIso();

  return (
    <div
      data-card-id={p.id}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "grid gap-1.5 rounded-lg bg-card p-3 text-left ring-1 ring-foreground/10 transition-[opacity,box-shadow] outline-none hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging && "opacity-40",
      )}
    >
      <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
      <span className="truncate text-xs text-muted-foreground">{clientName}</span>
      {(p.priceCents > 0 || p.dueDate) && (
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
          {p.priceCents > 0 ? (
            owed > 0 ? (
              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-400 tabular-nums">
                {formatMoney(owed, p.currency)} owed
                {p.paidCents > 0 && (
                  <span className="font-normal text-amber-400/70">
                    {" "}
                    / {formatMoney(p.priceCents, p.currency)}
                  </span>
                )}
              </span>
            ) : (
              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-400 tabular-nums">
                Paid · {formatMoney(p.priceCents, p.currency)}
              </span>
            )
          ) : (
            <span />
          )}
          {p.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                overdue ? "text-destructive" : "text-muted-foreground",
              )}
              title={overdue ? "Overdue" : "Due date"}
            >
              <CalendarDays className="size-3" />
              {formatDue(p.dueDate)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ClientsTable({
  loaded,
  clients,
  projects,
  onOpen,
}: {
  loaded: boolean;
  clients: Client[];
  projects: Project[];
  onOpen: (client: Client) => void;
}) {
  if (!loaded) return <Skeleton className="h-48 rounded-xl" />;
  if (!clients.length) {
    return (
      <Card className="items-center p-10 text-center text-sm text-muted-foreground">
        No clients yet. Add one here, or create a project and its client in one go from the
        board.
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 font-medium">Client</th>
            <th className="px-4 py-2.5 font-medium">Contact</th>
            <th className="px-4 py-2.5 font-medium">Projects</th>
            <th className="px-4 py-2.5 text-right font-medium">Billed</th>
            <th className="px-4 py-2.5 text-right font-medium">Owed</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const theirs = projects.filter((p) => p.clientId === c.id);
            const openOnes = theirs.filter((p) => p.status !== "done");
            const owing = theirs.filter((p) => balanceCents(p) > 0);
            const latest = [...openOnes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-left font-medium outline-none focus-visible:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(c);
                    }}
                  >
                    {c.name}
                  </button>
                </td>
                <td className="max-w-56 px-4 py-3 text-muted-foreground">
                  <span className="block truncate">
                    {[c.email, c.phone, c.social].filter(Boolean).join(" · ") || "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {theirs.length ? (
                    <span className="grid">
                      <span className="tabular-nums">
                        {openOnes.length} open · {theirs.length} total
                      </span>
                      {latest && (
                        <StatusPill status={latest.status} label={STATUS_LABELS[latest.status]} />
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  {theirs.some((p) => p.priceCents)
                    ? sumByCurrency(theirs, (p) => ({ cents: p.priceCents, currency: p.currency }))
                    : "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right tabular-nums",
                    owing.length ? "font-medium text-amber-400" : "text-muted-foreground",
                  )}
                >
                  {owing.length
                    ? sumByCurrency(owing, (p) => ({
                        cents: balanceCents(p),
                        currency: p.currency,
                      }))
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
