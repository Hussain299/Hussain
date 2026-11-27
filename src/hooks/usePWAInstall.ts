import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedIsInstalled = false;
const promptSubscribers = new Set<() => void>();
let listenersAttached = false;

function notifyPromptSubscribers() {
  promptSubscribers.forEach(cb => cb());
}

function ensureInstallListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  sharedIsInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyPromptSubscribers();
  });

  window.addEventListener('appinstalled', () => {
    sharedIsInstalled = true;
    sharedDeferredPrompt = null;
    notifyPromptSubscribers();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    ensureInstallListeners();
    return sharedDeferredPrompt;
  });
  const [isInstalled, setIsInstalled] = useState(() => {
    ensureInstallListeners();
    return sharedIsInstalled;
  });
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    ensureInstallListeners();
    const sync = () => {
      setDeferredPrompt(sharedDeferredPrompt);
      setIsInstalled(sharedIsInstalled);
    };
    sync();
    promptSubscribers.add(sync);

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    return () => {
      promptSubscribers.delete(sync);
    };
  }, []);

  const install = async () => {
    const promptEvent = sharedDeferredPrompt || deferredPrompt;
    if (!promptEvent) return false;
    sharedDeferredPrompt = null;
    notifyPromptSubscribers();
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        sharedIsInstalled = true;
        notifyPromptSubscribers();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}
