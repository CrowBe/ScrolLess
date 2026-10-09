import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initDb } from './db.js';
import { createContentMcpServer } from './mcp-content-tools.js';

// Local stdio MCP server: an agent on this machine launches this process and
// pushes readable items straight into the host SQLite store. Trust comes from
// the local process boundary, so no token is needed. stdout carries the MCP
// protocol — log to stderr only.

async function main() {
  const db = initDb(process.env.DB_PATH);
  const mcp = createContentMcpServer(db, 'local');
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await mcp.close().catch(() => {});
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  transport.onclose = () => { db.close(); };

  await mcp.connect(transport);
  console.error(`[scrolless-mcp] stdio server ready (db: ${db.name})`);
}

main().catch((err) => {
  console.error('[scrolless-mcp] Fatal error:', err);
  process.exit(1);
});
