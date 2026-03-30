import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { XCard } from './x-card';
import type { FeedItemResponse } from '../types';

const base: FeedItemResponse = {
  id: 'x:abc',
  source: 'x',
  title: 'Test tweet title',
  url: 'https://x.com/user/status/abc',
  tags: [],
  is_discovery: false,
  published_at: new Date(Date.now() - 7200000).toISOString(),
  fetched_at: new Date().toISOString(),
  is_read: false,
};

describe('XCard', () => {
  it('renders author handle', () => {
    render(<XCard item={{ ...base, author: '@testuser' }} onMarkRead={vi.fn()} />);
    expect(screen.getByText('@testuser')).toBeInTheDocument();
  });

  it('falls back to "Unknown" when no author', () => {
    render(<XCard item={base} onMarkRead={vi.fn()} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('renders content_preview when available', () => {
    render(<XCard item={{ ...base, content_preview: 'This is a tweet.' }} onMarkRead={vi.fn()} />);
    expect(screen.getByText('This is a tweet.')).toBeInTheDocument();
  });

  it('falls back to title when no content_preview', () => {
    render(<XCard item={base} onMarkRead={vi.fn()} />);
    expect(screen.getByText('Test tweet title')).toBeInTheDocument();
  });

  it('truncates long content_preview to 180 chars when collapsed', () => {
    const longText = 'A'.repeat(200);
    render(<XCard item={{ ...base, content_preview: longText }} onMarkRead={vi.fn()} />);
    expect(screen.getByText('A'.repeat(180) + '…')).toBeInTheDocument();
  });

  it('shows full text when expanded', () => {
    const longText = 'A'.repeat(200);
    render(<XCard item={{ ...base, content_preview: longText }} onMarkRead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it('shows View on X link when expanded', () => {
    render(<XCard item={base} onMarkRead={vi.fn()} />);
    expect(screen.queryByText('View on X')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('View on X')).toBeInTheDocument();
  });

  it('has unread class when unread', () => {
    const { container } = render(<XCard item={base} onMarkRead={vi.fn()} />);
    expect(container.querySelector('.card--unread')).toBeInTheDocument();
  });
});
