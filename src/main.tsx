import { render } from 'preact';
import { useState } from 'preact/hooks';
import { App } from './app';
import { startDeviceSession } from './bootstrap/device-session';
import { runRetentionCleanup } from './retention';
import './styles.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

function Root() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Start device session once on mount
  if (!ready && !initError) {
    startDeviceSession({
      onReady: () => {
        setReady(true);
        // Run retention cleanup in the background after init
        runRetentionCleanup().catch((err) => {
          console.warn('[retention] Cleanup failed:', err);
        });
      },
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Device session failed';
      console.warn('[device-session]', msg);
      setInitError(msg);
    });
  }

  if (!ready && !initError) {
    return (
      <div class="device-init">
        <div class="spinner" />
        <p>Setting up your device…</p>
      </div>
    );
  }

  if (initError) {
    return (
      <div class="device-init device-init--error">
        <span class="material-symbols-outlined">error</span>
        <p>Failed to initialise: {initError}</p>
        <button class="btn btn--ghost" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }

  return <App />;
}

const root = document.getElementById('app');
if (root) {
  render(<Root />, root);
}
