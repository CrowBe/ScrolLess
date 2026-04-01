const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  x: 'X',
  news: 'News',
};

export function displayName(name: string): string {
  return SOURCE_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
