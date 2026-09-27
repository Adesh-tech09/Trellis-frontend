import { SorobanTransactionResult } from './types';

export interface NotificationData {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  data?: {
    url?: string;
    transactionHash?: string;
    type?: 'trade' | 'transaction' | 'general';
    amount?: string;
    agentName?: string;
    category?: string;
    [key: string]: any;
  };
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export interface NotificationPreferences {
  enabled: boolean;
  tradeNotifications: boolean;
  transactionNotifications: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  eventCategories: Record<string, boolean>;
}

interface NotificationSyncMessage {
  type: 'mark_read' | 'dismiss' | 'mark_all_read' | 'notification_created';
  notificationId?: string;
  walletAddress?: string;
  timestamp: number;
  sourceTab: string;
}

const CHANNEL_NAME = 'trellis-notification-sync';
const STORAGE_KEY = 'Trellis-notification-preferences';
const TAB_ID = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export class NotificationManager {
  private static instance: NotificationManager;
  private subscription: PushSubscription | null = null;
  private isSupported: boolean = false;
  private broadcastChannel: BroadcastChannel | null = null;
  private preferences: NotificationPreferences = {
    enabled: true,
    tradeNotifications: true,
    transactionNotifications: true,
    soundEnabled: true,
    vibrationEnabled: true,
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00'
    },
    eventCategories: {
      proposal_passing: true,
      payout_execution: true,
      agent_error: true,
      governance: true,
      security_alert: true,
      trade_complete: true,
    }
  };
  private vapidPublicKey: string = '';
  private isInitialized: boolean = false;

  private constructor() {
    this.isSupported = typeof window !== 'undefined' && 'Notification' in window && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    if (this.isSupported) {
      this.loadPreferences();
      this.initBroadcastChannel();
      this.initVAPID();
    }
  }

  private initBroadcastChannel(): void {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    try {
      this.broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      this.broadcastChannel.onmessage = (event: MessageEvent<NotificationSyncMessage>) => {
        this.handleBroadcastMessage(event.data);
      };
    } catch (error) {
      console.warn('[NotificationManager] BroadcastChannel not available:', error);
    }
  }

  private initVAPID(): void {
    if (typeof window === 'undefined') return;
    this.vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  }

  private handleBroadcastMessage(message: NotificationSyncMessage): void {
    if (message.sourceTab === TAB_ID) return;
    switch (message.type) {
      case 'mark_read':
        if (message.notificationId) {
          // Trigger local update by re-dispatching via lifecycle if needed
          console.log('[NotificationManager] Marked as read via broadcast:', message.notificationId);
        }
        break;
      case 'mark_all_read':
        console.log('[NotificationManager] Mark all read via broadcast');
        break;
      case 'notification_created':
        console.log('[NotificationManager] New notification via broadcast');
        break;
    }
  }

  private broadcastMessage(message: NotificationSyncMessage): void {
    if (this.broadcastChannel) {
      message.sourceTab = TAB_ID;
      this.broadcastChannel.postMessage(message);
    }
  }

  public setVAPIDKey(key: string): void {
    this.vapidPublicKey = key;
  }

  public getVAPIDKey(): string {
    return this.vapidPublicKey || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  }

