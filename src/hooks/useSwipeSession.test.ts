import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

const api = {
  getFeedItems: vi.fn(),
  getPreferences: vi.fn(),
  sendFeedback: vi.fn(),
  undoFeedback: vi.fn(),
};
vi.mock('../api', () => ({
  getFeedItems: (...a: unknown[]) => api.getFeedItems(...a),
  getPreferences: (...a: unknown[]) => api.getPreferences(...a),
  sendFeedback: (...a: unknown[]) => api.sendFeedback(...a),
  undoFeedback: (...a: unknown[]) => api.undoFeedback(...a),
}));

import { useSwipeSession } from './useSwipeSession';

function item(id: string) {
  return {
    id, source: 'news', source_id: id, url: `https://e.com/${id}`, title: id, author: null,
    content_preview: null, body: null, thumbnail_url: null, content_type: null, tags: [], metadata: null,
    is_discovery: false, published_at: '2026-10-01T00:00:00Z', first_seen_at: '2026-10-01T00:00:00Z',
    is_read: false, is_saved: false, state_version: 0,
  };
}

describe('useSwipeSession', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getPreferences.mockResolvedValue({ session_size: 2 });
    api.getFeedItems.mockResolvedValue({ items: [item('a'), item('b')], next_cursor: 'more' });
    api.sendFeedback.mockResolvedValue({});
    api.undoFeedback.mockResolvedValue({});
  });

  it('draws a fixed number of unread cards and finishes after the last swipe', async () => {
    const { result } = renderHook(() => useSwipeSession({ view: 'feed', source: 'news' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getFeedItems).toHaveBeenCalledWith({ view: 'feed', source: 'news', unreadOnly: true, limit: 2 });
    expect(result.current.current?.id).toBe('a');
    expect(result.current.total).toBe(2);

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
    api.getFeedItems.mockResolvedValue({ items: [], next_cursor: null });
    const { result } = renderHook(() => useSwipeSession({ view: 'discover' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.empty).toBe(true);
  });
});
