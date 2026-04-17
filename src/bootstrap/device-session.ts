import { openScrollessDb, type DeviceRecord, type FeedItem } from '../idb';
import {
  generateKeypair,
  exportPublicKeyBase64,
  generateSigningKeypair,
  exportSigningPublicKeyBase64,
  signNonce,
  decryptFields,
  normaliseUrl,
  hashUrl,
} from '../crypto';
import { apiUrl } from '../config';

export class EnrollmentTokenRequiredError extends Error {
  constructor() { super('enrollment_token_required'); }
}

async function loadEnrollmentTokenFromIdb(): Promise<string | null> {
  const idb = await openScrollessDb();
  const row = await idb.get('preferences', 'enrollment_token');
  if (!row || typeof row.value !== 'string') return null;
  const trimmed = row.value.trim();
  return trimmed || null;
}

export async function saveEnrollmentToken(token: string): Promise<void> {
  const idb = await openScrollessDb();
  await idb.put('preferences', { key: 'enrollment_token', value: token.trim() });
}

const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 30_000;

// Module-level caches so api.ts req() can read auth state synchronously
let cachedDeviceId: string | null = null;
let cachedSessionToken: string | null = null;

export function getCachedDeviceId(): string | null {
  return cachedDeviceId;
}

export function getCachedSessionToken(): string | null {
  return cachedSessionToken;
}

type SessionUiState = 'not_registered' | 'stream_disconnected' | 'stream_active';

export interface DeviceSessionStatus {
  state: SessionUiState;
  deviceId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
}

interface EncryptedRelayItem {
  source_id: string;
  url: string;
  published_at: string;
  is_discovery?: boolean;
  encrypted_fields: string;
}

interface FeedItemsEventPayload {
  source: string;
  ephemeral_public_key: string;
  items: EncryptedRelayItem[];
}

export interface DeviceSessionOptions {
  onReady?: (deviceId: string) => void;
  onFeedItems?: (items: FeedItem[]) => void | Promise<void>;
}

type Listener = (status: DeviceSessionStatus) => void;

let status: DeviceSessionStatus = {
  state: 'not_registered',
  deviceId: null,
  connectedAt: null,
  lastError: null,
  reconnectAttempt: 0,
};

const listeners = new Set<Listener>();
let stream: EventSource | null = null;
let reconnectTimer: number | null = null;
let visibilityBound = false;

function emitStatus(next: Partial<DeviceSessionStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) {
    listener(status);
  }
}

export function getDeviceSessionStatus(): DeviceSessionStatus {
  return status;
}

export function subscribeDeviceSessionStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

/** Load an existing device record or create a new one. Migrates signing keys if absent. */
async function loadOrCreateDevice(): Promise<DeviceRecord> {
  const idb = await openScrollessDb();
  const existing = await idb.get('device', 'singleton');

  if (existing) {
    // Migrate: add ECDSA signing keypair if not yet present
    if (!existing.signing_private_key || !existing.signing_public_key_b64) {
      const { publicKey, privateKey } = await generateSigningKeypair();
      const signingPublicKeyB64 = await exportSigningPublicKeyBase64(publicKey);
      const migrated: DeviceRecord = { ...existing, signing_public_key_b64: signingPublicKeyB64, signing_private_key: privateKey };
      await idb.put('device', migrated);
      return migrated;
    }
    return existing;
  }

  // New device: ECDH key for feed decryption + ECDSA key for auth
  const { publicKey: ecdhPub, privateKey: ecdhPriv } = await generateKeypair();
  const { publicKey: sigPub, privateKey: sigPriv } = await generateSigningKeypair();
  const publicKeyB64 = await exportPublicKeyBase64(ecdhPub);
  const signingPublicKeyB64 = await exportSigningPublicKeyBase64(sigPub);
  const userId = `dev_${crypto.randomUUID()}`;

  const record: DeviceRecord = {
    id: 'singleton',
    user_id: userId,
    public_key_b64: publicKeyB64,
    private_key: ecdhPriv,
    signing_public_key_b64: signingPublicKeyB64,
    signing_private_key: sigPriv,
    registered_at: new Date().toISOString(),
  };

  await idb.put('device', record);
  return record;
}

/** Run challenge/verify to obtain a fresh session token from the server. */
async function authenticateDevice(deviceRecord: DeviceRecord): Promise<{ sessionToken: string; sessionExpiresAt: string }> {
  const enrollmentToken = await loadEnrollmentTokenFromIdb();
  const enrollHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (enrollmentToken) enrollHeaders['X-Device-Enroll-Token'] = enrollmentToken;

  const chalRes = await fetch(apiUrl('/api/v1/device/challenge'), {
    method: 'POST',
    headers: enrollHeaders,
    body: JSON.stringify({ device_id: deviceRecord.user_id, public_key: deviceRecord.signing_public_key_b64! }),
  });
  if (chalRes.status === 401) throw new EnrollmentTokenRequiredError();
  if (!chalRes.ok) throw new Error(`challenge failed (${chalRes.status})`);
  const { challenge_id, nonce } = await chalRes.json() as { challenge_id: string; nonce: string };

  const signature = await signNonce(nonce, deviceRecord.signing_private_key!);

  const verRes = await fetch(apiUrl('/api/v1/device/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id, device_id: deviceRecord.user_id, signature }),
  });
  if (!verRes.ok) throw new Error(`verify failed (${verRes.status})`);
  const { session_token, session_expires_at } = await verRes.json() as { session_token: string; session_expires_at: string };
  return { sessionToken: session_token, sessionExpiresAt: session_expires_at };
}

