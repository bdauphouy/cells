"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, LogOut, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AdminNavItem<Id extends string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  // Small count shown next to the label, e.g. uploads still in flight.
  badge?: number;
};

type ShellProps<Id extends string> = {
  nav: AdminNavItem<Id>[];
  active: Id;
  onLogout: () => void;
  children: ReactNode;
};

// Sections are addressed by hash (#library, #hero…) rather than by route,
// so switching between them never unmounts the page: uploads keep running
// and unsaved drafts survive a trip to another section.
export default function AdminShell<Id extends string>({
  nav,
  active,
  onLogout,
  children,
}: ShellProps<Id>) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 flex flex-col border-b border-border bg-sidebar/95 backdrop-blur md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-6">
          <Link href="/admin" className="flex items-center gap-3">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={140}
              height={91}
              className="h-7 w-auto"
              priority
            />
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
              Admin
            </span>
          </Link>
          <div className="flex items-center gap-1 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="View site"
              nativeButton={false}
              render={<Link href="/" />}
            >
              <ExternalLink />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Log out"
              onClick={onLogout}
            >
              <LogOut />
            </Button>
          </div>
        </div>

        <nav
          aria-label="Admin sections"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:px-3 md:pb-0"
        >
          {nav.map((item) => {
            const isActive = item.id === active;
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && (
                  <span className="rounded-full bg-primary px-1.5 text-[0.7rem] leading-5 font-medium tabular-nums text-primary-foreground">
                    {item.badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="hidden gap-1 border-t border-border p-3 md:grid">
          <Button
            variant="ghost"
            className="justify-start gap-2.5 px-3 text-muted-foreground"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ExternalLink />
            View site
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2.5 px-3 text-muted-foreground"
            onClick={onLogout}
          >
            <LogOut />
            Log out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-8 md:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}

// Shared save control for the settings sections: the button plus a quiet
// status so it's always clear whether what's on screen is what's live.
export function SaveControl({
  dirty,
  saving,
  saved,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {saving ? "" : dirty ? "Unsaved changes" : saved ? "Saved" : ""}
      </span>
      <Button onClick={onSave} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="grid gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <Icon className="size-4" />
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
