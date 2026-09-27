import type { StellarNetwork } from '../types';

export type ProposalType = 'upgrade_agent' | 'update_params' | 'treasury_spend';

export type ProposalStatus = 'pending' | 'active' | 'failed' | 'executed' | 'expired';

export interface GovernanceConfig {
  network: StellarNetwork;
  governanceAccount: string; // multisig account that owns the agent
  treasuryAccount: string; // XLM treasury account
  governanceToken: {
    code: string;
    issuer: string;
  };
  sorobanContractId: string;
  requiredApprovalRatio: number; // e.g. 0.6 for 60%
  minQuorumRatio: number; // e.g. 0.2 for 20%
  timelockSeconds: number;
  useQuadraticVoting?: boolean;
  minAccountAgeDays?: number;
  minTransactionCount?: number;
}

export interface ProposalActionUpgradeAgent {
  type: 'upgrade_agent';
  newCodeHash: string;
}

export interface ProposalActionUpdateParams {
  type: 'update_params';
  params: Record<string, string | number | boolean>;
}

export interface ProposalActionTreasurySpend {
  type: 'treasury_spend';
  amount: string; // XLM in string lumens
  destination: string;
  memo?: string;
}

export type ProposalAction =
  | ProposalActionUpgradeAgent
  | ProposalActionUpdateParams
  | ProposalActionTreasurySpend;

export interface ProposalVoteBreakdown {
  voter: string;
  tokenBalance: number;
  linearVotingPower: number;
  quadraticVotingPower: number;
  choice: VoteChoice;
  timestamp: string;
  isSybilVerified?: boolean;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: ProposalType;
  creator: string;
  createdAt: string;
  startTime: string;
  endTime: string;
  status: ProposalStatus;
  action: ProposalAction;
  approvals: number;
  rejections: number;
  abstentions: number;
  totalVotingPowerAtCreation: number;
  quadraticApprovals?: number;
  quadraticRejections?: number;
  quadraticAbstentions?: number;
  totalQuadraticVotingPowerAtCreation?: number;
  votes?: ProposalVoteBreakdown[];
}

export type VoteChoice = 'approve' | 'reject' | 'abstain';

export interface Vote {
  proposalId: string;
  voter: string;
  votingPower: number;
  quadraticVotingPower?: number;
  choice: VoteChoice;
  txHash: string;
  timestamp: string;
  isSybilVerified?: boolean;
}

export interface TreasuryBalance {
  account: string;
  balanceXlm: string;
}

export interface TreasuryTransaction {
  id: string;
  type: 'payment' | 'incoming' | 'outgoing';
  source: string;
  destination: string;
  amountXlm: string;
  createdAt: string;
  hash: string;
  memo?: string | null;
}

export interface Delegation {
  delegator: string;
  delegate: string;
  weight: number;
}

