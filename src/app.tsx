import { useState, useEffect, useCallback } from 'preact/hooks';
import { getFeed, getStats, markRead } from './api';
import type { FeedItemResponse, Stats } from './types';
import { SourceFilter } from './components/source-filter';
import { FeedList } from './components/feed-list';
import { SyncStatus } from './components/sync-status';
import { NotificationPrompt } from './components/notification-prompt';
import { Settings } from './settings';

type View = 'feed' | 'discover' | 'saved' | 'settings';

const LIMIT = 50;

export function App() {
  const [view, setView] = useState<View>('feed');
  const [source, setSource] = useState('');
  const [discovery, setDiscovery] = useState(false);
  const [items, setItems] = useState<FeedItemResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  async function loadStats() {
    try {
      setStats(await getStats());
    } catch {
      // ignore
    }
  }

  const loadFeed = useCallback(async (reset = false) => {
    setLoading(true);
    const currentOffset = reset ? 0 : offset;
    try {
      const res = await getFeed({
        limit: LIMIT,
        offset: currentOffset,
        source: source || undefined,
        discovery: view === 'discover' ? true : (discovery ? true : undefined),
        unread_only: view === 'saved' ? false : undefined,
      });
      setTotal(res.total);
      setOffset(currentOffset + LIMIT);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    } catch (err) {
      console.error('Failed to load feed:', err);
    } finally {
      setLoading(false);
    }
  }, [source, discovery, view, offset]);

  // Reload on filter changes
  useEffect(() => {
    setOffset(0);
    setItems([]);
    loadFeed(true);
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, discovery, view]);

  function handleMarkRead(id: string) {
    markRead(id).catch(console.error);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
    );
    loadStats();
  }

  function handleMarkedAllRead() {
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
    loadStats();
  }

  const navItems: Array<{ id: View; icon: string; label: string }> = [
    { id: 'feed', icon: 'feed', label: 'Feed' },
    { id: 'discover', icon: 'explore', label: 'Discover' },
    { id: 'saved', icon: 'bookmark', label: 'Saved' },
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];

  return (
    <div class="app">
      {/* Glass header */}
      <header class="app-header glass">
        <span class="app-header__logo">ScrolLess</span>
        <div class="app-header__right">
          <SyncStatus />
          <button
            class="app-header__settings"
            onClick={() => setView('settings')}
            aria-label="Settings"
          >
            <span
              class="material-symbols-outlined"
              style={view === 'settings' ? 'font-variation-settings: "FILL" 1' : ''}
            >
              settings
            </span>
          </button>
        </div>
      </header>

      <main class="app-main">
        <NotificationPrompt />

        {(view === 'feed' || view === 'discover') && (
          <SourceFilter
            stats={stats}
            source={source}
            discovery={view === 'discover'}
            onSourceChange={setSource}
            onDiscoveryChange={(d) => {
              if (d) setView('discover');
              else setView('feed');
            }}
            onMarkedAllRead={handleMarkedAllRead}
          />
        )}

        {view === 'settings' ? (
          <Settings />
        ) : (
          <FeedList
            items={items}
            loading={loading}
            hasMore={items.length < total}
            onLoadMore={() => loadFeed(false)}
            onMarkRead={handleMarkRead}
          />
        )}
      </main>

      {/* Bottom navigation */}
      <nav class="bottom-nav glass">
        {navItems.map(({ id, icon, label }) => (
          <button
            key={id}
            class={`bottom-nav__item${view === id ? ' bottom-nav__item--active' : ''}`}
            onClick={() => setView(id)}
          >
            <span
              class="material-symbols-outlined"
              style={view === id ? 'font-variation-settings: "FILL" 1' : ''}
            >
              {icon}
            </span>
            {view !== id && <span class="bottom-nav__label">{label}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
