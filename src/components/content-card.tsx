import { useExpandable } from '../hooks/use-expandable';
import type { FeedItemResponse } from '../types';
import { relativeTime } from '../utils';
import { SaveButton } from './save-button';

interface Props {
  item: FeedItemResponse;
  onMarkRead: (id: string) => void;
  onToggleSave: (id: string, currentlySaved: boolean) => void;
}

function uiForType(item: FeedItemResponse): { icon: string; cta: string } {
  const kind = item.card_type ?? item.content_type ?? 'article';
  if (kind === 'video') return { icon: item.action_icon ?? 'play_arrow', cta: item.action_label ?? 'Watch video' };
  if (kind === 'post') return { icon: item.action_icon ?? 'forum', cta: item.action_label ?? 'View post' };
  return { icon: item.action_icon ?? 'open_in_new', cta: item.action_label ?? 'Open item' };
}

export function ContentCard({ item, onMarkRead, onToggleSave }: Props) {
  const { expanded, toggle } = useExpandable(item.id, item.is_read, onMarkRead);
  const preview = item.content_preview ?? item.title;
  const truncated = !expanded && preview.length > 220 ? `${preview.slice(0, 220)}…` : preview;
  const ui = uiForType(item);

  return (
    <article
      class={`card card--news${item.is_read ? '' : ' card--unread'}`}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && toggle()}
    >
      {item.thumbnail_url && (
        <div class="card__thumb">
          <img src={item.thumbnail_url} alt="" loading="lazy" />
          <div class="card__source-badge card__source-badge--news">
            <span class="material-symbols-outlined">{ui.icon}</span>
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
        <p class="card__excerpt">{truncated}</p>
        {expanded && (
          <div class="card__expanded">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--primary"
              onClick={(e) => e.stopPropagation()}
            >
              <span class="material-symbols-outlined">{ui.icon}</span>
              {ui.cta}
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
