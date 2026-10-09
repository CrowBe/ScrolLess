import { useState, useEffect, useRef } from 'preact/hooks';
import { openScrollessDb, type FeedItem } from '../idb';
import { getHostItems, type HostItem } from '../api';
import { HOST_FEED_CHANGED, IDB_UPDATED } from '../feed-events';
import type { FeedItemResponse } from '../types';

export type FeedView = 'feed' | 'discover' | 'saved';

interface UseFeedItemsOptions {
  source?: string;
  view: FeedView | string;
}

const HOST_PAGE_SIZE = 50;

/** Map legacy IndexedDB FeedItem to the FeedItemResponse shape expected by card components. */
function fromIdb(item: FeedItem): FeedItemResponse {
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

function fromHost(item: HostItem): FeedItemResponse {
  return {
    id: item.id,
    source: item.source,
    content_type: item.content_type ?? undefined,
    title: item.title,
    author: item.author ?? undefined,
    url: item.url,
    content_preview: item.content_preview ?? undefined,
    thumbnail_url: item.thumbnail_url ?? undefined,
    metadata: item.metadata ?? undefined,
    tags: item.tags,
    is_discovery: item.is_discovery,
    // Unknown publication time: show when the host first saw the item
    published_at: item.published_at ?? item.first_seen_at,
    fetched_at: item.first_seen_at,
    is_read: item.is_read,
    is_saved: item.is_saved,
  };
}

async function loadLegacy(view: string, source?: string): Promise<FeedItemResponse[]> {
  try {
    const db = await openScrollessDb();
    let items = await db.getAll('feed_items');
    if (view === 'discover') items = items.filter((i) => i.is_discovery);
    else if (view === 'feed') items = items.filter((i) => !i.is_discovery);
    else if (view === 'saved') items = items.filter((i) => i.is_saved);
    if (source) items = items.filter((i) => i.source === source);
    return items.map(fromIdb);
  } catch (err) {
    console.warn('[useFeedItems] Failed to load from IndexedDB:', err);
    return [];
  }
}

function newestFirst(a: FeedItemResponse, b: FeedItemResponse): number {
  return a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0;
}

export function useFeedItems(opts: UseFeedItemsOptions) {
  const [hostItems, setHostItems] = useState<FeedItemResponse[]>([]);
  const [legacyItems, setLegacyItems] = useState<FeedItemResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Ignore responses from superseded requests (view/source changed mid-flight)
  const generation = useRef(0);
  const isFeedView = opts.view === 'feed' || opts.view === 'discover' || opts.view === 'saved';

  async function reloadLegacy() {
    const gen = generation.current;
    const items = await loadLegacy(opts.view, opts.source);
    if (gen === generation.current) setLegacyItems(items);
  }

  async function loadHostPage(after: string | null) {
    const gen = generation.current;
    try {
      const page = await getHostItems({ view: opts.view, source: opts.source, cursor: after, limit: HOST_PAGE_SIZE });
      if (gen !== generation.current) return;
      const mapped = page.items.map(fromHost);
      setHostItems((prev) => (after ? [...prev, ...mapped] : mapped));
      setCursor(page.next_cursor);
    } catch (err) {
      // Host unreachable or unauthorised: keep showing legacy items
      console.warn('[useFeedItems] Failed to load host items:', err);
      if (gen === generation.current && !after) {
        setHostItems([]);
        setCursor(null);
      }
    }
  }

  async function reload() {
    if (!isFeedView) {
      setLoading(false);
      return;
    }
    generation.current++;
    setLoading(true);
    await Promise.all([reloadLegacy(), loadHostPage(null)]);
    setLoading(false);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    await loadHostPage(cursor);
    setLoading(false);
  }

  /** Apply a local change to one host item without refetching the page. */
  function patchItem(id: string, patch: Partial<Pick<FeedItemResponse, 'is_read' | 'is_saved'>>) {
    setHostItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      // Unsaving in the saved view removes the item from that view
      return opts.view === 'saved' ? next.filter((item) => item.is_saved) : next;
    });
  }

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const onIdb = () => { void reloadLegacy(); };
    const onHost = () => { void reload(); };
    window.addEventListener(IDB_UPDATED, onIdb);
    window.addEventListener(HOST_FEED_CHANGED, onHost);
    // Pick up items the agent pushed while the reader was in the background
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(IDB_UPDATED, onIdb);
      window.removeEventListener(HOST_FEED_CHANGED, onHost);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.source, opts.view]);

  const items = [...hostItems, ...legacyItems].sort(newestFirst);
  return { items, loading, hasMore: cursor !== null, loadMore, patchItem, reload };
}
