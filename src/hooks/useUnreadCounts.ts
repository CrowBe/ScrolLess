import { useState, useEffect } from 'preact/hooks';
import { getFeedStats } from '../api';
import { FEED_CHANGED, ITEM_STATE_CHANGED } from '../feed-events';

export interface UnreadCounts {
  total: number;
  unread: number;
  by_source: Record<string, { total: number; unread: number }>;
}

export function useUnreadCounts(): UnreadCounts {
  const [counts, setCounts] = useState<UnreadCounts>({ total: 0, unread: 0, by_source: {} });

  async function recalculate() {
    try {
      const stats = await getFeedStats();
      const by_source: UnreadCounts['by_source'] = {};
      for (const row of stats.by_source) {
        by_source[row.source] = { total: row.count, unread: row.unread };
      }
      setCounts({ total: stats.total, unread: stats.unread, by_source });
    } catch (err) {
      console.warn('[useUnreadCounts] Failed to load stats:', err);
    }
  }

  useEffect(() => {
    void recalculate();
    const onChange = () => { void recalculate(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recalculate();
    };
    window.addEventListener(FEED_CHANGED, onChange);
    window.addEventListener(ITEM_STATE_CHANGED, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(FEED_CHANGED, onChange);
      window.removeEventListener(ITEM_STATE_CHANGED, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return counts;
}
