import type { BugReport } from "@/types/bug-report";

export interface OperationalHealth {
  generatedAt: string;
  categories: Array<{
    key: "unresolved-exceptions" | "stale-records" | "reconciliation-drift" | "user-incidents";
    label: string;
    count: number;
    severity: "info" | "warning" | "critical";
    href: string;
  }>;
}

export function buildOperationalHealth(
  reports: readonly BugReport[],
  now = Date.now(),
  staleAfterMs = 7 * 24 * 60 * 60 * 1000,
): OperationalHealth {
  const unresolved = reports.filter((report) => report.status !== "resolved");
  const stale = unresolved.filter(
    (report) => now - Date.parse(report.updatedAt) >= staleAfterMs,
  );
  const drift = reports.filter(
    (report) => report.status === "resolved" && report.rewardStatus === "pending",
  );
  const incidents = reports.filter(
    (report) => report.priority === "critical" && report.status !== "resolved",
  );

  return {
    generatedAt: new Date(now).toISOString(),
    categories: [
      {
        key: "unresolved-exceptions",
        label: "Unresolved exceptions",
        count: unresolved.length,
        severity: unresolved.length > 0 ? "warning" : "info",
        href: "/bug-reports?status=all",
      },
      {
        key: "stale-records",
        label: "Stale records",
        count: stale.length,
        severity: stale.length > 0 ? "warning" : "info",
        href: "/bug-reports?status=all&stale=true",
      },
      {
        key: "reconciliation-drift",
        label: "Reconciliation drift",
        count: drift.length,
        severity: drift.length > 0 ? "critical" : "info",
        href: "/bug-reports?status=resolved",
      },
      {
        key: "user-incidents",
        label: "User-impacting incidents",
        count: incidents.length,
        severity: incidents.length > 0 ? "critical" : "info",
        href: "/bug-reports?status=all&priority=critical",
      },
    ],
  };
}

/** Severity levels shared with the client telemetry contract. */
export type ExceptionSeverity = "warning" | "error" | "critical";

/** Bounded exception category; `rpc` failures back the RPC-error alert metric. */
export type ExceptionKind = "rpc" | "api" | "ui" | "render" | "wallet" | "other";

/**
 * A single sanitized application exception.
 *
 * The shape follows `docs/telemetry-event-contract.md`: every field is a
 * low-cardinality, non-identifying dimension, so the dashboard can group and
 * chart exceptions without storing user or wallet data.
 */
export interface ExceptionEvent {
  id: string;
  /** Event timestamp in milliseconds. */
  ts: number;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  /** Bounded feature/component label, e.g. `"wallet"`. */
  component: string;
  /** Bounded platform label, e.g. `"macOS"`. */
  browserOS: string;
  /** Release/build identifier, e.g. `"v1.4.0"`. */
  release: string;
  /** Stable error code from the telemetry contract, e.g. `"rpc_unavailable"`. */
  code?: string;
}

export type ExceptionGroupDimension = "component" | "browserOS" | "release" | "kind";

export interface ExceptionFilters {
  component?: string;
  browserOS?: string;
  release?: string;
  kind?: ExceptionKind;
}

export interface ExceptionGroup {
  key: string;
  count: number;
}

export interface ErrorTrendOptions extends ExceptionFilters {
  /** Total time range to chart, in milliseconds. */
  windowMs: number;
  /** Width of each bucket, in milliseconds. */
  bucketMs: number;
  /** Reference "now" in milliseconds; defaults to `Date.now()`. */
  now?: number;
}

export interface ErrorTrendBucket {
  bucketStart: number;
  bucketEnd: number;
  /** UTC `HH:MM` label for chart axes. */
  label: string;
  count: number;
  /** Bucket count normalised to errors per minute. */
  ratePerMinute: number;
  bySeverity: Record<ExceptionSeverity, number>;
}

export type AlertMetric = "exceptions" | "rpc-exceptions" | "critical-exceptions";

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  /** A window breaches when its observed count is strictly greater than this. */
  threshold: number;
  windowMs: number;
  severity: "warning" | "critical";
  /** Defaults to enabled when omitted. */
  enabled?: boolean;
  filters?: ExceptionFilters;
}

export interface AlertBreach {
  ruleId: string;
  ruleName: string;
  metric: AlertMetric;
  threshold: number;
  observed: number;
  severity: "warning" | "critical";
  windowStart: number;
  windowEnd: number;
}

export interface ExceptionTrendReport {
  generatedAt: number;
  windowMs: number;
  bucketMs: number;
  /** Exceptions inside the chart window after filters are applied. */
  total: number;
  buckets: ErrorTrendBucket[];
  groups: Record<ExceptionGroupDimension, ExceptionGroup[]>;
  breaches: AlertBreach[];
}

