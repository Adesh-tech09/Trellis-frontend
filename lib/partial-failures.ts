import { z } from 'zod';

/**
 * Partial failure dashboard for background and external integrations
 * Tracks operations stuck between internal state and external systems
 */

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FailureStatus = 'unresolved' | 'retrying' | 'resolved' | 'manual_intervention';
export type OperationType = 'transaction' | 'sync' | 'webhook' | 'import' | 'export' | 'background_job';

export interface PartialFailure {
  id: string;
  operationType: OperationType;
  operationId: string;
  internalState: Record<string, unknown>;
  externalRefId?: string;
  errorMessage: string;
  severity: FailureSeverity;
  status: FailureStatus;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  resolutionNotes?: string;
  canRetry: boolean;
  canIgnore: boolean;
  diagnosticData?: Record<string, unknown>;
}

export interface FailureGroup {
  operationType: OperationType;
  count: number;
  severity: FailureSeverity;
  oldest: string;
  newest: string;
  affectedResources: Set<string>;
}

export interface FailureReport {
  generatedAt: string;
  totalFailures: number;
  byStatus: Record<FailureStatus, number>;
  bySeverity: Record<FailureSeverity, number>;
  byOperationType: Record<OperationType, number>;
  groups: FailureGroup[];
  criticalFailures: PartialFailure[];
  staleFailures: PartialFailure[];
  retryableFailures: PartialFailure[];
}

export const PartialFailureSchema = z.object({
  id: z.string().uuid(),
  operationType: z.enum(['transaction', 'sync', 'webhook', 'import', 'export', 'background_job']),
  operationId: z.string(),
  internalState: z.record(z.unknown()),
  externalRefId: z.string().optional(),
  errorMessage: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['unresolved', 'retrying', 'resolved', 'manual_intervention']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastAttemptAt: z.string().datetime().optional(),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().positive(),
  nextRetryAt: z.string().datetime().optional(),
  resolutionNotes: z.string().optional(),
  canRetry: z.boolean(),
  canIgnore: z.boolean(),
  diagnosticData: z.record(z.unknown()).optional(),
});

class PartialFailureTracker {
  private failures: Map<string, PartialFailure> = new Map();
  private failuresByType: Map<OperationType, string[]> = new Map();
  private failuresByResource: Map<string, string[]> = new Map();
  private staleAfterMs: number = 7 * 24 * 60 * 60 * 1000; // 7 days
  private maxRetries: number = 3;
  private retryDelayMs: number = 60000; // 1 minute

  setStaleThreshold(ms: number): void {
    this.staleAfterMs = ms;
  }

  setMaxRetries(max: number): void {
    this.maxRetries = max;
  }

  setRetryDelay(ms: number): void {
    this.retryDelayMs = ms;
  }

  recordFailure(
    operationType: OperationType,
    operationId: string,
    internalState: Record<string, unknown>,
    errorMessage: string,
    externalRefId?: string,
    severity: FailureSeverity = 'medium'
  ): PartialFailure {
    const now = new Date();
    const failure: PartialFailure = {
      id: this.generateId(),
      operationType,
      operationId,
      internalState,
      externalRefId,
      errorMessage,
      severity,
      status: 'unresolved',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      retryCount: 0,
      maxRetries: this.maxRetries,
      canRetry: this.isRetryable(operationType),
      canIgnore: this.isIgnorable(severity),
      diagnosticData: {
        stackTrace: 'auto-captured',
        environment: 'production',
      },
    };

    try {
      PartialFailureSchema.parse(failure);
    } catch (error) {
      throw new Error('Invalid failure data');
    }

    this.failures.set(failure.id, failure);

    // Track by type
    const typeFailures = this.failuresByType.get(operationType) || [];
    typeFailures.push(failure.id);
    this.failuresByType.set(operationType, typeFailures);

    // Track by resource
    const resourceId = (internalState.resourceId as string) || 'unknown';
    const resourceFailures = this.failuresByResource.get(resourceId) || [];
    resourceFailures.push(failure.id);
    this.failuresByResource.set(resourceId, resourceFailures);

    return failure;
  }

  getFailure(failureId: string): PartialFailure | null {
    return this.failures.get(failureId) || null;
  }

  retryFailure(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) {
      throw new Error('Failure not found');
    }

    if (failure.retryCount >= failure.maxRetries) {
      throw new Error('Max retries exceeded');
    }

    if (!failure.canRetry) {
      throw new Error('This failure cannot be retried');
    }

    failure.retryCount += 1;
    failure.status = 'retrying';
    failure.lastAttemptAt = new Date().toISOString();
    failure.updatedAt = new Date().toISOString();

    // Schedule next retry
    if (failure.retryCount < failure.maxRetries) {
      const nextRetryTime = new Date(
        Date.now() + this.retryDelayMs * Math.pow(2, failure.retryCount - 1) // Exponential backoff
      );
      failure.nextRetryAt = nextRetryTime.toISOString();
    }

