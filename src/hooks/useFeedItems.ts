import { useState, useEffect } from 'preact/hooks';
import { openScrollessDb, type FeedItem } from '../idb';

export type FeedView = 'feed' | 'discover' | 'saved';

interface UseFeedItemsOptions {
  source?: string;
  view: FeedView | string;
}

export function useFeedItems(opts: UseFeedItemsOptions) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const db = await openScrollessDb();
      // getAllFromIndex returns ascending by default; reverse for newest-first
      const all = (await db.getAllFromIndex('feed_items', 'by_published_at')).reverse();

      let filtered = all;
      if (opts.view === 'discover') {
        filtered = all.filter((i) => i.is_discovery);
      } else if (opts.view === 'feed') {
        filtered = all.filter((i) => !i.is_discovery);
      } else if (opts.view === 'saved') {
        filtered = all.filter((i) => i.is_saved);
      }

      if (opts.source) {
        filtered = filtered.filter((i) => i.source === opts.source);
      }

      setItems(filtered);
    } catch (err) {
      console.warn('[useFeedItems] Failed to load from IndexedDB:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    window.addEventListener('scrolless:idb-updated', reload);
    return () => window.removeEventListener('scrolless:idb-updated', reload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.source, opts.view]);

  return { items, loading };
}
