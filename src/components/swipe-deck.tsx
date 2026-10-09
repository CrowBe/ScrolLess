import { useEffect, useRef, useState } from 'preact/hooks';
import type { FeedItemResponse } from '../types';
import type { Verdict } from '../api';
import { displayName } from '../source-labels';
import { relativeTime } from '../utils';

// Distance (px) a card must travel before release commits a verdict.
export const SWIPE_THRESHOLD = 110;
// Movement below this is a tap, not a drag.
const TAP_SLOP = 8;
const EXIT_MS = 220;

export const VERDICT_UI: Record<Verdict, { icon: string; label: string }> = {
  like: { icon: 'thumb_up', label: 'Like' },
  dislike: { icon: 'thumb_down', label: 'Not for me' },
  save: { icon: 'bookmark', label: 'Save' },
};

/** Which verdict a drag offset points at: up is save, otherwise left/right. */
export function verdictFor(dx: number, dy: number): Verdict {
  if (dy < 0 && -dy > Math.abs(dx)) return 'save';
  return dx >= 0 ? 'like' : 'dislike';
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface CardFaceProps {
  item: FeedItemResponse;
}

function CardFace({ item }: CardFaceProps) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <>
      {item.thumbnail_url && !imageFailed ? (
        <div class="swipe-card__media">
          <img src={item.thumbnail_url} alt="" draggable={false} onError={() => setImageFailed(true)} />
        </div>
      ) : (
        <div class="swipe-card__media swipe-card__media--empty" aria-hidden="true">
          <span class="material-symbols-outlined">article</span>
        </div>
      )}
      <div class="swipe-card__body">
        <div class="swipe-card__meta">
          <span class="swipe-card__source">{displayName(item.source)}</span>
          {item.author && <span class="swipe-card__author">{item.author}</span>}
          <span class="swipe-card__time">{relativeTime(item.published_at)}</span>
        </div>
        <h2 class="swipe-card__title">{item.title}</h2>
        {item.content_preview && <p class="swipe-card__preview">{item.content_preview}</p>}
      </div>
    </>
  );
}

interface Props {
  current: FeedItemResponse;
  next: FeedItemResponse | null;
  position: number;
  total: number;
  canUndo: boolean;
  /** Disable keyboard shortcuts, e.g. while the full-screen view is open. */
  keyboardDisabled?: boolean;
  onVerdict: (verdict: Verdict) => void;
  onUndo: () => void;
  onOpen: () => void;
}

