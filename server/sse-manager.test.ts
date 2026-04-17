import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { SseManager } from './sse-manager.js';

function mockReply(writeReturns: boolean = true): FastifyReply {
  return {
    raw: {
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn().mockReturnValue(writeReturns),
      end: vi.fn(),
    },
  } as unknown as FastifyReply;
}

describe('SseManager', () => {
  it('does not remove the active connection when an older connection closes', () => {
    const manager = new SseManager();
    const first = mockReply();
    const second = mockReply();

    manager.register('dev_123', first);
    manager.register('dev_123', second);

    manager.remove('dev_123', first);
    expect(manager.isOnline('dev_123')).toBe(true);
    expect(manager.send('dev_123', 'feed_items', { source: 'x' })).toBe(true);

    manager.remove('dev_123', second);
    expect(manager.isOnline('dev_123')).toBe(false);
  });

  it('drops the connection when the socket buffer is full', () => {
    const manager = new SseManager();
    const reply = mockReply(false); // write() returns false → backpressure

    manager.register('dev_back', reply);
    expect(manager.send('dev_back', 'feed_items', { source: 'x' })).toBe(false);
    expect(reply.raw.end).toHaveBeenCalled();
    expect(manager.isOnline('dev_back')).toBe(false);
  });
});
