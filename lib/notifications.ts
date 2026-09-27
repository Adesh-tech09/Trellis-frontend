import { SorobanTransactionResult } from './types';
import {
  AlertPreferences,
  ALERT_PREFERENCES_KEY,
  evaluateAlert,
  isWithinQuietHours,
  loadAlertPreferences as readAlertPreferences,
  updateAlertPreferences as persistAlertPreferences,
} from './notifications/alert-preferences';
import { playChime } from './notifications/chime';
import { LifecycleEventType, NotificationSeverity } from './notifications/lifecycle-types';

export interface NotificationData {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  /** Drives the chime policy; defaults to `info`. */
  severity?: NotificationSeverity;
  /** When set, the matching alert category can mute this notification. */
  eventType?: LifecycleEventType;
  data?: {
    url?: string;
    transactionHash?: string;
    type?: 'trade' | 'transaction' | 'general';
    amount?: string;
    agentName?: string;
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
    start: string; // HH:MM format
    end: string;   // HH:MM format
  };
}

export class NotificationManager {
  private static instance: NotificationManager;
  private subscription: PushSubscription | null = null;
  private isSupported: boolean = false;
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
    }
  };

  private constructor() {
    this.isSupported = typeof window !== 'undefined' && 'Notification' in window && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    if (this.isSupported) {
      this.loadPreferences();
    }
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

      this.migrateLegacyAlertPreferences();
    } catch (error) {
      console.warn('Failed to load notification preferences:', error);
    }
  }

  /**
   * One-time migration: before alert preferences existed, sound and quiet hours
   * lived only on `NotificationPreferences`. Seed the richer store from them so
   * an existing user's settings are not silently reset.
   */
  private migrateLegacyAlertPreferences(): void {
    if (typeof window === 'undefined') return;

    try {
      if (localStorage.getItem(ALERT_PREFERENCES_KEY)) {
        return;
      }

      persistAlertPreferences({
        audioEnabled: this.preferences.soundEnabled,
        quietHours: {
          ...readAlertPreferences().quietHours,
          enabled: this.preferences.quietHours.enabled,
          start: this.preferences.quietHours.start,
          end: this.preferences.quietHours.end,
        },
      });
    } catch (error) {
      console.warn('Failed to migrate alert preferences:', error);
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

    // Keep the alert-preference store in step when the legacy screen is used.
    const patch: Partial<AlertPreferences> = {};

    if (updates.soundEnabled !== undefined) {
      patch.audioEnabled = updates.soundEnabled;
    }

    if (updates.quietHours) {
      patch.quietHours = { ...readAlertPreferences().quietHours, ...updates.quietHours };
    }

    if (Object.keys(patch).length > 0) {
      persistAlertPreferences(patch);
    }
  }

  /** Audio/quiet-hours/category policy shared with `NotificationCenter`. */
  getAlertPreferences(): AlertPreferences {
    return readAlertPreferences();
  }

  updateAlertPreferences(updates: Partial<AlertPreferences>): AlertPreferences {
    const next = persistAlertPreferences(updates);
    this.preferences = {
      ...this.preferences,
      soundEnabled: next.audioEnabled,
      quietHours: {
        enabled: next.quietHours.enabled,
        start: next.quietHours.start,
        end: next.quietHours.end,
      },
    };
    this.savePreferences();
    return next;
  }

  /** Preview a chime regardless of the policy (used by the settings screen). */
  playAlertSound(severity: NotificationSeverity = 'info'): boolean {
    const preferences = this.getAlertPreferences();
    return playChime(severity, { volume: preferences.volume });
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

  /**
   * Quiet hours, evaluated from the shared alert schedule (which supports
   * per-day windows and crossing midnight) rather than from the legacy copy on
   * `NotificationPreferences`. Public so settings UIs can show whether the
   * window is active right now.
   */
  isInQuietHours(now: Date = new Date()): boolean {
    return isWithinQuietHours(now, this.getAlertPreferences().quietHours);
  }

  async subscribeToPush(): Promise<PushSubscription | null> {
    if (!this.isSupported) {
      throw new Error('Push notifications are not supported');
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      this.subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to any/ArrayBuffer for compatibility with different TS DOM libs
        applicationServerKey: this.urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').buffer as any
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
    }
  }

  getSubscription(): PushSubscription | null {
    return this.subscription;
  }

  async showNotification(data: NotificationData): Promise<void> {
    if (!this.preferences.enabled) {
      return;
    }

    const severity = data.severity ?? 'info';
    const alertPreferences = this.getAlertPreferences();
    // One policy decides both the chime and whether the notification surfaces:
    // category mutes always win, quiet hours only silence non-critical alerts
    // (unless the user opted into muting critical ones too).
    const decision = evaluateAlert(alertPreferences, {
      severity,
      eventType: data.eventType,
    });

    if (decision.reason === 'category_muted') {
      console.log('Notification suppressed by category mute');
      return;
    }

    if (decision.reason === 'quiet_hours') {
      console.log('Notification suppressed due to quiet hours');
      return;
    }

    if (decision.play) {
      playChime(severity, { volume: alertPreferences.volume });
    }

    const permission = await this.getCurrentPermission();
    if (permission !== 'granted') {
      console.log('Notification permission not granted');
      return;
    }

    // Check type-specific preferences
    const type = data.data?.type || 'general';
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
    } catch (error) {
      console.error('Failed to show notification:', error);
      
      // Fallback to browser notification if service worker fails
      if (permission === 'granted') {
        new Notification(data.title, {
          body: data.body,
          icon: data.icon || '/icons/icon-192x192.png',
          badge: data.badge || '/icons/icon-192x192.png',
          tag: data.tag || 'Trellis',
          requireInteraction: data.requireInteraction || false,
          silent: !this.preferences.soundEnabled,
          // Vibrate may not exist on all Notification typings; coerce for compatibility
          vibrate: (this.preferences.vibrationEnabled ? [100, 50, 100] : undefined) as any,
          data: data.data
        } as any);
      }
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
        severity: 'success',
        eventType: 'simulation_completed',
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
        severity: 'critical',
        eventType: 'simulation_failed',
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
        severity: 'success',
        severity: 'success',
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
        severity: 'critical',
        eventType: 'transaction_failed',
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