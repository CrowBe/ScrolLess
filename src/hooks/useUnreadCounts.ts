import { useState, useEffect } from 'preact/hooks';
import { openScrollessDb } from '../idb';
import { getHostItemStats } from '../api';
import { HOST_FEED_CHANGED, HOST_STATE_CHANGED, IDB_UPDATED } from '../feed-events';

export interface UnreadCounts {
  total: number;
  unread: number;
  by_source: Record<string, { total: number; unread: number }>;
}

type SourceCounts = UnreadCounts['by_source'];

async function legacyCounts(): Promise<SourceCounts> {
  const by_source: SourceCounts = {};
  try {
    const db = await openScrollessDb();
    for (const item of await db.getAll('feed_items')) {
      const entry = (by_source[item.source] ??= { total: 0, unread: 0 });
      entry.total++;
      if (!item.is_read) entry.unread++;
    }
  } catch (err) {
    console.warn('[useUnreadCounts] Failed to load from IndexedDB:', err);
  }
  return by_source;
}

async function hostCounts(): Promise<SourceCounts> {
  const by_source: SourceCounts = {};
  try {
    const stats = await getHostItemStats();
    for (const row of stats.by_source) {
      by_source[row.source] = { total: row.count, unread: row.unread };
    }
  } catch (err) {
    console.warn('[useUnreadCounts] Failed to load host stats:', err);
  }
  return by_source;
}

export function useUnreadCounts(): UnreadCounts {
  const [counts, setCounts] = useState<UnreadCounts>({ total: 0, unread: 0, by_source: {} });

  async function recalculate() {
    const parts = await Promise.all([legacyCounts(), hostCounts()]);
    const by_source: SourceCounts = {};
    let total = 0;
    let unread = 0;
    for (const part of parts) {
      for (const [source, c] of Object.entries(part)) {
        const entry = (by_source[source] ??= { total: 0, unread: 0 });
        entry.total += c.total;
        entry.unread += c.unread;
        total += c.total;
        unread += c.unread;
      }
    }
    setCounts({ total, unread, by_source });
  }

  useEffect(() => {
    void recalculate();
    const onChange = () => { void recalculate(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recalculate();
    };
    const events = [IDB_UPDATED, HOST_FEED_CHANGED, HOST_STATE_CHANGED];
    for (const e of events) window.addEventListener(e, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      for (const e of events) window.removeEventListener(e, onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return counts;
}
