import type { FeedItemResponse } from '../types';
import { YouTubeCard } from './youtube-card';
import { XCard } from './x-card';
import { NewsCard } from './news-card';
import { ContentCard } from './content-card';

interface Props {
  view: 'feed' | 'discover' | 'saved' | 'settings';
  items: FeedItemResponse[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
  onToggleSave: (id: string, currentlySaved: boolean) => void;
  onOpenSettings: () => void;
}

export function FeedList({
  view,
  items,
  loading,
  hasMore,
  onLoadMore,
  onMarkRead,
  onToggleSave,
  onOpenSettings,
}: Props) {
  if (loading && items.length === 0) {
    return (
      <div class="feed-empty">
        <div class="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    const isFeed = view === 'feed';
    const isDiscover = view === 'discover';
    const title = isFeed
      ? 'Your feed is empty'
      : isDiscover
        ? 'Nothing to discover yet'
        : 'No saved items yet';
    const subtitle = isFeed
      ? 'Add your first source in Settings to start building a personalized feed.'
      : isDiscover
        ? 'Add a few sources to unlock recommendations and trending picks.'
        : 'Save stories from Feed or Discover so they are easy to revisit.';

    return (
      <div class="feed-empty">
        <span class="material-symbols-outlined feed-empty__icon">inbox</span>
        <p class="feed-empty__title">{title}</p>
        <p class="feed-empty__sub">{subtitle}</p>
        {(isFeed || isDiscover) && (
          <button class="btn btn--ghost btn--sm" onClick={onOpenSettings}>
            Manage sources
          </button>
        )}
      </div>
    );
  }

  return (
    <div class="feed-list">
      {items.map((item) => {
        const cardType = item.card_type ?? item.content_type;
        switch (cardType ?? item.source) {
          case 'youtube':
          case 'video':
            return <YouTubeCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
          case 'x':
          case 'post':
            return <XCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
          case 'news':
          case 'article':
            return <NewsCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
          default:
            return <ContentCard key={item.id} item={item} onMarkRead={onMarkRead} onToggleSave={onToggleSave} />;
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
