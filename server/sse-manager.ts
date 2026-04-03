import type { FastifyReply } from 'fastify';

type SseEventPayload = Record<string, unknown>;

interface SseClient {
  reply: FastifyReply;
  keepalive: NodeJS.Timeout;
}

export class SseManager {
  private readonly clients = new Map<string, SseClient>();

  register(userId: string, reply: FastifyReply): void {
    this.remove(userId);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const keepalive = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': keepalive\n\n');
      }
    }, 30_000);

    this.clients.set(userId, { reply, keepalive });
  }

  remove(userId: string): void {
    const existing = this.clients.get(userId);
    if (!existing) return;
    clearInterval(existing.keepalive);
    this.clients.delete(userId);
  }

  isOnline(userId: string): boolean {
    const client = this.clients.get(userId);
    return Boolean(client && !client.reply.raw.writableEnded);
  }

  send(userId: string, event: string, payload: SseEventPayload): boolean {
    const client = this.clients.get(userId);
    if (!client || client.reply.raw.writableEnded) return false;

    const body = JSON.stringify(payload);
    client.reply.raw.write(`event: ${event}\n`);
    client.reply.raw.write(`data: ${body}\n\n`);
    return true;
  }
}
