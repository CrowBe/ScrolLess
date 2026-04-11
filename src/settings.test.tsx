import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { Settings } from './settings';

vi.mock('./api', () => ({
  getSources: vi.fn(),
  getTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

import { createToken, getSources, getTokens, getPreferences, updatePreferences } from './api';

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getTokens as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getPreferences as ReturnType<typeof vi.fn>).mockResolvedValue({
      blocked_keywords: ['sponsored'],
      retention_days: 7,
      max_items_per_source: 50,
    });
    (updatePreferences as ReturnType<typeof vi.fn>).mockImplementation(async (payload) => ({
      blocked_keywords: payload.blocked_keywords ?? ['sponsored'],
      retention_days: payload.retention_days ?? 7,
      max_items_per_source: payload.max_items_per_source ?? 50,
    }));
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
      expect(getPreferences).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('heading', { name: 'Add Source' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeInTheDocument();
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

  it('copies token using clipboard fallback when navigator.clipboard is unavailable', async () => {
    (createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'tok_live_123',
      token_hash: 'hash123',
      label: 'my-agent',
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    const execSpy = vi.spyOn(document, 'execCommand');

    render(<Settings />);
    const input = await screen.findByPlaceholderText('Token label (e.g. my-agent)');
    fireEvent.input(input, { target: { value: 'my-agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await screen.findByText('tok_live_123');

    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(await screen.findByText('Copied to clipboard.')).toBeInTheDocument();
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('saves preferences from the settings UI', async () => {
    render(<Settings />);

    const blockedKeywords = await screen.findByPlaceholderText('sponsored, giveaway');
    fireEvent.input(blockedKeywords, { target: { value: 'sponsored, giveaway' } });

    const retentionInput = screen.getByDisplayValue('7');
    fireEvent.input(retentionInput, { target: { value: '14' } });

    const maxItemsInput = screen.getByDisplayValue('50');
    fireEvent.input(maxItemsInput, { target: { value: '75' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({
        blocked_keywords: ['sponsored', 'giveaway'],
        retention_days: 14,
        max_items_per_source: 75,
      });
    });

    expect(await screen.findByText('Preferences saved.')).toBeInTheDocument();
  });
});
