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

/**
 * Weighted operational health scoring.
 *
 * Every component is scored in `0..1` from a measurement, then combined into a
 * single `0..100` percentage. A component that could not be measured contributes
 * nothing at all: its weight is removed from the denominator rather than scored
 * as a zero, because "we cannot see it" and "it is down" are different facts and
 * collapsing them would let an unconfigured probe look like an outage.
 */

export type HealthComponentStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "unknown";

export type HealthComponentKey =
  | "stellar-rpc"
  | "ipfs-gateway"
  | "telemetry-websocket"
  | "error-rate";

/** Piecewise-linear latency budget: 1 at `targetMs`, 0 at or beyond `maxMs`. */
export interface LatencySlo {
  targetMs: number;
  maxMs: number;
}

/** Rate budget (errors, incidents) expressed as a fraction of traffic. */
export interface RateSlo {
  target: number;
  max: number;
}

/** What a probe layer measured for one component, or that it could not run. */
export interface ProbeOutcome {
  key: Extract<HealthComponentKey, "stellar-rpc" | "ipfs-gateway" | "telemetry-websocket">;
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number | null;
  error?: string | null;
  /** True when the component has no configured target; not a failure. */
  skipped?: boolean;
}

export interface HealthComponent {
  key: HealthComponentKey;
  name: string;
  /** Status-page vocabulary, so the payload maps straight onto a monitor. */
  status: HealthComponentStatus;
  /** `0..100`, or `null` when the component could not be measured. */
  score: number | null;
  weight: number;
  critical: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  targetMs: number | null;
  message: string;
}

export interface OperationalHealthReport extends OperationalHealth {
  /** `0..100` weighted across measurable components. */
  score: number;
  status: HealthComponentStatus;
  components: HealthComponent[];
  /** Components pulling the score down, worst first. */
  degradedComponents: string[];
  weights: HealthComponentWeights;
  probes: {
    enabled: boolean;
    measured: number;
    skipped: number;
  };
}

export interface HealthComponentWeights {
  "stellar-rpc": number;
  "ipfs-gateway": number;
  "telemetry-websocket": number;
  "error-rate": number;
}

/**
 * Defaults weight the things a user actually feels: the RPC path they transact
 * through, then the incident/error backlog, then the two supporting services.
 * IPFS and the telemetry socket are allowed to be slower before they degrade.
 */
export const DEFAULT_HEALTH_WEIGHTS: HealthComponentWeights = {
  "stellar-rpc": 0.35,
  "error-rate": 0.25,
  "ipfs-gateway": 0.2,
  "telemetry-websocket": 0.2,
};

export const HEALTH_COMPONENT_SLOS: Record<
  "stellar-rpc" | "ipfs-gateway" | "telemetry-websocket",
  LatencySlo
> = {
  // Soroban RPC round trips: fast until ~600ms, unusable past 4s.
  "stellar-rpc": { targetMs: 600, maxMs: 4000 },
  // Gateway fetches are cold by nature; only multi-second stalls signal trouble.
  "ipfs-gateway": { targetMs: 1500, maxMs: 8000 },
  "telemetry-websocket": { targetMs: 800, maxMs: 5000 },
};

/** Incident backlog as a share of incoming reports. */
export const DEFAULT_ERROR_RATE_SLO: RateSlo = { target: 0.05, max: 0.5 };

export const HEALTH_STATUS_THRESHOLDS = {
  operational: 90,
  degraded: 60,
  partial_outage: 25,
} as const;

const COMPONENT_NAMES: Record<HealthComponentKey, string> = {
  "stellar-rpc": "Stellar RPC",
  "ipfs-gateway": "IPFS gateway",
  "telemetry-websocket": "Telemetry WebSocket",
  "error-rate": "Report error rate",
};

const CRITICAL_COMPONENTS: readonly HealthComponentKey[] = ["stellar-rpc"];

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

