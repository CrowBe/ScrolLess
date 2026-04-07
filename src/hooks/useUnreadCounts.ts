import { useState, useEffect } from 'preact/hooks';
import { openScrollessDb } from '../idb';

export interface UnreadCounts {
  total: number;
  unread: number;
  by_source: Record<string, { total: number; unread: number }>;
}

export function useUnreadCounts(): UnreadCounts {
  const [counts, setCounts] = useState<UnreadCounts>({ total: 0, unread: 0, by_source: {} });

  async function recalculate() {
    try {
      const db = await openScrollessDb();
      const all = await db.getAll('feed_items');
      const by_source: Record<string, { total: number; unread: number }> = {};
      let unread = 0;

      for (const item of all) {
        if (!by_source[item.source]) {
          by_source[item.source] = { total: 0, unread: 0 };
        }
        by_source[item.source].total++;
        if (!item.is_read) {
          by_source[item.source].unread++;
          unread++;
        }
      }

      setCounts({ total: all.length, unread, by_source });
    } catch (err) {
      console.warn('[useUnreadCounts] Failed to load from IndexedDB:', err);
    }
  }

  useEffect(() => {
    void recalculate();
    window.addEventListener('scrolless:idb-updated', recalculate);
    return () => window.removeEventListener('scrolless:idb-updated', recalculate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return counts;
}
