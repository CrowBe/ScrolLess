import { createHash, createPublicKey, verify as verifySignature } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';

export interface ApiAuthContext {
  userId: string;
  hasDeviceProof: boolean;
  authMethod: 'device-proof' | 'dev-bypass';
}

const DEVICE_PROOF_TTL_SECONDS = 120;

function shouldBypassDeviceAuthInDev(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.SCROLLESS_ALLOW_DEV_AUTH_BYPASS === 'true';
}

function extractDeviceId(req: FastifyRequest): string | null {
  const userIdHeader = req.headers['x-device-id'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
  if (!userId || typeof userId !== 'string') {
    return null;
  }
  return userId;
}

function parseDevicePublicKey(storedKey: string) {
  try {
    return createPublicKey(storedKey);
  } catch {
    return createPublicKey({
      key: Buffer.from(storedKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }
}

function verifyDeviceProof(req: FastifyRequest, publicKey: string): boolean {
  const tsHeader = req.headers['x-device-proof-ts'];
  const signatureHeader = req.headers['x-device-proof-signature'];

  const ts = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!ts || !signature) {
    return false;
  }

  const tsInt = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsInt)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsInt) > DEVICE_PROOF_TTL_SECONDS) {
    return false;
  }

  const url = req.url.split('?')[0] ?? req.url;
  const payload = `${ts}.${req.method.toUpperCase()}.${url}`;

  try {
    const key = parseDevicePublicKey(publicKey);
    const sig = Buffer.from(signature, 'base64');
    return verifySignature('sha256', Buffer.from(payload), key, sig);
  } catch {
    return false;
  }
}

export function resolveApiAuth(
  req: FastifyRequest,
  db: Database.Database,
): ApiAuthContext | null {
  const deviceId = extractDeviceId(req);

  if (!deviceId) {
    if (shouldBypassDeviceAuthInDev()) {
      return {
        userId: 'local',
        hasDeviceProof: true,
        authMethod: 'dev-bypass',
      };
    }
    return null;
  }

  if (!deviceId.startsWith('dev_')) {
    return null;
  }

  const registration = db.prepare(
    `SELECT user_id, public_key FROM device_registrations WHERE user_id = ?`
  ).get(deviceId) as { user_id: string; public_key: string } | undefined;

  if (!registration) {
    return null;
  }

  if (!verifyDeviceProof(req, registration.public_key)) {
    return null;
  }

  return {
    userId: registration.user_id,
    hasDeviceProof: true,
    authMethod: 'device-proof',
  };
}

export function requireApiAuth(req: FastifyRequest, reply: FastifyReply): ApiAuthContext | null {
  const auth = req.apiAuth;
  if (!auth?.userId) {
    reply.status(401).send({ error: 'Unauthorized device' });
    return null;
  }
  return auth;
}

export function requireSensitiveApiProof(req: FastifyRequest, reply: FastifyReply): ApiAuthContext | null {
  const auth = requireApiAuth(req, reply);
  if (!auth) {
    return null;
  }
  if (!auth.hasDeviceProof) {
    reply.status(401).send({ error: 'Device proof is required' });
    return null;
  }
  return auth;
}

export function registerApiAuthHook(
  fastify: FastifyInstance,
  db: Database.Database,
): void {
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) {
      return;
    }

    const auth = resolveApiAuth(req, db);
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized device' });
    }
    req.apiAuth = auth;
  });
}

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

  // Path 2: OAuth access token — look up raw token in oauth_tokens
  const oauthRow = db
    .prepare(
      `SELECT user_id, access_expires FROM oauth_tokens WHERE access_token = ?`
    )
    .get(token) as { user_id: string; access_expires: string } | undefined;

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

declare module 'fastify' {
  interface FastifyRequest {
    apiAuth?: ApiAuthContext;
    userId?: string;
  }
}