async function registerDevice(deviceRecord: DeviceRecord): Promise<void> {
  const enrollmentToken = await loadEnrollmentTokenFromIdb();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (enrollmentToken) headers['X-Device-Enroll-Token'] = enrollmentToken;

  const res = await fetch(apiUrl('/api/v1/device/register'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      device_id: deviceRecord.user_id,
      public_key: deviceRecord.public_key_b64,
    }),
  });
  if (res.status === 401) throw new EnrollmentTokenRequiredError();
  if (!res.ok) throw new Error(`register failed (${res.status})`);
}

/**
 * Decrypt incoming relay payload and write new items into IndexedDB.
 * Skips items that already exist (url_hash dedup).
 * Returns only the newly added items.
 */
async function decryptAndStore(
  payload: FeedItemsEventPayload,
  deviceRecord: DeviceRecord,
): Promise<FeedItem[]> {
  const db = await openScrollessDb();
  const added: FeedItem[] = [];
  let duped = 0;

  for (const item of payload.items ?? []) {
    try {
      const fields = await decryptFields(
        item.encrypted_fields,
        payload.ephemeral_public_key,
        deviceRecord.private_key,
      );

      const normUrl = normaliseUrl(item.url);
      const urlHash = await hashUrl(normUrl);

      // Client-side dedup: skip if url_hash already in IndexedDB
      const existing = await db.getFromIndex('feed_items', 'by_url_hash', urlHash);
      if (existing) {
        duped++;
        continue;
      }

      const feedItem: FeedItem = {
        id: `${payload.source}:${item.source_id}`,
        user_id: deviceRecord.user_id,
        source: payload.source,
        source_id: item.source_id,
        url: normUrl,
        url_hash: urlHash,
        published_at: item.published_at,
        fetched_at: new Date().toISOString(),
        is_discovery: Boolean(item.is_discovery),
        is_read: false,
        is_saved: false,
        ...fields,
      };

      await db.add('feed_items', feedItem);
      added.push(feedItem);
    } catch (err) {
      console.warn('[device-session] Failed to decrypt/store item:', item.source_id, err);
    }
  }

  // Append sync log entry
  await db.add('sync_log', {
    source: payload.source,
    synced_at: new Date().toISOString(),
    items_added: added.length,
    items_duped: duped,
  });

  return added;
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(connect: () => void): void {
  clearReconnectTimer();
  const attempt = status.reconnectAttempt + 1;
  const jitter = Math.floor(Math.random() * 300);
  const delay = Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * 2 ** (attempt - 1)) + jitter;
  emitStatus({ state: 'stream_disconnected', reconnectAttempt: attempt });
  reconnectTimer = window.setTimeout(connect, delay);
}

export async function startDeviceSession(options: DeviceSessionOptions = {}): Promise<void> {
  emitStatus({ state: 'not_registered', lastError: null, connectedAt: null });

  let deviceRecord: DeviceRecord;
  try {
    deviceRecord = await loadOrCreateDevice();
    cachedDeviceId = deviceRecord.user_id;
    emitStatus({ deviceId: deviceRecord.user_id });
    await registerDevice(deviceRecord);

    // Obtain a session token unless the cached one is still valid (with 60 s margin)
    const expiry = deviceRecord.session_expires_at ? new Date(deviceRecord.session_expires_at) : null;
    const needsAuth = !deviceRecord.session_token || !expiry || expiry <= new Date(Date.now() + 60_000);
    if (needsAuth) {
      const { sessionToken, sessionExpiresAt } = await authenticateDevice(deviceRecord);
      deviceRecord = { ...deviceRecord, session_token: sessionToken, session_expires_at: sessionExpiresAt };
      const idb = await openScrollessDb();
      await idb.put('device', deviceRecord);
    }
    cachedSessionToken = deviceRecord.session_token!;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'registration error';
    emitStatus({ state: 'not_registered', lastError: message });
    throw err;
  }

  options.onReady?.(deviceRecord.user_id);

  const connect = () => {
    clearReconnectTimer();
    stream?.close();

    stream = new EventSource(
      `${apiUrl('/api/stream')}?token=${encodeURIComponent(cachedSessionToken!)}`
    );

    stream.onopen = () => {
      emitStatus({
        state: 'stream_active',
        reconnectAttempt: 0,
        connectedAt: new Date().toISOString(),
        lastError: null,
      });
    };

    stream.onerror = () => {
      stream?.close();
      emitStatus({ state: 'stream_disconnected', lastError: 'stream error' });
      scheduleReconnect(connect);
    };

    stream.addEventListener('feed_items', async (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as FeedItemsEventPayload;
        const newItems = await decryptAndStore(payload, deviceRecord);

        // Signal app to refresh; items already in IndexedDB
        window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));

        await options.onFeedItems?.(newItems);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'ingestion failed';
        emitStatus({ lastError: message });
      }
    });
  };

  connect();

  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && status.state !== 'stream_active') {
        connect();
      }
    });
  }
}
