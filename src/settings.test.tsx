import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { Settings } from './settings';

vi.mock('./api', () => ({
  getSources: vi.fn(),
  getTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
}));

import { createToken, getSources, getTokens } from './api';

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

  it('keeps create token disabled until the label is at least 3 characters', async () => {
    render(<Settings />);

    const input = await screen.findByPlaceholderText('Token label (e.g. my-agent)');
    const create = screen.getByRole('button', { name: 'Create token' });

    expect(create).toBeDisabled();

    fireEvent.input(input, { target: { value: 'ab' } });
    expect(create).toBeDisabled();

    fireEvent.input(input, { target: { value: 'abc' } });
    expect(create).not.toBeDisabled();
  });

  it('creates token and displays revealed token value after click', async () => {
    (createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'tok_live_123',
      token_hash: 'hash123',
      label: 'my-agent',
    });

    render(<Settings />);

    const input = await screen.findByPlaceholderText('Token label (e.g. my-agent)');
    fireEvent.input(input, { target: { value: 'my-agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => {
      expect(createToken).toHaveBeenCalledWith('my-agent');
    });

    expect(screen.getByText('tok_live_123')).toBeInTheDocument();
  });
});
