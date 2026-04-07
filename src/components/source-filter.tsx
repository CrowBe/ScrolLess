import type { UnreadCounts } from '../hooks/useUnreadCounts';
import { openScrollessDb } from '../idb';
import { displayName } from '../source-labels';

interface Props {
  counts: UnreadCounts;
  source: string;
  onSourceChange: (source: string) => void;
  onManageSources: () => void;
}

const SOURCE_ORDER = ['youtube', 'x', 'news'];

function unreadFor(counts: UnreadCounts, source: string): number {
  if (!source) return counts.unread;
  return counts.by_source[source]?.unread ?? 0;
}

export function SourceFilter({
  counts,
  source,
  onSourceChange,
  onManageSources,
}: Props) {
  const unreadCount = unreadFor(counts, source);
  const knownSources = Object.keys(counts.by_source);
  const dynamicSources = Array.from(new Set([
    ...SOURCE_ORDER,
    ...knownSources,
    ...(source ? [source] : []),
  ]));
  const sources = [{ id: '', label: 'All' }, ...dynamicSources.map((id) => ({ id, label: displayName(id) }))];

  async function handleMarkAllRead() {
    if (unreadCount === 0) return;
    const db = await openScrollessDb();
    const all = await db.getAll('feed_items');
    const tx = db.transaction('feed_items', 'readwrite');
    for (const item of all) {
      if (item.is_read) continue;
      if (source && item.source !== source) continue;
      await tx.store.put({ ...item, is_read: true });
    }
    await tx.done;
    window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
  }

  return (
    <div class="source-filter">
      <div class="source-filter__chips" role="toolbar" aria-label="Feed source filters">
        {sources.map((s) => {
          const unread = unreadFor(counts, s.id);
          return (
            <button
              key={s.id}
              class={`chip${source === s.id ? ' chip--active' : ''}`}
              aria-pressed={source === s.id}
              onClick={() => onSourceChange(s.id)}
            >
              {s.label}
              {unread > 0 && (
                <span class="chip__badge">{unread > 99 ? '99+' : unread}</span>
              )}
            </button>
          );
        })}
      </div>

      <div class="source-filter__actions">
        <button class="btn btn--ghost btn--sm" onClick={onManageSources}>
          Manage sources
        </button>
        <button
          class="btn btn--ghost btn--sm"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
        >
          Mark all read
        </button>
      </div>
    </div>
  );
}
