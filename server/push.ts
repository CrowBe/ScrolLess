import webPush from 'web-push';
import type Database from 'better-sqlite3';
import type { AppConfig } from './types.js';

export function initPush(config: AppConfig): void {
  const push = config.push;
  if (!push?.vapid_public_key || !push?.vapid_private_key) {
    console.warn('[push] VAPID keys not configured — push notifications disabled');
    return;
  }

  webPush.setVapidDetails(
    push.subject ?? 'mailto:noreply@example.com',
    push.vapid_public_key,
    push.vapid_private_key
  );
  console.log('[push] Web Push initialised');
}

export async function notifyNewItems(
  db: Database.Database,
  userId: string,
  source: string,
  count: number,
  latestTitle?: string
): Promise<void> {
  const subs = db.prepare(
    `SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?`
  ).all(userId) as Array<{ id: number; endpoint: string; keys_p256dh: string; keys_auth: string }>;

  if (subs.length === 0) return;

  const payload = JSON.stringify({
    title: `${count} new from ${source}`,
    body: latestTitle ? `Latest: ${latestTitle}` : `${count} new item${count === 1 ? '' : 's'}`,
    source,
    count,
    url: '/',
  });

  const staleIds: number[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          payload
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410) {
          staleIds.push(sub.id);
        } else {
          console.error(`[push] Failed to notify endpoint ${sub.endpoint}:`, err);
        }
      }
    })
  );

  // Remove stale subscriptions
  if (staleIds.length > 0) {
    const placeholders = staleIds.map(() => '?').join(',');
    db.prepare(
      `DELETE FROM push_subscriptions WHERE id IN (${placeholders})`
    ).run(...staleIds);
    console.log(`[push] Removed ${staleIds.length} stale subscription(s)`);
  }
}
