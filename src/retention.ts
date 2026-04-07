import { openScrollessDb } from './idb';

/**
 * Delete feed items older than the user's retention preference.
 * Uses fetched_at (not published_at) as the age basis.
 * Saved items are always kept regardless of age.
 * Default retention: 7 days.
 */
export async function runRetentionCleanup(): Promise<{ deleted: number }> {
  const db = await openScrollessDb();

  const retentionPref = await db.get('preferences', 'retention_days');
  const retentionDays = typeof retentionPref?.value === 'number' ? retentionPref.value : 7;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const all = await db.getAll('feed_items');
  let deleted = 0;

  for (const item of all) {
    if (item.fetched_at < cutoff && !item.is_saved) {
      await db.delete('feed_items', item.id);
      deleted++;
    }
  }

  if (deleted > 0) {
    window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
  }

  return { deleted };
}
