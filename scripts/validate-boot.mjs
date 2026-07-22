import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requiredMajor = 20;
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

if (!Number.isFinite(nodeMajor) || nodeMajor < requiredMajor) {
  console.error(`[validate:boot] Node ${process.versions.node} does not satisfy >=${requiredMajor}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

async function waitForJson(url, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForText(url, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

const tempDir = await mkdtemp(join(tmpdir(), 'scrolless-boot-'));
const port = String(4300 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let shuttingDown = false;

try {
  console.log(`[validate:boot] Using Node ${process.versions.node}`);
  await run('npm', ['run', 'build']);

  server = spawn('npm', ['start'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: port,
      DB_PATH: join(tempDir, 'scrolless.db'),
    },
  });

  server.once('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code !== null && code !== 0) {
      console.error(`[validate:boot] Server exited early with ${code}`);
    } else if (signal) {
      console.error(`[validate:boot] Server exited early via ${signal}`);
    }
  });

  const health = await waitForJson(`${baseUrl}/health`);
  if (health?.ok !== true) {
    throw new Error(`/health returned unexpected payload: ${JSON.stringify(health)}`);
  }

  const html = await waitForText(`${baseUrl}/`);
  if (!html.includes('<div id="app"')) {
    throw new Error('Production root did not serve the ScrolLess app shell');
  }

  console.log(`[validate:boot] Production server booted and served health + app shell at ${baseUrl}`);
} finally {
  if (server && !server.killed) {
    shuttingDown = true;
    server.kill('SIGTERM');
  }
  await rm(tempDir, { recursive: true, force: true });
}