/** Fraction of the latency budget still available, `0..1`. */
export function scoreLatencySlo(latencyMs: number | null, slo: LatencySlo): number {
  if (latencyMs === null || latencyMs === undefined) {
    return 0;
  }

  if (latencyMs <= slo.targetMs) {
    return 1;
  }

  if (slo.maxMs <= slo.targetMs) {
    return 0;
  }

  return clamp01((slo.maxMs - latencyMs) / (slo.maxMs - slo.targetMs));
}

/** Fraction of the error budget still available, `0..1`. */
export function scoreRateSlo(rate: number, slo: RateSlo): number {
  if (rate <= slo.target) {
    return 1;
  }

  if (slo.max <= slo.target) {
    return 0;
  }

  return clamp01((slo.max - rate) / (slo.max - slo.target));
}

export function componentStatusFromScore(
  score: number | null,
): HealthComponentStatus {
  if (score === null) {
    return "unknown";
  }

  if (score >= HEALTH_STATUS_THRESHOLDS.operational) {
    return "operational";
  }

  if (score >= HEALTH_STATUS_THRESHOLDS.degraded) {
    return "degraded";
  }

  if (score >= HEALTH_STATUS_THRESHOLDS.partial_outage) {
    return "partial_outage";
  }

  return "major_outage";
}

/**
 * Incident signals re-used as the error-rate metric. There is no metrics
 * backend in this app, so the closest honest proxy is the report backlog:
 * unresolved reports over total reports, with critical incidents and
 * reconciliation drift counted twice because they are the ones that correlate
 * with failed operations.
 */
export function reportErrorRate(reports: readonly BugReport[]): number {
  if (reports.length === 0) {
    return 0;
  }

  const unresolved = reports.filter((report) => report.status !== "resolved").length;
  const critical = reports.filter(
    (report) => report.priority === "critical" && report.status !== "resolved",
  ).length;
  const drift = reports.filter(
    (report) => report.status === "resolved" && report.rewardStatus === "pending",
  ).length;

  return (unresolved + critical + drift) / reports.length;
}

function probeComponent(
  outcome: ProbeOutcome,
  weight: number,
): HealthComponent {
  const slo = HEALTH_COMPONENT_SLOS[outcome.key];
  const name = COMPONENT_NAMES[outcome.key];

  if (outcome.skipped) {
    return {
      key: outcome.key,
      name,
      status: "unknown",
      score: null,
      weight,
      critical: CRITICAL_COMPONENTS.includes(outcome.key),
      latencyMs: null,
      statusCode: null,
      targetMs: slo.targetMs,
      message: outcome.error ?? "Probe is not configured",
    };
  }

  // A component is only as healthy as its worst measurable aspect: answering
  // successfully after four seconds is still a degradation.
  const score = outcome.ok
    ? clamp01(scoreLatencySlo(outcome.latencyMs, slo))
    : 0;
  const percent = Math.round(score * 1000) / 10;

  return {
    key: outcome.key,
    name,
    status: componentStatusFromScore(percent),
    score: percent,
    weight,
    critical: CRITICAL_COMPONENTS.includes(outcome.key),
    latencyMs: outcome.latencyMs,
    statusCode: outcome.statusCode ?? null,
    targetMs: slo.targetMs,
    message: outcome.ok
      ? outcome.latencyMs === null
        ? "Reachable"
        : `Reachable in ${Math.round(outcome.latencyMs)}ms (target ${slo.targetMs}ms)`
      : outcome.error ?? "Unreachable",
  };
}

export interface BuildHealthComponentsInput {
  probes?: readonly ProbeOutcome[];
  reports: readonly BugReport[];
  weights?: Partial<HealthComponentWeights>;
}

