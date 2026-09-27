import {
  buildOperationalHealth,
  buildOperationalHealthReport,
  componentStatusFromScore,
  reportErrorRate,
  scoreLatencySlo,
  scoreRateSlo,
  toBetterStackPayload,
  toStatuspagePayload,
  type OperationalHealthReport,
  type ProbeOutcome,
} from "@/lib/operational-health";
import {
  healthProbesEnabled,
  probeHttpEndpoint,
  probeWebSocketEndpoint,
  resolveProbeTargets,
  resolveProbeTimeoutMs,
  runOperationalHealthProbes,
  type WebSocketFactory,
  type WebSocketLike,
} from "@/lib/operational-health-probes";
import type { BugReport } from "@/types/bug-report";

const baseReport: BugReport = {
  id: "BR-1",
  title: "Critical issue",
  description: "description",
  stepsToReproduce: "steps",
  expectedBehavior: "expected",
  actualBehavior: "actual",
  priority: "critical",
  category: "functionality",
  screenshots: [],
  reporterAddress: "private-address",
  reporterEmail: "private@example.com",
  status: "submitted",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  rewardAmount: 10,
  rewardStatus: "pending",
};

test("aggregates actionable categories without exposing report details", () => {
  const health = buildOperationalHealth([baseReport], Date.parse("2026-01-10T00:00:00.000Z"));
  expect(health.categories.map((category) => category.count)).toEqual([1, 1, 0, 1]);
  expect(JSON.stringify(health)).not.toContain("private@example.com");
  expect(JSON.stringify(health)).not.toContain("private-address");
});

// ── scoring primitives ─────────────────────────────────────────────────────

describe("scoreLatencySlo", () => {
  const slo = { targetMs: 600, maxMs: 4000 };

  test("a latency at or under the target is a full score", () => {
    expect(scoreLatencySlo(0, slo)).toBe(1);
    expect(scoreLatencySlo(600, slo)).toBe(1);
  });

  test("latency degrades linearly across the budget", () => {
    // Halfway through the budget (600..4000) is 2300ms.
    expect(scoreLatencySlo(2300, slo)).toBeCloseTo(0.5, 5);
    expect(scoreLatencySlo(1000, slo)).toBeGreaterThan(scoreLatencySlo(2000, slo));
    expect(scoreLatencySlo(2000, slo)).toBeGreaterThan(scoreLatencySlo(3500, slo));
  });

  test("beyond the maximum is zero, and an unmeasured latency scores nothing", () => {
    expect(scoreLatencySlo(4000, slo)).toBe(0);
    expect(scoreLatencySlo(9000, slo)).toBe(0);
    expect(scoreLatencySlo(null, slo)).toBe(0);
  });

  test("a degenerate budget does not divide by zero", () => {
    // Inside the target it is still healthy; past it, a zero-width budget
    // cannot be interpolated, so it is a hard failure rather than a NaN.
    expect(scoreLatencySlo(500, { targetMs: 600, maxMs: 600 })).toBe(1);
    expect(scoreLatencySlo(700, { targetMs: 600, maxMs: 600 })).toBe(0);
  });
});

describe("scoreRateSlo", () => {
  const slo = { target: 0.05, max: 0.5 };

  test("rates inside the target keep the full score", () => {
    expect(scoreRateSlo(0, slo)).toBe(1);
    expect(scoreRateSlo(0.05, slo)).toBe(1);
  });

  test("rates above the maximum burn the whole budget", () => {
    expect(scoreRateSlo(0.5, slo)).toBe(0);
    expect(scoreRateSlo(2, slo)).toBe(0);
  });

  test("the middle of the budget degrades smoothly", () => {
    expect(scoreRateSlo(0.275, slo)).toBeCloseTo(0.5, 5);
  });
});

test("componentStatusFromScore maps scores onto the status vocabulary", () => {
  expect(componentStatusFromScore(100)).toBe("operational");
  expect(componentStatusFromScore(90)).toBe("operational");
  expect(componentStatusFromScore(89.9)).toBe("degraded");
  expect(componentStatusFromScore(60)).toBe("degraded");
  expect(componentStatusFromScore(40)).toBe("partial_outage");
  expect(componentStatusFromScore(25)).toBe("partial_outage");
  expect(componentStatusFromScore(24.9)).toBe("major_outage");
  expect(componentStatusFromScore(0)).toBe("major_outage");
  expect(componentStatusFromScore(null)).toBe("unknown");
});

