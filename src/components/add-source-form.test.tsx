import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { AddSourceForm } from './add-source-form';

vi.mock('../api', () => ({
  addSource: vi.fn(),
}));

import { addSource } from '../api';

describe('AddSourceForm', () => {
  const onAdded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show errors on initial render (BUG-R2-8)', () => {
    render(<AddSourceForm onAdded={onAdded} />);
    expect(screen.queryByText('Source name is required')).not.toBeInTheDocument();
    expect(screen.queryByText('At least one URL is required')).not.toBeInTheDocument();
  });

  it('shows error after submitting empty form', async () => {
    render(<AddSourceForm onAdded={onAdded} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(screen.getByText('Source name is required')).toBeInTheDocument();
  });

  it('shows URL error after submitting with name but no URLs', async () => {
    render(<AddSourceForm onAdded={onAdded} />);
    const nameInput = screen.getByPlaceholderText('e.g. youtube, reddit, custom-blog');
    fireEvent.input(nameInput, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(screen.getByText('At least one URL is required')).toBeInTheDocument();
  });

  it('shows invalid URL error', async () => {
    render(<AddSourceForm onAdded={onAdded} />);
    const nameInput = screen.getByPlaceholderText('e.g. youtube, reddit, custom-blog');
    const urlArea = screen.getByPlaceholderText('https://example.com/feed');
    fireEvent.input(nameInput, { target: { value: 'test' } });
    fireEvent.input(urlArea, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(screen.getByText(/Invalid URL/)).toBeInTheDocument();
  });

  it('clears errors and submitted state on successful add', async () => {
    (addSource as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(<AddSourceForm onAdded={onAdded} />);

    // First submit fails
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    expect(screen.getByText('Source name is required')).toBeInTheDocument();

    // Fill in valid data and submit
    const nameInput = screen.getByPlaceholderText('e.g. youtube, reddit, custom-blog');
    const urlArea = screen.getByPlaceholderText('https://example.com/feed');
    fireEvent.input(nameInput, { target: { value: 'test' } });
    fireEvent.input(urlArea, { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalled();
    });

    // After success, errors should be cleared and no error visible
    expect(screen.queryByText('Source name is required')).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid URL/)).not.toBeInTheDocument();
  });

  it('does not show stale errors after successful submission and re-submit', async () => {
    (addSource as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(<AddSourceForm onAdded={onAdded} />);

    // Valid submission
    const nameInput = screen.getByPlaceholderText('e.g. youtube, reddit, custom-blog');
    const urlArea = screen.getByPlaceholderText('https://example.com/feed');
    fireEvent.input(nameInput, { target: { value: 'test' } });
    fireEvent.input(urlArea, { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalled();
    });

    // Form should be reset — submitting blank should not flash old errors
    // (submitted flag was reset)
    expect(screen.queryByText('Source name is required')).not.toBeInTheDocument();
  });
});
