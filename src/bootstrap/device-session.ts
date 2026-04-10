import { openScrollessDb, type DeviceRecord, type FeedItem } from '../idb';
import { generateKeypair, exportPublicKeyBase64, decryptFields, normaliseUrl, hashUrl } from '../crypto';
import { apiUrl, getDeviceEnrollmentToken } from '../config';

const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 30_000;

// Module-level cache so api.ts req() can read the device ID synchronously
let cachedDeviceId: string | null = null;

export function getCachedDeviceId(): string | null {
  return cachedDeviceId;
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

/** Load an existing device record or create and register a new one. */
async function loadOrCreateDevice(): Promise<DeviceRecord> {
  const db = await openScrollessDb();
  const existing = await db.get('device', 'singleton');
  if (existing) return existing;

  // Generate a non-extractable keypair — private key stored in IndexedDB via structured clone
  const { publicKey, privateKey } = await generateKeypair();
  const publicKeyB64 = await exportPublicKeyBase64(publicKey);
  const userId = `dev_${crypto.randomUUID()}`;

  const record: DeviceRecord = {
    id: 'singleton',
    user_id: userId,
    public_key_b64: publicKeyB64,
    private_key: privateKey,
    registered_at: new Date().toISOString(),
  };

  await db.put('device', record);
  return record;
}

async function registerDevice(deviceRecord: DeviceRecord): Promise<void> {
  const enrollmentToken = getDeviceEnrollmentToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (enrollmentToken) {
    headers['X-Device-Enroll-Token'] = enrollmentToken;
  }

  const res = await fetch(apiUrl('/api/v1/device/register'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      device_id: deviceRecord.user_id,
      public_key: deviceRecord.public_key_b64,
    }),
  });
  if (!res.ok) {
    throw new Error(`register failed (${res.status})`);
  }
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
      `${apiUrl('/api/stream')}?device_id=${encodeURIComponent(deviceRecord.user_id)}`
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
