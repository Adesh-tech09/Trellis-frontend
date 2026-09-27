import { NextResponse } from "next/server";
import { getBugReports } from "@/app/api/bug-reports/route";
import {
  buildOperationalHealthReport,
  toBetterStackPayload,
  toStatuspagePayload,
} from "@/lib/operational-health";
import {
  healthProbesEnabled,
  runOperationalHealthProbes,
  type ProbeEnvironment,
} from "@/lib/operational-health-probes";

// A status feed has to report the moment it is asked, so nothing here is cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_FORMATS = ["json", "statuspage", "betterstack"] as const;
type HealthFormat = (typeof SUPPORTED_FORMATS)[number];

const DISABLED_FLAGS = ["0", "false", "off", "no"];

function readProbeEnvironment(): ProbeEnvironment {
  return {
    OPERATIONAL_HEALTH_RPC_URL: process.env.OPERATIONAL_HEALTH_RPC_URL,
    OPERATIONAL_HEALTH_IPFS_GATEWAY_URL:
      process.env.OPERATIONAL_HEALTH_IPFS_GATEWAY_URL,
    OPERATIONAL_HEALTH_WS_URL: process.env.OPERATIONAL_HEALTH_WS_URL,
    OPERATIONAL_HEALTH_PROBE_TIMEOUT_MS:
      process.env.OPERATIONAL_HEALTH_PROBE_TIMEOUT_MS,
    OPERATIONAL_HEALTH_PROBES: process.env.OPERATIONAL_HEALTH_PROBES,
    NEXT_PUBLIC_TELEMETRY_WS_URL: process.env.NEXT_PUBLIC_TELEMETRY_WS_URL,
  };
}

/**
 * Operational health for maintainers and status monitors.
 *
 * `GET /api/operational-health`                   → full report: overall score,
 *                                                   per-component breakdown, the
 *                                                   incident categories already
 *                                                   returned by this route.
 * `GET /api/operational-health?format=statuspage` → Statuspage-shaped summary.
 * `GET /api/operational-health?format=betterstack`→ Better Stack heartbeat.
 * `?probe=0` skips the live probes (and `OPERATIONAL_HEALTH_PROBES=off` does it
 * for every request), so the endpoint stays usable with no outbound access.
 */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const format = (searchParams.get("format") ?? "json").toLowerCase();

  if (!SUPPORTED_FORMATS.includes(format as HealthFormat)) {
    return NextResponse.json(
      {
        error: `Unsupported format "${format}"`,
        supported: SUPPORTED_FORMATS,
      },
      { status: 400 },
    );
  }

  const environment = readProbeEnvironment();
  const probeFlag = searchParams.get("probe");
  const probesEnabled =
    probeFlag === null
      ? healthProbesEnabled(environment)
      : !DISABLED_FLAGS.includes(probeFlag.trim().toLowerCase());

  const probes = probesEnabled
    ? await runOperationalHealthProbes({ env: environment })
    : undefined;

  const report = buildOperationalHealthReport({
    reports: getBugReports(),
    probes,
    probesEnabled,
  });

  const body =
    format === "statuspage"
      ? toStatuspagePayload(report)
      : format === "betterstack"
        ? toBetterStackPayload(report)
        : report;

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
