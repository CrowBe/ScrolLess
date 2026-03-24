import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyAgentToken(
  db: Database.Database,
  token: string
): { valid: boolean; userId: string | null } {
  const hash = hashToken(token);

  const row = db
    .prepare('SELECT user_id FROM agent_tokens WHERE token_hash = ?')
    .get(hash) as { user_id: string } | undefined;

  if (!row) {
    return { valid: false, userId: null };
  }

  db.prepare(
    `UPDATE agent_tokens SET last_used = datetime('now') WHERE token_hash = ?`
  ).run(hash);

  return { valid: true, userId: row.user_id };
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
