import type { Stats } from '../types';
import { markAllRead } from '../api';
import { displayName } from '../source-labels';

interface Props {
  stats: Stats | null;
  source: string;
  discovery: boolean;
  onSourceChange: (source: string) => void;
  onDiscoveryChange: (discovery: boolean) => void;
  onMarkedAllRead: () => void;
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
  discovery,
  onSourceChange,
  onDiscoveryChange,
  onMarkedAllRead,
}: Props) {
  const dynamicSources = Array.from(new Set([
    ...SOURCE_ORDER,
    ...(stats?.by_source.map((s) => s.source) ?? []),
    ...(source ? [source] : []),
  ]));
  const sources = [{ id: '', label: 'All' }, ...dynamicSources.map((id) => ({ id, label: displayName(id) }))];

  async function handleMarkAllRead() {
    await markAllRead(source || undefined);
    onMarkedAllRead();
  }

  return (
    <div class="source-filter">
      <div class="source-filter__chips">
        {sources.map((s) => {
          const unread = unreadFor(stats, s.id);
          return (
            <button
              key={s.id}
              class={`chip${source === s.id ? ' chip--active' : ''}`}
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
        <div class="source-filter__toggle">
          <button
            class={`chip chip--sm${!discovery ? ' chip--active' : ''}`}
            onClick={() => onDiscoveryChange(false)}
          >
            Feed
          </button>
          <button
            class={`chip chip--sm${discovery ? ' chip--active' : ''}`}
            onClick={() => onDiscoveryChange(true)}
          >
            Discover
          </button>
        </div>

        <button class="btn btn--ghost btn--sm" onClick={handleMarkAllRead}>
          Mark all read
        </button>
      </div>
    </div>
  );
}
