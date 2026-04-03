import { useExpandable } from '../hooks/use-expandable';
import type { FeedItemResponse } from '../types';
import { relativeTime } from '../utils';
import { SaveButton } from './save-button';

interface Props {
  item: FeedItemResponse;
  onMarkRead: (id: string) => void;
  onToggleSave: (id: string, currentlySaved: boolean) => void;
}

export function NewsCard({ item, onMarkRead, onToggleSave }: Props) {
  const { expanded, toggle } = useExpandable(item.id, item.is_read, onMarkRead);
  const ctaLabel = item.action_label ?? (item.source === 'news' ? 'Read article' : 'Open item');
  const ctaIcon = item.action_icon ?? 'open_in_new';

  return (
    <article
      class={`card card--news${item.is_read ? '' : ' card--unread'}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && toggle()}
    >
      {expanded && item.thumbnail_url && (
        <div class="card__hero">
          <img src={item.thumbnail_url} alt="" loading="lazy" />
          <div class="card__source-badge card__source-badge--news">
            <span class="material-symbols-outlined">article</span>
          </div>
        </div>
      )}
      <div class="card__body">
        <div class="card__meta">
          {item.author && <span class="card__author">{item.author}</span>}
          <span class="card__time">{relativeTime(item.published_at)}</span>
          <SaveButton saved={item.is_saved} onToggle={() => onToggleSave(item.id, item.is_saved)} />
        </div>
        <h3 class="card__title">{item.title}</h3>
        {expanded && (
          <div class="card__expanded">
            {item.content_preview && (
              <p class="card__excerpt">{item.content_preview}</p>
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--primary"
              onClick={(e) => e.stopPropagation()}
            >
              <span class="material-symbols-outlined">{ctaIcon}</span>
              {ctaLabel}
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
