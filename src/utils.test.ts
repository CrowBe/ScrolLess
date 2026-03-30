import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { relativeTime } from './utils';

describe('relativeTime', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "just now" within 60 seconds', () => {
    vi.setSystemTime(new Date('2026-03-30T12:00:30Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.setSystemTime(new Date('2026-03-30T12:30:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toBe('30m ago');
  });

  it('returns hours ago', () => {
    vi.setSystemTime(new Date('2026-03-30T15:00:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toBe('3h ago');
  });

  it('returns days ago', () => {
    vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toBe('3d ago');
  });

  it('returns formatted date beyond 7 days', () => {
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toMatch(/Mar 30/);
  });

  it('boundary: exactly 60 seconds returns 1m ago', () => {
    vi.setSystemTime(new Date('2026-03-30T12:01:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toBe('1m ago');
  });

  it('boundary: exactly 7 days returns formatted date', () => {
    vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));
    expect(relativeTime('2026-03-30T12:00:00Z')).toMatch(/Mar 30/);
  });
});
