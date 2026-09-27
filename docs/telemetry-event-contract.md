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

## Dashboard Queries

The primary operational views should group by `type`, `severity`, `taskKind`, `state`, and `code` only. These bounded dimensions support failure-rate and conversion analysis without creating a high-cardinality or personally identifying metric stream.

## Transports

The dashboard prefers an unordered, unreliable WebRTC data channel (`ordered: false`, `maxRetransmits: 0`) because a
stale metric tick must never delay the ticks behind it. The existing WebSocket stream remains the transport whenever
WebRTC is unsupported, ICE does not complete, or no producer peer is connected, so the event contract above is
identical on both paths.

Connection state, the active transport, and the reason for any fallback are exposed by `useTelemetryStream` (and its
`useTelemetryWebSocket` compatibility wrapper). Configuration lives in `NEXT_PUBLIC_TELEMETRY_WEBRTC`,
`NEXT_PUBLIC_TELEMETRY_STUN_URLS`, `NEXT_PUBLIC_TELEMETRY_TURN_URL`, and `NEXT_PUBLIC_TELEMETRY_ICE_SERVERS`.
