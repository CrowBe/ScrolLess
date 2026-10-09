import { useState, useEffect } from 'preact/hooks';
import { useFeedItems } from './hooks/useFeedItems';
import { useUnreadCounts } from './hooks/useUnreadCounts';
import { openScrollessDb } from './idb';
import { isHostItemId, updateHostItem } from './api';
import { emit, HOST_STATE_CHANGED, IDB_UPDATED } from './feed-events';
import { SourceFilter } from './components/source-filter';
import { FeedList } from './components/feed-list';
import { SyncStatus } from './components/sync-status';
import { DeviceSessionStatusBadge } from './components/device-session-status';
import { NotificationPrompt } from './components/notification-prompt';
import { Settings } from './settings';

type View = 'feed' | 'discover' | 'saved' | 'settings';

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
const VIEW_TO_TITLE: Record<View, string> = {
  feed: 'Feed',
  discover: 'Discover',
  saved: 'Saved',
  settings: 'Settings',
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
  const [source, setSource] = useState('');

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
    if (!location.hash) {
      location.hash = VIEW_TO_HASH.feed;
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `ScrolLess — ${VIEW_TO_TITLE[view]}`;
  }, [view]);

  const { items, loading, hasMore, loadMore, patchItem, reload } = useFeedItems({ source, view });
  const counts = useUnreadCounts();

  async function updateHost(id: string, patch: { is_read?: boolean; is_saved?: boolean }) {
    patchItem(id, patch);
    try {
      await updateHostItem(id, patch);
      emit(HOST_STATE_CHANGED);
    } catch (err) {
      console.warn('[App] Failed to update host item:', err);
      void reload();
    }
  }

  async function updateLegacy(id: string, patch: { is_read?: boolean; is_saved?: boolean }) {
    const db = await openScrollessDb();
    const item = await db.get('feed_items', id);
    if (item) {
      await db.put('feed_items', { ...item, ...patch });
      emit(IDB_UPDATED);
    }
  }

  async function handleMarkRead(id: string) {
    const patch = { is_read: true };
    await (isHostItemId(id) ? updateHost(id, patch) : updateLegacy(id, patch));
  }

  async function handleToggleSave(id: string, currentlySaved: boolean) {
    const patch = { is_saved: !currentlySaved };
    await (isHostItemId(id) ? updateHost(id, patch) : updateLegacy(id, patch));
  }

  return (
    <div class="app">
      <header class="app-header glass">
        <span class="app-header__logo">ScrolLess</span>
        <div class="app-header__right">
          <DeviceSessionStatusBadge />
          <SyncStatus />
        </div>
      </header>

      <main id="main-content" class="app-main" tabindex={-1}>
        <NotificationPrompt />

        {(view === 'feed' || view === 'discover') && (
          <SourceFilter
            counts={counts}
            source={source}
            onSourceChange={setSource}
          />
        )}

        {view === 'settings' ? (
          <Settings />
        ) : (
          <FeedList
            view={view}
            items={items}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={() => { void loadMore(); }}
            onMarkRead={handleMarkRead}
            onToggleSave={handleToggleSave}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </main>

      <nav class="bottom-nav glass" aria-label="Primary">
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
