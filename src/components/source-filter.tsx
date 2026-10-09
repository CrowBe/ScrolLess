import type { UnreadCounts } from '../hooks/useUnreadCounts';
import { markAllRead } from '../api';
import { emit, FEED_CHANGED } from '../feed-events';
import { displayName } from '../source-labels';

interface Props {
  counts: UnreadCounts;
  source: string;
  onSourceChange: (source: string) => void;
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
    try {
      await markAllRead(source || undefined);
      emit(FEED_CHANGED);
    } catch (err) {
      console.warn('[SourceFilter] Failed to mark items read:', err);
    }
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