export function SwipeDeck({ current, next, position, total, canUndo, keyboardDisabled, onVerdict, onUndo, onOpen }: Props) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [exiting, setExiting] = useState<Verdict | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const exitTimer = useRef<number | null>(null);

  // A new top card starts centred
  useEffect(() => {
    setDrag(null);
    setExiting(null);
  }, [current.id]);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  function commit(verdict: Verdict) {
    if (exiting) return;
    setExiting(verdict);
    const delay = prefersReducedMotion() ? 0 : EXIT_MS;
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      onVerdict(verdict);
    }, delay);
  }

  useEffect(() => {
    if (keyboardDisabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const keyMap: Record<string, () => void> = {
        ArrowRight: () => commit('like'),
        ArrowLeft: () => commit('dislike'),
        ArrowUp: () => commit('save'),
        Enter: onOpen,
        Backspace: () => { if (canUndo) onUndo(); },
        z: () => { if (canUndo) onUndo(); },
      };
      const action = keyMap[e.key];
      if (!action) return;
      // Leave Enter alone when a button has focus so it activates that button
      if (e.key === 'Enter' && target?.tagName === 'BUTTON') return;
      e.preventDefault();
      action();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function onPointerDown(e: PointerEvent) {
    if (exiting) return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ dx: 0, dy: 0 });
  }

  function onPointerMove(e: PointerEvent) {
    if (!start.current || start.current.pointerId !== e.pointerId) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
  }

  function onPointerUp(e: PointerEvent) {
    if (!start.current || start.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    const distance = Math.hypot(dx, dy);
    if (distance < TAP_SLOP) {
      setDrag(null);
      onOpen();
      return;
    }
    const verdict = verdictFor(dx, dy);
    const travelled = verdict === 'save' ? -dy : Math.abs(dx);
    if (travelled >= SWIPE_THRESHOLD) {
      setDrag({ dx, dy });
      commit(verdict);
    } else {
      setDrag(null); // spring back
    }
  }

  function onPointerCancel() {
    start.current = null;
    setDrag(null);
  }

  // Overlay: which verdict the gesture (or a button press) points at, and how strongly
  let indicator: Verdict | null = null;
  let strength = 0;
  if (exiting) {
    indicator = exiting;
    strength = 1;
  } else if (drag && Math.hypot(drag.dx, drag.dy) > TAP_SLOP * 2) {
    indicator = verdictFor(drag.dx, drag.dy);
    const travelled = indicator === 'save' ? -drag.dy : Math.abs(drag.dx);
    strength = Math.min(1, Math.max(0, travelled / SWIPE_THRESHOLD));
  }

  let transform = '';
  if (exiting) {
    const off = { like: 'translate(140%, 0) rotate(18deg)', dislike: 'translate(-140%, 0) rotate(-18deg)', save: 'translate(0, -130%)' };
    transform = off[exiting];
  } else if (drag) {
    transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.05}deg)`;
  }
  const dragging = drag !== null && start.current !== null;

  return (
    <div class="swipe-deck">
      <div class="swipe-deck__progress" aria-label={`Card ${position} of ${total}`}>
        <span class="swipe-deck__count">{position} / {total}</span>
        <div class="swipe-deck__bar" aria-hidden="true">
          <div class="swipe-deck__bar-fill" style={{ width: `${(position / Math.max(total, 1)) * 100}%` }} />
        </div>
      </div>

      <div class="swipe-deck__stack">
        {next && (
          <div key={next.id} class="swipe-card swipe-card--next" aria-hidden="true">
            <CardFace item={next} />
          </div>
        )}
        <article
          key={current.id}
          class={`swipe-card${dragging ? ' swipe-card--dragging' : ''}${exiting ? ' swipe-card--exiting' : ''}`}
          style={transform ? { transform } : undefined}
          role="button"
          tabIndex={0}
          aria-label={`${current.title}. Open full screen`}
          aria-roledescription="swipeable card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <CardFace item={current} />
          {indicator && (
            <div
              class={`swipe-card__overlay swipe-card__overlay--${indicator}`}
              style={{ opacity: strength }}
              data-testid="swipe-overlay"
              data-verdict={indicator}
              aria-hidden="true"
            >
              <span class="material-symbols-outlined swipe-card__overlay-icon">{VERDICT_UI[indicator].icon}</span>
              <span class="swipe-card__overlay-label">{VERDICT_UI[indicator].label}</span>
            </div>
          )}
        </article>
      </div>

      <div class="swipe-actions" role="toolbar" aria-label="Card actions">
        <button class="swipe-actions__btn swipe-actions__btn--undo" onClick={onUndo} disabled={!canUndo || !!exiting} aria-label="Undo last swipe" title="Undo (Z)">
          <span class="material-symbols-outlined">undo</span>
        </button>
        <button class="swipe-actions__btn swipe-actions__btn--dislike" onClick={() => commit('dislike')} disabled={!!exiting} aria-label="Not for me" title="Not for me (←)">
          <span class="material-symbols-outlined">thumb_down</span>
        </button>
        <button class="swipe-actions__btn swipe-actions__btn--save" onClick={() => commit('save')} disabled={!!exiting} aria-label="Save" title="Save (↑)">
          <span class="material-symbols-outlined">bookmark</span>
        </button>
        <button class="swipe-actions__btn swipe-actions__btn--like" onClick={() => commit('like')} disabled={!!exiting} aria-label="Like" title="Like (→)">
          <span class="material-symbols-outlined">thumb_up</span>
        </button>
      </div>
    </div>
  );
}
