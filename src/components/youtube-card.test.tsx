import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { YouTubeCard } from './youtube-card';
import type { FeedItemResponse } from '../types';

const base: FeedItemResponse = {
  id: 'youtube:abc',
  source: 'youtube',
  title: 'Test Video',
  url: 'https://youtube.com/watch?v=abc',
  tags: [],
  is_discovery: false,
  published_at: new Date(Date.now() - 3600000).toISOString(),
  fetched_at: new Date().toISOString(),
  is_read: false,
  is_saved: false,
};

describe('YouTubeCard', () => {
  it('renders the title', () => {
    render(<YouTubeCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(screen.getByText('Test Video')).toBeInTheDocument();
  });

  it('has unread class when unread', () => {
    const { container } = render(<YouTubeCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(container.querySelector('.card--unread')).toBeInTheDocument();
  });

  it('does not have unread class when read', () => {
    const { container } = render(<YouTubeCard item={{ ...base, is_read: true }} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(container.querySelector('.card--unread')).not.toBeInTheDocument();
  });

  it('shows Watch on YouTube link when expanded', () => {
    render(<YouTubeCard item={base} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(screen.queryByText('Watch on YouTube')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('Watch on YouTube')).toBeInTheDocument();
  });

  it('calls onMarkRead when expanding unread item', () => {
    const markRead = vi.fn();
    render(<YouTubeCard item={base} onMarkRead={markRead} onToggleSave={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(markRead).toHaveBeenCalledWith('youtube:abc');
  });

  it('thumbnail expands its container class when expanded', () => {
    const { container } = render(<YouTubeCard item={{ ...base, thumbnail_url: 'https://img.example.com/thumb.jpg' }} onMarkRead={vi.fn()} onToggleSave={vi.fn()} />);
    expect(container.querySelector('.card__thumb--expanded')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(container.querySelector('.card__thumb--expanded')).toBeInTheDocument();
  });
});
