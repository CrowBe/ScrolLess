import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createContentMcpServer } from './mcp-content-tools.js';
import { recordFeedback, type PushResult } from './content-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

describe('content MCP server', () => {
  let db: Database.Database;
  let client: Client;
  const committed: PushResult[] = [];

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8'));
    db.prepare(`INSERT INTO user_sources (user_id, name, enabled, urls) VALUES ('local', 'youtube', 1, ?)`)
      .run(JSON.stringify(['https://www.youtube.com/feed/subscriptions']));

    const server = createContentMcpServer(db, 'local', { onCommitted: (r) => committed.push(r) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    db.close();
    committed.length = 0;
  });

  it('exposes the push tools, guide and prompt', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_collection_context', 'get_taste_profile', 'list_items', 'push_items']);

    const guide = await client.readResource({ uri: 'scrolless://guide/push' });
    expect((guide.contents[0] as { text: string }).text).toContain('push_items');

    const hints = await client.readResource({ uri: 'scrolless://sources/youtube' });
    expect((hints.contents[0] as { text: string }).text).toContain('push guide wins');

    const prompt = await client.getPrompt({ name: 'collect_feed', arguments: { source: 'youtube' } });
    expect(JSON.stringify(prompt.messages)).toContain('youtube');
  });

  it('returns collection context', async () => {
    const result = await client.callTool({ name: 'get_collection_context', arguments: {} });
    const context = JSON.parse(textOf(result)) as { sources: Array<{ name: string; enabled: boolean; urls: string[] }> };
    expect(context.sources).toEqual([
      expect.objectContaining({ name: 'youtube', enabled: true, urls: ['https://www.youtube.com/feed/subscriptions'] }),
    ]);
  });

  it('summarises learned taste for the agent', async () => {
    const context = JSON.parse(textOf(await client.callTool({ name: 'get_collection_context', arguments: {} }))) as { taste_summary: string };
    expect(context.taste_summary).toMatch(/No swipe feedback yet/);

    const push = JSON.parse(textOf(await client.callTool({
      name: 'push_items',
      arguments: {
        source: 'youtube',
        items: [{ source_id: 'v1', url: 'https://www.youtube.com/watch?v=v1', title: 'Rust talk', author: 'Chan', tags: ['Rust'] }],
      },
    }))) as PushResult;
    recordFeedback(db, 'local', push.receipts[0].id!, 'save');

    const taste = JSON.parse(textOf(await client.callTool({ name: 'get_taste_profile', arguments: {} }))) as {
      feedback: { total: number; saves: number };
      liked: { tags: Array<{ name: string }>; authors: Array<{ name: string; source: string }> };
      summary: string;
    };
    expect(taste.feedback).toMatchObject({ total: 1, saves: 1 });
    expect(taste.liked.tags).toEqual([expect.objectContaining({ name: 'rust' })]);
    expect(taste.liked.authors).toEqual([expect.objectContaining({ name: 'Chan', source: 'youtube' })]);
    expect(taste.summary).toMatch(/Leans toward: topics rust/);
  });

  it('pushes items and reads them back', async () => {
    const push = await client.callTool({
      name: 'push_items',
      arguments: {
        source: 'youtube',
        items: [{
          source_id: 'dQw4w9WgXcQ',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'A video',
          author: 'A channel',
          content_type: 'video',
          metadata: { duration: '3:32' },
        }],
      },
    });
    const result = JSON.parse(textOf(push)) as PushResult;
    expect(result.counts.created).toBe(1);
    expect(committed).toHaveLength(1);

    const list = await client.callTool({ name: 'list_items', arguments: { source: 'youtube' } });
    const { items } = JSON.parse(textOf(list)) as { items: Array<{ title: string; metadata: unknown }> };
    expect(items).toEqual([expect.objectContaining({ title: 'A video', metadata: { duration: '3:32' } })]);
  });

  it('reports invalid sources as tool errors', async () => {
    const result = await client.callTool({
      name: 'push_items',
      arguments: { source: 'Not Valid!', items: [] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('invalid_source');
  });
});
