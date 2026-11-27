/**
 * SignalForge ML — Client-Side Service Worker Controller & Background Sync Bridge
 * Registers the Service Worker, manages Periodic Background Sync,
 * and maintains continuous keepalive telemetry with the backend engine.
 */

import { useEffect, useState, useCallback } from 'react';

export interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isActive: boolean;
  isPeriodicSyncSupported: boolean;
  isPeriodicSyncRegistered: boolean;
  notificationPermission: NotificationPermission | 'default';
  lastPulseTime: string | null;
  pulsesCount: number;
  lastHeartbeatStatus: 'HEALTHY' | 'SYNCING' | 'OFFLINE' | 'SERVER_ERROR' | 'UNKNOWN';
  version: string;
}

class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private listeners: Set<(state: ServiceWorkerState) => void> = new Set();
  private state: ServiceWorkerState = {
    isSupported: typeof window !== 'undefined' && 'serviceWorker' in navigator,
    isRegistered: false,
    isActive: false,
    isPeriodicSyncSupported: false,
    isPeriodicSyncRegistered: false,
    notificationPermission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default',
    lastPulseTime: null,
    pulsesCount: 0,
    lastHeartbeatStatus: 'UNKNOWN',
    version: '3.0.0',
  };

  constructor() {
    if (typeof window !== 'undefined' && this.state.isSupported) {
      this.init();
    }
  }

  private notify() {
    this.listeners.forEach((listener) => listener({ ...this.state }));
  }

  public subscribe(listener: (state: ServiceWorkerState) => void) {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): ServiceWorkerState {
    return { ...this.state };
  }

  private async init() {
    try {
      // Purge any stale legacy caches (preserve active v3.2.0 cache)
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key.startsWith('signalforge-') && !key.includes('v3.2.0')) {
              caches.delete(key).catch(() => {});
            }
          });
        });
      }

      // 1. Register the Service Worker at root scope
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.registration = reg;
      this.state.isRegistered = true;
      this.state.isActive = !!reg.active;
      this.notify();

      // Listen for controlling service worker changes and populate initial SW telemetry
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.state.isActive = !!navigator.serviceWorker.controller;
        if (this.state.isActive) {
          this.ping();
        }
        this.notify();
      });

      // Listen for messages from sw.js
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (!data) return;

        if (data.type === 'PONG') {
          this.state.lastHeartbeatStatus = 'HEALTHY';
          this.state.version = data.version || this.state.version;
          this.state.pulsesCount = data.pulsesCount ?? this.state.pulsesCount;
          if (data.lastPulse) this.state.lastPulseTime = data.lastPulse;
          this.notify();
        } else if (data.type === 'BACKGROUND_PULSE_SUCCESS') {
          this.state.lastHeartbeatStatus = 'HEALTHY';
          this.state.lastPulseTime = data.timestamp;
          this.state.pulsesCount = data.pulsesCount ?? (this.state.pulsesCount + 1);
          this.notify();
        }
      });

      // 2. Check Periodic Background Sync capabilities
      if ('periodicSync' in reg) {
        this.state.isPeriodicSyncSupported = true;
        try {
          const tags = await (reg as any).periodicSync.getTags();
          if (tags.includes('signalforge-periodic-pulse')) {
            this.state.isPeriodicSyncRegistered = true;
          } else {
            // Register periodic background sync (minimum interval 60 seconds)
            await (reg as any).periodicSync.register('signalforge-periodic-pulse', {
              minInterval: 60 * 1000,
            });
            this.state.isPeriodicSyncRegistered = true;
            console.log('[ServiceWorkerManager] Periodic Background Sync registered for SignalForge engine.');
          }
        } catch (err: any) {
          console.info('[ServiceWorkerManager] Periodic sync registration restricted by browser policy:', err.message);
        }
      }

      // 3. Register standard Background Sync if available
      if ('sync' in reg) {
        try {
          await (reg as any).sync.register('signalforge-sync');
          console.log('[ServiceWorkerManager] Background Sync registered for SignalForge engine.');
        } catch (err: any) {
          console.info('[ServiceWorkerManager] Background sync registration:', err.message);
        }
      }

      this.ping();
      this.notify();
    } catch (err: any) {
      console.warn('[ServiceWorkerManager] Service worker registration error:', err.message);
    }
  }

  public ping() {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PING' });
    }
  }

  public async triggerManualPulse(): Promise<boolean> {
    try {
      this.state.lastHeartbeatStatus = 'SYNCING';
      this.notify();

      // Call direct pulse endpoint for immediate feedback and single authoritative pulse
      const res = await fetch('/api/scheduler/pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CLIENT_MANUAL_TRIGGER' }),
      });

      if (res.ok) {
        this.state.lastHeartbeatStatus = 'HEALTHY';
        this.state.lastPulseTime = new Date().toISOString();
        this.state.pulsesCount++;
        this.ping();
        this.notify();
        return true;
      }
      this.state.lastHeartbeatStatus = 'SERVER_ERROR';
      this.notify();
      return false;
    } catch {
      this.state.lastHeartbeatStatus = 'OFFLINE';
      this.notify();
      return false;
    }
  }

  public async requestNotificationPermission(): Promise<NotificationPermission> {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        this.state.notificationPermission = permission;
        this.notify();
        return permission;
      } catch {
        return 'denied';
      }
    }
    return 'denied';
  }
}

export const swManager = new ServiceWorkerManager();

/**
 * React Hook for consuming live Service Worker & Background Daemon Status
 */
export function useServiceWorker() {
  const [swState, setSwState] = useState<ServiceWorkerState>(swManager.getState());

  useEffect(() => {
    return swManager.subscribe((state) => {
      setSwState(state);
    });
  }, []);

  const triggerPulse = useCallback(() => {
    return swManager.triggerManualPulse();
  }, []);

  const requestNotifications = useCallback(() => {
    return swManager.requestNotificationPermission();
  }, []);

  const ping = useCallback(() => {
    swManager.ping();
  }, []);

  return {
    ...swState,
    triggerPulse,
    requestNotifications,
    ping,
  };
}
