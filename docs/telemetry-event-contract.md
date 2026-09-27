# Telemetry Event Contract

This document defines the minimum safe event shape for the existing client telemetry surface. It gives application features one shared contract for recording outcomes without turning telemetry into a source of user or wallet data.

## Required Fields

Every event includes:

| Field | Meaning |
| --- | --- |
| `id` | Unique event identifier. |
| `ts` | Event timestamp in milliseconds. |
| `agentRef` | Opaque, non-identifying actor reference. |
| `type` | `heartbeat`, `status`, `error`, `task_started`, or `task_completed`. |
| `severity` | `debug`, `info`, `warn`, `error`, or `critical`. |

The optional payload may contain only a correlation ID, operation kind, state, stable error code, and a human-safe message.

## Operation Names

Use stable, low-cardinality values for `taskKind`, such as `wallet_connect`, `wallet_sign`, `arena_load`, `transaction_submit`, or `data_refresh`. Do not include identifiers, route parameters, transaction XDR, request bodies, wallet addresses, or free-form user input in an operation name.

## Outcomes And Latency

For an operation that starts and completes, emit `task_started` and `task_completed` with the same opaque `correlationId`. Include a terminal `state` such as `succeeded`, `failed`, `cancelled`, or `timed_out`. The producer or dashboard may derive latency from the two timestamps; do not add unbounded timing labels.

Failures should use a stable `code` such as `wallet_unavailable`, `user_rejected`, `network_mismatch`, `rpc_unavailable`, or `request_timeout`. Error messages must be useful to operators while remaining safe to expose.

## Privacy Boundary

The telemetry sanitizer removes sensitive keys and redacts obvious email and long base64-like values. Producers must still avoid sending passwords, tokens, cookies, IP addresses, names, account IDs, addresses, public keys, private keys, raw transaction payloads, and stack traces. Sanitization is defense in depth, not permission to emit sensitive data.

## Metric Export (OTLP)

`lib/metric-definitions.ts` records client counters, histograms, and gauges through `OtlpMetricExporter`, which batches buffered points and POSTs OTLP/HTTP JSON to a collector.

| Variable | Purpose |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL; `/v1/metrics` is appended automatically. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Signal-specific override, used as-is. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` (default), `http/protobuf`, or `grpc`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated `key=value` collector headers. |
| `OTEL_SERVICE_NAME` | Resource `service.name` value. |
| `OTEL_METRIC_EXPORT_INTERVAL` | Batch interval in milliseconds (default 30000). |
| `OTEL_METRIC_ALLOW_UNSAFE` | `true` bypasses the `SAFE_METRICS` allow-list (local debugging only). |

The browser bundle only sees `NEXT_PUBLIC_*` variables, so client-side export uses `NEXT_PUBLIC_OTEL_EXPORTER_OTLP_*`. Omit the endpoint entirely to keep metrics local — the exporter then buffers without transmitting.

Batches use delta temporality: counters are encoded as monotonic sums, histograms carry explicit bucket bounds plus string bucket counts, and gauges carry the last observed value. Attribute keys failing `isFieldSafe` and metric names outside `SAFE_METRICS` are dropped before encoding, so exported batches stay inside the privacy boundary above.

The client always transmits OTLP/HTTP JSON. A `grpc` protocol value is treated as a transport hint for the collector setup and still goes over the HTTP endpoint; wire a real gRPC transport only if a collector requires it.

## Dashboard Queries

The primary operational views should group by `type`, `severity`, `taskKind`, `state`, and `code` only. These bounded dimensions support failure-rate and conversion analysis without creating a high-cardinality or personally identifying metric stream.