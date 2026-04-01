import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { NewsCard } from './news-card';
import type { FeedItemResponse } from '../types';

const base: FeedItemResponse = {
  id: 'news:abc',
  source: 'news',
  title: 'Test Article',
  url: 'https://example.com/article',
  tags: [],
  is_discovery: false,
  published_at: new Date(Date.now() - 60000).toISOString(),
  fetched_at: new Date().toISOString(),
  is_read: false,
  is_saved: false,
};

describe('NewsCard', () => {
  it('renders the title', () => {
    render(<NewsCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(screen.getByText('Test Article')).toBeInTheDocument();
  });

  it('shows author when provided', () => {
    render(<NewsCard item={{ ...base, author: 'Jane Smith' }} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('has unread class when unread', () => {
    const { container } = render(<NewsCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(container.querySelector('.card--unread')).toBeInTheDocument();
  });

  it('does not have unread class when read', () => {
    const { container } = render(<NewsCard item={{ ...base, is_read: true }} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(container.querySelector('.card--unread')).not.toBeInTheDocument();
  });

  it('shows Read article link when expanded', () => {
    render(<NewsCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(screen.queryByText('Read article')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('Read article')).toBeInTheDocument();
  });

  it('collapses on second click', () => {
    render(<NewsCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.queryByText('Read article')).not.toBeInTheDocument();
  });

  it('calls onMarkRead with item id when expanding unread item', () => {
    const markRead = vi.fn();
    render(<NewsCard item={base} onMarkRead={markRead} onToggleSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(markRead).toHaveBeenCalledWith('news:abc');
  });

  it('does not call onMarkRead when expanding read item', () => {
    const markRead = vi.fn();
    render(<NewsCard item={{ ...base, is_read: true }} onMarkRead={markRead} onToggleSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('shows content preview when expanded', () => {
    render(<NewsCard item={{ ...base, content_preview: 'A great summary.' }} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('A great summary.')).toBeInTheDocument();
  });

  it('triggers toggle on Enter keydown', () => {
    render(<NewsCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    fireEvent.keyDown(screen.getAllByRole('button')[0], { key: 'Enter' });
    expect(screen.getByText('Read article')).toBeInTheDocument();
  });
});
