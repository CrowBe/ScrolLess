import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { SourceFilter } from './source-filter';
import type { UnreadCounts } from '../hooks/useUnreadCounts';

const markAllRead = vi.fn();
vi.mock('../api', () => ({ markAllRead: (...args: unknown[]) => markAllRead(...args) }));

const counts: UnreadCounts = {
  total: 20,
  unread: 8,
  by_source: {
    youtube: { total: 10, unread: 3 },
    x: { total: 5, unread: 2 },
    news: { total: 5, unread: 3 },
  },
};

const defaultProps = {
  counts,
  source: '',
  onSourceChange: vi.fn(),
};

describe('SourceFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all source chips', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
  });

  it('shows total unread badge on All chip', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('marks All chip as active when no source selected', () => {
    render(<SourceFilter {...defaultProps} source="" />);
    const allButton = screen.getByText('All').closest('button');
    expect(allButton).toHaveClass('chip--active');
  });

  it('marks correct chip as active when source is selected', () => {
    render(<SourceFilter {...defaultProps} source="youtube" />);
    const youtubeButton = screen.getByText('YouTube').closest('button');
    expect(youtubeButton).toHaveClass('chip--active');
  });

  it('calls onSourceChange when a chip is clicked', () => {
    const onSourceChange = vi.fn();
    render(<SourceFilter {...defaultProps} onSourceChange={onSourceChange} />);
    fireEvent.click(screen.getByText('YouTube'));
    expect(onSourceChange).toHaveBeenCalledWith('youtube');
  });

  it('shows zero unread badges with empty counts', () => {
    const emptyCounts: UnreadCounts = { total: 0, unread: 0, by_source: {} };
    render(<SourceFilter {...defaultProps} counts={emptyCounts} />);
    expect(screen.queryByText('8')).not.toBeInTheDocument();
  });

  it('shows Mark all read button', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('marks the selected source read and signals a feed reload', async () => {
    markAllRead.mockResolvedValue({ updated: 3 });
    const listener = vi.fn();
    window.addEventListener('scrolless:feed-changed', listener);
    render(<SourceFilter {...defaultProps} source="youtube" />);
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(listener).toHaveBeenCalled());
    expect(markAllRead).toHaveBeenCalledWith('youtube');
    window.removeEventListener('scrolless:feed-changed', listener);
  });

  it('disables Mark all read when there are no unread items', () => {
    const zeroCounts: UnreadCounts = {
      total: 20,
      unread: 0,
      by_source: {
        youtube: { total: 10, unread: 0 },
        x: { total: 5, unread: 0 },
        news: { total: 5, unread: 0 },
      },
    };
    render(<SourceFilter {...defaultProps} counts={zeroCounts} />);
    expect(screen.getByText('Mark all read')).toBeDisabled();
  });

  it('marks source chips with aria-pressed', () => {
    render(<SourceFilter {...defaultProps} source="youtube" />);
    const youtubeChip = screen.getByRole('button', { name: /^YouTube/ });
    const allChip = screen.getByRole('button', { name: /^All/ });
    expect(youtubeChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
  });
});
