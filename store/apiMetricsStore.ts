import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistStorage } from './persistence';

interface ApiMetricsState {
  totalRequests: number;
  cacheHits: number;
  networkRequests: number;
  batchedRequests: number;
  lastRequestAt: string | null;
  hasHydrated: boolean;
}

interface ApiMetricsActions {
  recordRequest: (payload: {
    cacheHit: boolean;
    networkRequest: boolean;
    batched: boolean;
  }) => void;
  setHydrated: (hydrated: boolean) => void;
}

export type ApiMetricsStore = ApiMetricsState & ApiMetricsActions;

const initialApiMetricsState: ApiMetricsState = {
  totalRequests: 0,
  cacheHits: 0,
  networkRequests: 0,
  batchedRequests: 0,
  lastRequestAt: null,
  hasHydrated: false,
};

export const useApiMetricsStore = create<ApiMetricsStore>()(
  persist(
    (set) => ({
      ...initialApiMetricsState,
      recordRequest: ({ cacheHit, networkRequest, batched }) =>
        set((state) => ({
          totalRequests: state.totalRequests + 1,
          cacheHits: state.cacheHits + (cacheHit ? 1 : 0),
          networkRequests: state.networkRequests + (networkRequest ? 1 : 0),
          batchedRequests: state.batchedRequests + (batched ? 1 : 0),
          lastRequestAt: new Date().toISOString(),
        })),
      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'trellis-api-metrics-store',
      version: 1,
      storage: createPersistStorage(),
      partialize: (state) => ({
        totalRequests: state.totalRequests,
        cacheHits: state.cacheHits,
        networkRequests: state.networkRequests,
        batchedRequests: state.batchedRequests,
        lastRequestAt: state.lastRequestAt,
      }),
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return initialApiMetricsState;
        }

        const state = persistedState as Partial<ApiMetricsState>;
        const nextState: ApiMetricsState = {
          totalRequests: typeof state.totalRequests === 'number' ? state.totalRequests : 0,
          cacheHits: typeof state.cacheHits === 'number' ? state.cacheHits : 0,
          networkRequests:
            typeof state.networkRequests === 'number' ? state.networkRequests : 0,
          batchedRequests:
            typeof state.batchedRequests === 'number' ? state.batchedRequests : 0,
          lastRequestAt:
            typeof state.lastRequestAt === 'string' ? state.lastRequestAt : null,
          hasHydrated: false,
        };

        if (version <= 0) {
          return nextState;
        }

        return nextState;
      },
      onRehydrateStorage: () => () => {
        useApiMetricsStore.setState({ hasHydrated: true });
      },
    },
  ),
);
