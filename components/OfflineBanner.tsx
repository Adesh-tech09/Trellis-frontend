'use client';

import { useCallback, useEffect, useState } from 'react';
import PWAManager, {
  OFFLINE_QUEUE_CHANGE_EVENT,
  OFFLINE_QUEUE_SYNCED_EVENT,
  type FlushOfflineQueueResult,
} from '@/lib/pwa-utils';
import { usePWA } from '@/hooks/usePWA';

const SYNCED_MESSAGE_TIMEOUT_MS = 6000;

/**
 * Informs the user when the app is running from cached data and when mutations
 * made offline (bug reports, feedback, ...) are queued for delivery.
 *
 * Reads the queue size from `PWAManager` and reacts to the `offline-queue-change`
 * / `offline-queue-synced` events so the count stays in sync with the service
 * worker driven replays.
 */
export default function OfflineBanner() {
  const { isOnline } = usePWA();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(0);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await PWAManager.getInstance().getPendingSubmissionCount());
    } catch {
      setPending(0);
    }
  }, []);

  useEffect(() => {
    const manager = PWAManager.getInstance();
    manager.setupBackgroundSync();
    void refreshPending();

    const handleQueueChange = (event: Event) => {
      const detail = (event as CustomEvent<{ pending?: number }>).detail;
      setPending(typeof detail?.pending === 'number' ? detail.pending : 0);
    };

    const handleSynced = (event: Event) => {
      const detail = (event as CustomEvent<FlushOfflineQueueResult>).detail;
      setSyncing(false);
      setSynced(detail?.synced?.length ?? 0);
      void refreshPending();
    };

    window.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleQueueChange);
    window.addEventListener(OFFLINE_QUEUE_SYNCED_EVENT, handleSynced);

    return () => {
      window.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleQueueChange);
      window.removeEventListener(OFFLINE_QUEUE_SYNCED_EVENT, handleSynced);
    };
  }, [refreshPending]);

  // Clear the "synced" confirmation after a moment so it does not linger.
  useEffect(() => {
    if (synced === 0) {
      return;
    }

    const timeout = setTimeout(() => setSynced(0), SYNCED_MESSAGE_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [synced]);

  const syncNow = useCallback(async () => {
    setSyncing(true);

    try {
      await PWAManager.getInstance().flushOfflineSubmissions();
    } finally {
      setSyncing(false);
      void refreshPending();
    }
  }, [refreshPending]);

  const showSyncedMessage = isOnline && pending === 0 && synced > 0;

  if (isOnline && pending === 0 && !showSyncedMessage) {
    return null;
  }

  return (
    <div
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-trellis-vine/40 bg-trellis-deep/95 px-4 py-3 text-sm text-white shadow-lg backdrop-blur md:left-1/2 md:right-auto md:-translate-x-1/2"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          isOnline ? 'bg-trellis-leaf' : 'bg-trellis-amber'
        }`}
      />

      <div className="flex-1">
        {!isOnline && (
          <p>
            <span className="font-medium">You&apos;re offline.</span> Showing cached content.
          </p>
        )}

        {pending > 0 && (
          <p className={isOnline ? undefined : 'mt-0.5 text-xs text-white/70'}>
            {pending} offline {pending === 1 ? 'change' : 'changes'} waiting to sync
            {isOnline ? '' : ' — will send automatically when you reconnect'}.
          </p>
        )}

        {showSyncedMessage && (
          <p>
            {synced} offline {synced === 1 ? 'change' : 'changes'} synced.
          </p>
        )}
      </div>

      {isOnline && pending > 0 && (
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="shrink-0 rounded-lg border border-trellis-leaf/50 px-3 py-1 text-xs font-medium text-trellis-leaf transition hover:bg-trellis-leaf/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}

      {showSyncedMessage && (
        <button
          type="button"
          onClick={() => setSynced(0)}
          aria-label="Dismiss offline sync notification"
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-white/60 transition hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  );
}
