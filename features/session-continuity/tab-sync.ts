export type SessionSyncEvent = 'WALLET_DISCONNECTED' | 'NETWORK_CHANGED' | 'THEME_MUTATED';

export interface SessionSyncMessage {
  event: SessionSyncEvent;
  payload?: unknown;
  source: string;
  timestamp: number;
}

export function createSessionSyncMessage(event: SessionSyncEvent, payload: unknown, source: string): SessionSyncMessage {
  return { event, payload, source, timestamp: Date.now() };
}

export class SessionTabSync {
  private readonly channel: BroadcastChannel | null;
  private readonly source: string;
  private readonly listeners = new Set<(message: SessionSyncMessage) => void>();

  constructor(source = crypto.randomUUID()) {
    this.source = source;
    this.channel = typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('trellis-session-sync') : null;
    this.channel?.addEventListener('message', this.handleMessage);
  }

  private readonly handleMessage = (event: MessageEvent<SessionSyncMessage>) => {
    if (event.data?.source !== this.source) this.listeners.forEach((listener) => listener(event.data));
  };

  subscribe(listener: (message: SessionSyncMessage) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  publish(event: SessionSyncEvent, payload?: unknown) { const message = createSessionSyncMessage(event, payload, this.source); this.channel?.postMessage(message); return message; }

  close() { this.channel?.removeEventListener('message', this.handleMessage); this.channel?.close(); this.listeners.clear(); }
}
