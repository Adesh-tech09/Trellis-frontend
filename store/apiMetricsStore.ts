import { create } from 'zustand';
import {
  DEFAULT_ALERT_RULES,
  type AlertRule,
  type ExceptionEvent,
} from '@/lib/operational-health';

/** Bound the in-memory exception buffer so a long session cannot grow unbounded. */
const MAX_EXCEPTION_EVENTS = 500;

interface ApiMetricsState {
  totalRequests: number;
  cacheHits: number;
  networkRequests: number;
  batchedRequests: number;
  lastRequestAt: string | null;
  exceptionEvents: ExceptionEvent[];
  alertRules: AlertRule[];
}

interface ApiMetricsActions {
  recordRequest: (payload: {
    cacheHit: boolean;
    networkRequest: boolean;
    batched: boolean;
  }) => void;
  /** Appends one or more sanitized exceptions, keeping the newest 500. */
  recordException: (event: ExceptionEvent | ExceptionEvent[]) => void;
  /** Replaces the buffer, e.g. after hydrating from `/api/operational-health`. */
  setExceptionEvents: (events: ExceptionEvent[]) => void;
  clearExceptions: () => void;
  /** Upserts a maintainer alert rule by id. */
  addAlertRule: (rule: AlertRule) => void;
  removeAlertRule: (ruleId: string) => void;
  setAlertRules: (rules: AlertRule[]) => void;
}

export type ApiMetricsStore = ApiMetricsState & ApiMetricsActions;

export const useApiMetricsStore = create<ApiMetricsStore>((set) => ({
  totalRequests: 0,
  cacheHits: 0,
  networkRequests: 0,
  batchedRequests: 0,
  lastRequestAt: null,
  exceptionEvents: [],
  alertRules: [...DEFAULT_ALERT_RULES],
  recordRequest: ({ cacheHit, networkRequest, batched }) =>
    set((state) => ({
      totalRequests: state.totalRequests + 1,
      cacheHits: state.cacheHits + (cacheHit ? 1 : 0),
      networkRequests: state.networkRequests + (networkRequest ? 1 : 0),
      batchedRequests: state.batchedRequests + (batched ? 1 : 0),
      lastRequestAt: new Date().toISOString(),
    })),
  recordException: (event) =>
    set((state) => {
      const incoming = Array.isArray(event) ? event : [event];
      const merged = [...state.exceptionEvents, ...incoming]
        .sort((a, b) => a.ts - b.ts)
        .slice(-MAX_EXCEPTION_EVENTS);
      return { exceptionEvents: merged };
    }),
  setExceptionEvents: (events) =>
    set({ exceptionEvents: [...events].sort((a, b) => a.ts - b.ts).slice(-MAX_EXCEPTION_EVENTS) }),
  clearExceptions: () => set({ exceptionEvents: [] }),
  addAlertRule: (rule) =>
    set((state) => ({
      alertRules: state.alertRules.some((existing) => existing.id === rule.id)
        ? state.alertRules.map((existing) => (existing.id === rule.id ? rule : existing))
        : [...state.alertRules, rule],
    })),
  removeAlertRule: (ruleId) =>
    set((state) => ({ alertRules: state.alertRules.filter((rule) => rule.id !== ruleId) })),
  setAlertRules: (rules) => set({ alertRules: [...rules] }),
}));
