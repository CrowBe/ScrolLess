import { useState, useEffect } from 'preact/hooks';
import { useFeedItems } from './hooks/useFeedItems';
import { useUnreadCounts } from './hooks/useUnreadCounts';
import { openScrollessDb, type FeedItem } from './idb';
import type { FeedItemResponse } from './types';
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

/** Map IndexedDB FeedItem to the FeedItemResponse shape expected by card components. */
function toResponse(item: FeedItem): FeedItemResponse {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    author: item.author,
    url: item.url,
    content_preview: item.content_preview,
    thumbnail_url: item.thumbnail_url,
    tags: item.tags,
    is_discovery: item.is_discovery,
    published_at: item.published_at,
    fetched_at: item.fetched_at,
    is_read: item.is_read,
    is_saved: item.is_saved,
  };
}

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

  const { items, loading } = useFeedItems({ source, view });
  const counts = useUnreadCounts();

  async function handleMarkRead(id: string) {
    const db = await openScrollessDb();
    const item = await db.get('feed_items', id);
    if (item) {
      await db.put('feed_items', { ...item, is_read: true });
      window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
    }
  }

  async function handleToggleSave(id: string, currentlySaved: boolean) {
    const db = await openScrollessDb();
    const item = await db.get('feed_items', id);
    if (item) {
      await db.put('feed_items', { ...item, is_saved: !currentlySaved });
      window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
    }
  }

  const displayItems = items.map(toResponse);

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
            items={displayItems}
            loading={loading}
            hasMore={false}
            onLoadMore={() => {}}
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
