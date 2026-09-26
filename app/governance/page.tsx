'use client';

import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useStellarWallet } from '@/components/context/StellarWalletProvider';
import { GovernanceDashboard } from '@/features/governance/components/GovernanceDashboard';
import { PolicyManager } from '@/features/governance/components/PolicyManager';
import {
  GovernanceConfig,
  Proposal,
  ProposalAction,
  VoteChoice,
} from '@/lib/governance/types';
import {
  buildSorobanProposalTx,
  buildSorobanVoteTx,
  buildExecuteProposalTx,
  isProposalApproved,
} from '@/lib/governance/stellar-governance';
import { signTransactionWithFreighter, submitTransaction } from '@/lib/stellar';
import { DEFAULT_NETWORK } from '@/lib/stellar-constants';
import { calculateQuadraticVotingWeight } from '@/features/governance/utils/quadraticVoting';
import { verifyStellarAccountSybilResistance } from '@/features/governance/utils/sybilResistance';
import { getVotingPowerForAccount } from '@/lib/governance/stellar-governance';
import { toast } from 'sonner';

const MOCK_CONFIG: GovernanceConfig = {
  network: DEFAULT_NETWORK,
  governanceAccount: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  treasuryAccount: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  governanceToken: {
    code: 'GOV',
    issuer: 'GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
  },
  sorobanContractId: 'CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  requiredApprovalRatio: 0.6,
  minQuorumRatio: 0.2,
  timelockSeconds: 3600,
  useQuadraticVoting: true,
  minAccountAgeDays: 30,
  minTransactionCount: 5,
};

