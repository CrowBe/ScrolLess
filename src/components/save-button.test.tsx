import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SaveButton } from './save-button';

describe('SaveButton', () => {
  it('renders with unsaved state', () => {
    render(<SaveButton saved={false} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Save item' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveClass('card__save--active');
  });

  it('renders with saved state', () => {
    render(<SaveButton saved={true} onToggle={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Remove from saved' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass('card__save--active');
  });

  it('calls onToggle when clicked', () => {
    let toggled = false;
    render(<SaveButton saved={false} onToggle={() => { toggled = true; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    expect(toggled).toBe(true);
  });

  it('stops event propagation on click', () => {
    let parentClicked = false;
    render(
      <div onClick={() => { parentClicked = true; }}>
        <SaveButton saved={false} onToggle={() => {}} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    expect(parentClicked).toBe(false);
  });

  it('shows filled bookmark icon when saved', () => {
    const { container } = render(<SaveButton saved={true} onToggle={() => {}} />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon?.getAttribute('style')).toContain('FILL');
  });

  it('shows unfilled bookmark icon when unsaved', () => {
    const { container } = render(<SaveButton saved={false} onToggle={() => {}} />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon?.getAttribute('style')).toBe('');
  });
});
