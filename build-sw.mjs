// Build service worker without filename hashing
// Runs after vite build via npm run build
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(__dirname, 'src/sw.ts')],
  bundle: true,
  outfile: join(__dirname, 'dist/client/sw.js'),
  format: 'esm',
  target: 'es2022',
  minify: false,
});

console.log('Service worker built to dist/client/sw.js');