const SEED_PROPOSALS: Proposal[] = [
  {
    id: 'TIP-042',
    title: 'TIP-042: Implement Protocol Fee Burn & Dynamic Treasury Allocation',
    description:
      'Calibrate autonomous agent routing fees to burn 15% of fee revenue while allocating 35% directly to decentralized LP incentives. A single whale voter with 10,000 tokens voted to reject, but 100 community members with 100 tokens each voted to approve. Quadratic voting ensures community consensus prevails.',
    type: 'update_params',
    creator: 'GA7Q...TRELLIS_CORE',
    createdAt: new Date(Date.now() - 3600 * 48 * 1000).toISOString(),
    startTime: new Date(Date.now() - 3600 * 48 * 1000).toISOString(),
    endTime: new Date(Date.now() + 3600 * 72 * 1000).toISOString(),
    status: 'active',
    action: {
      type: 'update_params',
      params: { fee_burn_pct: 15, lp_incentive_pct: 35 },
    },
    approvals: 10000, // 100 community members * 100 tokens each
    rejections: 10000, // 1 whale * 10,000 tokens
    abstentions: 500,
    totalVotingPowerAtCreation: 25000,
    quadraticApprovals: 1000, // 100 * sqrt(100) = 1000 votes!
    quadraticRejections: 100, // 1 * sqrt(10,000) = 100 votes!
    quadraticAbstentions: 22.36,
    totalQuadraticVotingPowerAtCreation: 500,
    votes: [
      {
        voter: 'GWHALE...99AA',
        tokenBalance: 10000,
        linearVotingPower: 10000,
        quadraticVotingPower: 100,
        choice: 'reject',
        timestamp: new Date(Date.now() - 3600 * 30 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GCOMM...POOL1',
        tokenBalance: 2500,
        linearVotingPower: 2500,
        quadraticVotingPower: 50,
        choice: 'approve',
        timestamp: new Date(Date.now() - 3600 * 20 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GCOMM...POOL2',
        tokenBalance: 2500,
        linearVotingPower: 2500,
        quadraticVotingPower: 50,
        choice: 'approve',
        timestamp: new Date(Date.now() - 3600 * 18 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GCOMM...98USERS',
        tokenBalance: 5000,
        linearVotingPower: 5000,
        quadraticVotingPower: 900,
        choice: 'approve',
        timestamp: new Date(Date.now() - 3600 * 10 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GDELEG...500',
        tokenBalance: 500,
        linearVotingPower: 500,
        quadraticVotingPower: 22.36,
        choice: 'abstain',
        timestamp: new Date(Date.now() - 3600 * 5 * 1000).toISOString(),
        isSybilVerified: true,
      },
    ],
  },
  {
    id: 'TIP-043',
    title: 'TIP-043: Treasury Spend for Stellar Soroban Cross-Rollup Bridge',
    description:
      'Authorize a 5,000 XLM grant from the agent governance treasury to deploy and audit cross-chain messaging verification adapters on testnet.',
    type: 'treasury_spend',
    creator: 'GB22...DEV_GUILD',
    createdAt: new Date(Date.now() - 3600 * 24 * 1000).toISOString(),
    startTime: new Date(Date.now() - 3600 * 24 * 1000).toISOString(),
    endTime: new Date(Date.now() + 3600 * 96 * 1000).toISOString(),
    status: 'active',
    action: {
      type: 'treasury_spend',
      amount: '5000',
      destination: 'GB22...DEV_GUILD',
      memo: 'Bridge Grant Q3',
    },
    approvals: 8100,
    rejections: 900,
    abstentions: 100,
    totalVotingPowerAtCreation: 20000,
    quadraticApprovals: 90,
    quadraticRejections: 30,
    quadraticAbstentions: 10,
    totalQuadraticVotingPowerAtCreation: 400,
    votes: [
      {
        voter: 'GCONTRIB...11AA',
        tokenBalance: 4900,
        linearVotingPower: 4900,
        quadraticVotingPower: 70,
        choice: 'approve',
        timestamp: new Date(Date.now() - 3600 * 12 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GCOMM...88BB',
        tokenBalance: 3200,
        linearVotingPower: 3200,
        quadraticVotingPower: 20,
        choice: 'approve',
        timestamp: new Date(Date.now() - 3600 * 8 * 1000).toISOString(),
        isSybilVerified: true,
      },
      {
        voter: 'GSKEPTIC...33CC',
        tokenBalance: 900,
        linearVotingPower: 900,
        quadraticVotingPower: 30,
        choice: 'reject',
        timestamp: new Date(Date.now() - 3600 * 4 * 1000).toISOString(),
        isSybilVerified: true,
      },
    ],
  },
];

export default function GovernancePage() {
  const { wallet } = useStellarWallet();
  const [proposals, setProposals] = useState<Proposal[]>(SEED_PROPOSALS);

  const createProposalMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      action: ProposalAction;
    }) => {
      if (!wallet) throw new Error('Wallet not connected');
      const proposalId = `${Date.now()}`;
      const tx = buildSorobanProposalTx({
        config: MOCK_CONFIG,
        creator: wallet.publicKey,
        proposalId,
        title: input.title,
        description: input.description,
        action: input.action,
      });
      const signed = await signTransactionWithFreighter(tx, wallet.network);
      if (!signed.success) throw new Error(signed.error || 'Failed to sign');
      const submitResult = await submitTransaction(
        tx.toEnvelope().toXDR('base64'),
        wallet.network
      );
      if (!submitResult.success) {
        throw new Error(submitResult.error || 'Failed to submit');
      }
      const now = new Date();
      const start = now.toISOString();
      const end = new Date(now.getTime() + MOCK_CONFIG.timelockSeconds * 1000).toISOString();
      const votingPowerAtCreation = 0;
      const proposal: Proposal = {
        id: proposalId,
        title: input.title,
        description: input.description,
        type: input.action.type,
        creator: wallet.publicKey,
        createdAt: now.toISOString(),
        startTime: start,
        endTime: end,
        status: 'active',
        action: input.action,
        approvals: 0,
        rejections: 0,
        abstentions: 0,
        totalVotingPowerAtCreation: votingPowerAtCreation,
        quadraticApprovals: 0,
        quadraticRejections: 0,
        quadraticAbstentions: 0,
        votes: [],
      };
      setProposals((prev) => [proposal, ...prev]);
      toast.success('Proposal created successfully on-chain');
    },
  });

  const voteMutation = useMutation({
    mutationFn: async (params: { proposal: Proposal; choice: VoteChoice }) => {
      if (!wallet) throw new Error('Wallet not connected');

      // 1. Verify Sybil resistance for this voter
      const sybilResult = await verifyStellarAccountSybilResistance(
        wallet.publicKey,
        wallet.network,
        {
          minAccountAgeDays: MOCK_CONFIG.minAccountAgeDays,
          minTransactionCount: MOCK_CONFIG.minTransactionCount,
        }
      );

      // Check if account passed Sybil checks
      if (!sybilResult.isVerified && MOCK_CONFIG.minAccountAgeDays) {
        toast.warning(
          `Account flagged by Sybil-Resistance: ${sybilResult.reasons.join(', ')}. Voting power will be restricted.`
        );
      }

      // 2. Fetch voter token balance and compute quadratic weight
      let tokenBalance = 0;
      try {
        tokenBalance = await getVotingPowerForAccount(wallet.publicKey, MOCK_CONFIG);
      } catch {
        tokenBalance = 100; // Demo fallback balance
      }

      const quadraticWeight = calculateQuadraticVotingWeight(tokenBalance);

      // 3. Build & sign transaction
      const tx = buildSorobanVoteTx({
        config: MOCK_CONFIG,
        voter: wallet.publicKey,
        proposalId: params.proposal.id,
        choice: params.choice,
      });

      const signed = await signTransactionWithFreighter(tx, wallet.network);
      if (!signed.success) throw new Error(signed.error || 'Failed to sign');
      const submitResult = await submitTransaction(
        tx.toEnvelope().toXDR('base64'),
        wallet.network
      );
      if (!submitResult.success) {
        throw new Error(submitResult.error || 'Failed to submit');
      }

      // 4. Update proposals with quadratic voting tallies
      setProposals((prev) =>
        prev.map((p) => {
          if (p.id !== params.proposal.id) return p;

          const currentQuadApprovals =
            p.quadraticApprovals ?? (p.approvals > 0 ? Math.sqrt(p.approvals) : 0);
          const currentQuadRejections =
            p.quadraticRejections ?? (p.rejections > 0 ? Math.sqrt(p.rejections) : 0);
          const currentQuadAbstentions =
            p.quadraticAbstentions ?? (p.abstentions > 0 ? Math.sqrt(p.abstentions) : 0);

          const newVote = {
            voter: wallet.publicKey,
            tokenBalance,
            linearVotingPower: tokenBalance,
            quadraticVotingPower: quadraticWeight,
            choice: params.choice,
            timestamp: new Date().toISOString(),
            isSybilVerified: sybilResult.isVerified,
          };

          return {
            ...p,
            approvals:
              params.choice === 'approve' ? p.approvals + tokenBalance : p.approvals,
            rejections:
              params.choice === 'reject' ? p.rejections + tokenBalance : p.rejections,
            abstentions:
              params.choice === 'abstain' ? p.abstentions + tokenBalance : p.abstentions,
            quadraticApprovals:
              params.choice === 'approve'
                ? currentQuadApprovals + quadraticWeight
                : currentQuadApprovals,
            quadraticRejections:
              params.choice === 'reject'
                ? currentQuadRejections + quadraticWeight
                : currentQuadRejections,
            quadraticAbstentions:
              params.choice === 'abstain'
                ? currentQuadAbstentions + quadraticWeight
                : currentQuadAbstentions,
            votes: [newVote, ...(p.votes || [])],
          };
        })
      );

      toast.success(
        `Vote cast! Quadratic Weight: ${quadraticWeight.toFixed(2)} votes applied.`
      );
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (proposal: Proposal) => {
      if (!wallet) throw new Error('Wallet not connected');
      const totalVotingPower =
        proposal.totalVotingPowerAtCreation || proposal.approvals + proposal.rejections + proposal.abstentions;
      const approved = isProposalApproved(
        proposal,
        totalVotingPower,
        MOCK_CONFIG
      );
      if (!approved) throw new Error('Proposal not approved by governance rules');
      const tx = buildExecuteProposalTx({
        config: MOCK_CONFIG,
        executor: wallet.publicKey,
        proposalId: proposal.id,
      });
      const signed = await signTransactionWithFreighter(tx, wallet.network);
      if (!signed.success) throw new Error(signed.error || 'Failed to sign');
      const submitResult = await submitTransaction(
        tx.toEnvelope().toXDR('base64'),
        wallet.network
      );
      if (!submitResult.success) {
        throw new Error(submitResult.error || 'Failed to submit');
      }
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposal.id ? { ...p, status: 'executed' } : p
        )
      );
    },
  });

  const handleCreateProposal = () => {
    if (!wallet) return;
    const title = prompt('Proposal title') || 'Untitled proposal';
    const description = prompt('Proposal description') || '';
    const action: ProposalAction = {
      type: 'update_params',
      params: {
        example_param: 'value',
      },
    };
    createProposalMutation.mutate({ title, description, action });
  };

  const handleVote = (proposal: Proposal, choice: VoteChoice) => {
    voteMutation.mutate({ proposal, choice });
  };

  const handleExecute = (proposal: Proposal) => {
    executeMutation.mutate(proposal);
  };

  return (
    <main className="pt-24 pb-16 px-4 max-w-6xl mx-auto space-y-8">
      <GovernanceDashboard
        config={MOCK_CONFIG}
        proposals={proposals}
        onCreateProposal={handleCreateProposal}
        onVote={handleVote}
        onExecute={handleExecute}
      />

      <div className="pt-20 border-t border-white/5">
         <PolicyManager />
      </div>
    </main>
  );
}

