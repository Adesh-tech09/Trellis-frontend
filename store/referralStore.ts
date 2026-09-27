import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ReferralService } from '../../features/referral-sharing/services/referralService';
import {
  ReferralLink,
  ReferralStats,
  ReferralReward,
} from '../../features/referral-sharing/types';
import { createPersistStorage } from './persistence';

interface ReferralState {
  stats: ReferralStats | null;
  links: ReferralLink[];
  rewards: ReferralReward[];
  loading: boolean;
  error: string | null;
  hasHydrated: boolean;
}

interface ReferralActions {
  fetchReferralData: (userId: string) => Promise<void>;
  generateLink: (params: {
    userId: string;
    reward?: string;
  }) => Promise<ReferralLink>;
  claimReferralReward: (rewardId: string) => Promise<string>;
  clearError: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export type ReferralStore = ReferralState & ReferralActions;

const initialReferralState: ReferralState = {
  stats: null,
  links: [],
  rewards: [],
  loading: false,
  error: null,
  hasHydrated: false,
};

export const useReferralStore = create<ReferralStore>()(
  persist(
    (set, get) => ({
      ...initialReferralState,

      fetchReferralData: async (userId: string) => {
        set({ loading: true, error: null });
        try {
          const [stats, links, rewards] = await Promise.all([
            ReferralService.getReferralStats(userId),
            ReferralService.getUserReferralLinks(userId),
            ReferralService.getReferralRewards(userId),
          ]);
          set({ stats, links, rewards, loading: false });
        } catch (error) {
          set({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to fetch referral data',
          });
        }
      },

      generateLink: async ({ userId, reward }: { userId: string; reward?: string }) => {
        try {
          const newLink = await ReferralService.generateReferralLink(userId, reward);
          set((state) => ({
            links: [newLink, ...state.links],
            stats: state.stats
              ? { ...state.stats, activeLinks: state.stats.activeLinks + 1 }
              : state.stats,
          }));
          return newLink;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to generate link';
          set({ error: message });
          throw new Error(message);
        }
      },

      claimReferralReward: async (rewardId: string) => {
        try {
          const success = await ReferralService.claimReward(rewardId);
          if (!success) throw new Error('Claim failed');
          const rewards = get().rewards.map((reward) =>
            reward.id === rewardId
              ? { ...reward, status: 'claimed' as const }
              : reward,
          );
          set({ rewards });
          return rewardId;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to claim reward';
          set({ error: message });
          throw new Error(message);
        }
      },

      clearError: () => set({ error: null }),
      setHydrated: (hydrated) => set({ hasHydrated: hydrated }),
    }),
    {
      name: 'trellis-referral-store',
      version: 1,
      storage: createPersistStorage(),
      partialize: (state) => ({
        stats: state.stats,
        links: state.links,
        rewards: state.rewards,
      }),
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return initialReferralState;
        }

        const state = persistedState as Partial<ReferralState>;
        const nextState: ReferralState = {
          stats: state.stats ?? null,
          links: Array.isArray(state.links) ? state.links : [],
          rewards: Array.isArray(state.rewards) ? state.rewards : [],
          loading: false,
          error: null,
          hasHydrated: false,
        };

        if (version <= 0) {
          return nextState;
        }

        return nextState;
      },
      onRehydrateStorage: () => () => {
        useReferralStore.setState({ hasHydrated: true });
      },
    },
  ),
);
