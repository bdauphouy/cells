"use client";

import { useEffect, useState } from "react";
import { Eye, Globe, MonitorSmartphone, RefreshCw, Users } from "lucide-react";
import { SectionHeader, StatCard } from "@/components/admin/AdminShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsEntry, StatsRange, StatsReport } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const RANGES: StatsRange[] = [7, 30, 90];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const dayLabel = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function countryLabel(code: string) {
  if (code === "XX") return "Unknown";
  const flag = String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
  let name = code;
  try {
    name = regionNames.of(code) ?? code;
  } catch {}
  return `${flag} ${name}`;
}

const percent = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : "0%";

// `active` lets the section refetch whenever it's opened, so the numbers
// aren't stuck at whatever they were when the admin page first loaded.
export default function AnalyticsCard({ active }: { active: boolean }) {
  const [range, setRange] = useState<StatsRange>(30);
  const [report, setReport] = useState<StatsReport | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Loading and error are derived from which request last settled, rather
  // than flipped on at the start of the effect.
  const requestKey = `${range}:${reloadKey}`;
  const [settled, setSettled] = useState<{ key: string; error: string } | null>(null);
  const loading = active && settled?.key !== requestKey;
  const error = settled?.key === requestKey ? settled.error : "";

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/admin/stats?range=${range}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<StatsReport>;
      })
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setSettled({ key: requestKey, error: "" });
      })
      .catch((e: Error) => {
        if (!cancelled) setSettled({ key: requestKey, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [active, range, requestKey]);

  const shown = report?.range === range ? report : null;
  const devices = shown?.breakdown.device ?? [];
  const mobileShare = shown
    ? percent(
        devices.filter((d) => d.name !== "Desktop").reduce((n, d) => n + d.count, 0),
        shown.views,
      )
    : null;

  return (
    <>
      <SectionHeader
        title="Analytics"
        description="Visits to the public site, counted without cookies. Your own visits are skipped while you're logged in. Days are in UTC."
        actions={
          <>
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={r === range}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    r === range
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
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
          label="Page views"
          icon={Eye}
          value={shown ? shown.views.toLocaleString() : <Skeleton className="h-8 w-14" />}
        />
        <StatCard
          label="Visitors"
          icon={Users}
          value={shown ? shown.visitors.toLocaleString() : <Skeleton className="h-8 w-14" />}
          hint="Unique per day, summed"
        />
        <StatCard
          label="Countries"
          icon={Globe}
          value={
            shown ? (
              shown.breakdown.country.filter((c) => c.name !== "XX").length
            ) : (
              <Skeleton className="h-8 w-10" />
            )
          }
        />
        <StatCard
          label="On mobile"
          icon={MonitorSmartphone}
          value={mobileShare ?? <Skeleton className="h-8 w-12" />}
          hint="Phones and tablets"
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Daily traffic</CardTitle>
        </CardHeader>
        <CardContent>
          {shown ? <DailyChart daily={shown.daily} /> : <Skeleton className="h-40" />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Countries" entries={shown?.breakdown.country} format={countryLabel} />
        <Breakdown title="Referrers" entries={shown?.breakdown.referrer} />
        <Breakdown title="Browsers" entries={shown?.breakdown.browser} />
        <Breakdown title="Operating systems" entries={shown?.breakdown.os} />
        <Breakdown title="Devices" entries={shown?.breakdown.device} />
      </div>
    </>
  );
}

function DailyChart({ daily }: { daily: StatsReport["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  const first = daily[0]?.day;
  const last = daily.at(-1)?.day;
  return (
    <div>
      <div className="flex h-40 items-end gap-px" role="img" aria-label="Views per day">
        {daily.map((d) => (
          <div
            key={d.day}
            className="group relative flex h-full flex-1 items-end"
            title={`${dayLabel.format(new Date(d.day))}: ${d.views} views, ${d.visitors} visitors`}
          >
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-primary/30 transition-colors group-hover:bg-primary/50"
              style={{ height: `${(d.views / max) * 100}%` }}
            >
              <div
                className="w-full bg-primary"
                style={{ height: `${d.views ? (d.visitors / d.views) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{first && dayLabel.format(new Date(first))}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-primary" /> Visitors
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-primary/30" /> Views
          </span>
        </span>
        <span>{last && dayLabel.format(new Date(last))}</span>
      </div>
    </div>
  );
}

const TOP = 8;

function Breakdown({
  title,
  entries,
  format = (name) => name,
}: {
  title: string;
  entries: StatsEntry[] | undefined;
  format?: (name: string) => string;
}) {
  const total = entries?.reduce((n, e) => n + e.count, 0) ?? 0;
  const top = entries?.slice(0, TOP) ?? [];
  const rest = entries?.slice(TOP).reduce((n, e) => n + e.count, 0) ?? 0;
  const rows = rest ? [...top, { name: "\0other", count: rest }] : top;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!entries ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <ul className="grid gap-1">
            {rows.map((e) => (
              <li key={e.name} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-sm">
                <span
                  className="absolute inset-y-0 left-0 bg-muted"
                  style={{ width: `${(e.count / total) * 100}%` }}
                  aria-hidden
                />
                <span className="relative truncate">
                  {e.name === "\0other" ? "Other" : format(e.name)}
                </span>
                <span className="relative shrink-0 tabular-nums text-muted-foreground">
                  {e.count.toLocaleString()}
                  <span className="ml-2 inline-block w-9 text-right text-xs">
                    {percent(e.count, total)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