test("reportErrorRate counts unresolved, critical and unreconciled reports", () => {
  expect(reportErrorRate([])).toBe(0);

  const resolvedOnly: BugReport = {
    ...baseReport,
    id: "BR-2",
    priority: "low",
    status: "resolved",
    rewardStatus: "paid",
  };
  expect(reportErrorRate([resolvedOnly])).toBe(0);

  // One unresolved critical report out of one weighs 3x: unresolved + critical.
  expect(reportErrorRate([baseReport])).toBe(2);

  const drift: BugReport = {
    ...baseReport,
    id: "BR-3",
    priority: "low",
    status: "resolved",
    rewardStatus: "pending",
  };
  expect(reportErrorRate([resolvedOnly, drift])).toBe(0.5);
});

// ── report assembly ────────────────────────────────────────────────────────

const healthyProbes: ProbeOutcome[] = [
  { key: "stellar-rpc", ok: true, latencyMs: 120, statusCode: 200 },
  { key: "ipfs-gateway", ok: true, latencyMs: 400, statusCode: 200 },
  { key: "telemetry-websocket", ok: true, latencyMs: 90 },
];

function buildReport(probes: ProbeOutcome[], reports: readonly BugReport[] = []) {
  return buildOperationalHealthReport({ probes, reports, probesEnabled: true });
}

test("a healthy system scores 100 and reports every component", () => {
  const report = buildReport(healthyProbes);

  expect(report.score).toBe(100);
  expect(report.status).toBe("operational");
  expect(report.components.map((component) => component.key)).toEqual([
    "stellar-rpc",
    "ipfs-gateway",
    "telemetry-websocket",
    "error-rate",
  ]);
  expect(report.components.every((component) => component.status === "operational")).toBe(true);
  expect(report.probes).toEqual({ enabled: true, measured: 3, skipped: 0 });
  expect(report.degradedComponents).toEqual([]);
});

test("an RPC latency spike lowers the overall score", () => {
  const healthy = buildReport(healthyProbes);
  const spiking = buildReport([
    { key: "stellar-rpc", ok: true, latencyMs: 3000, statusCode: 200 },
    ...healthyProbes.slice(1),
  ]);

  expect(spiking.score).toBeLessThan(healthy.score);
  // (4000 - 3000) / (4000 - 600) = 29.4% of the RPC latency budget left.
  const rpc = spiking.components.find((component) => component.key === "stellar-rpc")!;
  expect(rpc.score).toBe(29.4);
  expect(rpc.status).toBe("partial_outage");
  expect(spiking.status).toBe("partial_outage");
  expect(spiking.degradedComponents).toContain("stellar-rpc");
  expect(rpc.message).toContain("3000ms");
});

test("a failing dependency takes the score to the floor", () => {
  const report = buildReport([
    { key: "stellar-rpc", ok: false, latencyMs: null, error: "ECONNREFUSED" },
    ...healthyProbes.slice(1),
  ]);

  const rpc = report.components.find((component) => component.key === "stellar-rpc")!;
  expect(rpc.score).toBe(0);
  expect(rpc.status).toBe("major_outage");
  expect(rpc.message).toBe("ECONNREFUSED");
  // A dead critical dependency cannot be averaged away by healthy ones.
  expect(report.status).toBe("major_outage");
  expect(report.score).toBe(65);
});

