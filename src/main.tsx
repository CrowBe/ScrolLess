import { render } from 'preact';
import { App } from './app';
import { startDeviceSession } from './bootstrap/device-session';
import './styles.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}


startDeviceSession({
  onFeedItems: async (items) => {
    window.dispatchEvent(new CustomEvent('scrolless:feed-items', { detail: { items } }));
  },
}).catch((err) => {
  console.warn('Device session bootstrap failed:', err);
});

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
