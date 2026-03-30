import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useExpandable } from './use-expandable';

describe('useExpandable', () => {
  it('starts collapsed', () => {
    const { result } = renderHook(() => useExpandable('1', false, vi.fn()));
    expect(result.current.expanded).toBe(false);
  });

  it('toggles expanded on each call', () => {
    const { result } = renderHook(() => useExpandable('1', false, vi.fn()));
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
  });

  it('calls markRead with item id when expanding an unread item', () => {
    const markRead = vi.fn();
    const { result } = renderHook(() => useExpandable('item-1', false, markRead));
    act(() => result.current.toggle());
    expect(markRead).toHaveBeenCalledWith('item-1');
  });

  it('does not call markRead when expanding an already-read item', () => {
    const markRead = vi.fn();
    const { result } = renderHook(() => useExpandable('item-1', true, markRead));
    act(() => result.current.toggle());
    expect(markRead).not.toHaveBeenCalled();
  });

  it('does not call markRead on collapse', () => {
    const markRead = vi.fn();
    const { result } = renderHook(() => useExpandable('item-1', false, markRead));
    act(() => result.current.toggle()); // expand
    markRead.mockClear();
    act(() => result.current.toggle()); // collapse
    expect(markRead).not.toHaveBeenCalled();
  });
});
