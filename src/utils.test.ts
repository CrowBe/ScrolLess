import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { relativeTime } from './utils';

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

  // ── BUG-R2-6: Timezone handling tests ──

  it('treats bare datetime strings (no Z suffix) as UTC', () => {
    // SQLite datetime('now') produces "2026-03-31 11:31:41" without Z
    vi.setSystemTime(new Date('2026-03-31T12:31:41Z'));
    // Should be ~1h ago, NOT 11h+ ago from local-time misparse
    expect(relativeTime('2026-03-31 11:31:41')).toBe('1h ago');
  });

  it('treats bare ISO datetime without Z as UTC', () => {
    vi.setSystemTime(new Date('2026-03-31T11:35:00Z'));
    expect(relativeTime('2026-03-31T11:31:41')).toBe('3m ago');
  });

  it('preserves Z-suffixed timestamps as UTC', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
    expect(relativeTime('2026-03-31T11:00:00Z')).toBe('1h ago');
  });

  it('handles positive timezone offsets correctly', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
    // 2026-03-31T17:00:00+05:00 = 2026-03-31T12:00:00Z → should be "just now"
    expect(relativeTime('2026-03-31T17:00:00+05:00')).toBe('just now');
  });

  it('handles negative timezone offsets correctly', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));
    // 2026-03-31T04:00:00-08:00 = 2026-03-31T12:00:00Z → should be "just now"
    expect(relativeTime('2026-03-31T04:00:00-08:00')).toBe('just now');
  });

  it('ISO format from strftime is handled correctly', () => {
    // New schema default: strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    vi.setSystemTime(new Date('2026-03-31T12:05:00Z'));
    expect(relativeTime('2026-03-31T12:00:00Z')).toBe('5m ago');
  });

  it('formatted date fallback uses correct UTC date', () => {
    vi.setSystemTime(new Date('2026-04-10T12:00:00Z'));
    // Bare datetime without Z — should still show correct UTC date
    expect(relativeTime('2026-03-30 12:00:00')).toMatch(/Mar 30/);
  });
});
