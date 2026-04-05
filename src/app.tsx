import { useState, useEffect, useCallback } from 'preact/hooks';
import { getFeed, getStats, markRead, saveItem, unsaveItem } from './api';
import type { FeedItemResponse, Stats } from './types';
import { SourceFilter } from './components/source-filter';
import { FeedList } from './components/feed-list';
import { SyncStatus } from './components/sync-status';
import { DeviceSessionStatusBadge } from './components/device-session-status';
import { NotificationPrompt } from './components/notification-prompt';
import { Settings } from './settings';

type View = 'feed' | 'discover' | 'saved' | 'settings';

const LIMIT = 50;

const HASH_TO_VIEW: Record<string, View> = {
  '#/feed': 'feed',
  '#/discover': 'discover',
  '#/saved': 'saved',
  '#/settings': 'settings',
};
const VIEW_TO_HASH: Record<View, string> = {
  feed: '#/feed',
  discover: '#/discover',
  saved: '#/saved',
  settings: '#/settings',
};

function viewFromHash(): View {
  return HASH_TO_VIEW[location.hash] ?? 'feed';
}

const NAV_ITEMS: Array<{ id: View; icon: string; label: string }> = [
  { id: 'feed', icon: 'feed', label: 'Feed' },
  { id: 'discover', icon: 'explore', label: 'Discover' },
  { id: 'saved', icon: 'bookmark', label: 'Saved' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

export function App() {
  const [view, setViewState] = useState<View>(viewFromHash);

  function setView(v: View) {
    setViewState(v);
    const target = VIEW_TO_HASH[v];
    if (location.hash !== target) {
      location.hash = target;
    }
  }

  useEffect(() => {
    function onHashChange() {
      setViewState(viewFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    // Set initial hash if empty
    if (!location.hash) {
      location.hash = VIEW_TO_HASH.feed;
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [source, setSource] = useState('');
  const [items, setItems] = useState<FeedItemResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  async function loadStats() {
    try {
      const discoveryParam = view === 'discover' ? true : view === 'feed' ? false : undefined;
      setStats(await getStats(discoveryParam));
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
        discovery: view === 'discover' ? true : view === 'feed' ? false : undefined,
        saved: view === 'saved' ? true : undefined,
      });
      setTotal(res.total);
      setOffset(currentOffset + LIMIT);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
    } catch (err) {
      console.error('Failed to load feed:', err);
    } finally {
      setLoading(false);
    }
  }, [source, view, offset]);

  // Reload on filter changes
  useEffect(() => {
    setOffset(0);
    setItems([]);
    loadFeed(true);
    loadStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, view]);

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


  useEffect(() => {
    function onFeedItems() {
      setOffset(0);
      loadFeed(true);
      loadStats();
    }

    window.addEventListener('scrolless:feed-items', onFeedItems);
    return () => window.removeEventListener('scrolless:feed-items', onFeedItems);
  }, [loadFeed]);

  function handleToggleSave(id: string, saved: boolean) {
    (saved ? unsaveItem(id) : saveItem(id)).catch(console.error);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, is_saved: !saved } : item))
    );
  }

  return (
    <div class="app">
      {/* Glass header */}
      <header class="app-header glass">
        <span class="app-header__logo">ScrolLess</span>
        <div class="app-header__right">
          <DeviceSessionStatusBadge />
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
            onSourceChange={setSource}
            onMarkedAllRead={handleMarkedAllRead}
            onManageSources={() => setView('settings')}
          />
        )}

        {view === 'settings' ? (
          <Settings />
        ) : (
          <FeedList
            view={view}
            items={items}
            loading={loading}
            hasMore={items.length < total}
            onLoadMore={() => loadFeed(false)}
            onMarkRead={handleMarkRead}
            onToggleSave={handleToggleSave}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </main>

      {/* Bottom navigation */}
      <nav class="bottom-nav glass">
        {NAV_ITEMS.map(({ id, icon, label }) => (
          <button
            key={id}
            class={`bottom-nav__item${view === id ? ' bottom-nav__item--active' : ''}`}
            onClick={() => setView(id)}
            aria-label={label}
            aria-current={view === id ? 'page' : undefined}
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
