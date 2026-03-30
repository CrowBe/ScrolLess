import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import { hashToken, seedAgentToken, verifyAgentToken } from './auth.js';
import { registerAgentRoutes, scheduleCleanup } from './agent-routes.js';
import { registerApiRoutes } from './api-routes.js';
import { registerOAuthRoutes, seedOAuthClients } from './oauth-routes.js';
import { registerMcpHandler } from './mcp.js';
import { initPush, notifyNewItems } from './push.js';
import type { AppConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// Load config
function loadConfig(): AppConfig {
  const configPath = resolve(process.cwd(), 'config.json');
  const examplePath = resolve(process.cwd(), 'config.example.json');

  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf8')) as AppConfig;
  }

  console.warn('[config] config.json not found — using config.example.json (push/auth may be non-functional)');
  return JSON.parse(readFileSync(examplePath, 'utf8')) as AppConfig;
}

async function start() {
  const config = loadConfig();

  if (!config.agent_token_hash) {
    console.warn('[auth] agent_token_hash is not set in config.json — agent endpoints will reject all requests');
    console.warn('[auth] Generate a token: npm run generate-token');
    console.warn('[auth] Then hash it: node -e "const c=require(\'crypto\');const t=\'YOUR_TOKEN\';console.log(c.createHash(\'sha256\').update(t).digest(\'hex\'))"');
  }

  const dbPath = config.db_path;
  const db = initDb(dbPath);

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
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id'],
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

  // Rate limiting for agent routes
  await fastify.register(fastifyRateLimit, {
    max: config.rate_limit?.agent_max_per_hour ?? 60,
    timeWindow: '1 hour',
    keyGenerator: (req) => {
      const auth = req.headers.authorization ?? '';
      return auth || req.ip;
    },
    // Only apply to /agent/* — we'll scope this in the route registration
  });

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

  // Register routes
  registerAgentRoutes(fastify, db, pushCallback);
  registerApiRoutes(fastify, db);
  registerOAuthRoutes(fastify, db, config);
  registerMcpHandler(fastify, db, pushCallback);

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

  const host = config.server?.host ?? '127.0.0.1';
  const port = config.server?.port ?? 3333;

  await fastify.listen({ host, port });
  console.log(`[server] ScrolLess running at http://${host}:${port}`);

  scheduleCleanup(db, 'local');
}

start().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