    return true;
  }

  markResolved(failureId: string, notes?: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) {
      throw new Error('Failure not found');
    }

    failure.status = 'resolved';
    failure.resolutionNotes = notes;
    failure.updatedAt = new Date().toISOString();

    return true;
  }

  markManualIntervention(failureId: string, notes?: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) {
      throw new Error('Failure not found');
    }

    failure.status = 'manual_intervention';
    failure.resolutionNotes = notes || 'Marked for manual review';
    failure.updatedAt = new Date().toISOString();

    return true;
  }

  ignoreFailure(failureId: string, reason?: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) {
      throw new Error('Failure not found');
    }

    if (!failure.canIgnore) {
      throw new Error('Critical failures cannot be ignored');
    }

    failure.status = 'resolved';
    failure.resolutionNotes = reason || 'Ignored by operator';
    failure.updatedAt = new Date().toISOString();

    return true;
  }

  getFailuresByType(operationType: OperationType): PartialFailure[] {
    const failureIds = this.failuresByType.get(operationType) || [];
    return failureIds
      .map((id) => this.getFailure(id))
      .filter((failure) => failure !== null) as PartialFailure[];
  }

  getFailuresByStatus(status: FailureStatus): PartialFailure[] {
    return Array.from(this.failures.values()).filter((failure) => failure.status === status);
  }

  getCriticalFailures(): PartialFailure[] {
    return Array.from(this.failures.values()).filter(
      (failure) => failure.severity === 'critical' && failure.status !== 'resolved'
    );
  }

  getStaleFailures(beforeMs?: number): PartialFailure[] {
    const threshold = beforeMs || this.staleAfterMs;
    const now = Date.now();

    return Array.from(this.failures.values()).filter((failure) => {
      const age = now - new Date(failure.createdAt).getTime();
      return failure.status === 'unresolved' && age > threshold;
    });
  }

  getRetryableFailures(): PartialFailure[] {
    return Array.from(this.failures.values()).filter(
      (failure) =>
        failure.canRetry &&
        failure.retryCount < failure.maxRetries &&
        failure.status !== 'resolved'
    );
  }

  generateReport(): FailureReport {
    const now = new Date();
    const failures = Array.from(this.failures.values());

    const byStatus: Record<FailureStatus, number> = {
      unresolved: 0,
      retrying: 0,
      resolved: 0,
      manual_intervention: 0,
    };

    const bySeverity: Record<FailureSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    const byOperationType: Record<OperationType, number> = {
      transaction: 0,
      sync: 0,
      webhook: 0,
      import: 0,
      export: 0,
      background_job: 0,
    };

    failures.forEach((failure) => {
      byStatus[failure.status] += 1;
      bySeverity[failure.severity] += 1;
      byOperationType[failure.operationType] += 1;
    });

    // Group failures by type and severity
    const groups = this.groupFailures(failures);

    return {
      generatedAt: now.toISOString(),
      totalFailures: failures.length,
      byStatus,
      bySeverity,
      byOperationType,
      groups,
      criticalFailures: this.getCriticalFailures(),
      staleFailures: this.getStaleFailures(),
      retryableFailures: this.getRetryableFailures(),
    };
  }

  private groupFailures(failures: PartialFailure[]): FailureGroup[] {
    const groups = new Map<string, FailureGroup>();

    failures.forEach((failure) => {
      const key = `${failure.operationType}:${failure.severity}`;

      if (!groups.has(key)) {
        groups.set(key, {
          operationType: failure.operationType,
          count: 0,
          severity: failure.severity,
          oldest: failure.createdAt,
          newest: failure.updatedAt,
          affectedResources: new Set(),
        });
      }

      const group = groups.get(key)!;
      group.count += 1;

      if (failure.createdAt < group.oldest) {
        group.oldest = failure.createdAt;
      }
      if (failure.updatedAt > group.newest) {
        group.newest = failure.updatedAt;
      }

      const resourceId = (failure.internalState.resourceId as string) || 'unknown';
      group.affectedResources.add(resourceId);
    });

    return Array.from(groups.values());
  }

  private isRetryable(operationType: OperationType): boolean {
    // Transactions, syncs, and webhooks can be retried
    // Imports/exports and jobs may need manual intervention
    return ['transaction', 'sync', 'webhook'].includes(operationType);
  }

  private isIgnorable(severity: FailureSeverity): boolean {
    // Only low and medium severity failures can be ignored
    return ['low', 'medium'].includes(severity);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  getAllFailures(): PartialFailure[] {
    return Array.from(this.failures.values());
  }

  clearResolved(): number {
    const resolved: string[] = [];

    this.failures.forEach((failure, id) => {
      if (failure.status === 'resolved') {
        resolved.push(id);
      }
    });

    resolved.forEach((id) => {
      this.failures.delete(id);
    });

    return resolved.length;
  }
}

export const partialFailureTracker = new PartialFailureTracker();

export function recordFailure(
  operationType: OperationType,
  operationId: string,
  internalState: Record<string, unknown>,
  errorMessage: string,
  externalRefId?: string,
  severity?: FailureSeverity
): PartialFailure {
  return partialFailureTracker.recordFailure(
    operationType,
    operationId,
    internalState,
    errorMessage,
    externalRefId,
    severity
  );
}

export function retryFailure(failureId: string): boolean {
  return partialFailureTracker.retryFailure(failureId);
}

export function markFailureResolved(failureId: string, notes?: string): boolean {
  return partialFailureTracker.markResolved(failureId, notes);
}

export function getCriticalFailures(): PartialFailure[] {
  return partialFailureTracker.getCriticalFailures();
}

export function getFailureReport(): FailureReport {
  return partialFailureTracker.generateReport();
}
