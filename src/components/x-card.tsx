import { useExpandable } from '../hooks/use-expandable';
import type { FeedItemResponse } from '../types';
import { relativeTime } from '../utils';
import { SaveButton } from './save-button';

interface Props {
  item: FeedItemResponse;
  onMarkRead: (id: string) => void;
  onToggleSave: (id: string, currentlySaved: boolean) => void;
}

export function XCard({ item, onMarkRead, onToggleSave }: Props) {
  const { expanded, toggle } = useExpandable(item.id, item.is_read, onMarkRead);
  const ctaLabel = item.action_label ?? (item.source === 'x' ? 'View on X' : 'View post');

  const handle = item.author ?? 'Unknown';
  const preview = item.content_preview ?? item.title;
  const truncated = !expanded && preview.length > 180 ? preview.slice(0, 180) + '…' : preview;

  return (
    <article
      class={`card card--x${item.is_read ? '' : ' card--unread'}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && toggle()}
    >
      {item.thumbnail_url && (
        <div class={`card__thumb${expanded ? ' card__thumb--expanded' : ''}`}>
          <img src={item.thumbnail_url} alt="" loading="lazy" />
          <div class="card__source-badge card__source-badge--x">𝕏</div>
        </div>
      )}
      <div class="card__header">
        <div class="card__avatar">
          <span class="material-symbols-outlined">person</span>
        </div>
        <div class="card__header-meta">
          <span class="card__author">{handle}</span>
          <span class="card__time">{relativeTime(item.published_at)}</span>
        </div>
        <SaveButton saved={item.is_saved} onToggle={() => onToggleSave(item.id, item.is_saved)} />
      </div>
      <div class="card__body">
        <p class="card__text">{truncated}</p>
        {expanded && (
          <div class="card__expanded">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--ghost"
              onClick={(e) => e.stopPropagation()}
            >
              {ctaLabel}
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
