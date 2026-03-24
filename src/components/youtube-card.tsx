import { useExpandable } from '../hooks/use-expandable';
import type { FeedItemResponse } from '../types';
import { relativeTime } from '../utils';

interface Props {
  item: FeedItemResponse;
  onMarkRead: (id: string) => void;
}

export function YouTubeCard({ item, onMarkRead }: Props) {
  const { expanded, toggle } = useExpandable(item.id, item.is_read, onMarkRead);

  return (
    <article
      class={`card card--youtube${item.is_read ? '' : ' card--unread'}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && toggle()}
    >
      {item.thumbnail_url && (
        <div class={`card__thumb${expanded ? ' card__thumb--expanded' : ''}`}>
          <img src={item.thumbnail_url} alt="" loading="lazy" />
          <div class="card__source-badge card__source-badge--youtube">
            <span class="material-symbols-outlined">smart_display</span>
          </div>
        </div>
      )}
      <div class="card__body">
        <div class="card__meta">
          {item.author && <span class="card__author">{item.author}</span>}
          <span class="card__time">{relativeTime(item.published_at)}</span>
        </div>
        <h3 class="card__title">{item.title}</h3>
        {expanded && (
          <div class="card__expanded">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--primary"
              onClick={(e) => e.stopPropagation()}
            >
              <span class="material-symbols-outlined">play_arrow</span>
              Watch on YouTube
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
