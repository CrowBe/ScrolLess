import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { Settings } from './settings';

vi.mock('./api', () => ({
  getSources: vi.fn(),
  getTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
}));

import { getSources, getTokens } from './api';

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders token label input with form-input styling class', async () => {
    render(<Settings />);

    const input = await screen.findByPlaceholderText('Token label (e.g. my-agent)');
    expect(input).toHaveClass('form-input');
    expect(input).not.toHaveClass('input');
  });

  it('loads settings data without crashing on initial render', async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(getSources).toHaveBeenCalledTimes(1);
      expect(getTokens).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('heading', { name: 'Add Source' })).toBeInTheDocument();
  });
});
