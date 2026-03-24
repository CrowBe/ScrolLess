import { render } from 'preact';
import { App } from './app';
import './styles.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
