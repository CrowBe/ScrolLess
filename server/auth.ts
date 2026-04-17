import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Try Bearer token auth first, then OAuth access token.
 * Returns { valid, userId } — route handlers don't care which path succeeded.
 */
export function verifyAgentToken(
  db: Database.Database,
  token: string
): { valid: boolean; userId: string | null } {
  // Path 1: Bearer token — hash and look up in agent_tokens
  const hash = hashToken(token);

  const agentRow = db
    .prepare('SELECT user_id FROM agent_tokens WHERE token_hash = ?')
    .get(hash) as { user_id: string } | undefined;

  if (agentRow) {
    db.prepare(
      `UPDATE agent_tokens SET last_used = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE token_hash = ?`
    ).run(hash);
    return { valid: true, userId: agentRow.user_id };
  }

  // Path 2: OAuth access token — hash and look up in oauth_tokens
  const oauthRow = db
    .prepare(
      `SELECT user_id, access_expires FROM oauth_tokens WHERE access_token_hash = ?`
    )
    .get(hash) as { user_id: string; access_expires: string } | undefined;

  if (oauthRow) {
    if (new Date(oauthRow.access_expires) > new Date()) {
      return { valid: true, userId: oauthRow.user_id };
    }
    // Token exists but expired
    return { valid: false, userId: null };
  }

  return { valid: false, userId: null };
}

export function seedAgentToken(
  db: Database.Database,
  tokenHash: string,
  label?: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO agent_tokens (token_hash, user_id, label) VALUES (?, 'local', ?)`
  ).run(tokenHash, label ?? 'default');
}