export interface AlertRuleInput {
  id?: string;
  name?: string;
  metric: AlertMetric;
  threshold: number;
  windowMinutes: number;
  severity?: AlertRule["severity"];
  filters?: ExceptionFilters;
}

const MINUTE_MS = 60 * 1000;

const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  exceptions: "Exceptions",
  "rpc-exceptions": "RPC errors",
  "critical-exceptions": "Critical exceptions",
};

/** Maintainer defaults, including the `> 15 RPC errors in 5 min` rule from the issue. */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  {
    id: "rpc-errors-5m",
    name: "RPC errors over threshold",
    metric: "rpc-exceptions",
    threshold: 15,
    windowMs: 5 * MINUTE_MS,
    severity: "critical",
  },
  {
    id: "exceptions-15m",
    name: "Exception volume spike",
    metric: "exceptions",
    threshold: 30,
    windowMs: 15 * MINUTE_MS,
    severity: "warning",
  },
  {
    id: "critical-exceptions-10m",
    name: "Critical exception burst",
    metric: "critical-exceptions",
    threshold: 5,
    windowMs: 10 * MINUTE_MS,
    severity: "critical",
  },
];

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function toMinuteLabel(ts: number): string {
  return new Date(ts).toISOString().slice(11, 16);
}

/** True when every populated filter dimension matches the event. */
export function matchesExceptionFilters(
  event: ExceptionEvent,
  filters: ExceptionFilters = {},
): boolean {
  if (filters.component && event.component !== filters.component) return false;
  if (filters.browserOS && event.browserOS !== filters.browserOS) return false;
  if (filters.release && event.release !== filters.release) return false;
  if (filters.kind && event.kind !== filters.kind) return false;
  return true;
}

export function filterExceptionEvents(
  events: readonly ExceptionEvent[],
  filters: ExceptionFilters = {},
): ExceptionEvent[] {
  return events.filter((event) => matchesExceptionFilters(event, filters));
}

/** Counts exceptions per dimension, highest count first, then alphabetically. */
export function groupExceptionEvents(
  events: readonly ExceptionEvent[],
  dimension: ExceptionGroupDimension,
): ExceptionGroup[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event[dimension];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({ key, count })).sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key),
  );
}

/**
 * Buckets exceptions into contiguous, fixed-width time slots ending at `now`.
 *
 * The window is half-open (`[now - windowMs, now)`), so an event is counted in
 * exactly one bucket. `ratePerMinute` normalises partial buckets so short
 * windows remain comparable with longer ones.
 */
export function buildErrorTrend(
  events: readonly ExceptionEvent[],
  options: ErrorTrendOptions,
): ErrorTrendBucket[] {
  const { windowMs, bucketMs } = options;
  assertPositive("windowMs", windowMs);
  assertPositive("bucketMs", bucketMs);

  const now = options.now ?? Date.now();
  const windowStart = now - windowMs;
  const bucketCount = Math.max(1, Math.ceil(windowMs / bucketMs));
  const minutesPerBucket = bucketMs / MINUTE_MS;

  const buckets: ErrorTrendBucket[] = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = windowStart + index * bucketMs;
    return {
      bucketStart,
      bucketEnd: bucketStart + bucketMs,
      label: toMinuteLabel(bucketStart),
      count: 0,
      ratePerMinute: 0,
      bySeverity: { warning: 0, error: 0, critical: 0 },
    };
  });

  for (const event of filterExceptionEvents(events, options)) {
    if (event.ts < windowStart || event.ts >= now) continue;
    const index = Math.min(bucketCount - 1, Math.floor((event.ts - windowStart) / bucketMs));
    const bucket = buckets[index];
    bucket.count += 1;
    bucket.bySeverity[event.severity] += 1;
  }

  for (const bucket of buckets) {
    bucket.ratePerMinute = Math.round((bucket.count / minutesPerBucket) * 100) / 100;
  }

  return buckets;
}

/** Maps an event to the alert metric it contributes to. */
export function matchesAlertMetric(event: ExceptionEvent, metric: AlertMetric): boolean {
  if (metric === "exceptions") return true;
  if (metric === "rpc-exceptions") return event.kind === "rpc";
  return event.severity === "critical";
}

/**
 * Evaluates maintainer alert rules over the half-open window
 * `[now - rule.windowMs, now)` and returns the breached rules.
 *
 * A rule breaches only when the observed count is strictly greater than its
 * threshold, matching the `> 15 RPC errors in 5 mins` semantics.
 */
