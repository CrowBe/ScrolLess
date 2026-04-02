import { describe, it, expect } from 'vitest';
import { displayName } from './source-labels';

describe('displayName', () => {
  it('returns "YouTube" for youtube', () => {
    expect(displayName('youtube')).toBe('YouTube');
  });

  it('returns "X" for x', () => {
    expect(displayName('x')).toBe('X');
  });

  it('returns "News" for news', () => {
    expect(displayName('news')).toBe('News');
  });

  it('capitalises first letter for unknown sources', () => {
    expect(displayName('reddit')).toBe('Reddit');
  });

  it('capitalises first letter for multi-word custom sources', () => {
    expect(displayName('custom-blog')).toBe('Custom-blog');
  });

  it('handles single character source', () => {
    expect(displayName('a')).toBe('A');
  });
});
