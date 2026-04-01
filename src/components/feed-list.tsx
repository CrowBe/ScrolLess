import type { FeedItemResponse } from '../types';
import { YouTubeCard } from './youtube-card';
import { XCard } from './x-card';
import { NewsCard } from './news-card';

interface Props {
  items: FeedItemResponse[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
  onToggleSave: (id: string, currentlySaved: boolean) => void;
}

export function FeedList({ items, loading, hasMore, onLoadMore, onMarkRead, onToggleSave }: Props) {
  if (loading && items.length === 0) {
    return (
      <div class="feed-empty">
        <div class="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div class="feed-empty">
        <span class="material-symbols-outlined feed-empty__icon">inbox</span>
        <p>No items yet</p>
        <p class="feed-empty__sub">Items will appear here once the agent syncs</p>
      </div>
    );
  }

  return (
    <div class="feed-list">
      {items.map((item) => {
        switch (item.source) {
          case 'youtube':
            return <YouTubeCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
          case 'x':
            return <XCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
          default:
            return <NewsCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
        }
      })}

      {hasMore && (
        <div class="feed-list__more">
          <button class="btn btn--ghost" onClick={onLoadMore} disabled={loading}>
            {loading ? <span class="spinner spinner--sm" /> : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
