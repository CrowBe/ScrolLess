import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { SwipeDeck, verdictFor, SWIPE_THRESHOLD } from './swipe-deck';
import type { FeedItemResponse } from '../types';

function card(id: string, title = `Title ${id}`): FeedItemResponse {
  return {
    id, source: 'news', title, url: `https://e.com/${id}`, tags: [], is_discovery: false,
    published_at: new Date().toISOString(), fetched_at: new Date().toISOString(), is_read: false, is_saved: false,
  };
}

function setup(overrides: Partial<Parameters<typeof SwipeDeck>[0]> = {}) {
  const props = {
    current: card('a', 'First card'),
    next: card('b'),
    position: 1,
    total: 5,
    canUndo: false,
    onVerdict: vi.fn(),
    onUndo: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<SwipeDeck {...props} />);
  return props;
}

function drag(el: Element, dx: number, dy: number, release = true) {
  fireEvent.pointerDown(el, { clientX: 200, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
  if (release) fireEvent.pointerUp(el, { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
}

describe('verdictFor', () => {
  it('maps right to like, left to dislike and up to save', () => {
    expect(verdictFor(120, 10)).toBe('like');
    expect(verdictFor(-120, 10)).toBe('dislike');
    expect(verdictFor(30, -120)).toBe('save');
    // Mostly sideways with a slight upward drift is still like/dislike
    expect(verdictFor(120, -40)).toBe('like');
  });
});

describe('SwipeDeck', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const cardEl = () => screen.getByRole('button', { name: /First card/ });

  it('shows progress', () => {
    setup({ position: 3, total: 20 });
    expect(screen.getByText('3 / 20')).toBeInTheDocument();
  });

  it.each([
    ['like', 160, 0, 'Like'],
    ['dislike', -160, 0, 'Not for me'],
    ['save', 0, -160, 'Save'],
  ] as const)('shows the %s overlay while dragging and commits on release', (verdict, dx, dy, label) => {
    const props = setup();
    drag(cardEl(), dx, dy, false);
    const overlay = screen.getByTestId('swipe-overlay');
    expect(overlay).toHaveAttribute('data-verdict', verdict);
    expect(overlay).toHaveTextContent(label);

    fireEvent.pointerUp(cardEl(), { clientX: 200 + dx, clientY: 300 + dy, pointerId: 1 });
    act(() => { vi.runAllTimers(); });
    expect(props.onVerdict).toHaveBeenCalledWith(verdict);
  });

  it('springs back below the threshold', () => {
    const props = setup();
    drag(cardEl(), SWIPE_THRESHOLD - 20, 0);
    act(() => { vi.runAllTimers(); });
    expect(props.onVerdict).not.toHaveBeenCalled();
    expect(screen.queryByTestId('swipe-overlay')).not.toBeInTheDocument();
  });

  it('opens full screen on tap', () => {
    const props = setup();
    drag(cardEl(), 2, 1);
    expect(props.onOpen).toHaveBeenCalled();
    expect(props.onVerdict).not.toHaveBeenCalled();
  });

  it('commits from buttons', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The overlay confirms the action while the card flies off
    expect(screen.getByTestId('swipe-overlay')).toHaveAttribute('data-verdict', 'save');
    act(() => { vi.runAllTimers(); });
    expect(props.onVerdict).toHaveBeenCalledWith('save');
  });

  it.each([
    ['ArrowRight', 'like'],
    ['ArrowLeft', 'dislike'],
    ['ArrowUp', 'save'],
  ] as const)('maps %s to %s', (key, verdict) => {
    const props = setup();
    fireEvent.keyDown(window, { key });
    act(() => { vi.runAllTimers(); });
    expect(props.onVerdict).toHaveBeenCalledWith(verdict);
  });

  it('undoes with Z and opens with Enter', () => {
    const props = setup({ canUndo: true });
    fireEvent.keyDown(window, { key: 'z' });
    expect(props.onUndo).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(props.onOpen).toHaveBeenCalled();
  });

  it('ignores shortcuts when disabled', () => {
    const props = setup({ keyboardDisabled: true });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => { vi.runAllTimers(); });
    expect(props.onVerdict).not.toHaveBeenCalled();
  });
});
