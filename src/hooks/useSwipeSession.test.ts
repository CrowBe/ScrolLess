import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

const api = {
  getSession: vi.fn(),
  sendFeedback: vi.fn(),
  undoFeedback: vi.fn(),
};
vi.mock('../api', () => ({
  getSession: (...a: unknown[]) => api.getSession(...a),
  sendFeedback: (...a: unknown[]) => api.sendFeedback(...a),
  undoFeedback: (...a: unknown[]) => api.undoFeedback(...a),
}));

import { useSwipeSession } from './useSwipeSession';

function session(items: unknown[], size = 2) {
  return { ranking_version: 'rank1', size, exploration_share: 0.2, discovery_count: 0, feedback_count: 0, items };
}

function item(id: string, slot = 'ranked') {
  return {
    id, source: 'news', source_id: id, url: `https://e.com/${id}`, title: id, author: null,
    content_preview: null, body: null, thumbnail_url: null, content_type: null, tags: [], metadata: null,
    is_discovery: false, published_at: '2026-10-01T00:00:00Z', first_seen_at: '2026-10-01T00:00:00Z',
    is_read: false, is_saved: false, state_version: 0,
    session: { slot, score: 0.5, reasons: slot === 'ranked' ? ['liked tag: rust'] : [] },
  };
}

describe('useSwipeSession', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getSession.mockResolvedValue(session([item('a'), item('b', 'discovery')]));
    api.sendFeedback.mockResolvedValue({});
    api.undoFeedback.mockResolvedValue({});
  });

  it('plays the host-ranked session in order and finishes after the last swipe', async () => {
    const { result } = renderHook(() => useSwipeSession({ view: 'feed', source: 'news' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getSession).toHaveBeenCalledWith({ view: 'feed', source: 'news' });
    expect(result.current.current).toMatchObject({ id: 'a', session_slot: 'ranked', session_reasons: ['liked tag: rust'] });
    expect(result.current.next?.session_slot).toBe('discovery');
    expect(result.current.total).toBe(2);
    expect(result.current.size).toBe(2);

    act(() => result.current.swipe('like'));
    act(() => result.current.swipe('save'));
    expect(api.sendFeedback).toHaveBeenNthCalledWith(1, 'a', 'like');
    expect(api.sendFeedback).toHaveBeenNthCalledWith(2, 'b', 'save');
    expect(result.current.done).toBe(true);
    expect(result.current.tally).toEqual({ like: 1, dislike: 0, save: 1 });
  });

  it('undoes the last swipe', async () => {
    const { result } = renderHook(() => useSwipeSession({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.swipe('dislike'));
    act(() => result.current.undo());
    expect(api.undoFeedback).toHaveBeenCalledWith('a');
    expect(result.current.current?.id).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.tally.dislike).toBe(0);
  });

  it('puts the card back when recording fails', async () => {
    api.sendFeedback.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useSwipeSession({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.swipe('like'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.current?.id).toBe('a');
    expect(result.current.tally.like).toBe(0);
    warn.mockRestore();
  });

  it('reports an empty session', async () => {
    api.getSession.mockResolvedValue(session([], 20));
    const { result } = renderHook(() => useSwipeSession({ view: 'discover' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.empty).toBe(true);
  });
});