export function buildHealthComponents({
  probes,
  reports,
  weights,
}: BuildHealthComponentsInput): HealthComponent[] {
  const resolvedWeights: HealthComponentWeights = {
    ...DEFAULT_HEALTH_WEIGHTS,
    ...weights,
  };

  const measured: HealthComponent[] = (
    probes ?? [
      {
        key: "stellar-rpc",
        ok: false,
        latencyMs: null,
        skipped: true,
        error: "Probe is not configured",
      },
      {
        key: "ipfs-gateway",
        ok: false,
        latencyMs: null,
        skipped: true,
        error: "Probe is not configured",
      },
      {
        key: "telemetry-websocket",
        ok: false,
        latencyMs: null,
        skipped: true,
        error: "Probe is not configured",
      },
    ]
  ).map((outcome) => probeComponent(outcome, resolvedWeights[outcome.key]));

  const errorRate = reportErrorRate(reports);
  const errorScore = Math.round(scoreRateSlo(errorRate, DEFAULT_ERROR_RATE_SLO) * 1000) / 10;
  measured.push({
    key: "error-rate",
    name: COMPONENT_NAMES["error-rate"],
    status: componentStatusFromScore(errorScore),
    score: errorScore,
    weight: resolvedWeights["error-rate"],
    critical: CRITICAL_COMPONENTS.includes("error-rate"),
    latencyMs: null,
    statusCode: null,
    targetMs: null,
    message:
      reports.length === 0
        ? "No reports recorded"
        : `${(errorRate * 100).toFixed(1)}% of ${reports.length} reports are open, critical, or unreconciled`,
  });

  return measured;
}

