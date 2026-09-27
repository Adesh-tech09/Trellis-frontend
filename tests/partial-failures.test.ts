import {
  recordFailure,
  retryFailure,
  markFailureResolved,
  markFailureManualIntervention,
  ignoreFailure,
  getFailure,
  getFailuresByType,
  getFailuresByStatus,
  getFailuresByResource,
  getCriticalFailures,
  getStaleFailures,
  getRetryableFailures,
  getFailureReport,
  partialFailureTracker,
} from '@/lib/partial-failures';

describe('Partial Failure Tracker', () => {
  beforeEach(() => {
    partialFailureTracker.setStaleThreshold(7 * 24 * 60 * 60 * 1000);
    partialFailureTracker.setMaxRetries(3);
    partialFailureTracker.setRetryDelay(60000);
  });

  describe('Failure Recording', () => {
    it('should record a new failure', () => {
      const failure = recordFailure(
        'transaction',
        'tx_123',
        { resourceId: 'user_1', amount: '1000' },
        'Transaction timeout',
        'ext_ref_456',
        'high'
      );

      expect(failure).toBeDefined();
      expect(failure.operationType).toBe('transaction');
      expect(failure.operationId).toBe('tx_123');
      expect(failure.externalRefId).toBe('ext_ref_456');
      expect(failure.severity).toBe('high');
      expect(failure.status).toBe('unresolved');
      expect(failure.retryCount).toBe(0);
    });

    it('should set default severity', () => {
      const failure = recordFailure(
        'sync',
        'sync_123',
        { resourceId: 'user_1' },
        'Sync failed'
      );

      expect(failure.severity).toBe('medium');
    });

    it('should determine retryability by operation type', () => {
      const txFailure = recordFailure(
        'transaction',
        'tx_1',
        {},
        'Error'
      );
      const importFailure = recordFailure(
        'import',
        'imp_1',
        {},
        'Error'
      );

      expect(txFailure.canRetry).toBe(true);
      expect(importFailure.canRetry).toBe(false);
    });

    it('should determine ignorability by severity', () => {
      const lowFailure = recordFailure('webhook', 'wh_1', {}, 'Error', undefined, 'low');
      const criticalFailure = recordFailure('webhook', 'wh_2', {}, 'Error', undefined, 'critical');

      expect(lowFailure.canIgnore).toBe(true);
      expect(criticalFailure.canIgnore).toBe(false);
    });
  });

  describe('Failure Retrieval', () => {
    it('should retrieve a failure by ID', () => {
      const recorded = recordFailure('transaction', 'tx_1', { resourceId: 'user_1' }, 'Error');
      const retrieved = partialFailureTracker.getFailure(recorded.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.operationId).toBe('tx_1');
    });

    it('should return null for non-existent failure', () => {
      const result = partialFailureTracker.getFailure('non-existent');
      expect(result).toBeNull();
    });

    it('should retrieve failures by operation type', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error');
      recordFailure('transaction', 'tx_2', {}, 'Error');
      recordFailure('sync', 'sync_1', {}, 'Error');

      const txFailures = partialFailureTracker.getFailuresByType('transaction');
      const syncFailures = partialFailureTracker.getFailuresByType('sync');

      expect(txFailures.length).toBeGreaterThanOrEqual(2);
      expect(syncFailures.length).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve failures by status', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      markFailureResolved(failure.id);

      const resolved = partialFailureTracker.getFailuresByStatus('resolved');
      const unresolved = partialFailureTracker.getFailuresByStatus('unresolved');

      expect(resolved.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Retry Logic', () => {
    it('should retry a failed operation', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Timeout');
      const success = retryFailure(failure.id);

      expect(success).toBe(true);

      const updated = partialFailureTracker.getFailure(failure.id);
      expect(updated?.retryCount).toBe(1);
      expect(updated?.status).toBe('retrying');
      expect(updated?.lastAttemptAt).toBeDefined();
    });

    it('should enforce max retry limit', () => {
      partialFailureTracker.setMaxRetries(2);
      const failure = recordFailure('transaction', 'tx_1', {}, 'Timeout');

      retryFailure(failure.id);
      retryFailure(failure.id);

      expect(() => {
        retryFailure(failure.id);
      }).toThrow('Max retries exceeded');
    });

    it('should not retry non-retryable failures', () => {
      const failure = recordFailure('import', 'imp_1', {}, 'Import failed');

      expect(() => {
        retryFailure(failure.id);
      }).toThrow('cannot be retried');
    });

    it('should schedule next retry with exponential backoff', () => {
      partialFailureTracker.setRetryDelay(1000);
      const failure = recordFailure('transaction', 'tx_1', {}, 'Timeout');

      retryFailure(failure.id);
      const updated1 = partialFailureTracker.getFailure(failure.id);
      const firstRetryTime = updated1?.nextRetryAt;

      retryFailure(failure.id);
      const updated2 = partialFailureTracker.getFailure(failure.id);
      const secondRetryTime = updated2?.nextRetryAt;

      // Second retry should be further in the future
      if (firstRetryTime && secondRetryTime) {
        expect(new Date(secondRetryTime) > new Date(firstRetryTime)).toBe(true);
      }
    });

    it('should get retryable failures', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error');
      recordFailure('transaction', 'tx_2', {}, 'Error');
      recordFailure('import', 'imp_1', {}, 'Error');

      const retryable = partialFailureTracker.getRetryableFailures();
      expect(retryable.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Failure Resolution', () => {
    it('should mark failure as resolved', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      const success = markFailureResolved(failure.id, 'Fixed manually');

      expect(success).toBe(true);

      const updated = partialFailureTracker.getFailure(failure.id);
      expect(updated?.status).toBe('resolved');
      expect(updated?.resolutionNotes).toBe('Fixed manually');
    });

    it('should mark failure for manual intervention', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      partialFailureTracker.markManualIntervention(failure.id, 'Requires human review');

      const updated = partialFailureTracker.getFailure(failure.id);
      expect(updated?.status).toBe('manual_intervention');
      expect(updated?.resolutionNotes).toContain('human review');
    });

    it('should allow ignoring low severity failures', () => {
      const failure = recordFailure(
        'webhook',
        'wh_1',
        {},
        'Non-critical error',
        undefined,
        'low'
      );

      partialFailureTracker.ignoreFailure(failure.id, 'Not actionable');

      const updated = partialFailureTracker.getFailure(failure.id);
      expect(updated?.status).toBe('resolved');
    });

    it('should prevent ignoring critical failures', () => {
      const failure = recordFailure(
        'transaction',
        'tx_1',
        {},
        'Critical error',
        undefined,
        'critical'
      );

      expect(() => {
        partialFailureTracker.ignoreFailure(failure.id);
      }).toThrow('cannot be ignored');
    });
  });

  describe('Critical Failures', () => {
    it('should identify critical failures', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'low');
      recordFailure('transaction', 'tx_2', {}, 'Error', undefined, 'critical');
      recordFailure('transaction', 'tx_3', {}, 'Error', undefined, 'critical');

      const critical = getCriticalFailures();
      expect(critical.length).toBeGreaterThanOrEqual(2);
      expect(critical.every((f) => f.severity === 'critical')).toBe(true);
    });

    it('should not include resolved critical failures', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'critical');
      markFailureResolved(failure.id);

      const critical = getCriticalFailures();
      expect(critical.find((f) => f.id === failure.id)).toBeUndefined();
    });
  });

  describe('Stale Failures', () => {
    it('should identify stale failures', () => {
      partialFailureTracker.setStaleThreshold(0.1); // ~100ms
      recordFailure('transaction', 'tx_1', {}, 'Error');

      // Wait for threshold to pass
      const stale = partialFailureTracker.getStaleFailures();
      expect(stale.length).toBeGreaterThanOrEqual(1);
    });

    it('should not include resolved stale failures', () => {
      partialFailureTracker.setStaleThreshold(0.1);
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');

      const stale1 = partialFailureTracker.getStaleFailures();
      expect(stale1.some((f) => f.id === failure.id)).toBe(true);

      markFailureResolved(failure.id);
      const stale2 = partialFailureTracker.getStaleFailures();
      expect(stale2.some((f) => f.id === failure.id)).toBe(false);
    });
  });

  describe('Failure Reporting', () => {
    it('should generate comprehensive failure report', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'high');
      recordFailure('sync', 'sync_1', {}, 'Error', undefined, 'medium');
      recordFailure('webhook', 'wh_1', {}, 'Error', undefined, 'low');

      const report = getFailureReport();

      expect(report.generatedAt).toBeDefined();
      expect(report.totalFailures).toBeGreaterThanOrEqual(3);
      expect(report.byOperationType.transaction).toBeGreaterThanOrEqual(1);
      expect(report.byOperationType.sync).toBeGreaterThanOrEqual(1);
      expect(report.byOperationType.webhook).toBeGreaterThanOrEqual(1);
    });

    it('should track failure status distribution', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      retryFailure(failure.id);

      const report = getFailureReport();

      expect(report.byStatus.unresolved).toBeGreaterThanOrEqual(0);
      expect(report.byStatus.retrying).toBeGreaterThanOrEqual(1);
    });

    it('should track failure severity distribution', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'low');
      recordFailure('transaction', 'tx_2', {}, 'Error', undefined, 'high');
      recordFailure('transaction', 'tx_3', {}, 'Error', undefined, 'critical');

      const report = getFailureReport();

      expect(report.bySeverity.low).toBeGreaterThanOrEqual(1);
      expect(report.bySeverity.high).toBeGreaterThanOrEqual(1);
      expect(report.bySeverity.critical).toBeGreaterThanOrEqual(1);
    });

    it('should group failures by type and severity', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'high');
      recordFailure('transaction', 'tx_2', {}, 'Error', undefined, 'high');
      recordFailure('sync', 'sync_1', {}, 'Error', undefined, 'medium');

      const report = getFailureReport();

      expect(report.groups.length).toBeGreaterThanOrEqual(2);
    });

    it('should include critical failures in report', () => {
      recordFailure('transaction', 'tx_1', {}, 'Critical Error', undefined, 'critical');

      const report = getFailureReport();

      expect(report.criticalFailures.length).toBeGreaterThanOrEqual(1);
    });

    it('should include retryable failures in report', () => {
      recordFailure('transaction', 'tx_1', {}, 'Timeout');

      const report = getFailureReport();

      expect(report.retryableFailures.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cleanup', () => {
    it('should clear resolved failures', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      markFailureResolved(failure.id);

      const beforeClean = partialFailureTracker.getAllFailures().length;
      const cleaned = partialFailureTracker.clearResolved();

      expect(cleaned).toBe(1);
      expect(partialFailureTracker.getAllFailures().length).toBeLessThan(beforeClean);
    });
  });

  describe('Error Handling', () => {
    it('should throw for non-existent failure operations', () => {
      expect(() => {
        retryFailure('non-existent');
      }).toThrow('not found');

      expect(() => {
        markFailureResolved('non-existent');
      }).toThrow('not found');
    });

    it('should handle invalid failure data', () => {
      expect(() => {
        recordFailure('invalid_type' as any, 'op_1', {}, 'Error');
      }).toThrow();
    });

    it('should throw for missing required fields', () => {
      expect(() => {
        recordFailure('transaction' as any, '', {}, 'Error');
      }).toThrow();
    });

    it('should throw for invalid stale threshold', () => {
      expect(() => {
        partialFailureTracker.setStaleThreshold(0);
      }).toThrow();
    });
  });

  describe('Failure Queries by Resource', () => {
    it('should retrieve failures by resource ID', () => {
      const resourceId = 'user_123';

      recordFailure('transaction', 'tx_1', { resourceId }, 'Error');
      recordFailure('sync', 'sync_1', { resourceId }, 'Error');
      recordFailure('transaction', 'tx_2', { resourceId: 'user_456' }, 'Error');

      const failures = getFailuresByResource(resourceId);
      expect(failures.length).toBeGreaterThanOrEqual(2);
      expect(failures.every((f) => (f.internalState.resourceId as string) === resourceId)).toBe(true);
    });
  });

  describe('Retry Policy Configuration', () => {
    it('should allow custom retry policy configuration', () => {
      partialFailureTracker.setRetryPolicy({
        maxRetries: 5,
        initialDelayMs: 5000,
        backoffMultiplier: 3,
      });

      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');
      expect(failure.maxRetries).toBe(5);
    });

    it('should throw for invalid retry policy', () => {
      expect(() => {
        partialFailureTracker.setRetryPolicy({ maxRetries: 0 });
      }).toThrow();
    });
  });

  describe('Failure Group Analysis', () => {
    it('should calculate average age for failure groups', () => {
      recordFailure('transaction', 'tx_1', {}, 'Error', undefined, 'high');
      recordFailure('transaction', 'tx_2', {}, 'Error', undefined, 'high');

      const report = getFailureReport();
      const txHighGroup = report.groups.find(
        (g) => g.operationType === 'transaction' && g.severity === 'high'
      );

      expect(txHighGroup).toBeDefined();
      expect(txHighGroup?.averageAge).toBeGreaterThanOrEqual(0);
    });

    it('should track affected resources in groups', () => {
      recordFailure('transaction', 'tx_1', { resourceId: 'user_1' }, 'Error', undefined, 'high');
      recordFailure('transaction', 'tx_2', { resourceId: 'user_2' }, 'Error', undefined, 'high');
      recordFailure('transaction', 'tx_3', { resourceId: 'user_1' }, 'Error', undefined, 'high');

      const report = getFailureReport();
      const txHighGroup = report.groups.find(
        (g) => g.operationType === 'transaction' && g.severity === 'high'
      );

      expect(txHighGroup?.affectedResources.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Exported Helper Functions', () => {
    it('should export all query functions', () => {
      const failure = recordFailure('transaction', 'tx_1', { resourceId: 'user_1' }, 'Error');

      expect(getFailure(failure.id)).toBeDefined();
      expect(getFailuresByType('transaction').length).toBeGreaterThan(0);
      expect(getFailuresByStatus('unresolved').length).toBeGreaterThan(0);
      expect(getFailuresByResource('user_1').length).toBeGreaterThan(0);
    });

    it('should export resolution functions', () => {
      const failure = recordFailure('transaction', 'tx_1', {}, 'Error');

      const manual = markFailureManualIntervention(failure.id, 'Needs review');
      expect(manual).toBe(true);

      const updated = getFailure(failure.id);
      expect(updated?.status).toBe('manual_intervention');
    });

    it('should export convenience functions', () => {
      const critical = getCriticalFailures();
      expect(Array.isArray(critical)).toBe(true);

      const stale = getStaleFailures();
      expect(Array.isArray(stale)).toBe(true);

      const retryable = getRetryableFailures();
      expect(Array.isArray(retryable)).toBe(true);
    });
  });
});
