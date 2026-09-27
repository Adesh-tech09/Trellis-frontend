/**
 * Pure connection-state machine for the agent telemetry transport.
 *
 * This module deliberately has **no** DOM, WebSocket, or WebRTC references so the
 * negotiation and fallback transitions can be reasoned about (and unit tested,
 * including under plain Node) without a browser. `telemetryTransport.ts` owns all
 * I/O and feeds events into this machine.
 */

export type TelemetryTransportKind = 'webrtc' | 'websocket';

export type TelemetryConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'negotiating'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

/**
 * Why the client left the WebRTC path. `null` means the preferred transport is
 * still (or was) in use.
 */
export type TelemetryFallbackReason =
  | 'webrtc-unsupported'
  | 'webrtc-disabled'
  | 'signaling-failed'
  | 'no-peer'
  | 'ice-failed'
  | 'channel-timeout'
  | 'channel-closed'
  | 'datachannel-error';

export interface TelemetryConnectionState {
  status: TelemetryConnectionStatus;
  /** Active transport, or `null` while connecting / after close. */
  transport: TelemetryTransportKind | null;
  fallbackReason: TelemetryFallbackReason | null;
  /** Number of times the transport fell back from WebRTC to WebSocket. */
  fallbacks: number;
  /** Number of connection attempts (start + reconnects). */
  attempts: number;
  lastError: string | null;
  updatedAt: number;
}

export type TelemetryConnectionEvent =
  | { type: 'start'; now: number }
  | { type: 'negotiate'; now: number }
  | { type: 'webrtc-open'; now: number }
  | { type: 'websocket-open'; now: number }
  | { type: 'fallback'; reason: TelemetryFallbackReason; now: number }
  | { type: 'reconnect'; now: number }
  | { type: 'error'; message: string; now: number }
  | { type: 'close'; now: number }
  | { type: 'dispose'; now: number };

export function initialTelemetryConnectionState(now = 0): TelemetryConnectionState {
  return {
    status: 'idle',
    transport: null,
    fallbackReason: null,
    fallbacks: 0,
    attempts: 0,
    lastError: null,
    updatedAt: now,
  };
}

/**
 * Pure reducer. Returns a new state object; never mutates the input.
 *
 * Transition table:
 *
 * | event           | from                              | to                              |
 * | --------------- | --------------------------------- | ------------------------------- |
 * | start           | any                               | connecting (attempts + 1)       |
 * | negotiate       | connecting, negotiating           | negotiating                     |
 * | webrtc-open     | any but closed                    | open / webrtc                   |
 * | websocket-open  | any but closed                    | open / websocket                |
 * | fallback        | any but closed                    | connecting (fallbacks + 1)      |
 * | reconnect       | any but closed                    | reconnecting (attempts + 1)     |
 * | error           | any but closed                    | error                           |
 * | close / dispose | any                               | closed                          |
 *
 * Events that are invalid for the current state (for example `webrtc-open`
 * after `dispose`) are ignored so late socket/data-channel callbacks cannot
 * resurrect a torn-down transport.
 */
export function reduceTelemetryConnection(
  state: TelemetryConnectionState,
  event: TelemetryConnectionEvent
): TelemetryConnectionState {
  switch (event.type) {
    case 'start':
      return {
        ...state,
        status: 'connecting',
        transport: null,
        fallbackReason: null,
        attempts: state.attempts + 1,
        lastError: null,
        updatedAt: event.now,
      };
    case 'negotiate':
      if (state.status !== 'connecting' && state.status !== 'negotiating') return state;
      return { ...state, status: 'negotiating', transport: null, updatedAt: event.now };
    case 'webrtc-open':
      if (state.status === 'closed') return state;
      return {
        ...state,
        status: 'open',
        transport: 'webrtc',
        fallbackReason: null,
        lastError: null,
        updatedAt: event.now,
      };
    case 'websocket-open':
      if (state.status === 'closed') return state;
      return {
        ...state,
        status: 'open',
        transport: 'websocket',
        lastError: null,
        updatedAt: event.now,
      };
    case 'fallback':
      if (state.status === 'closed') return state;
      return {
        ...state,
        status: 'connecting',
        transport: null,
        fallbackReason: event.reason,
        fallbacks: state.fallbacks + 1,
        updatedAt: event.now,
      };
    case 'reconnect':
      if (state.status === 'closed') return state;
      return {
        ...state,
        status: 'reconnecting',
        transport: null,
        fallbackReason: null,
        attempts: state.attempts + 1,
        lastError: null,
        updatedAt: event.now,
      };
    case 'error':
      if (state.status === 'closed') return state;
      return { ...state, status: 'error', lastError: event.message, updatedAt: event.now };
    case 'close':
      return { ...state, status: 'closed', transport: null, updatedAt: event.now };
    case 'dispose':
      return { ...state, status: 'closed', transport: null, updatedAt: event.now };
    default:
      return state;
  }
}

export function isTelemetryConnectionOpen(state: TelemetryConnectionState): boolean {
  return state.status === 'open';
}

/** Status union kept by the pre-existing dashboard hook, for a non-breaking swap. */
export type LegacyTelemetryStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** Collapse the richer machine status onto the dashboard's original status union. */
export function toLegacyTelemetryStatus(state: TelemetryConnectionState): LegacyTelemetryStatus {
  switch (state.status) {
    case 'open':
      return 'open';
    case 'error':
      return 'error';
    case 'closed':
      return 'closed';
    case 'connecting':
    case 'negotiating':
    case 'reconnecting':
      return 'connecting';
    default:
      return 'idle';
  }
}

export interface TelemetryConnectionMachine {
  getState(): TelemetryConnectionState;
  send(event: TelemetryConnectionEvent): TelemetryConnectionState;
  subscribe(listener: (state: TelemetryConnectionState) => void): () => void;
}

/** Small event-emitter wrapper around the reducer, used by `TelemetryTransport`. */
export function createTelemetryConnectionMachine(
  initial?: TelemetryConnectionState
): TelemetryConnectionMachine {
  let current = initial ?? initialTelemetryConnectionState();
  const listeners = new Set<(state: TelemetryConnectionState) => void>();

  return {
    getState: () => current,
    send(event) {
      current = reduceTelemetryConnection(current, event);
      for (const listener of listeners) listener(current);
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
