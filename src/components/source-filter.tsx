import type { Stats } from '../types';
import { markAllRead } from '../api';
import { displayName } from '../source-labels';

interface Props {
  stats: Stats | null;
  source: string;
  onSourceChange: (source: string) => void;
  onMarkedAllRead: () => void;
  onManageSources: () => void;
}

const SOURCE_ORDER = ['youtube', 'x', 'news'];

function unreadFor(stats: Stats | null, source: string): number {
  if (!stats) return 0;
  if (!source) return stats.unread;
  return stats.by_source.find((s) => s.source === source)?.unread ?? 0;
}

export function SourceFilter({
  stats,
  source,
  onSourceChange,
  onMarkedAllRead,
  onManageSources,
}: Props) {
  const unreadCount = unreadFor(stats, source);
  const dynamicSources = Array.from(new Set([
    ...SOURCE_ORDER,
    ...(stats?.by_source.map((s) => s.source) ?? []),
    ...(source ? [source] : []),
  ]));
  const sources = [{ id: '', label: 'All' }, ...dynamicSources.map((id) => ({ id, label: displayName(id) }))];

  async function handleMarkAllRead() {
    if (unreadCount === 0) return;
    await markAllRead(source || undefined);
    onMarkedAllRead();
  }

  return (
    <div class="source-filter">
      <div class="source-filter__chips" role="toolbar" aria-label="Feed source filters">
        {sources.map((s) => {
          const unread = unreadFor(stats, s.id);
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
