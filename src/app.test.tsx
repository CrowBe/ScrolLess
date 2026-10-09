import { render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';

vi.mock('./hooks/useFeedItems', () => ({
  useFeedItems: () => ({ items: [], loading: false, error: null, hasMore: false, loadMore: vi.fn(), patchItem: vi.fn(), reload: vi.fn() }),
}));

vi.mock('./hooks/useUnreadCounts', () => ({
  useUnreadCounts: () => ({ total: 0, unread: 0, by_source: {} }),
}));

vi.mock('./components/source-filter', () => ({
  SourceFilter: () => <div>SourceFilter</div>,
}));

vi.mock('./components/swipe-session', () => ({
  SwipeSession: () => <div>SwipeSession</div>,
}));

vi.mock('./components/feed-list', () => ({
  FeedList: () => <div>FeedList</div>,
}));


vi.mock('./components/device-session-status', () => ({
  DeviceSessionStatusBadge: () => <div>DeviceSessionStatusBadge</div>,
}));

vi.mock('./components/notification-prompt', () => ({
  NotificationPrompt: () => <div>NotificationPrompt</div>,
}));

vi.mock('./settings', () => ({
  Settings: () => <div>SettingsPage</div>,
}));

describe('App', () => {
  it('renders a Settings item in the bottom navigation', () => {
    window.location.hash = '#/feed';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the swipe session for Feed and the list for Saved', () => {
    window.location.hash = '#/feed';
    const { unmount } = render(<App />);
    expect(screen.getByText('SwipeSession')).toBeInTheDocument();
    unmount();

    window.location.hash = '#/saved';
    render(<App />);
    expect(screen.getByText('FeedList')).toBeInTheDocument();
    expect(screen.queryByText('SwipeSession')).not.toBeInTheDocument();
  });
});
