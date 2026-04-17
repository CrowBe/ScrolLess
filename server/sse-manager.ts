import type { FastifyReply } from 'fastify';

type SseEventPayload = object;

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

  remove(userId: string, reply?: FastifyReply): void {
    const existing = this.clients.get(userId);
    if (!existing) return;
    if (reply && existing.reply !== reply) return;
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
    const headerFlushed = client.reply.raw.write(`event: ${event}\n`);
    const bodyFlushed = client.reply.raw.write(`data: ${body}\n\n`);

    // Back-pressure guard: if either write signals the kernel buffer is full
    // the client is too slow to keep up. Drop the connection so the
    // EventSource reconnects cleanly instead of letting Node's write buffer
    // grow without bound.
    if (!headerFlushed || !bodyFlushed) {
      client.reply.raw.end();
      this.remove(userId);
      return false;
    }
    return true;
  }
}