  static getInstance(): NotificationManager {
    if (typeof window === 'undefined') {
      // Return a dummy instance for SSR that won't access browser APIs
      return new NotificationManager();
    }
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  private async loadPreferences(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('Trellis-notification-preferences');
      if (stored) {
        this.preferences = { ...this.preferences, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.warn('Failed to load notification preferences:', error);
    }
  }

  private savePreferences(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('Trellis-notification-preferences', JSON.stringify(this.preferences));
    } catch (error) {
      console.warn('Failed to save notification preferences:', error);
    }
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  updatePreferences(updates: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    this.savePreferences();
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) {
      throw new Error('Notifications are not supported in this browser');
    }

    const permission = await Notification.requestPermission();
    return permission;
  }

  async getCurrentPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) {
      return 'denied';
    }
    return Notification.permission;
  }

  private isInQuietHours(): boolean {
    if (!this.preferences.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const { start, end } = this.preferences.quietHours;

    if (start <= end) {
      // Same day range (e.g., 22:00 to 08:00 doesn't apply here)
      return currentTime >= start && currentTime <= end;
    } else {
      // Overnight range (e.g., 22:00 to 08:00)
      return currentTime >= start || currentTime <= end;
    }
  }

  async subscribeToPush(): Promise<PushSubscription | null> {
    if (!this.isSupported) {
      throw new Error('Push notifications are not supported');
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = this.vapidPublicKey
        ? this.urlBase64ToUint8Array(this.vapidPublicKey)
        : this.urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '');
      
      this.subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      this.broadcastMessage({
        type: 'notification_created',
        timestamp: Date.now(),
        sourceTab: TAB_ID,
      });

      return this.subscription;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      return null;
    }
  }

  async unsubscribeFromPush(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
      this.broadcastMessage({
        type: 'notification_created',
        timestamp: Date.now(),
        sourceTab: TAB_ID,
      });
    }
  }

  getSubscription(): PushSubscription | null {
    return this.subscription;
  }

  async updatePreferences(updates: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    if (updates.eventCategories) {
      this.preferences.eventCategories = { ...this.preferences.eventCategories, ...updates.eventCategories };
    }
    this.savePreferences();
    this.broadcastMessage({
      type: 'notification_created',
      timestamp: Date.now(),
      sourceTab: TAB_ID,
    });
  }

  isEventCategoryEnabled(category: string): boolean {
    return this.preferences.eventCategories[category] !== false;
  }

  getEventCategories(): Record<string, boolean> {
    return { ...this.preferences.eventCategories };
  }

  async showNotification(data: NotificationData): Promise<void> {
    if (!this.preferences.enabled) {
      return;
    }

    if (this.isInQuietHours()) {
      console.log('Notification suppressed due to quiet hours');
      return;
    }

    const permission = await this.getCurrentPermission();
    if (permission !== 'granted') {
      console.log('Notification permission not granted');
      return;
    }

    const type = data.data?.type || 'general';
    const category = data.data?.category || type;
    if (!this.isEventCategoryEnabled(category)) {
      return;
    }
    if (type === 'trade' && !this.preferences.tradeNotifications) {
      return;
    }
    if (type === 'transaction' && !this.preferences.transactionNotifications) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      const notificationData = {
        title: data.title,
        body: data.body,
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/icons/icon-192x192.png',
        tag: data.tag || 'Trellis',
        requireInteraction: data.requireInteraction || false,
        silent: !this.preferences.soundEnabled,
        vibrate: this.preferences.vibrationEnabled ? [100, 50, 100] : undefined,
        data: {
          ...data.data,
          timestamp: Date.now()
        },
        actions: data.actions || []
      };

      await registration.showNotification(data.title, notificationData as any);

      this.broadcastMessage({
        type: 'notification_created',
        notificationId: data.data?.transactionHash || Date.now().toString(),
        timestamp: Date.now(),
        sourceTab: TAB_ID,
      });
    } catch (error) {
      console.error('Failed to show notification:', error);
      
      if (permission === 'granted') {
        new Notification(data.title, {
          body: data.body,
          icon: data.icon || '/icons/icon-192x192.png',
          badge: data.badge || '/icons/icon-192x192.png',
          tag: data.tag || 'Trellis',
          requireInteraction: data.requireInteraction || false,
          silent: !this.preferences.soundEnabled,
          vibrate: (this.preferences.vibrationEnabled ? [100, 50, 100] : undefined) as any,
          data: data.data
        } as any);
      }
    }
  }

  destroy(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  async showTradeNotification(
    transactionResult: SorobanTransactionResult,
    agentName: string,
    amount?: string
  ): Promise<void> {
    if (transactionResult.success) {
      await this.showNotification({
        title: 'Trade Successful! 🎉',
        body: `Successfully completed transaction for ${agentName}${amount ? ` (${amount})` : ''}`,
        tag: 'trade-success',
        data: {
          type: 'trade',
          transactionHash: transactionResult.hash,
          agentName,
          amount,
          url: '/portfolio',
          status: 'success'
        },
        actions: [
          {
            action: 'view-transaction',
            title: 'View Details',
            icon: '/icons/icon-192x192.png'
          },
          {
            action: 'view-portfolio',
            title: 'View Portfolio',
            icon: '/icons/icon-192x192.png'
          }
        ]
      });
    } else {
      await this.showNotification({
        title: 'Trade Failed ❌',
        body: `Transaction failed for ${agentName}: ${transactionResult.error}`,
        tag: 'trade-error',
        requireInteraction: true,
        data: {
          type: 'trade',
          transactionHash: transactionResult.hash,
          agentName,
          error: transactionResult.error,
          url: '/portfolio',
          status: 'failed'
        },
        actions: [
          {
            action: 'retry-transaction',
            title: 'Retry',
            icon: '/icons/icon-192x192.png'
          }
        ]
      });
    }
  }

  async showTransactionNotification(
    transactionResult: SorobanTransactionResult,
    description: string
  ): Promise<void> {
    if (transactionResult.success) {
      await this.showNotification({
        title: 'Transaction Complete ✅',
        body: description,
        tag: 'transaction-success',
        data: {
          type: 'transaction',
          transactionHash: transactionResult.hash,
          url: '/portfolio',
          status: 'success'
        }
      });
    } else {
      await this.showNotification({
        title: 'Transaction Failed ❌',
        body: `${description}: ${transactionResult.error}`,
        tag: 'transaction-error',
        requireInteraction: true,
        data: {
          type: 'transaction',
          transactionHash: transactionResult.hash,
          error: transactionResult.error,
          url: '/portfolio',
          status: 'failed'
        }
      });
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async clearAllNotifications(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications();
      notifications.forEach(notification => notification.close());
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  }

  async getNotificationCount(): Promise<number> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications();
      return notifications.length;
    } catch (error) {
      console.error('Failed to get notification count:', error);
      return 0;
    }
  }
}

export const notificationManager = NotificationManager.getInstance();