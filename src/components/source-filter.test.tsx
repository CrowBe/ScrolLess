import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SourceFilter } from './source-filter';
import type { Stats } from '../types';

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
  discovery: false,
  onSourceChange: vi.fn(),
  onDiscoveryChange: vi.fn(),
  onMarkedAllRead: vi.fn(),
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

  it('shows Feed/Discover toggle', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
  });

  it('marks Feed active when discovery is false', () => {
    render(<SourceFilter {...defaultProps} discovery={false} />);
    const feedBtn = screen.getByText('Feed').closest('button');
    expect(feedBtn).toHaveClass('chip--active');
  });

  it('marks Discover active when discovery is true', () => {
    render(<SourceFilter {...defaultProps} discovery={true} />);
    const discoverBtn = screen.getByText('Discover').closest('button');
    expect(discoverBtn).toHaveClass('chip--active');
  });

  it('calls onDiscoveryChange when Discover is clicked', () => {
    const onDiscoveryChange = vi.fn();
    render(<SourceFilter {...defaultProps} onDiscoveryChange={onDiscoveryChange} />);
    fireEvent.click(screen.getByText('Discover'));
    expect(onDiscoveryChange).toHaveBeenCalledWith(true);
  });

  it('shows zero unread badges with null stats', () => {
    render(<SourceFilter {...defaultProps} stats={null} />);
    expect(screen.queryByText('8')).not.toBeInTheDocument();
  });

  it('shows Mark all read button', () => {
    render(<SourceFilter {...defaultProps} />);
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });
});
