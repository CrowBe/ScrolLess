import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifyAgentToken } from './auth.js';
import { getSyncContext, submitEncryptedPayload, type PushCallback } from './agent-routes.js';
import type { AgentEncryptedFeedPayload } from './types.js';
import type { SseManager } from './sse-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, '../skill/resources');

// Cache platform resources at startup to avoid synchronous file I/O per request
const resourceCache = new Map<string, string>();
try {
  for (const file of readdirSync(RESOURCES_DIR)) {
    if (file.endsWith('.md')) {
      const name = file.slice(0, -3);
      resourceCache.set(name, readFileSync(join(RESOURCES_DIR, file), 'utf8'));
    }
  }
} catch {
  // skill/resources may not exist in all environments
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

const GENERIC_INSTRUCTIONS = `# Scraping Instructions

No platform-specific instructions are available for this source.

Extract content items from the provided URLs. For each item, extract:
- source_id: a unique identifier for the item
- url: the canonical URL
- published_at: publication timestamp in ISO 8601 format
- plaintext fields to encrypt: title, author, content_preview, thumbnail_url, tags

Skip ads, sponsored content, and navigation elements.
`;

const RUN_FEED_SYNC_PROMPT = `Call get_sync_context to get your work order.
For each source where enabled is true:
  1. Fetch the scraping_resource to get platform-specific instructions
  2. Navigate to each URL in urls[]
  3. Extract items published after last_sync
  4. Skip any item whose title or content contains a blocked_keyword
  5. Collect up to max_items items
  6. Call submit_items with the batch
Log the relayed count. If a source fails, continue to the next.`;

function readPlatformResource(name: string): string | null {
  return resourceCache.get(name) ?? null;
}

function getScrapingNotes(db: Database.Database, userId: string, sourceName: string): string | null {
  const row = db.prepare(
    `SELECT scraping_notes FROM user_sources WHERE user_id = ? AND name = ?`
  ).get(userId, sourceName) as { scraping_notes: string | null } | undefined;
  return row?.scraping_notes ?? null;
}

export function registerMcpHandler(
  fastify: FastifyInstance,
  db: Database.Database,
  pushCallback?: PushCallback,
  sseManager?: SseManager
): void {
  // Map of session ID to transport, owning userId, and last-used time
  const transports = new Map<string, { transport: StreamableHTTPServerTransport; userId: string; lastUsedAt: number }>();

  // Periodically evict sessions idle longer than SESSION_TTL_MS
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, entry] of transports) {
      if (entry.lastUsedAt < cutoff) {
        entry.transport.close().catch(() => {});
        transports.delete(id);
      }
    }
  }, 10 * 60 * 1000); // every 10 minutes
  cleanupInterval.unref();

  function createMcpServer(userId: string): McpServer {
    const mcp = new McpServer(
      { name: 'scrolless', version: '1.0.0' },
      { capabilities: { resources: {}, tools: {}, prompts: {} } }
    );

    // Tool: get_sync_context
    mcp.tool(
      'get_sync_context',
      'Returns everything an agent needs to plan a scraping run: enabled sources with URLs, last sync times, and content filters.',
      async () => {
        const context = getSyncContext(db, userId);
        return {
          content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
        };
      }
    );

    // Tool: submit_items
    mcp.tool(
      'submit_items',
      'Submit an encrypted batch of scraped feed items from one source. Returns relayed count.',
      {
        source: z.string().describe('Source name, e.g. "youtube", "x", "news"'),
        ephemeral_public_key: z.string().describe('Base64 ephemeral P-256 public key used for this batch'),
        items: z.array(z.object({
          source_id: z.string(),
          url: z.string(),
          published_at: z.string(),
          encrypted_fields: z.string(),
          is_discovery: z.boolean().optional(),
        })).describe('Array of feed items to submit'),
      },
      async (args) => {
        const payload: AgentEncryptedFeedPayload = {
          source: args.source,
          ephemeral_public_key: args.ephemeral_public_key,
          items: args.items,
        };

        const result = submitEncryptedPayload(db, userId, payload, sseManager, pushCallback);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }
    );

    // Resource template: scrolless://platforms/{name}
    mcp.resource(
      'platform_instructions',
      new ResourceTemplate('scrolless://platforms/{name}', {
        list: async () => {
          const sourceRows = db.prepare(
            `SELECT name FROM user_sources WHERE user_id = ?`
          ).all(userId) as Array<{ name: string }>;

          return {
            resources: sourceRows.map(r => ({
              uri: `scrolless://platforms/${r.name}`,
              name: `${r.name} scraping instructions`,
              mimeType: 'text/markdown',
            })),
          };
        },
      }),
      { mimeType: 'text/markdown' },
      async (uri, variables) => {
        const name = variables.name as string;
        let content = readPlatformResource(name);
        if (!content) {
          content = GENERIC_INSTRUCTIONS;
        }

        const notes = getScrapingNotes(db, userId, name);
        if (notes) {
          content += `\n\n## User-Provided Scraping Notes\n\n${notes}`;
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: content,
          }],
        };
      }
    );

    // Prompt: run_feed_sync
    mcp.prompt(
      'run_feed_sync',
      'Complete feed sync workflow — call this to scrape all enabled sources and submit items.',
      async () => ({
        messages: [{
          role: 'user',
          content: { type: 'text', text: RUN_FEED_SYNC_PROMPT },
        }],
      })
    );

    return mcp;
  }

  function authenticateRequest(req: FastifyRequest): string | null {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;

    const result = verifyAgentToken(db, token);
    return result.valid ? (result.userId ?? 'local') : null;
  }

  // Handle MCP requests (POST, GET, DELETE)
  fastify.all('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = authenticateRequest(req);
    if (!userId) {
      return reply.status(401).send({ error: 'Invalid or missing authentication token' });
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'DELETE') {
      if (sessionId && transports.has(sessionId)) {
        const entry = transports.get(sessionId)!;
        await entry.transport.close();
        transports.delete(sessionId);
        return reply.status(200).send();
      }
      return reply.status(404).send({ error: 'Session not found' });
    }

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      const entry = transports.get(sessionId)!;
      // Verify the authenticated user owns this session
      if (entry.userId !== userId) {
        return reply.status(403).send({ error: 'Session belongs to a different user' });
      }
      entry.lastUsedAt = Date.now();
      transport = entry.transport;
    } else if (!sessionId && req.method === 'POST') {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      const mcp = createMcpServer(userId);
      await mcp.connect(transport);

      if (transport.sessionId) {
        transports.set(transport.sessionId, { transport, userId, lastUsedAt: Date.now() });
      }

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };
    } else {
      if (sessionId) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return reply.status(400).send({ error: 'Missing session ID' });
    }

    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}
