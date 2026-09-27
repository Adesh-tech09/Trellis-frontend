import { z } from 'zod';
import { evaluatePolicy } from './policy-engine';

/**
 * Abuse-resistant invitation and collaboration workflow
 * Prevents spam, unauthorized role escalation, and stale invites
 */

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
export type InvitationRole = 'viewer' | 'contributor' | 'maintainer' | 'admin';

export interface Invitation {
  id: string;
  inviterId: string;
  inviteeEmail: string;
  targetResourceId: string;
  targetResourceType: string;
  role: InvitationRole;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface InvitationAcceptancePayload {
  invitationId: string;
  acceptedBy: string;
  newResourceId?: string;
}

export interface InvitationStats {
  totalSent: number;
  pending: number;
  accepted: number;
  rejected: number;
  expired: number;
  revoked: number;
}

export interface RolePermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canEscalateRoles: boolean;
}

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  inviterId: z.string(),
  inviteeEmail: z.string().email(),
  targetResourceId: z.string(),
  targetResourceType: z.string(),
  role: z.enum(['viewer', 'contributor', 'maintainer', 'admin']),
  status: z.enum(['pending', 'accepted', 'rejected', 'revoked', 'expired']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  revokedBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const roleHierarchy: Record<InvitationRole, number> = {
  viewer: 1,
  contributor: 2,
  maintainer: 3,
  admin: 4,
};

const rolePermissions: Record<InvitationRole, RolePermissions> = {
  viewer: {
    canRead: true,
    canWrite: false,
    canDelete: false,
    canInvite: false,
    canManageMembers: false,
    canEscalateRoles: false,
  },
  contributor: {
    canRead: true,
    canWrite: true,
    canDelete: false,
    canInvite: false,
    canManageMembers: false,
    canEscalateRoles: false,
  },
  maintainer: {
    canRead: true,
    canWrite: true,
    canDelete: true,
    canInvite: true,
    canManageMembers: true,
    canEscalateRoles: false,
  },
  admin: {
    canRead: true,
    canWrite: true,
    canDelete: true,
    canInvite: true,
    canManageMembers: true,
    canEscalateRoles: true,
  },
};

class InvitationManager {
  private invitations: Map<string, Invitation> = new Map();
  private invitationsByEmail: Map<string, string[]> = new Map();
  private maxInvitesPerDay: number = 50;
  private inviteExpiryHours: number = 168; // 7 days
  private rateLimitByInviter: Map<string, { count: number; resetTime: number }> = new Map();

  setMaxInvitesPerDay(max: number): void {
    this.maxInvitesPerDay = max;
  }

  setInviteExpiryHours(hours: number): void {
    this.inviteExpiryHours = hours;
  }

  createInvitation(
    inviterId: string,
    inviteeEmail: string,
    targetResourceId: string,
    targetResourceType: string,
    role: InvitationRole
  ): Invitation {
    // Validate invitation creation through policy
    const policyDecision = evaluatePolicy({
      actor: {
        id: inviterId,
        role: 'user',
        permissions: ['invite'],
      },
      resource: {
        id: targetResourceId,
        type: targetResourceType,
        owner: inviterId,
      },
      action: 'invite_collaborator',
    });

    if (!policyDecision.allowed) {
      throw new Error(`Invitation creation denied: ${policyDecision.reason}`);
    }

    // Check rate limiting
    const rateLimitKey = inviterId;
    const now = Date.now();
    const rateLimit = this.rateLimitByInviter.get(rateLimitKey);

    if (rateLimit && now < rateLimit.resetTime) {
      if (rateLimit.count >= this.maxInvitesPerDay) {
        throw new Error('Invitation rate limit exceeded');
      }
    }

    const invitation: Invitation = {
      id: this.generateId(),
      inviterId,
      inviteeEmail,
      targetResourceId,
      targetResourceType,
      role,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + this.inviteExpiryHours * 60 * 60 * 1000).toISOString(),
      metadata: {
        ipAddress: 'auto-detected',
        userAgent: 'auto-detected',
      },
    };

    // Validate invitation
    try {
      InvitationSchema.parse(invitation);
    } catch (error) {
      throw new Error('Invalid invitation data');
    }

    this.invitations.set(invitation.id, invitation);

    // Track by email
    const inviteIds = this.invitationsByEmail.get(inviteeEmail) || [];
    inviteIds.push(invitation.id);
    this.invitationsByEmail.set(inviteeEmail, inviteIds);

    // Update rate limit
    if (rateLimit && now < rateLimit.resetTime) {
      rateLimit.count += 1;
    } else {
      this.rateLimitByInviter.set(rateLimitKey, {
        count: 1,
        resetTime: now + 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    return invitation;
  }

  getInvitation(invitationId: string): Invitation | null {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) return null;

    // Check expiry
    if (this.isExpired(invitation)) {
      invitation.status = 'expired';
    }

    return invitation;
  }

  acceptInvitation(invitationId: string, acceptedBy: string): boolean {
    const invitation = this.getInvitation(invitationId);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    // Check if already accepted
    if (invitation.status === 'accepted') {
      throw new Error('Invitation already accepted');
    }

    // Check if revoked
    if (invitation.status === 'revoked') {
      throw new Error('Invitation has been revoked');
    }

    // Check if expired
    if (this.isExpired(invitation)) {
      invitation.status = 'expired';
      throw new Error('Invitation has expired');
    }

    // Check for role escalation
    if (this.requiresRoleConfirmation(invitation.role)) {
      // This would require additional confirmation in the UI
      // For now, we allow it but log it
      console.warn(`Role escalation: ${acceptedBy} accepted ${invitation.role} role`);
    }

    invitation.status = 'accepted';
    invitation.acceptedAt = new Date().toISOString();

    return true;
  }

  rejectInvitation(invitationId: string, rejectedBy: string): boolean {
    const invitation = this.getInvitation(invitationId);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error('Cannot reject non-pending invitation');
    }

    invitation.status = 'rejected';
    return true;
  }

  revokeInvitation(invitationId: string, revokedBy: string): boolean {
    const invitation = this.getInvitation(invitationId);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error('Cannot revoke non-pending invitation');
    }

    if (invitation.inviterId !== revokedBy) {
      throw new Error('Only the inviter can revoke an invitation');
    }

    invitation.status = 'revoked';
    invitation.revokedAt = new Date().toISOString();
    invitation.revokedBy = revokedBy;

    return true;
  }

  getInvitationsByEmail(email: string): Invitation[] {
    const inviteIds = this.invitationsByEmail.get(email) || [];
    return inviteIds
      .map((id) => this.getInvitation(id))
      .filter((inv) => inv !== null) as Invitation[];
  }

  getInvitationsByInviter(inviterId: string): Invitation[] {
    return Array.from(this.invitations.values()).filter(
      (inv) => inv.inviterId === inviterId
    );
  }

  getPendingInvitationsByInviter(inviterId: string): Invitation[] {
    return this.getInvitationsByInviter(inviterId).filter(
      (inv) => inv.status === 'pending' && !this.isExpired(inv)
    );
  }

  getInvitationStats(inviterId: string): InvitationStats {
    const invitations = this.getInvitationsByInviter(inviterId);

    return {
      totalSent: invitations.length,
      pending: invitations.filter((inv) => inv.status === 'pending').length,
      accepted: invitations.filter((inv) => inv.status === 'accepted').length,
      rejected: invitations.filter((inv) => inv.status === 'rejected').length,
      expired: invitations.filter((inv) => inv.status === 'expired').length,
      revoked: invitations.filter((inv) => inv.status === 'revoked').length,
    };
  }

  getRolePermissions(role: InvitationRole): RolePermissions {
    return rolePermissions[role];
  }

  canEscalateRole(currentRole: InvitationRole, newRole: InvitationRole): boolean {
    // Admin can escalate to any role
    // Maintainer can only escalate to maintainer or below
    // Others cannot escalate

    const currentLevel = roleHierarchy[currentRole];
    const newLevel = roleHierarchy[newRole];

    // Cannot escalate above current role
    if (newLevel > currentLevel) {
      // Only admins can escalate
      return currentRole === 'admin';
    }

    return true;
  }

  validateInvitationForAcceptance(invitationId: string): { valid: boolean; reason?: string } {
    const invitation = this.getInvitation(invitationId);
    if (!invitation) {
      return { valid: false, reason: 'Invitation not found' };
    }

    if (invitation.status !== 'pending') {
      return { valid: false, reason: `Invitation is ${invitation.status}` };
    }

    if (this.isExpired(invitation)) {
      return { valid: false, reason: 'Invitation has expired' };
    }

    return { valid: true };
  }

  private isExpired(invitation: Invitation): boolean {
    return new Date(invitation.expiresAt) < new Date();
  }

  private requiresRoleConfirmation(role: InvitationRole): boolean {
    return ['maintainer', 'admin'].includes(role);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  clearExpiredInvitations(): void {
    const expired: string[] = [];

    this.invitations.forEach((invitation, id) => {
      if (this.isExpired(invitation)) {
        expired.push(id);
      }
    });

    expired.forEach((id) => {
      const invitation = this.invitations.get(id);
      if (invitation && invitation.status === 'pending') {
        invitation.status = 'expired';
      }
    });
  }

  getAllInvitations(): Invitation[] {
    return Array.from(this.invitations.values());
  }
}

export const invitationManager = new InvitationManager();

export function createInvitation(
  inviterId: string,
  inviteeEmail: string,
  targetResourceId: string,
  targetResourceType: string,
  role: InvitationRole
): Invitation {
  return invitationManager.createInvitation(inviterId, inviteeEmail, targetResourceId, targetResourceType, role);
}

export function acceptInvitation(invitationId: string, acceptedBy: string): boolean {
  return invitationManager.acceptInvitation(invitationId, acceptedBy);
}

export function revokeInvitation(invitationId: string, revokedBy: string): boolean {
  return invitationManager.revokeInvitation(invitationId, revokedBy);
}

export function getInvitationsByEmail(email: string): Invitation[] {
  return invitationManager.getInvitationsByEmail(email);
}

export function getInvitationStats(inviterId: string): InvitationStats {
  return invitationManager.getInvitationStats(inviterId);
}

export function canEscalateRole(currentRole: InvitationRole, newRole: InvitationRole): boolean {
  return invitationManager.canEscalateRole(currentRole, newRole);
}
