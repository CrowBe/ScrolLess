import { render } from 'preact';
import { useState } from 'preact/hooks';
import { App } from './app';
import { startDeviceSession, saveEnrollmentToken, EnrollmentTokenRequiredError } from './bootstrap/device-session';
import { runRetentionCleanup } from './retention';
import { syncPreferencesToIdb } from './api';
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
  const [needsEnrollmentToken, setNeedsEnrollmentToken] = useState(false);
  const [enrollmentInput, setEnrollmentInput] = useState('');
  const [enrollmentSaving, setEnrollmentSaving] = useState(false);

  // Start device session once on mount (re-runs after enrollment token is submitted)
  if (!ready && !initError && !needsEnrollmentToken) {
    startDeviceSession({
      onReady: () => {
        setReady(true);
        // Sync server preferences to IDB so retention and other local logic uses the correct values
        syncPreferencesToIdb().catch((err) => {
          console.warn('[preferences] Sync to IDB failed:', err);
        });
        runRetentionCleanup().catch((err) => {
          console.warn('[retention] Cleanup failed:', err);
        });
      },
    }).catch((err) => {
      if (err instanceof EnrollmentTokenRequiredError) {
        setNeedsEnrollmentToken(true);
      } else {
        const msg = err instanceof Error ? err.message : 'Device session failed';
        console.warn('[device-session]', msg);
        setInitError(msg);
      }
    });
  }

  if (needsEnrollmentToken) {
    async function handleEnrollmentSubmit(e: Event) {
      e.preventDefault();
      const token = enrollmentInput.trim();
      if (!token) return;
      setEnrollmentSaving(true);
      await saveEnrollmentToken(token);
      setEnrollmentInput('');
      setEnrollmentSaving(false);
      setNeedsEnrollmentToken(false);
    }

    return (
      <div class="device-init">
        <span class="material-symbols-outlined">lock</span>
        <p>An enrollment token is required to register this device.</p>
        <p>Enter the <code>DEVICE_ENROLLMENT_TOKEN</code> value from your server configuration.</p>
        <form onSubmit={handleEnrollmentSubmit} style="display:flex;gap:0.5rem;margin-top:0.5rem">
          <input
            class="form-input"
            type="password"
            placeholder="Enrollment token"
            value={enrollmentInput}
            onInput={(e) => setEnrollmentInput((e.target as HTMLInputElement).value)}
            disabled={enrollmentSaving}
            autoFocus
          />
          <button class="btn btn--primary" type="submit" disabled={!enrollmentInput.trim() || enrollmentSaving}>
            {enrollmentSaving ? '…' : 'Submit'}
          </button>
        </form>
      </div>
    );
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
