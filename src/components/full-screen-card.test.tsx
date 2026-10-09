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

  it('explains the card score when it came from a ranked session', () => {
    render(
      <FullScreenCard
        item={{
          ...item,
          session_slot: 'ranked',
          session_score: 0.8,
          session_breakdown: [
            { part: 'author', key: 'author:news/ada', label: 'Ada', value: 0.4, weight: 1.5, contribution: 0.6 },
            { part: 'freshness', label: 'freshness', value: 0.667, weight: 0.3, contribution: 0.2 },
          ],
        }}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Why this card?'));
    expect(screen.getByText(/Ranked by your taste/)).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Author\s*Ada/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Score 0\.80/ })).toBeInTheDocument();
  });

  it('has no explanation outside a session', () => {
    render(<FullScreenCard item={item} onClose={vi.fn()} />);
    expect(screen.queryByText('Why this card?')).not.toBeInTheDocument();
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