test("components that cannot be measured are excluded, not scored as zero", () => {
  const report = buildReport([
    { key: "stellar-rpc", ok: true, latencyMs: 120, statusCode: 200 },
    { key: "ipfs-gateway", ok: false, latencyMs: null, skipped: true, error: "Probe is not configured" },
    { key: "telemetry-websocket", ok: false, latencyMs: null, skipped: true, error: "No telemetry WebSocket URL configured" },
  ]);

  expect(report.probes).toEqual({ enabled: true, measured: 1, skipped: 2 });
  const skipped = report.components.filter((component) => component.status === "unknown");
  expect(skipped.map((component) => component.key)).toEqual([
    "ipfs-gateway",
    "telemetry-websocket",
  ]);
  expect(skipped.every((component) => component.score === null)).toBe(true);
  // Only the RPC and error-rate components carry weight here.
  expect(report.score).toBe(100);
  expect(report.status).toBe("operational");
  expect(report.degradedComponents).toEqual([]);
});

test("an incident backlog degrades the score without any probe", () => {
  const report = buildOperationalHealthReport({
    reports: [baseReport, baseReport, baseReport, baseReport],
    probes: [
      { key: "stellar-rpc", ok: false, latencyMs: null, skipped: true },
      { key: "ipfs-gateway", ok: false, latencyMs: null, skipped: true },
      { key: "telemetry-websocket", ok: false, latencyMs: null, skipped: true },
    ],
    probesEnabled: true,
  });

  const errorRate = report.components.find((component) => component.key === "error-rate")!;
  expect(reportErrorRate([baseReport, baseReport, baseReport, baseReport])).toBe(2);
  expect(errorRate.score).toBe(0);
  expect(errorRate.status).toBe("major_outage");
  expect(report.score).toBe(0);
  expect(report.status).toBe("major_outage");
  expect(report.degradedComponents).toEqual(["error-rate"]);
});

test("weights are configurable and normalised across measurable components", () => {
  const report = buildOperationalHealthReport({
    probes: [
      { key: "stellar-rpc", ok: true, latencyMs: 120, statusCode: 200 },
      { key: "ipfs-gateway", ok: false, latencyMs: null, error: "HTTP 503" },
      { key: "telemetry-websocket", ok: true, latencyMs: 90, skipped: true },
    ],
    reports: [],
    probesEnabled: true,
    weights: { "ipfs-gateway": 1, "stellar-rpc": 1, "error-rate": 0 },
  });

  // 100 (rpc) and 0 (ipfs) at equal weight, the skipped socket and the
  // zero-weighted error rate contribute nothing.
  expect(report.score).toBe(50);
  expect(report.weights["ipfs-gateway"]).toBe(1);
});

// ── status page payloads ───────────────────────────────────────────────────

describe("status page payloads", () => {
  const report: OperationalHealthReport = buildReport([
    { key: "stellar-rpc", ok: true, latencyMs: 120, statusCode: 200 },
    { key: "ipfs-gateway", ok: false, latencyMs: null, error: "HTTP 503" },
    { key: "telemetry-websocket", ok: false, latencyMs: null, skipped: true },
  ]);

  test("Statuspage payload uses the indicator and component vocabularies", () => {
    const payload = toStatuspagePayload(report, "Trellis Status");

    expect(payload.status.indicator).toBe("minor");
    expect(payload.page.name).toBe("Trellis Status");
    expect(payload.page.updated_at).toBe(report.generatedAt);
    expect(payload.status.description).toContain("health 75%");
    expect(payload.status.description).toContain("3/4 components measured");

    const byId = Object.fromEntries(
      payload.components.map((component) => [component.id, component]),
    );
    expect(byId["stellar-rpc"].status).toBe("operational");
    // The gateway answered 503: down, but not critical enough to force the
    // aggregate status on its own — it pulls the score to 75%.
    expect(byId["ipfs-gateway"].status).toBe("major_outage");
    expect(byId["error-rate"].status).toBe("operational");
    // Unmeasurable components are not published to a status page.
    expect(byId["telemetry-websocket"]).toBeUndefined();
    expect(payload.components.map((component) => component.position)).toEqual([1, 2, 3]);
  });

  test("Better Stack payload summarises components and status", () => {
    const payload = toBetterStackPayload(report);

    expect(payload.status).toBe("degraded");
    expect(payload.score).toBe(report.score);
    expect(payload.checked_at).toBe(report.generatedAt);
    expect(payload.summary).toContain("health 75%");
    expect(payload.summary).toContain("3/4 measured components");
    expect(payload.components.find((component) => component.name === "IPFS gateway")).toMatchObject({
      status: "down",
      latency_ms: null,
    });
    expect(payload.components.find((component) => component.name === "Telemetry WebSocket")!.status).toBe("unknown");
  });

  test("a total outage maps onto the worst indicators", () => {
    const outage = buildReport([
      { key: "stellar-rpc", ok: false, latencyMs: null, error: "down" },
      { key: "ipfs-gateway", ok: false, latencyMs: null, error: "down" },
      { key: "telemetry-websocket", ok: false, latencyMs: null, error: "down" },
    ]);

    expect(outage.score).toBe(25);
    expect(toStatuspagePayload(outage).status.indicator).toBe("critical");
    expect(toBetterStackPayload(outage).status).toBe("down");
  });
});

