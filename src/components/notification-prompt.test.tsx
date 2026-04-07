import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { NotificationPrompt } from './notification-prompt';
import { subscribePush } from '../api';

vi.mock('../api', () => ({
  getVapidKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

describe('NotificationPrompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('denied'),
      },
    });

    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
          },
        }),
      },
    });
  });

  it('shows a visible error message when enabling notifications is denied', async () => {
    render(<NotificationPrompt />);

    const enableBtn = await screen.findByRole('button', { name: 'Enable' });
    fireEvent.click(enableBtn);

    expect(
      await screen.findByText('Notifications were not enabled. Check your browser permission settings.')
    ).toBeInTheDocument();
  });

  it('shows enabled state when browser permission is granted even before subscription exists', async () => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
    });

    render(<NotificationPrompt />);

    expect(await screen.findByText('Notifications: On')).toBeInTheDocument();
    expect(screen.getByText('Finishing setup…')).toBeInTheDocument();
    expect(subscribePush).not.toHaveBeenCalled();
  });
});
