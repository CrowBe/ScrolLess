import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { FullScreenCard } from './full-screen-card';
import type { FeedItemResponse } from '../types';

const item: FeedItemResponse = {
  id: 'ci_1', source: 'news', title: 'Long read', url: 'https://e.com/1', tags: ['db'],
  content_preview: 'Short preview', body: 'The full body text', is_discovery: false,
  published_at: new Date().toISOString(), fetched_at: new Date().toISOString(), is_read: false, is_saved: false,
};

describe('FullScreenCard', () => {
  it('shows the full body and the original link in a dialog', () => {
    render(<FullScreenCard item={item} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Long read' })).toBeInTheDocument();
    expect(screen.getByText('The full body text')).toBeInTheDocument();
    expect(screen.queryByText('Short preview')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open original/ })).toHaveAttribute('href', 'https://e.com/1');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape and acts from the action bar', () => {
    const onClose = vi.fn();
    const onVerdict = vi.fn();
    render(<FullScreenCard item={item} onClose={onClose} onVerdict={onVerdict} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(onVerdict).toHaveBeenCalledWith('like');
  });
});
