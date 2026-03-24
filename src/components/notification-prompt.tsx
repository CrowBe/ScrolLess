import { useState, useEffect } from 'preact/hooks';
import { getVapidKey, subscribePush, unsubscribePush } from '../api';

const DISMISSED_KEY = 'scrolless_push_dismissed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function NotificationPrompt() {
  const [state, setState] = useState<'loading' | 'hidden' | 'prompt' | 'granted' | 'denied'>('loading');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setState('hidden');
      return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
      setState('granted');
      // Try to get the existing subscription endpoint
      navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
        if (sub) setEndpoint(sub.endpoint);
      });
      return;
    }
    if (perm === 'denied') {
      setState('hidden');
      return;
    }
    if (localStorage.getItem(DISMISSED_KEY)) {
      setState('hidden');
      return;
    }
    setState('prompt');
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState('denied');
        return;
      }

      const { key } = await getVapidKey();
      if (!key) throw new Error('No VAPID key configured');

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as unknown as ArrayBuffer,
      });

      await subscribePush(sub.toJSON() as PushSubscriptionJSON);
      setEndpoint(sub.endpoint);
      setState('granted');
    } catch (err) {
      console.error('Push subscription failed:', err);
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setState('hidden');
  }

  async function handleDisable() {
    if (!endpoint) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      await unsubscribePush(endpoint);
      setState('prompt');
      setEndpoint(null);
      localStorage.removeItem(DISMISSED_KEY);
    } catch (err) {
      console.error('Unsubscribe failed:', err);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'hidden' || state === 'denied') return null;

  if (state === 'granted') {
    return (
      <div class="notif-prompt notif-prompt--on">
        <span class="material-symbols-outlined">notifications_active</span>
        <span>Notifications: On</span>
        <button class="btn btn--ghost btn--sm" onClick={handleDisable} disabled={busy}>
          Disable
        </button>
      </div>
    );
  }

  return (
    <div class="notif-prompt">
      <span class="material-symbols-outlined">notifications</span>
      <span class="notif-prompt__text">Get notified when new content arrives</span>
      <div class="notif-prompt__actions">
        <button class="btn btn--primary btn--sm" onClick={handleEnable} disabled={busy}>
          {busy ? '…' : 'Enable'}
        </button>
        <button class="btn btn--ghost btn--sm" onClick={handleDismiss} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}
