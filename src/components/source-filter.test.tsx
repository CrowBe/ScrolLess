import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SourceFilter } from './source-filter';
import type { Stats } from '../types';
import { markAllRead } from '../api';

vi.mock('../api', () => ({
  markAllRead: vi.fn().mockResolvedValue(undefined),
}));

const stats: Stats = {
  total: 20,
  unread: 8,
  by_source: [
    { source: 'youtube', count: 10, unread: 3 },
    { source: 'x', count: 5, unread: 2 },
    { source: 'news', count: 5, unread: 3 },
  ],
};

const defaultProps = {
  stats,
  source: '',
  onSourceChange: vi.fn(),
  onMarkedAllRead: vi.fn(),
  onManageSources: vi.fn(),
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

  it('shows zero unread badges with null stats', () => {
    render(<SourceFilter {...defaultProps} stats={null} />);
    expect(screen.queryByText('8')).not.toBeInTheDocument();
  });

  it('shows Mark all read button', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('calls onManageSources when manage sources is clicked', () => {
    const onManageSources = vi.fn();
    render(<SourceFilter {...defaultProps} onManageSources={onManageSources} />);
    fireEvent.click(screen.getByText('Manage sources'));
    expect(onManageSources).toHaveBeenCalledTimes(1);
  });

  it('disables Mark all read when there are no unread items', () => {
    const zeroStats: Stats = {
      ...stats,
      unread: 0,
      by_source: stats.by_source.map((entry) => ({ ...entry, unread: 0 })),
    };

    render(<SourceFilter {...defaultProps} stats={zeroStats} />);
    expect(screen.getByText('Mark all read')).toBeDisabled();
  });

  it('marks source chips with aria-pressed and calls mark all read', () => {
    render(<SourceFilter {...defaultProps} source="youtube" />);

    const youtubeChip = screen.getByRole('button', { name: /^YouTube/ });
    const allChip = screen.getByRole('button', { name: /^All/ });

    expect(youtubeChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByText('Mark all read'));

    expect(markAllRead).toHaveBeenCalledWith('youtube');
  });
});
