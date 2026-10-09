import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

const getFeedItems = vi.fn();
vi.mock('../api', () => ({ getFeedItems: (...args: unknown[]) => getFeedItems(...args) }));

import { useFeedItems } from './useFeedItems';

function item(id: string, publishedAt: string | null) {
  return {
    id, source: 'youtube', source_id: id, url: `https://e.com/${id}`, title: id, author: null,
    content_preview: null, thumbnail_url: null, content_type: 'video', tags: [], metadata: null,
    is_discovery: false, published_at: publishedAt, first_seen_at: '2026-10-05T00:00:00Z',
    is_read: false, is_saved: false, state_version: 0,
  };
}

describe('useFeedItems', () => {
  beforeEach(() => { getFeedItems.mockReset(); });

  it('loads pages and falls back to first-seen time for undated items', async () => {
    getFeedItems
      .mockResolvedValueOnce({ items: [item('ci_new', '2026-10-03T00:00:00Z'), item('ci_undated', null)], next_cursor: 'c1' })
      .mockResolvedValueOnce({ items: [item('ci_old', '2026-10-01T00:00:00Z')], next_cursor: null });

    const { result } = renderHook(() => useFeedItems({ view: 'feed', source: 'youtube' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getFeedItems).toHaveBeenCalledWith(expect.objectContaining({ view: 'feed', source: 'youtube', cursor: null }));
    expect(result.current.items.map((i) => i.id)).toEqual(['ci_new', 'ci_undated']);
    expect(result.current.items[1].published_at).toBe('2026-10-05T00:00:00Z');
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });
    expect(getFeedItems).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
    expect(result.current.items.map((i) => i.id)).toEqual(['ci_new', 'ci_undated', 'ci_old']);
    expect(result.current.hasMore).toBe(false);
  });

  it('reports load errors instead of an empty feed', async () => {
    getFeedItems.mockRejectedValue(new Error('GET /api/items → 401'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useFeedItems({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('GET /api/items → 401');
    warn.mockRestore();
  });

  it('patches items locally and drops unsaved items from the saved view', async () => {
    getFeedItems.mockResolvedValue({ items: [{ ...item('ci_a', '2026-10-03T00:00:00Z'), is_saved: true }], next_cursor: null });
    const { result } = renderHook(() => useFeedItems({ view: 'saved' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.patchItem('ci_a', { is_read: true }));
    expect(result.current.items[0].is_read).toBe(true);
    act(() => result.current.patchItem('ci_a', { is_saved: false }));
    expect(result.current.items).toHaveLength(0);
  });
});
