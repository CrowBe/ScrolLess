import { useState, useEffect } from 'preact/hooks';
import { useFeedItems } from './hooks/useFeedItems';
import { useUnreadCounts } from './hooks/useUnreadCounts';
import { updateFeedItem } from './api';
import { emit, ITEM_STATE_CHANGED } from './feed-events';
import { SourceFilter } from './components/source-filter';
import { FeedList } from './components/feed-list';
import { SwipeSession } from './components/swipe-session';
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

  // Feed and Discover are swipe sessions; only Saved is a list
  const isDeckView = view === 'feed' || view === 'discover';
  const { items, loading, error, hasMore, loadMore, patchItem, reload } = useFeedItems({
    source: '',
    view: view === 'saved' ? 'saved' : 'inactive',
  });
  const counts = useUnreadCounts();
  const moreAvailable = source ? counts.by_source[source]?.unread ?? 0 : counts.unread;

  async function updateItem(id: string, patch: { is_read?: boolean; is_saved?: boolean }) {
    patchItem(id, patch);
    try {
      await updateFeedItem(id, patch);
      emit(ITEM_STATE_CHANGED);
    } catch (err) {
      console.warn('[App] Failed to update item:', err);
      void reload();
    }
  }

  function handleMarkRead(id: string) {
    void updateItem(id, { is_read: true });
  }

  function handleToggleSave(id: string, currentlySaved: boolean) {
    void updateItem(id, { is_saved: !currentlySaved });
  }

  return (
    <div class="app">
      <header class="app-header glass">
        <span class="app-header__logo">ScrolLess</span>
        <div class="app-header__right">
          <DeviceSessionStatusBadge />
        </div>
      </header>

      <main id="main-content" class={`app-main${isDeckView ? ' app-main--deck' : ''}`} tabindex={-1}>
        <NotificationPrompt />

        {isDeckView && (
          <SourceFilter
            counts={counts}
            source={source}
            onSourceChange={setSource}
          />
        )}

        {view === 'settings' ? (
          <Settings />
        ) : isDeckView ? (
          <SwipeSession
            key={view}
            view={view}
            source={source}
            moreAvailable={moreAvailable}
            onOpenSettings={() => setView('settings')}
          />
        ) : (
          <FeedList
            view={view}
            items={items}
            loading={loading}
            error={error}
            hasMore={hasMore}
            onLoadMore={() => { void (error ? reload() : loadMore()); }}
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
