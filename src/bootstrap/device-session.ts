import { openScrollessDb, type DeviceRecord } from '../idb';
import { generateSigningKeypair, exportSigningPublicKeyBase64, signNonce } from '../device-crypto';
import { apiUrl } from '../config';

// Reader authentication: the device proves possession of its signing key via
// challenge/verify and receives a session token for /api/* requests.

export class EnrollmentTokenRequiredError extends Error {
  constructor() { super('enrollment_token_required'); }
}

async function loadEnrollmentToken(): Promise<string | null> {
  const idb = await openScrollessDb();
  const row = await idb.get('preferences', 'enrollment_token');
  if (!row || typeof row.value !== 'string') return null;
  return row.value.trim() || null;
}

export async function saveEnrollmentToken(token: string): Promise<void> {
  const idb = await openScrollessDb();
  await idb.put('preferences', { key: 'enrollment_token', value: token.trim() });
}

// Module-level cache so api.ts req() can read auth state synchronously
let cachedSessionToken: string | null = null;

export function getCachedSessionToken(): string | null {
  return cachedSessionToken;
}

export interface DeviceSessionStatus {
  state: 'connecting' | 'ready' | 'error';
  deviceId: string | null;
  lastError: string | null;
}

type Listener = (status: DeviceSessionStatus) => void;

let status: DeviceSessionStatus = { state: 'connecting', deviceId: null, lastError: null };
const listeners = new Set<Listener>();

function emitStatus(next: Partial<DeviceSessionStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
}

export function getDeviceSessionStatus(): DeviceSessionStatus {
  return status;
}

export function subscribeDeviceSessionStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

async function loadOrCreateDevice(): Promise<DeviceRecord> {
  const idb = await openScrollessDb();
  const existing = await idb.get('device', 'singleton');
  if (existing) return existing;

  const { publicKey, privateKey } = await generateSigningKeypair();
  const record: DeviceRecord = {
    id: 'singleton',
    device_id: `dev_${crypto.randomUUID()}`,
    signing_public_key_b64: await exportSigningPublicKeyBase64(publicKey),
    signing_private_key: privateKey,
    registered_at: new Date().toISOString(),
  };
  await idb.put('device', record);
  return record;
}

/** Run challenge/verify to obtain a fresh session token from the server. */
async function authenticateDevice(device: DeviceRecord): Promise<{ sessionToken: string; sessionExpiresAt: string }> {
  const enrollmentToken = await loadEnrollmentToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (enrollmentToken) headers['X-Device-Enroll-Token'] = enrollmentToken;

  const chalRes = await fetch(apiUrl('/api/v1/device/challenge'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ device_id: device.device_id, public_key: device.signing_public_key_b64 }),
  });
  if (chalRes.status === 401) throw new EnrollmentTokenRequiredError();
  if (!chalRes.ok) throw new Error(`challenge failed (${chalRes.status})`);
  const { challenge_id, nonce } = await chalRes.json() as { challenge_id: string; nonce: string };

  const signature = await signNonce(nonce, device.signing_private_key);

  const verRes = await fetch(apiUrl('/api/v1/device/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id, device_id: device.device_id, signature }),
  });
  if (!verRes.ok) throw new Error(`verify failed (${verRes.status})`);
  const { session_token, session_expires_at } = await verRes.json() as { session_token: string; session_expires_at: string };
  return { sessionToken: session_token, sessionExpiresAt: session_expires_at };
}

export async function startDeviceSession(): Promise<void> {
  emitStatus({ state: 'connecting', lastError: null });
  try {
    let device = await loadOrCreateDevice();
    emitStatus({ deviceId: device.device_id });

    // Reuse the cached session token unless it expires within 60 s
    const expiry = device.session_expires_at ? new Date(device.session_expires_at) : null;
    if (!device.session_token || !expiry || expiry <= new Date(Date.now() + 60_000)) {
      const { sessionToken, sessionExpiresAt } = await authenticateDevice(device);
      device = { ...device, session_token: sessionToken, session_expires_at: sessionExpiresAt };
      const idb = await openScrollessDb();
      await idb.put('device', device);
    }
    cachedSessionToken = device.session_token!;
    emitStatus({ state: 'ready' });
  } catch (err) {
    emitStatus({ state: 'error', lastError: err instanceof Error ? err.message : 'authentication error' });
    throw err;
  }
}