// ── probes ─────────────────────────────────────────────────────────────────

function response(status: number): Response {
  return { status } as Response;
}

describe("probeHttpEndpoint", () => {
  test("measures a healthy endpoint", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200));
    const result = await probeHttpEndpoint("https://rpc.example", {
      timeoutMs: 200,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).not.toBeNull();
    expect(result.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rpc.example",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  test("treats a server error as unhealthy but a 4xx as reachable", async () => {
    const failing = await probeHttpEndpoint("https://rpc.example", {
      timeoutMs: 200,
      fetchImpl: jest.fn().mockResolvedValue(response(503)) as unknown as typeof fetch,
    });
    expect(failing).toMatchObject({ ok: false, statusCode: 503, error: "HTTP 503" });

    const clientError = await probeHttpEndpoint("https://rpc.example", {
      timeoutMs: 200,
      fetchImpl: jest.fn().mockResolvedValue(response(404)) as unknown as typeof fetch,
    });
    expect(clientError.ok).toBe(true);
  });

  test("reports a timeout instead of hanging", async () => {
    const hangingFetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const result = await probeHttpEndpoint("https://rpc.example", {
      timeoutMs: 10,
      fetchImpl: hangingFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Timed out after 10ms");
    expect(result.latencyMs).toBeNull();
  });

  test("surfaces a connection failure", async () => {
    const result = await probeHttpEndpoint("https://rpc.example", {
      timeoutMs: 200,
      fetchImpl: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ ok: false, error: "ECONNREFUSED" });
  });
});

class FakeSocket implements WebSocketLike {
  static behaviour: "open" | "error" | "silent" = "open";
  static closed = 0;

  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(public readonly url: string) {
    // Real sockets settle asynchronously, after the probe attaches handlers.
    setTimeout(() => {
      if (FakeSocket.behaviour === "open") {
        this.onopen?.({});
      } else if (FakeSocket.behaviour === "error") {
        this.onerror?.({});
      }
    }, 0);
  }

  close(): void {
    FakeSocket.closed += 1;
  }
}

describe("probeWebSocketEndpoint", () => {
  beforeEach(() => {
    FakeSocket.behaviour = "open";
    FakeSocket.closed = 0;
  });

  test("a completed handshake is healthy and the socket is closed", async () => {
    const result = await probeWebSocketEndpoint("wss://telemetry.example", {
      timeoutMs: 500,
      WebSocketImpl: FakeSocket as unknown as WebSocketFactory,
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.unavailable).toBeUndefined();
    expect(FakeSocket.closed).toBe(1);
  });

  test("a failed handshake is unhealthy", async () => {
    FakeSocket.behaviour = "error";

    const result = await probeWebSocketEndpoint("wss://telemetry.example", {
      timeoutMs: 500,
      WebSocketImpl: FakeSocket as unknown as WebSocketFactory,
    });

    expect(result).toMatchObject({ ok: false, error: "Connection error" });
  });

  test("a socket that never opens times out", async () => {
    FakeSocket.behaviour = "silent";

    const result = await probeWebSocketEndpoint("wss://telemetry.example", {
      timeoutMs: 20,
      WebSocketImpl: FakeSocket as unknown as WebSocketFactory,
    });

    expect(result).toMatchObject({ ok: false, error: "Timed out after 20ms" });
  });

  test("a constructor that throws is reported, not rethrown", async () => {
    const Throwing = function ThrowingSocket() {
      throw new Error("Invalid URL");
    } as unknown as WebSocketFactory;

    const result = await probeWebSocketEndpoint("wss://bad.example", {
      timeoutMs: 100,
      WebSocketImpl: Throwing,
    });

    expect(result).toMatchObject({ ok: false, error: "Invalid URL" });
  });
});

describe("probe configuration", () => {
  test("probes are on by default and can be switched off", () => {
    expect(healthProbesEnabled({})).toBe(true);
    expect(healthProbesEnabled({ OPERATIONAL_HEALTH_PROBES: "off" })).toBe(false);
    expect(healthProbesEnabled({ OPERATIONAL_HEALTH_PROBES: "false" })).toBe(false);
    expect(healthProbesEnabled({ OPERATIONAL_HEALTH_PROBES: "on" })).toBe(true);
  });

  test("the probe timeout falls back to a safe default", () => {
    expect(resolveProbeTimeoutMs({})).toBe(2500);
    expect(resolveProbeTimeoutMs({ OPERATIONAL_HEALTH_PROBE_TIMEOUT_MS: "500" })).toBe(500);
    expect(resolveProbeTimeoutMs({ OPERATIONAL_HEALTH_PROBE_TIMEOUT_MS: "abc" })).toBe(2500);
    expect(resolveProbeTimeoutMs({ OPERATIONAL_HEALTH_PROBE_TIMEOUT_MS: "-1" })).toBe(2500);
  });

  test("targets come from the environment with an IPFS default", () => {
    const targets = resolveProbeTargets({
      OPERATIONAL_HEALTH_RPC_URL: "https://rpc.example",
      OPERATIONAL_HEALTH_WS_URL: "wss://telemetry.example",
    });

    expect(targets.map((target) => target.key)).toEqual([
      "stellar-rpc",
      "ipfs-gateway",
      "telemetry-websocket",
    ]);
    expect(targets[0].url).toBe("https://rpc.example");
    expect(targets[1].url).toBe("https://ipfs.io/ipfs/");
    expect(targets[2].url).toBe("wss://telemetry.example");

    const withoutTelemetry = resolveProbeTargets({});
    expect(withoutTelemetry.map((target) => target.key)).toEqual([
      "stellar-rpc",
      "ipfs-gateway",
    ]);
  });

  test("runOperationalHealthProbes marks an unconfigured socket as skipped", async () => {
    const outcomes = await runOperationalHealthProbes({
      env: { OPERATIONAL_HEALTH_RPC_URL: "https://rpc.example" },
      fetchImpl: jest.fn().mockResolvedValue(response(200)) as unknown as typeof fetch,
      WebSocketImpl: FakeSocket as unknown as WebSocketFactory,
    });

    expect(outcomes.map((outcome) => outcome.key)).toEqual([
      "stellar-rpc",
      "ipfs-gateway",
      "telemetry-websocket",
    ]);
    expect(outcomes.filter((outcome) => !outcome.skipped).every((outcome) => outcome.ok)).toBe(true);
    expect(
      outcomes.find((outcome) => outcome.key === "telemetry-websocket")!.skipped,
    ).toBe(true);
  });

  test("a failing probe flows through to a lower score", async () => {
    const outcomes = await runOperationalHealthProbes({
      env: {
        OPERATIONAL_HEALTH_RPC_URL: "https://rpc.example",
        OPERATIONAL_HEALTH_WS_URL: "wss://telemetry.example",
      },
      fetchImpl: jest.fn().mockResolvedValue(response(503)) as unknown as typeof fetch,
      WebSocketImpl: FakeSocket as unknown as WebSocketFactory,
    });

    expect(
      outcomes
        .filter((outcome) => outcome.key !== "telemetry-websocket")
        .every((outcome) => !outcome.ok),
    ).toBe(true);

    const report = buildOperationalHealthReport({ reports: [], probes: outcomes, probesEnabled: true });
    // Both HTTP dependencies are down; the socket is up and nothing is in the
    // incident backlog, so the blend lands at 45% with a dead critical RPC.
    expect(report.score).toBe(45);
    expect(report.status).toBe("major_outage");
  });
});
