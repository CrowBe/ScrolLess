/** Detect whether a timestamp string already carries timezone info */
function hasTimezone(ts: string): boolean {
  if (ts.endsWith('Z')) return true;
  // Match +HH:MM or -HH:MM after the T separator (not the date dashes)
  const tIdx = ts.indexOf('T');
  if (tIdx === -1) return false;
  const after = ts.slice(tIdx + 1);
  return /[+-]\d{2}:\d{2}$/.test(after);
}

/** Parse a timestamp, treating bare datetime strings (no timezone) as UTC */
function parseUtcDate(ts: string): Date {
  return new Date(hasTimezone(ts) ? ts : ts + 'Z');
}

export function relativeTime(iso: string): string {
  const date = parseUtcDate(iso);
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
