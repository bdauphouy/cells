import { db } from "@/lib/kv";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  PROJECT_STATUSES,
  type Client,
  type ClientInput,
  type Project,
  type ProjectInput,
} from "@/lib/crm-model";

// One Redis hash per entity, keyed by id, so saving a card writes that card
// alone rather than rewriting the whole board.
const CLIENTS_KEY = "crm:clients";
const PROJECTS_KEY = "crm:projects";

export async function getCrm(): Promise<{ clients: Client[]; projects: Project[] }> {
  const [clients, projects] = await Promise.all([
    db().hgetall<Record<string, Client>>(CLIENTS_KEY),
    db().hgetall<Record<string, Project>>(PROJECTS_KEY),
  ]);
  return {
    clients: Object.values(clients ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
    projects: Object.values(projects ?? {}).sort((a, b) => a.order - b.order),
  };
}

export async function getClient(id: string) {
  return db().hget<Client>(CLIENTS_KEY, id);
}

export async function createClient(input: ClientInput): Promise<Client> {
  const client: Client = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  await db().hset(CLIENTS_KEY, { [client.id]: client });
  return client;
}

export async function updateClient(id: string, patch: Partial<ClientInput>) {
  const current = await getClient(id);
  if (!current) return null;
  const client: Client = { ...current, ...patch };
  await db().hset(CLIENTS_KEY, { [id]: client });
  return client;
}

export async function deleteClient(id: string): Promise<"ok" | "not_found" | "has_projects"> {
  if (!(await getClient(id))) return "not_found";
  const { projects } = await getCrm();
  if (projects.some((p) => p.clientId === id)) return "has_projects";
  await db().hdel(CLIENTS_KEY, id);
  return "ok";
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const now = Date.now();
  const project: Project = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db().hset(PROJECTS_KEY, { [project.id]: project });
  return project;
}

export async function updateProject(id: string, patch: Partial<ProjectInput>) {
  const current = await db().hget<Project>(PROJECTS_KEY, id);
  if (!current) return null;
  const project: Project = { ...current, ...patch, updatedAt: Date.now() };
  await db().hset(PROJECTS_KEY, { [id]: project });
  return project;
}

export async function deleteProject(id: string) {
  return (await db().hdel(PROJECTS_KEY, id)) > 0;
}

// ---------------------------------------------------------------------------
// Request validation. Each parser returns only the known fields, trimmed, so
// nothing unexpected from a request body ends up persisted.

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const MAX_TEXT = 5000;

const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.length <= max ? v.trim() : undefined;

const cents = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e12 ? v : undefined;

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function parseClient(body: unknown, partial: boolean): Parsed<Partial<ClientInput>> {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const out: Partial<ClientInput> = {};

  for (const key of ["name", "email", "phone", "social", "notes"] as const) {
    if (b[key] === undefined) continue;
    const value = str(b[key], key === "notes" ? MAX_TEXT : 200);
    if (value === undefined) return { ok: false, error: `Invalid ${key}` };
    out[key] = value;
  }
  if (out.name === "" || (!partial && !out.name)) {
    return { ok: false, error: "A client needs a name" };
  }
  if (!partial) {
    out.email ??= "";
    out.phone ??= "";
    out.social ??= "";
    out.notes ??= "";
  }
  return { ok: true, value: out };
}

export function parseProject(body: unknown, partial: boolean): Parsed<Partial<ProjectInput>> {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const out: Partial<ProjectInput> = {};

  if (b.title !== undefined) {
    const title = str(b.title);
    if (!title) return { ok: false, error: "A project needs a title" };
    out.title = title;
  }
  if (b.clientId !== undefined) {
    if (typeof b.clientId !== "string" || !b.clientId) return { ok: false, error: "Invalid client" };
    out.clientId = b.clientId;
  }
  if (b.status !== undefined) {
    if (!PROJECT_STATUSES.includes(b.status as never)) return { ok: false, error: "Invalid status" };
    out.status = b.status as ProjectInput["status"];
  }
  if (b.currency !== undefined) {
    if (!CURRENCIES.includes(b.currency as never)) return { ok: false, error: "Invalid currency" };
    out.currency = b.currency as ProjectInput["currency"];
  }
  for (const key of ["priceCents", "paidCents"] as const) {
    if (b[key] === undefined) continue;
    const value = cents(b[key]);
    if (value === undefined) return { ok: false, error: "Invalid amount" };
    out[key] = value;
  }
  if (b.dueDate !== undefined) {
    if (b.dueDate !== null && !isDate(b.dueDate)) return { ok: false, error: "Invalid due date" };
    out.dueDate = b.dueDate;
  }
  if (b.notes !== undefined) {
    const notes = str(b.notes, MAX_TEXT);
    if (notes === undefined) return { ok: false, error: "Invalid notes" };
    out.notes = notes;
  }
  if (b.order !== undefined) {
    if (typeof b.order !== "number" || !Number.isFinite(b.order)) {
      return { ok: false, error: "Invalid order" };
    }
    out.order = b.order;
  }

  if (!partial) {
    if (!out.title) return { ok: false, error: "A project needs a title" };
    if (!out.clientId) return { ok: false, error: "A project needs a client" };
    out.status ??= "pending";
    out.currency ??= DEFAULT_CURRENCY;
    out.priceCents ??= 0;
    out.paidCents ??= 0;
    out.dueDate ??= null;
    out.notes ??= "";
    out.order ??= Date.now();
  }
  return { ok: true, value: out };
}
