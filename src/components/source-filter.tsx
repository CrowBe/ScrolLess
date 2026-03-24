import type { Stats } from '../types';
import { markAllRead } from '../api';

interface Props {
  stats: Stats | null;
  source: string;
  discovery: boolean;
  onSourceChange: (source: string) => void;
  onDiscoveryChange: (discovery: boolean) => void;
  onMarkedAllRead: () => void;
}

const SOURCES = [
  { id: '', label: 'All' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'x', label: 'X' },
  { id: 'news', label: 'News' },
];

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
  async function handleMarkAllRead() {
    await markAllRead(source || undefined);
    onMarkedAllRead();
  }

  return (
    <div class="source-filter">
      <div class="source-filter__chips">
        {SOURCES.map((s) => {
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
