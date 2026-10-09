import { useState } from 'preact/hooks';
import { useSwipeSession, type Verdict } from '../hooks/useSwipeSession';
import { SwipeDeck } from './swipe-deck';
import { FullScreenCard } from './full-screen-card';

interface Props {
  view: 'feed' | 'discover';
  source: string;
  /** Unread items left on the host after this session, for the "another session" offer. */
  moreAvailable: number;
  onOpenSettings: () => void;
}

export function SwipeSession({ view, source, moreAvailable, onOpenSettings }: Props) {
  const session = useSwipeSession({ view, source: source || undefined });
  const [expanded, setExpanded] = useState(false);

  function handleVerdict(verdict: Verdict) {
    setExpanded(false);
    session.swipe(verdict);
  }

  if (session.loading && !session.current) {
    return (
      <div class="feed-empty">
        <div class="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (session.error && !session.current && !session.done) {
    return (
      <div class="feed-empty">
        <span class="material-symbols-outlined feed-empty__icon">cloud_off</span>
        <p class="feed-empty__title">Couldn't load your feed</p>
        <p class="feed-empty__sub">{session.error}</p>
        <button class="btn btn--ghost btn--sm" onClick={() => void session.restart()}>Retry</button>
      </div>
    );
  }

  if (session.empty) {
    return (
      <div class="feed-empty">
        <span class="material-symbols-outlined feed-empty__icon">inbox</span>
        <p class="feed-empty__title">{view === 'discover' ? 'Nothing to discover yet' : 'Nothing new'}</p>
        <p class="feed-empty__sub">Ask your agent to collect your sources, or add sources in Settings first.</p>
        <button class="btn btn--ghost btn--sm" onClick={onOpenSettings}>Manage sources</button>
      </div>
    );
  }

  if (session.done) {
    const { like, dislike, save } = session.tally;
    return (
      <div class="feed-empty session-done">
        <span class="material-symbols-outlined feed-empty__icon">task_alt</span>
        <p class="feed-empty__title">You're caught up</p>
        <p class="feed-empty__sub">
          {session.total} card{session.total === 1 ? '' : 's'} reviewed · {like} liked · {dislike} passed · {save} saved
        </p>
        <div class="session-done__actions">
          {session.canUndo && (
            <button class="btn btn--ghost btn--sm" onClick={session.undo}>
              <span class="material-symbols-outlined">undo</span>
              Undo last
            </button>
          )}
          {moreAvailable > 0 ? (
            <button class="btn btn--primary btn--sm" onClick={() => void session.restart()}>
              Start another session ({moreAvailable} waiting)
            </button>
          ) : (
            <p class="feed-empty__sub">Nothing else waiting. Your agent will add more on its next run.</p>
          )}
        </div>
      </div>
    );
  }

  const current = session.current!;
  return (
    <>
      {session.error && (
        <div class="swipe-error" role="alert">
          <span>{session.error}</span>
          <button class="btn btn--ghost btn--sm" onClick={session.dismissError}>Dismiss</button>
        </div>
      )}
      <SwipeDeck
        current={current}
        next={session.next}
        position={session.position}
        total={session.total}
        canUndo={session.canUndo}
        keyboardDisabled={expanded}
        onVerdict={handleVerdict}
        onUndo={session.undo}
        onOpen={() => setExpanded(true)}
      />
      {expanded && (
        <FullScreenCard item={current} onClose={() => setExpanded(false)} onVerdict={handleVerdict} />
      )}
    </>
  );
}