const COMPONENT_STATUS_SEVERITY: Record<HealthComponentStatus, number> = {
  operational: 0,
  unknown: 0,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

const COMPONENT_STATUS_FROM_SEVERITY: Record<number, HealthComponentStatus> = {
  0: "operational",
  2: "degraded",
  3: "partial_outage",
  4: "major_outage",
};

export interface BuildOperationalHealthReportInput {
  reports: readonly BugReport[];
  probes?: readonly ProbeOutcome[];
  weights?: Partial<HealthComponentWeights>;
  now?: number;
  staleAfterMs?: number;
  probesEnabled?: boolean;
}

export function buildOperationalHealthReport({
  reports,
  probes,
  weights,
  now = Date.now(),
  staleAfterMs,
  probesEnabled = false,
}: BuildOperationalHealthReportInput): OperationalHealthReport {
  const components = buildHealthComponents({ probes, reports, weights });
  const detail = buildOperationalHealth(reports, now, staleAfterMs);

  // Only measurable components count towards the score, so an unconfigured
  // probe cannot read as an outage; the denominator is their total weight.
  const measurable = components.filter(
    (component): component is HealthComponent & { score: number } =>
      component.score !== null,
  );
  const totalWeight = measurable.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  const score =
    totalWeight === 0
      ? 0
      : Math.round(
          (measurable.reduce(
            (sum, component) => sum + component.score * component.weight,
            0,
          ) /
            totalWeight) *
            10,
        ) / 10;

  // A weighted average can hide a dead critical dependency; the overall status
  // is therefore the worse of the average and the worst *measurable* critical
  // component. An unobserved critical component is not evidence of an outage.
  const weightedStatus = componentStatusFromScore(score);
  const worstCritical = components
    .filter(
      (component) => component.critical && component.status !== "unknown",
    )
    .map((component) => COMPONENT_STATUS_SEVERITY[component.status])
    .reduce((worst, severity) => Math.max(worst, severity), 0);
  const status =
    COMPONENT_STATUS_SEVERITY[weightedStatus] >= worstCritical
      ? weightedStatus
      : COMPONENT_STATUS_FROM_SEVERITY[worstCritical];

  return {
    ...detail,
    score,
    status,
    components,
    degradedComponents: components
      .filter(
        (component) =>
          component.status !== "operational" && component.status !== "unknown",
      )
      .sort(
        (a, b) =>
          COMPONENT_STATUS_SEVERITY[b.status] -
          COMPONENT_STATUS_SEVERITY[a.status],
      )
      .map((component) => component.key),
    weights: {
      ...DEFAULT_HEALTH_WEIGHTS,
      ...weights,
    },
    probes: {
      enabled: probesEnabled,
      measured: components.filter(
        (component) => component.score !== null && component.key !== "error-rate",
      ).length,
      skipped: components.filter(
        (component) => component.score === null && component.key !== "error-rate",
      ).length,
    },
  };
}

/** Statuspage indicator vocabulary for the overall score. */
export function toStatuspageIndicator(
  report: Pick<OperationalHealthReport, "status">,
): "none" | "minor" | "major" | "critical" {
  switch (report.status) {
    case "operational":
      return "none";
    case "degraded":
      return "minor";
    case "partial_outage":
      return "major";
    default:
      return "critical";
  }
}

export interface StatuspagePayload {
  page: {
    name: string;
    updated_at: string;
  };
  status: {
    indicator: "none" | "minor" | "major" | "critical";
    description: string;
  };
  components: Array<{
    id: string;
    name: string;
    status: "operational" | "degraded_performance" | "partial_outage" | "major_outage";
    position: number;
    updated_at: string;
    description: string;
    group: boolean;
  }>;
}

const STATUSPAGE_COMPONENT_STATUS = {
  operational: "operational",
  degraded: "degraded_performance",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
} as const;

/**
 * Statuspage-shaped summary. Unmeasurable components are omitted rather than
 * published: a status page should not list a component the monitor cannot see.
 */
export function toStatuspagePayload(
  report: OperationalHealthReport,
  pageName = "Trellis",
): StatuspagePayload {
  const published = report.components.filter(
    (component) => component.status !== "unknown",
  );
  const measured = report.components.filter(
    (component) => component.score !== null,
  ).length;

  return {
    page: {
      name: pageName,
      updated_at: report.generatedAt,
    },
    status: {
      indicator: toStatuspageIndicator(report),
      description:
        (report.status === "operational"
          ? "All systems operational"
          : `${report.degradedComponents.length} subsystem(s) affected`) +
        ` (health ${report.score}%, ${measured}/${report.components.length} components measured)`,
    },
    components: published.map((component, index) => ({
      id: component.key,
      name: component.name,
      status:
        STATUSPAGE_COMPONENT_STATUS[
          component.status as keyof typeof STATUSPAGE_COMPONENT_STATUS
        ],
      position: index + 1,
      updated_at: report.generatedAt,
      description: component.message,
      group: false,
    })),
  };
}

export interface BetterStackPayload {
  status: "up" | "degraded" | "down";
  score: number;
  summary: string;
  checked_at: string;
  components: Array<{
    name: string;
    status: "up" | "degraded" | "down" | "unknown";
    latency_ms: number | null;
    message: string;
  }>;
}

const BETTER_STACK_COMPONENT_STATUS = {
  operational: "up",
  degraded: "degraded",
  partial_outage: "degraded",
  major_outage: "down",
  unknown: "unknown",
} as const;

const BETTER_STACK_OVERALL_STATUS = {
  operational: "up",
  unknown: "degraded",
  degraded: "degraded",
  partial_outage: "down",
  major_outage: "down",
} as const;

/** Better Stack heartbeat / status-page shape. */
export function toBetterStackPayload(
  report: OperationalHealthReport,
): BetterStackPayload {
  return {
    status: BETTER_STACK_OVERALL_STATUS[report.status],
    score: report.score,
    summary:
      `Operational health ${report.score}% across ` +
      `${report.components.filter((component) => component.score !== null).length}/${report.components.length} measured components`,
    checked_at: report.generatedAt,
    components: report.components.map((component) => ({
      name: component.name,
      status: BETTER_STACK_COMPONENT_STATUS[component.status],
      latency_ms: component.latencyMs,
      message: component.message,
    })),
  };
}
