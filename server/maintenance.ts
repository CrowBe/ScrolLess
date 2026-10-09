import type Database from 'better-sqlite3';

/** Purge expired OAuth codes/tokens and device sessions/challenges. */
export function cleanupExpired(db: Database.Database): void {
  const authCodes = db.prepare(
    `DELETE FROM oauth_auth_codes WHERE expires_at < datetime('now')`
  ).run();

  // Purge OAuth tokens where both access and refresh have expired
  const oauthTokens = db.prepare(
    `DELETE FROM oauth_tokens WHERE access_expires < datetime('now') AND (refresh_expires IS NULL OR refresh_expires < datetime('now'))`
  ).run();

  // expires_at is ISO-8601 with 'T'/'Z' while datetime('now') is space-separated;
  // compare both sides through datetime() so SQLite normalizes first.
  const deviceSessions = db.prepare(
    `DELETE FROM device_sessions WHERE datetime(expires_at) < datetime('now')`
  ).run();

  const deviceChallenges = db.prepare(
    `DELETE FROM device_challenges WHERE consumed_at IS NOT NULL OR datetime(expires_at) < datetime('now')`
  ).run();

  console.log(
    `[cleanup] auth_codes=${authCodes.changes} oauth_tokens=${oauthTokens.changes}` +
    ` device_sessions=${deviceSessions.changes} device_challenges=${deviceChallenges.changes}`
  );
}

export function scheduleCleanup(db: Database.Database): void {
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  cleanupExpired(db);
  const interval = setInterval(() => cleanupExpired(db), CLEANUP_INTERVAL_MS);
  interval.unref();
}
