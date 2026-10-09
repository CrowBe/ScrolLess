import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';

const getHostItems = vi.fn();
const legacy = [
  { id: 'news:1', source: 'news', title: 'Legacy', url: 'https://e.com/1', tags: [], is_discovery: false,
    published_at: '2026-10-02T00:00:00Z', fetched_at: '2026-10-02T00:00:00Z', is_read: false, is_saved: false },
];

vi.mock('../api', () => ({ getHostItems: (...args: unknown[]) => getHostItems(...args) }));
vi.mock('../idb', () => ({
  openScrollessDb: async () => ({ getAll: async () => legacy }),
}));

import { useFeedItems } from './useFeedItems';

function hostItem(id: string, publishedAt: string | null) {
  return {
    id, source: 'youtube', source_id: id, url: `https://e.com/${id}`, title: id, author: null,
    content_preview: null, thumbnail_url: null, content_type: 'video', tags: [], metadata: null,
    is_discovery: false, published_at: publishedAt, first_seen_at: '2026-10-05T00:00:00Z',
    is_read: false, is_saved: false, state_version: 0,
  };
}

describe('useFeedItems', () => {
  beforeEach(() => { getHostItems.mockReset(); });

  it('merges host and legacy items newest first and paginates host items', async () => {
    getHostItems
      .mockResolvedValueOnce({ items: [hostItem('ci_new', '2026-10-03T00:00:00Z'), hostItem('ci_undated', null)], next_cursor: 'c1' })
      .mockResolvedValueOnce({ items: [hostItem('ci_old', '2026-10-01T00:00:00Z')], next_cursor: null });

    const { result } = renderHook(() => useFeedItems({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(['ci_undated', 'ci_new', 'news:1']);
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });
    expect(getHostItems).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
    expect(result.current.items.map((i) => i.id)).toEqual(['ci_undated', 'ci_new', 'news:1', 'ci_old']);
    expect(result.current.hasMore).toBe(false);
  });

  it('falls back to legacy items when the host is unavailable', async () => {
    getHostItems.mockRejectedValue(new Error('GET /api/items → 401'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useFeedItems({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(['news:1']);
    warn.mockRestore();
  });

  it('patches host items locally', async () => {
    getHostItems.mockResolvedValue({ items: [hostItem('ci_a', '2026-10-03T00:00:00Z')], next_cursor: null });
    const { result } = renderHook(() => useFeedItems({ view: 'feed' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.patchItem('ci_a', { is_saved: true }));
    expect(result.current.items.find((i) => i.id === 'ci_a')?.is_saved).toBe(true);
  });
});
