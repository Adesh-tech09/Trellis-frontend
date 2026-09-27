import { z } from 'zod';

/**
 * Policy Engine for configurable business rules
 * Centralizes hard-coded business logic into a tested, maintainable policy layer
 */

export type PolicyAction =
  | 'create_agent'
  | 'transfer_funds'
  | 'invite_collaborator'
  | 'escalate_role'
  | 'retry_operation'
  | 'impersonate_user';

export interface PolicyContext {
  actor: {
    id: string;
    role: 'admin' | 'maintainer' | 'user' | 'guest';
    permissions: string[];
  };
  resource: {
    id: string;
    type: string;
    owner: string;
  };
  action: PolicyAction;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation?: boolean;
  rateLimitRemaining?: number;
}

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: (context: PolicyContext) => boolean;
  action: PolicyAction;
  effect: 'allow' | 'deny';
  priority: number;
}

export interface BusinessPolicy {
  maxAgentsPerUser: number;
  maxTransferAmount: string;
  maxInvitesPerDay: number;
  inviteExpiryHours: number;
  impersonationMaxDurationMinutes: number;
  retryAttemptsMax: number;
  roleEscalationRequiresConfirmation: boolean;
}

export const defaultBusinessPolicy: BusinessPolicy = {
  maxAgentsPerUser: 10,
  maxTransferAmount: '1000000', // XLM
  maxInvitesPerDay: 50,
  inviteExpiryHours: 24 * 7, // 7 days
  impersonationMaxDurationMinutes: 30,
  retryAttemptsMax: 3,
  roleEscalationRequiresConfirmation: true,
};

export const PolicyContextSchema = z.object({
  actor: z.object({
    id: z.string(),
    role: z.enum(['admin', 'maintainer', 'user', 'guest']),
    permissions: z.array(z.string()),
  }),
  resource: z.object({
    id: z.string(),
    type: z.string(),
    owner: z.string(),
  }),
  action: z.enum([
    'create_agent',
    'transfer_funds',
    'invite_collaborator',
    'escalate_role',
    'retry_operation',
    'impersonate_user',
  ]),
  metadata: z.record(z.unknown()).optional(),
});

class PolicyEngine {
  private policy: BusinessPolicy;
  private rules: Map<string, PolicyRule> = new Map();
  private rateLimits: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(policy: BusinessPolicy = defaultBusinessPolicy) {
    this.policy = policy;
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    // Rule: Only admins can impersonate
    this.addRule({
      id: 'impersonation_admin_only',
      name: 'Impersonation requires admin role',
      description: 'Only administrators can impersonate users',
      action: 'impersonate_user',
      effect: 'deny',
      priority: 100,
      condition: (ctx) => ctx.actor.role !== 'admin',
    });

    // Rule: Role escalation requires confirmation
    this.addRule({
      id: 'role_escalation_confirmation',
      name: 'Role escalation requires confirmation',
      description: 'Escalating roles to higher privileges requires explicit confirmation',
      action: 'escalate_role',
      effect: 'deny',
      priority: 90,
      condition: (ctx) => {
        const isEscalation = ['admin', 'maintainer'].includes(ctx.resource.type);
        return isEscalation && !ctx.metadata?.confirmed;
      },
    });

    // Rule: Rate limit invitations
    this.addRule({
      id: 'invite_rate_limit',
      name: 'Invitation rate limiting',
      description: `Maximum ${this.policy.maxInvitesPerDay} invitations per day`,
      action: 'invite_collaborator',
      effect: 'deny',
      priority: 80,
      condition: (ctx) => {
        const key = `invites:${ctx.actor.id}`;
        const limit = this.rateLimits.get(key);
        return limit ? limit.count >= this.policy.maxInvitesPerDay : false;
      },
    });

    // Rule: Guests cannot create agents
    this.addRule({
      id: 'guest_no_create',
      name: 'Guests cannot create agents',
      description: 'Guest accounts are not permitted to create new agents',
      action: 'create_agent',
      effect: 'deny',
      priority: 70,
      condition: (ctx) => ctx.actor.role === 'guest',
    });

    // Rule: Max agents per user
    this.addRule({
      id: 'max_agents_per_user',
      name: 'Maximum agents per user',
      description: `Each user can create at most ${this.policy.maxAgentsPerUser} agents`,
      action: 'create_agent',
      effect: 'deny',
      priority: 60,
      condition: (ctx) => {
        const agentCount = (ctx.metadata?.agentCount as number) || 0;
        return agentCount >= this.policy.maxAgentsPerUser;
      },
    });

    // Rule: Transfer amount limits
    this.addRule({
      id: 'transfer_amount_limit',
      name: 'Transfer amount limit',
      description: `Maximum transfer amount is ${this.policy.maxTransferAmount} XLM`,
      action: 'transfer_funds',
      effect: 'deny',
      priority: 50,
      condition: (ctx) => {
        const amount = (ctx.metadata?.amount as string) || '0';
        return BigInt(amount) > BigInt(this.policy.maxTransferAmount);
      },
    });
  }

