import { z } from 'zod';
import { evaluatePolicy } from './policy-engine';

/**
 * Scoped maintainer impersonation for support debugging
 * Time-limited, audited sessions with restricted mutations
 */

export interface ImpersonationSession {
  id: string;
  adminId: string;
  targetUserId: string;
  startedAt: string;
  expiresAt: string;
  scope: ImpersonationScope;
  auditLog: AuditEvent[];
  isActive: boolean;
}

export type ImpersonationScope = 'read_only' | 'limited_write' | 'debug';

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  resource: string;
  result: 'success' | 'blocked' | 'error';
  metadata?: Record<string, unknown>;
}

export interface ImpersonationPermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canTransfer: boolean;
  allowedActions: string[];
  blockedActions: string[];
}

export const ImpersonationSessionSchema = z.object({
  id: z.string().uuid(),
  adminId: z.string(),
  targetUserId: z.string(),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  scope: z.enum(['read_only', 'limited_write', 'debug']),
  auditLog: z.array(z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    action: z.string(),
    resource: z.string(),
    result: z.enum(['success', 'blocked', 'error']),
    metadata: z.record(z.unknown()).optional(),
  })),
  isActive: z.boolean(),
});

const scopePermissions: Record<ImpersonationScope, ImpersonationPermissions> = {
  read_only: {
    canRead: true,
    canWrite: false,
    canDelete: false,
    canTransfer: false,
    allowedActions: ['view_user_data', 'view_wallet', 'view_transactions', 'view_agents'],
    blockedActions: ['create', 'update', 'delete', 'transfer', 'impersonate'],
  },
  limited_write: {
    canRead: true,
    canWrite: true,
    canDelete: false,
    canTransfer: false,
    allowedActions: [
      'view_user_data',
      'update_profile',
      'create_agent',
      'view_wallet',
      'view_transactions',
    ],
    blockedActions: ['delete_user', 'transfer_funds', 'delete_data', 'escalate_role'],
  },
  debug: {
    canRead: true,
    canWrite: true,
    canDelete: true,
    canTransfer: false,
    allowedActions: [
      'view_user_data',
      'update_profile',
      'create_agent',
      'delete_agent',
      'view_wallet',
      'view_transactions',
      'test_operations',
    ],
    blockedActions: ['transfer_funds', 'escalate_role', 'impersonate'],
  },
};

class ImpersonationManager {
  private sessions: Map<string, ImpersonationSession> = new Map();
  private maxDurationMinutes: number = 30;

  setMaxDuration(minutes: number): void {
    this.maxDurationMinutes = minutes;
  }

  startSession(
    adminId: string,
    targetUserId: string,
    scope: ImpersonationScope = 'read_only',
    durationMinutes?: number
  ): ImpersonationSession {
    // Validate admin permissions
    const policyDecision = evaluatePolicy({
      actor: {
        id: adminId,
        role: 'admin',
        permissions: ['impersonate'],
      },
      resource: {
        id: targetUserId,
        type: 'user',
        owner: 'system',
      },
      action: 'impersonate_user',
    });

    if (!policyDecision.allowed) {
      throw new Error(`Impersonation denied: ${policyDecision.reason}`);
    }

    const now = new Date();
    const duration = Math.min(durationMinutes || this.maxDurationMinutes, this.maxDurationMinutes);
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

    const session: ImpersonationSession = {
      id: this.generateId(),
      adminId,
      targetUserId,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      scope,
      auditLog: [
        {
          id: this.generateId(),
          timestamp: now.toISOString(),
          action: 'session_started',
          resource: `user:${targetUserId}`,
          result: 'success',
          metadata: { scope, durationMinutes: duration },
        },
      ],
      isActive: true,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  endSession(sessionId: string, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.isActive = false;
    session.auditLog.push({
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      action: 'session_ended',
      resource: `user:${session.targetUserId}`,
      result: 'success',
      metadata: { reason },
    });
  }

  getSession(sessionId: string): ImpersonationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check if session is expired
    if (new Date(session.expiresAt) < new Date()) {
      session.isActive = false;
      return session;
    }

    return session;
  }

  isSessionActive(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    const now = new Date();
    const isExpired = new Date(session.expiresAt) < now;

    return session.isActive && !isExpired;
  }

  canPerformAction(sessionId: string, action: string): boolean {
    const session = this.getSession(sessionId);
    if (!session || !this.isSessionActive(sessionId)) {
      return false;
    }

    const permissions = scopePermissions[session.scope];
    const isAllowed = permissions.allowedActions.includes(action);
    const isBlocked = permissions.blockedActions.includes(action);

    return isAllowed && !isBlocked;
  }

  recordAction(
    sessionId: string,
    action: string,
    resource: string,
    result: 'success' | 'blocked' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.auditLog.push({
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      action,
      resource,
      result,
      metadata,
    });
  }

  getPermissions(sessionId: string): ImpersonationPermissions | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    return scopePermissions[session.scope];
  }

  getAuditLog(sessionId: string): AuditEvent[] {
    const session = this.getSession(sessionId);
    if (!session) return [];

    return [...session.auditLog];
  }

  getActiveSessions(): ImpersonationSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => this.isSessionActive(session.id)
    );
  }

  getSessionsForAdmin(adminId: string): ImpersonationSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.adminId === adminId
    );
  }

  validateSession(sessionId: string): boolean {
    try {
      const session = this.getSession(sessionId);
      if (!session) return false;

      ImpersonationSessionSchema.parse(session);
      return this.isSessionActive(sessionId);
    } catch {
      return false;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  clearExpiredSessions(): void {
    const now = new Date();
    const expired: string[] = [];

    this.sessions.forEach((session, id) => {
      if (new Date(session.expiresAt) < now) {
        expired.push(id);
      }
    });

    expired.forEach((id) => this.sessions.delete(id));
  }
}

export const impersonationManager = new ImpersonationManager();

export function startImpersonation(
  adminId: string,
  targetUserId: string,
  scope?: ImpersonationScope,
  durationMinutes?: number
): ImpersonationSession {
  return impersonationManager.startSession(adminId, targetUserId, scope, durationMinutes);
}

export function endImpersonation(sessionId: string, reason?: string): void {
  impersonationManager.endSession(sessionId, reason);
}

export function isImpersonationActive(sessionId: string): boolean {
  return impersonationManager.isSessionActive(sessionId);
}

export function getImpersonationSession(sessionId: string): ImpersonationSession | null {
  return impersonationManager.getSession(sessionId);
}

export function canPerformActionInImpersonation(sessionId: string, action: string): boolean {
  return impersonationManager.canPerformAction(sessionId, action);
}