export function evaluateAlertRules(
  events: readonly ExceptionEvent[],
  rules: readonly AlertRule[],
  now = Date.now(),
): AlertBreach[] {
  const breaches: AlertBreach[] = [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const windowStart = now - rule.windowMs;
    const observed = events.filter(
      (event) =>
        event.ts >= windowStart &&
        event.ts < now &&
        matchesAlertMetric(event, rule.metric) &&
        matchesExceptionFilters(event, rule.filters),
    ).length;

    if (observed > rule.threshold) {
      breaches.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        observed,
        severity: rule.severity,
        windowStart,
        windowEnd: now,
      });
    }
  }

  return breaches.sort(
    (a, b) => b.observed / b.threshold - a.observed / a.threshold || a.ruleId.localeCompare(b.ruleId),
  );
}

/** Human-readable summary of a rule, e.g. `RPC errors > 15 in 5 min`. */
export function describeAlertRule(rule: Pick<AlertRule, "metric" | "threshold" | "windowMs">): string {
  return `${ALERT_METRIC_LABELS[rule.metric]} > ${rule.threshold} in ${rule.windowMs / MINUTE_MS} min`;
}

/**
 * Validates and normalises a rule coming from the maintainer rule creator.
 * Throws when the threshold or window is not usable.
 */
export function createAlertRule(input: AlertRuleInput): AlertRule {
  const threshold = Math.round(input.threshold);
  assertPositive("Alert threshold", threshold);

  const windowMinutes = Math.round(input.windowMinutes);
  if (!Number.isFinite(windowMinutes) || windowMinutes < 1 || windowMinutes > 24 * 60) {
    throw new Error("Alert window must be between 1 and 1440 minutes");
  }

  const metric = input.metric;
  return {
    id: input.id ?? `alert-${metric}-${threshold}-${windowMinutes}m`,
    name:
      (input.name ?? "").trim() ||
      `${ALERT_METRIC_LABELS[metric]} > ${threshold} in ${windowMinutes} min`,
    metric,
    threshold,
    windowMs: windowMinutes * MINUTE_MS,
    severity: input.severity ?? "warning",
    enabled: true,
    ...(input.filters ? { filters: input.filters } : {}),
  };
}

/** Builds the chart, grouping and breach payload rendered by the operations page. */
export function buildExceptionTrendReport(
  events: readonly ExceptionEvent[],
  options: {
    windowMs: number;
    bucketMs: number;
    now?: number;
    filters?: ExceptionFilters;
    rules?: readonly AlertRule[];
  },
): ExceptionTrendReport {
  const now = options.now ?? Date.now();
  const filters = options.filters ?? {};
  const windowStart = now - options.windowMs;

  const inWindow = events.filter(
    (event) =>
      event.ts >= windowStart && event.ts < now && matchesExceptionFilters(event, filters),
  );

  return {
    generatedAt: now,
    windowMs: options.windowMs,
    bucketMs: options.bucketMs,
    total: inWindow.length,
    buckets: buildErrorTrend(events, {
      windowMs: options.windowMs,
      bucketMs: options.bucketMs,
      now,
      ...filters,
    }),
    groups: {
      component: groupExceptionEvents(inWindow, "component"),
      browserOS: groupExceptionEvents(inWindow, "browserOS"),
      release: groupExceptionEvents(inWindow, "release"),
      kind: groupExceptionEvents(inWindow, "kind"),
    },
    breaches: evaluateAlertRules(events, options.rules ?? DEFAULT_ALERT_RULES, now),
  };
}

const PRIORITY_SEVERITY: Record<BugReport["priority"], ExceptionSeverity> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "warning",
};

const CATEGORY_KIND: Record<BugReport["category"], ExceptionKind> = {
  security: "api",
  functionality: "other",
  performance: "render",
  ui: "ui",
  other: "other",
};

/**
 * Projects a bug report into the exception stream. Bug reports are the
 * dashboard's existing "unresolved exceptions", so maintainer data already on
 * hand feeds the trend chart and the alert rules.
 */
export function bugReportToExceptionEvent(report: BugReport): ExceptionEvent {
  const updated = Date.parse(report.updatedAt);
  const created = Date.parse(report.createdAt);
  return {
    id: `BR-EX-${report.id}`,
    ts: updated || created || 0,
    kind: CATEGORY_KIND[report.category],
    severity: PRIORITY_SEVERITY[report.priority],
    component: report.category,
    browserOS: "unknown",
    release: "unknown",
    code: `bug_report_${report.category}`,
  };
}