  addRule(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  updatePolicy(updates: Partial<BusinessPolicy>): void {
    this.policy = { ...this.policy, ...updates };
  }

  getPolicy(): Readonly<BusinessPolicy> {
    return Object.freeze({ ...this.policy });
  }

  evaluate(context: PolicyContext): PolicyDecision {
    // Validate context
    try {
      PolicyContextSchema.parse(context);
    } catch (error) {
      return {
        allowed: false,
        reason: 'Invalid policy context',
      };
    }

    // Sort rules by priority (higher first)
    const sortedRules = Array.from(this.rules.values()).sort(
      (a, b) => b.priority - a.priority
    );

    // Evaluate deny rules first
    const denyRules = sortedRules.filter((r) => r.effect === 'deny' && r.action === context.action);
    for (const rule of denyRules) {
      if (rule.condition(context)) {
        return {
          allowed: false,
          reason: rule.description,
        };
      }
    }

    // Evaluate allow rules
    const allowRules = sortedRules.filter((r) => r.effect === 'allow' && r.action === context.action);
    const allowed = allowRules.length === 0 || allowRules.some((r) => r.condition(context));

    if (!allowed) {
      return {
        allowed: false,
        reason: 'Action not permitted by policy',
      };
    }

    // Check if confirmation required
    const requiresConfirmation =
      context.action === 'escalate_role' && this.policy.roleEscalationRequiresConfirmation
      && !context.metadata?.confirmed;

    const rateLimitKey = `${context.action}:${context.actor.id}`;
    const rateLimitInfo = this.rateLimits.get(rateLimitKey);

    return {
      allowed: true,
      reason: 'Policy allows this action',
      requiresConfirmation,
      rateLimitRemaining: this.policy.maxInvitesPerDay - (rateLimitInfo?.count || 0),
    };
  }

  recordRateLimitedAction(actorId: string, action: PolicyAction): void {
    const key = `${action}:${actorId}`;
    const now = Date.now();
    const limit = this.rateLimits.get(key);

    if (!limit || now >= limit.resetTime) {
      // New window
      this.rateLimits.set(key, {
        count: 1,
        resetTime: now + 24 * 60 * 60 * 1000, // 24 hours
      });
    } else {
      // Update existing window
      limit.count += 1;
    }
  }

  getRateLimitStatus(actorId: string, action: PolicyAction): { remaining: number; resetTime: number } {
    const key = `${action}:${actorId}`;
    const limit = this.rateLimits.get(key);
    const now = Date.now();

    if (!limit || now >= limit.resetTime) {
      return {
        remaining: this.getActionLimit(action),
        resetTime: now + 24 * 60 * 60 * 1000,
      };
    }

    return {
      remaining: this.getActionLimit(action) - limit.count,
      resetTime: limit.resetTime,
    };
  }

  private getActionLimit(action: PolicyAction): number {
    const limits: Record<PolicyAction, number> = {
      create_agent: this.policy.maxAgentsPerUser,
      transfer_funds: 1, // Per transaction
      invite_collaborator: this.policy.maxInvitesPerDay,
      escalate_role: 10,
      retry_operation: this.policy.retryAttemptsMax,
      impersonate_user: 5,
    };
    return limits[action] || 0;
  }
}

// Export singleton instance
export const policyEngine = new PolicyEngine();

export function evaluatePolicy(context: PolicyContext): PolicyDecision {
  return policyEngine.evaluate(context);
}

export function updateBusinessPolicy(updates: Partial<BusinessPolicy>): void {
  policyEngine.updatePolicy(updates);
}

export function getBusinessPolicy(): Readonly<BusinessPolicy> {
  return policyEngine.getPolicy();
}
