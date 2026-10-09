import { useState, useEffect, useRef } from 'preact/hooks';
import { getFeedItems, type FeedItem } from '../api';
import { FEED_CHANGED } from '../feed-events';
import type { FeedItemResponse } from '../types';

export type FeedView = 'feed' | 'discover' | 'saved';

interface UseFeedItemsOptions {
  source?: string;
  view: FeedView | string;
}

const PAGE_SIZE = 50;

function toResponse(item: FeedItem): FeedItemResponse {
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

export function useFeedItems(opts: UseFeedItemsOptions) {
  const [items, setItems] = useState<FeedItemResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ignore responses from superseded requests (view/source changed mid-flight)
  const generation = useRef(0);
  const isFeedView = opts.view === 'feed' || opts.view === 'discover' || opts.view === 'saved';

  async function loadPage(after: string | null) {
    const gen = generation.current;
    try {
      const page = await getFeedItems({ view: opts.view, source: opts.source, cursor: after, limit: PAGE_SIZE });
      if (gen !== generation.current) return;
      const mapped = page.items.map(toResponse);
      setItems((prev) => (after ? [...prev, ...mapped] : mapped));
      setCursor(page.next_cursor);
      setError(null);
    } catch (err) {
      console.warn('[useFeedItems] Failed to load feed:', err);
      if (gen === generation.current) setError(err instanceof Error ? err.message : 'Failed to load feed');
    }
  }

  async function reload() {
    if (!isFeedView) {
      setLoading(false);
      return;
    }
    generation.current++;
    setLoading(true);
    await loadPage(null);
    setLoading(false);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    await loadPage(cursor);
    setLoading(false);
  }

  /** Apply a local change to one item without refetching the page. */
  function patchItem(id: string, patch: Partial<Pick<FeedItemResponse, 'is_read' | 'is_saved'>>) {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      // Unsaving in the saved view removes the item from that view
      return opts.view === 'saved' ? next.filter((item) => item.is_saved) : next;
    });
  }

  useEffect(() => {
    void reload();
    const onChanged = () => { void reload(); };
    // Pick up items the agent pushed while the reader was in the background
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    window.addEventListener(FEED_CHANGED, onChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(FEED_CHANGED, onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.source, opts.view]);

  return { items, loading, error, hasMore: cursor !== null, loadMore, patchItem, reload };
}
