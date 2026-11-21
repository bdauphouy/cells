import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/crm-model";

// Native rather than a custom listbox: the CRM is also used from a phone,
// where the OS picker is the most comfortable way to choose a status.
// The browser's own arrow ignores padding and sits flush against the border,
// so it's hidden (`appearance-none`) and replaced by a chevron we can place.
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative w-full min-w-0">
      <select
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&>option]:bg-popover",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
      />
    </div>
  );
}

export const STATUS_DOT: Record<ProjectStatus, string> = {
  pending: "bg-zinc-400",
  awaiting_payment: "bg-amber-400",
  in_progress: "bg-sky-400",
  done: "bg-emerald-400",
};

export function StatusPill({ status, label }: { status: ProjectStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {label}
    </span>
  );
}

// "YYYY-MM-DD" in the viewer's own timezone, comparable with a stored due date.
export const todayIso = () => new Date().toLocaleDateString("en-CA");

const dueFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
export const formatDue = (iso: string) => dueFormat.format(new Date(iso));
