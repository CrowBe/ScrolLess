import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import { seedAgentToken, verifyAgentToken } from './auth.js';
import { registerAgentRoutes, scheduleCleanup } from './agent-routes.js';
import { registerApiRoutes } from './api-routes.js';
import { registerOAuthRoutes, seedOAuthClients } from './oauth-routes.js';
import { registerMcpHandler } from './mcp.js';
import { initPush, notifyNewItems } from './push.js';
import { SseManager } from './sse-manager.js';
import type { AppConfig, OAuthClientConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOauthClients(value: string | undefined): OAuthClientConfig[] {
  if (!value) {
    return [{
      client_id: 'claude-connector',
      redirect_uris: ['https://claude.ai/oauth/callback'],
      is_public: true,
    }];
  }

  try {
    const parsed = JSON.parse(value) as OAuthClientConfig[];
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (err) {
    console.warn('[config] Failed to parse OAUTH_CLIENTS_JSON. Falling back to default claude-connector client.', err);
    return [{
      client_id: 'claude-connector',
      redirect_uris: ['https://claude.ai/oauth/callback'],
      is_public: true,
    }];
  }
}

// Load config from environment variables.
function loadConfig(): AppConfig {
  const config: AppConfig = {
    agent_token_hash: process.env.AGENT_TOKEN_HASH ?? '',
    db_path: process.env.DB_PATH,
    base_url: process.env.BASE_URL,
    admin_password: process.env.ADMIN_PASSWORD,
    server: {
      port: parseNumber(process.env.PORT, 3333),
      host: process.env.HOST ?? '0.0.0.0',
    },
    push: {
      vapid_public_key: process.env.VAPID_PUBLIC_KEY,
      vapid_private_key: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    },
    rate_limit: {
      agent_max_per_hour: parseNumber(process.env.AGENT_RATE_LIMIT_PER_HOUR, 60),
    },
    oauth: {
      clients: parseOauthClients(process.env.OAUTH_CLIENTS_JSON),
      token_expires_in: parseNumber(process.env.OAUTH_TOKEN_EXPIRES_IN, 3600),
      refresh_token_expires_in: parseNumber(process.env.OAUTH_REFRESH_TOKEN_EXPIRES_IN, 2592000),
    },
    device: {
      enrollment_token: process.env.DEVICE_ENROLLMENT_TOKEN,
    },
  };

  return config;
}

async function start() {
  const config = loadConfig();

  if (!config.agent_token_hash) {
    console.warn('[auth] AGENT_TOKEN_HASH is not set — agent endpoints will reject all requests');
    console.warn('[auth] Generate a token: npm run generate-token');
    console.warn('[auth] Then hash it: node -e "const c=require(\'crypto\');const t=\'YOUR_TOKEN\';console.log(c.createHash(\'sha256\').update(t).digest(\'hex\'))"');
  }

  const dbPath = config.db_path;
  const db = initDb(dbPath);
  const sseManager = new SseManager();

  if (config.agent_token_hash) {
    seedAgentToken(db, config.agent_token_hash, 'default');
  }

  // Seed OAuth clients from config
  seedOAuthClients(db, config);

  // Store VAPID public key in preferences so /api/push/vapid-key can serve it
  if (config.push?.vapid_public_key) {
    db.prepare(
      `INSERT OR REPLACE INTO user_preferences (user_id, key, value) VALUES ('local', 'vapid_public_key', ?)`
    ).run(JSON.stringify(config.push.vapid_public_key));
  }

  initPush(config);

  const fastify = Fastify({ logger: { level: isProd ? 'warn' : 'info' } });


  // Platform health probe endpoint (Render/other hosts)
  fastify.get('/health', async () => ({ ok: true }));

  // CORS — allow PWA dev origin in dev; always allow the MCP endpoint to be reached
  // by Claude Desktop / claude.ai (they make direct HTTP, not browser-CORS requests,
  // but we add the header for any web-based MCP client)
  await fastify.register(fastifyCors, {
    origin: (origin, done) => {
      const allowed = [
        'https://claude.ai',
        'https://www.claude.ai',
        ...(isProd ? [] : ['http://localhost:5173']),
        ...(config.base_url ? [config.base_url.replace(/\/$/, '')] : []),
      ];
      if (!origin || allowed.includes(origin)) {
        done(null, true);
      } else {
        done(null, false);
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'X-Device-Id'],
    exposedHeaders: ['Mcp-Session-Id'],
  });

  // Security headers on every response
  fastify.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isProd) {
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
  });

  // Form body parsing (for OAuth authorize POST)
  await fastify.register(fastifyFormbody);

  // Auth preHandler for agent routes
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/agent/')) return;

    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!token) {
      return reply.status(401).send({ error: 'Missing Authorization header' });
    }

    const result = verifyAgentToken(db, token);
    if (!result.valid) {
      return reply.status(401).send({ error: 'Invalid agent token' });
    }

    req.userId = result.userId ?? 'local';
  });

  // Push callback passed to agent routes
  const pushCallback = (userId: string, source: string, count: number, latestTitle?: string) =>
    notifyNewItems(db, userId, source, count, latestTitle);

  // Rate limiting — scoped to agent/MCP routes only
  // (skipIf does not exist in @fastify/rate-limit v9; use scoped plugin instead)
  await fastify.register(async (agentScope) => {
    await agentScope.register(fastifyRateLimit, {
      max: config.rate_limit?.agent_max_per_hour ?? 60,
      timeWindow: '1 hour',
      keyGenerator: (req) => {
        const auth = req.headers.authorization ?? '';
        return auth || req.ip;
      },
    });
    registerAgentRoutes(agentScope, db, pushCallback, sseManager);
    registerMcpHandler(agentScope, db, pushCallback, sseManager);
  });

  // Register non-rate-limited routes
  registerApiRoutes(fastify, db, sseManager, {
    deviceEnrollmentToken: config.device?.enrollment_token,
  });
  registerOAuthRoutes(fastify, db, config);

  // Static file serving in production
  const distPath = resolve(__dirname, '../dist/client');
  if (isProd && existsSync(distPath)) {
    await fastify.register(fastifyStatic, {
      root: distPath,
      prefix: '/',
    });

    // SPA fallback — serve index.html for non-api, non-agent paths
    fastify.setNotFoundHandler(async (req, reply) => {
      if (!req.url.startsWith('/api/') && !req.url.startsWith('/agent/') && !req.url.startsWith('/oauth/') && !req.url.startsWith('/mcp')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  const host = config.server?.host ?? '0.0.0.0';
  const port = config.server?.port ?? 3333;

  await fastify.listen({ host, port });
  console.log(`[server] ScrolLess running at http://${host}:${port}`);

  scheduleCleanup(db);
}

start().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
