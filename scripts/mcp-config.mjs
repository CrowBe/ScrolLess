// Print MCP client configuration for this checkout's local stdio server.
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = resolve(root, 'node_modules/.bin/tsx');
const entry = resolve(root, 'server/mcp-stdio.ts');

console.log('Claude Code:\n');
console.log(`  claude mcp add scrolless --scope user -- ${command} ${entry}\n`);
console.log('JSON config (Claude Desktop, Cursor, other MCP clients):\n');
console.log(JSON.stringify({ mcpServers: { scrolless: { command, args: [entry] } } }, null, 2));
