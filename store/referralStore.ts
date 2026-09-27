import { create } from 'zustand';
import { ReferralService } from '../../features/referral-sharing/services/referralService';
import {
  AnalyticsService,
  type RecordClickEventInput,
} from '../../features/referral-sharing/services/analyticsService';
import {
  ReferralLink,
  ReferralStats,
  ReferralReward,
  ReferralClickMetrics,
} from '../../features/referral-sharing/types';

interface ReferralState {
  stats: ReferralStats | null;
  links: ReferralLink[];
  rewards: ReferralReward[];
  /** CTR / conversion metrics for the user's vanity links (#128). */
  clickMetrics: ReferralClickMetrics | null;
  /** Most recently registered vanity alias (#128). */
  vanitySlug: string | null;
  loading: boolean;
  error: string | null;
}

interface ReferralActions {
  fetchReferralData: (userId: string) => Promise<void>;
  generateLink: (params: {
    userId: string;
    reward?: string;
  }) => Promise<ReferralLink>;
  registerVanitySlug: (params: {
    userId: string;
    slug: string;
    targetAgentId: string;
    reward?: string;
  }) => Promise<ReferralLink>;
  recordClick: (input: RecordClickEventInput) => Promise<void>;
  claimReferralReward: (rewardId: string) => Promise<string>;
  clearError: () => void;
}

export type ReferralStore = ReferralState & ReferralActions;

export const useReferralStore = create<ReferralStore>((set, get) => ({
  stats: null,
  links: [],
  rewards: [],
  clickMetrics: null,
  vanitySlug: null,
  loading: false,
  error: null,

  fetchReferralData: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const [stats, links, rewards] = await Promise.all([
        ReferralService.getReferralStats(userId),
        ReferralService.getUserReferralLinks(userId),
        ReferralService.getReferralRewards(userId),
      ]);

      // Rebuild click metrics from the locally mirrored ledger for this user's
      // vanity slugs; the backend remains the authority for the dashboard.
      const slugs = new Set(
        links.map((link) => link.slug).filter((value): value is string => Boolean(value)),
      );
      const events = AnalyticsService.getStoredLinkEvents().filter((event) =>
        slugs.has(event.slug),
      );

      set({
        stats,
        links,
        rewards,
        clickMetrics: AnalyticsService.computeClickMetrics(events),
        loading: false,
      });
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

  registerVanitySlug: async ({ userId, slug, targetAgentId, reward }) => {
    set({ loading: true, error: null });
    try {
      const existingSlugs = get()
        .links.map((link) => link.slug)
        .filter((value): value is string => Boolean(value));

      const newLink = await ReferralService.registerVanitySlug({
        userId,
        slug,
        targetAgentId,
        reward,
        existingSlugs,
      });

      set((state) => ({
        links: [newLink, ...state.links],
        vanitySlug: newLink.slug ?? null,
        loading: false,
        stats: state.stats
          ? { ...state.stats, activeLinks: state.stats.activeLinks + 1 }
          : state.stats,
      }));
      return newLink;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to register vanity slug';
      set({ error: message, loading: false });
      throw new Error(message);
    }
  },

  recordClick: async (input: RecordClickEventInput) => {
    try {
      const event = await AnalyticsService.recordClickEvent(input);
      const stored = AnalyticsService.getStoredLinkEvents();
      const events = stored.some((item) => item.id === event.id)
        ? stored
        : [...stored, event];
      set({ clickMetrics: AnalyticsService.computeClickMetrics(events) });
    } catch (error) {
      console.warn('Failed to record referral click:', error);
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
}));
