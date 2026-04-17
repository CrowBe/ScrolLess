import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import type { AppConfig } from './types.js';
import { hashToken } from './auth.js';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function seedOAuthClients(db: Database.Database, config: AppConfig): void {
  const clients = config.oauth?.clients ?? [];
  // ON CONFLICT preserves `is_active` so operators can disable a client without
  // having it silently re-enabled on the next restart.
  const stmt = db.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, label, is_active)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(client_id) DO UPDATE SET
       redirect_uris = excluded.redirect_uris,
       label = excluded.label`
  );
  const seed = db.transaction(() => {
    for (const c of clients) {
      stmt.run(c.client_id, null, JSON.stringify(c.redirect_uris), c.client_id);
    }
  });
  seed();
}

export function registerOAuthRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  config: AppConfig
): void {
  const tokenExpiresIn = config.oauth?.token_expires_in ?? 3600;
  const refreshExpiresIn = config.oauth?.refresh_token_expires_in ?? 2592000;

  function getIssuer(): string {
    if (config.base_url) return config.base_url.replace(/\/$/, '');
    const host = config.server?.host === '0.0.0.0' ? '127.0.0.1' : (config.server?.host ?? '127.0.0.1');
    const port = config.server?.port ?? 3333;
    return `http://${host}:${port}`;
  }

  function buildMetadata() {
    const issuer = getIssuer();
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    };
  }

  // RFC 8414 §3 — discovery at both root and /oauth/ prefix
  fastify.get('/.well-known/oauth-authorization-server', async (_req, reply) => {
    return reply.send(buildMetadata());
  });

  fastify.get('/oauth/.well-known/oauth-authorization-server', async (_req, reply) => {
    return reply.send(buildMetadata());
  });

  // --- Authorization endpoint ---
  fastify.get('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } = q;

    // Validate required params
    if (!client_id || !redirect_uri || !response_type || !code_challenge || !code_challenge_method || !state) {
      return reply.status(400).send({ error: 'Missing required parameters: client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state' });
    }

    if (response_type !== 'code') {
      return reply.status(400).send({ error: 'response_type must be "code"' });
    }

    if (code_challenge_method !== 'S256') {
      return reply.status(400).send({ error: 'code_challenge_method must be "S256"' });
    }

    // Validate client
    const client = db.prepare(
      'SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ? AND is_active = 1'
    ).get(client_id) as { client_id: string; redirect_uris: string } | undefined;

    if (!client) {
      return reply.status(400).send({ error: 'Unknown client_id' });
    }

    let allowedUris: string[];
    try {
      allowedUris = JSON.parse(client.redirect_uris);
    } catch {
      return reply.status(500).send({ error: 'server_error', error_description: 'Malformed client configuration' });
    }
    if (!allowedUris.includes(redirect_uri)) {
      return reply.status(400).send({ error: 'Invalid redirect_uri' });
    }

    // Render minimal consent screen
    const needsPassword = !!config.admin_password;
    const passwordField = needsPassword
      ? `<div class="field"><label for="admin_password">Admin password</label><input id="admin_password" type="password" name="admin_password" required autocomplete="current-password"></div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize — ScrolLess</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; max-width: 400px; width: 100%; text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { color: #999; margin: 0 0 1.5rem; }
    .client { color: #60a5fa; font-weight: 600; }
    .field { margin: 0 0 1.25rem; text-align: left; }
    .field label { display: block; font-size: 0.8rem; color: #999; margin-bottom: 0.4rem; }
    .field input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.75rem; background: #111; border: 1px solid #444; border-radius: 6px; color: #e5e5e5; font-size: 0.9rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: center; }
    button { padding: 0.625rem 1.5rem; border-radius: 8px; border: none; font-size: 0.875rem; cursor: pointer; font-weight: 500; }
    .allow { background: #2563eb; color: #fff; }
    .allow:hover { background: #1d4ed8; }
    .deny { background: #333; color: #ccc; }
    .deny:hover { background: #444; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Access</h1>
    <p><span class="client">${escapeHtml(client_id)}</span> wants to access your ScrolLess account.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="response_type" value="code">
      ${passwordField}
      <div class="actions">
        <button type="submit" name="approve" value="1" class="allow">Allow</button>
        <button type="submit" name="approve" value="0" class="deny">Deny</button>
      </div>
    </form>
  </div>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // --- Authorization approval (POST) ---
  fastify.post('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string>;
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, approve, admin_password } = body;

    // Re-validate client and redirect_uri before any redirect (prevent open redirect)
    const client = db.prepare(
      'SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ? AND is_active = 1'
    ).get(client_id) as { client_id: string; redirect_uris: string } | undefined;

    if (!client) {
      return reply.status(400).send({ error: 'Unknown client_id' });
    }

    let allowedUris: string[];
    try {
      allowedUris = JSON.parse(client.redirect_uris);
    } catch {
      return reply.status(500).send({ error: 'server_error', error_description: 'Malformed client configuration' });
    }
    if (!allowedUris.includes(redirect_uri)) {
      return reply.status(400).send({ error: 'Invalid redirect_uri' });
    }

    if (approve !== '1') {
      const denyUrl = `${redirect_uri}?error=access_denied&state=${encodeURIComponent(state ?? '')}`;
      return reply.redirect(denyUrl);
    }

    // Verify admin password if configured (timing-safe comparison)
    if (config.admin_password) {
      const expected = Buffer.from(config.admin_password);
      const received = Buffer.from(admin_password ?? '');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        return reply.status(403).send({ error: 'access_denied', error_description: 'Invalid admin password' });
      }
    }

    if (code_challenge_method !== 'S256') {
      return reply.status(400).send({ error: 'code_challenge_method must be "S256"' });
    }

    // Generate auth code
    const code = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const userId = 'local'; // PoC: single user

    db.prepare(
      `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(code, client_id, userId, redirect_uri, code_challenge, expiresAt);

    const redirectUrl = `${redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? '')}`;
    return reply.redirect(redirectUrl);
  });

  // --- Token endpoint ---
  fastify.post('/oauth/token', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string>;
    const { grant_type } = body;

    if (grant_type === 'authorization_code') {
      return handleAuthCodeGrant(body, reply);
    } else if (grant_type === 'refresh_token') {
      return handleRefreshGrant(body, reply);
    }

    return reply.status(400).send({ error: 'unsupported_grant_type' });
  });

  function handleAuthCodeGrant(body: Record<string, string>, reply: FastifyReply) {
    const { code, redirect_uri, code_verifier, client_id } = body;

    if (!code || !redirect_uri || !code_verifier || !client_id) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'Missing required parameters' });
    }

    // Look up auth code
    const authCode = db.prepare(
      `SELECT code, client_id, user_id, redirect_uri, code_challenge, expires_at
       FROM oauth_auth_codes WHERE code = ?`
    ).get(code) as {
      code: string; client_id: string; user_id: string;
      redirect_uri: string; code_challenge: string; expires_at: string;
    } | undefined;

    if (!authCode) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    // Check expiry
    if (new Date(authCode.expires_at) < new Date()) {
      db.prepare('DELETE FROM oauth_auth_codes WHERE code = ?').run(code);
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Authorization code has expired' });
    }

    // Check client_id and redirect_uri match
    if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'client_id or redirect_uri mismatch' });
    }

    // PKCE verification: SHA-256(code_verifier) base64url-encoded must equal code_challenge
    const verifierHash = base64url(createHash('sha256').update(code_verifier).digest());
    if (verifierHash !== authCode.code_challenge) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE code_verifier does not match code_challenge' });
    }

    // Issue tokens — store only hashes, return plaintext to client
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const accessExpires = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();
    const refreshExpires = new Date(Date.now() + refreshExpiresIn * 1000).toISOString();

    db.prepare(
      `INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires, refresh_expires)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(hashToken(accessToken), hashToken(refreshToken), authCode.client_id, authCode.user_id, accessExpires, refreshExpires);

    // Delete used auth code
    db.prepare('DELETE FROM oauth_auth_codes WHERE code = ?').run(code);

    return reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: tokenExpiresIn,
      refresh_token: refreshToken,
      scope: 'feed',
    });
  }

  function handleRefreshGrant(body: Record<string, string>, reply: FastifyReply) {
    const { refresh_token, client_id } = body;

    if (!refresh_token || !client_id) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'Missing required parameters' });
    }

    const tokenRow = db.prepare(
      `SELECT access_token_hash, client_id, user_id, refresh_expires
       FROM oauth_tokens WHERE refresh_token_hash = ?`
    ).get(hashToken(refresh_token)) as {
      access_token_hash: string; client_id: string;
      user_id: string; refresh_expires: string | null;
    } | undefined;

    if (!tokenRow) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
    }

    if (tokenRow.client_id !== client_id) {
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'client_id mismatch' });
    }

    // Check refresh token expiry
    if (tokenRow.refresh_expires && new Date(tokenRow.refresh_expires) < new Date()) {
      db.prepare('DELETE FROM oauth_tokens WHERE access_token_hash = ?').run(tokenRow.access_token_hash);
      return reply.status(400).send({ error: 'invalid_grant', error_description: 'Refresh token has expired' });
    }

    // Delete old token row
    db.prepare('DELETE FROM oauth_tokens WHERE access_token_hash = ?').run(tokenRow.access_token_hash);

    // Issue new tokens — store only hashes, return plaintext to client
    const newAccessToken = randomBytes(32).toString('hex');
    const newRefreshToken = randomBytes(32).toString('hex');
    const accessExpires = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();
    const refreshExpires = new Date(Date.now() + refreshExpiresIn * 1000).toISOString();

    db.prepare(
      `INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires, refresh_expires)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(hashToken(newAccessToken), hashToken(newRefreshToken), tokenRow.client_id, tokenRow.user_id, accessExpires, refreshExpires);

    return reply.send({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: tokenExpiresIn,
      refresh_token: newRefreshToken,
      scope: 'feed',
    });
  }

  // --- Revocation endpoint (RFC 7009) ---
  fastify.post('/oauth/revoke', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string>;
    const { token } = body;

    if (token) {
      // Try as access token first, then as refresh token (look up by hash)
      const tokenHash = hashToken(token);
      const r1 = db.prepare('DELETE FROM oauth_tokens WHERE access_token_hash = ?').run(tokenHash);
      if (r1.changes === 0) {
        db.prepare('DELETE FROM oauth_tokens WHERE refresh_token_hash = ?').run(tokenHash);
      }
    }

    // Always 200 per RFC 7009
    return reply.status(200).send({});
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
