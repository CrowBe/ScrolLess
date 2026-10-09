import { useState, useEffect, useRef } from 'preact/hooks';
import { getFeedItems, getPreferences, sendFeedback, undoFeedback, type Verdict } from '../api';
import { emit, ITEM_STATE_CHANGED } from '../feed-events';
import type { FeedItemResponse } from '../types';
import { toResponse } from './useFeedItems';

export type { Verdict };

export const DEFAULT_SESSION_SIZE = 20;

interface SwipeSessionOptions {
  view: 'feed' | 'discover';
  source?: string;
}

export type Tally = Record<Verdict, number>;

const EMPTY_TALLY: Tally = { like: 0, dislike: 0, save: 0 };

/**
 * A bounded review session: a fixed number of unread cards drawn when the
 * session starts. Each swipe records a verdict on the host; undo reverts the
 * most recent one.
 */
export function useSwipeSession(opts: SwipeSessionOptions) {
  const [cards, setCards] = useState<FeedItemResponse[]>([]);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Array<{ id: string; verdict: Verdict }>>([]);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [size, setSize] = useState(DEFAULT_SESSION_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ignore responses from superseded sessions (view/source changed mid-flight)
  const generation = useRef(0);

  async function start() {
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const sessionSize = await getPreferences()
        .then((prefs) => prefs.session_size)
        .catch(() => DEFAULT_SESSION_SIZE);
      const page = await getFeedItems({
        view: opts.view,
        source: opts.source,
        unreadOnly: true,
        limit: sessionSize,
      });
      if (gen !== generation.current) return;
      setSize(sessionSize);
      setCards(page.items.map(toResponse));
      setIndex(0);
      setHistory([]);
      setTally(EMPTY_TALLY);
    } catch (err) {
      if (gen === generation.current) setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }

  function swipe(verdict: Verdict) {
    const card = cards[index];
    if (!card) return;
    setIndex((i) => i + 1);
    setHistory((h) => [...h, { id: card.id, verdict }]);
    setTally((t) => ({ ...t, [verdict]: t[verdict] + 1 }));
    sendFeedback(card.id, verdict)
      .then(() => emit(ITEM_STATE_CHANGED))
      .catch((err) => {
        // Put the card back so the verdict is not silently lost
        console.warn('[useSwipeSession] Failed to record feedback:', err);
        setError('Could not save that swipe. Try again.');
        setIndex((i) => Math.max(0, i - 1));
        setHistory((h) => h.filter((entry) => entry.id !== card.id));
        setTally((t) => ({ ...t, [verdict]: Math.max(0, t[verdict] - 1) }));
      });
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setIndex((i) => Math.max(0, i - 1));
    setHistory((h) => h.slice(0, -1));
    setTally((t) => ({ ...t, [last.verdict]: Math.max(0, t[last.verdict] - 1) }));
    undoFeedback(last.id)
      .then(() => emit(ITEM_STATE_CHANGED))
      .catch((err) => {
        console.warn('[useSwipeSession] Failed to undo feedback:', err);
        setError('Could not undo that swipe.');
      });
  }

  useEffect(() => {
    void start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.view, opts.source]);

  return {
    current: cards[index] ?? null,
    next: cards[index + 1] ?? null,
    position: Math.min(index + 1, cards.length),
    total: cards.length,
    size,
    tally,
    canUndo: history.length > 0,
    done: !loading && cards.length > 0 && index >= cards.length,
    empty: !loading && !error && cards.length === 0,
    loading,
    error,
    swipe,
    undo,
    restart: start,
    dismissError: () => setError(null),
  };
}
