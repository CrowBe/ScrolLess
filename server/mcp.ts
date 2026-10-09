import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { verifyAgentToken } from './auth.js';
import { createContentMcpServer } from './mcp-content-tools.js';

// HTTP transport for the MCP tools in mcp-content-tools.ts, for agents that
// cannot launch the local stdio server. Requires an agent or OAuth token.

export type NewItemsCallback = (userId: string, source: string, count: number, latestTitle?: string) => Promise<void>;

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export function registerMcpHandler(
  fastify: FastifyInstance,
  db: Database.Database,
  onNewItems?: NewItemsCallback
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

  function createMcpServer(userId: string) {
    return createContentMcpServer(db, userId, {
      onCommitted: (result, latestTitle) => {
        onNewItems?.(userId, result.source, result.counts.created + result.counts.updated, latestTitle).catch(() => {});
      },
    });
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
