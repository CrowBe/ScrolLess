import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeedItemResponse } from '../types';
import type { Verdict } from '../api';
import { displayName } from '../source-labels';
import { relativeTime } from '../utils';
import { VERDICT_UI } from './swipe-deck';
import { WhyThisCard } from './why-this-card';

interface Props {
  item: FeedItemResponse;
  onClose: () => void;
  /** Act on the card from full screen; omitted for read-only contexts. */
  onVerdict?: (verdict: Verdict) => void;
}

/** Full-screen reading view for one card. */
export function FullScreenCard({ item, onClose, onVerdict }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = item.body ?? item.content_preview;

  return (
    <div class="fullscreen-card" role="dialog" aria-modal="true" aria-labelledby="fullscreen-card-title">
      <div class="fullscreen-card__bar">
        <button ref={closeRef} class="fullscreen-card__close" onClick={onClose} aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
        <span class="fullscreen-card__source">{displayName(item.source)}</span>
      </div>

      <div class="fullscreen-card__scroll">
        {item.thumbnail_url && !imageFailed && (
          <div class="fullscreen-card__media">
            <img src={item.thumbnail_url} alt="" onError={() => setImageFailed(true)} />
          </div>
        )}
        <div class="fullscreen-card__content">
          <div class="swipe-card__meta">
            {item.author && <span class="swipe-card__author">{item.author}</span>}
            <span class="swipe-card__time">{relativeTime(item.published_at)}</span>
          </div>
          <h2 id="fullscreen-card-title" class="fullscreen-card__title">{item.title}</h2>
          {text && <p class="fullscreen-card__text">{text}</p>}
          {item.tags.length > 0 && (
            <ul class="fullscreen-card__tags">
              {item.tags.map((tag) => <li key={tag} class="chip">{tag}</li>)}
            </ul>
          )}
          <a class="btn btn--primary fullscreen-card__open" href={item.url} target="_blank" rel="noopener noreferrer">
            <span class="material-symbols-outlined">open_in_new</span>
            Open original
          </a>
          <WhyThisCard item={item} />
        </div>
      </div>

      {onVerdict && (
        <div class="swipe-actions fullscreen-card__actions" role="toolbar" aria-label="Card actions">
          {(['dislike', 'save', 'like'] as const).map((verdict) => (
            <button
              key={verdict}
              class={`swipe-actions__btn swipe-actions__btn--${verdict}`}
              onClick={() => onVerdict(verdict)}
              aria-label={VERDICT_UI[verdict].label}
            >
              <span class="material-symbols-outlined">{VERDICT_UI[verdict].icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
