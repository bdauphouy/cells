// Types, constants and formatting shared by the CRM's API routes and its
// admin UI. Kept free of server imports so the client bundle can use it.

export const PROJECT_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_payment",
  "done",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: "Pending",
  awaiting_payment: "Awaiting payment",
  in_progress: "In progress",
  done: "Done",
};

export const CURRENCIES = ["EUR", "USD", "HNL", "GBP", "CAD", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = "EUR";

export type Client = {
  id: string;
  name: string;
  email: string;
  phone: string;
  // Instagram/TikTok handle or any other way they reach out.
  social: string;
  notes: string;
  createdAt: number;
};

// A project is the Kanban card: one piece of work for one client. Amounts are
// integer cents so sums never pick up floating-point dust.
export type Project = {
  id: string;
  clientId: string;
  title: string;
  status: ProjectStatus;
  priceCents: number;
  paidCents: number;
  currency: Currency;
  dueDate: string | null; // "YYYY-MM-DD"
  notes: string;
  // Position within its column; fractional so a move rewrites one card only.
  order: number;
  createdAt: number;
  updatedAt: number;
};

export type ClientInput = Omit<Client, "id" | "createdAt">;
export type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt">;

export const balanceCents = (p: Pick<Project, "priceCents" | "paidCents">) =>
  Math.max(0, p.priceCents - p.paidCents);

export function formatMoney(cents: number, currency: Currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    // Whole amounts read cleaner on a card; cents only when there are some.
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// Projects can be priced in different currencies, so totals are kept per
// currency instead of being added together into a meaningless number.
export function sumByCurrency<T>(
  items: T[],
  pick: (item: T) => { cents: number; currency: Currency },
): string {
  const totals = new Map<Currency, number>();
  for (const item of items) {
    const { cents, currency } = pick(item);
    if (cents) totals.set(currency, (totals.get(currency) ?? 0) + cents);
  }
  if (!totals.size) return formatMoney(0, DEFAULT_CURRENCY);
  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .map(([currency, cents]) => formatMoney(cents, currency))
    .join(" · ");
}

// Accepts "1200", "1 200,50", "1,200.50"… and returns cents, or null.
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s  ]/g, "").replace(/[^\d.,-]/g, "");
  if (!input.trim()) return 0;
  // Something was typed but none of it is a number: invalid, not zero.
  if (!/\d/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  // A trailing group of exactly 3 digits is a thousands separator, not
  // decimals ("1,200" is twelve hundred).
  const decimals = lastSep === -1 ? "" : s.slice(lastSep + 1);
  const hasDecimals = lastSep !== -1 && decimals.length > 0 && decimals.length <= 2;
  const whole = (hasDecimals ? s.slice(0, lastSep) : s).replace(/[.,]/g, "");
  const value = Number(`${whole || "0"}.${hasDecimals ? decimals : "0"}`);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export const centsToInput = (cents: number) =>
  cents ? String(cents / 100) : "";
