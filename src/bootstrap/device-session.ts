import type { FeedItemResponse } from '../types';
import { apiUrl } from '../config';

const DEVICE_ID_KEY = 'scrolless_device_id';
const DEVICE_KEY_PAIR_KEY = 'scrolless_device_keypair_jwk';
const INGESTED_EVENT_KEY = 'scrolless_ingested_feed_events';
const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 30_000;

type SessionUiState = 'not_registered' | 'stream_disconnected' | 'stream_active';

export interface DeviceSessionStatus {
  state: SessionUiState;
  deviceId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
}

interface DeviceSessionKeyMaterial {
  privateKeyJwk: JsonWebKey;
  publicKeySpki: string;
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

interface IngestionRecord {
  id: string;
  device_id: string;
  source: string;
  received_at: string;
  item_count: number;
  payload: FeedItemsEventPayload;
}

interface DeviceSessionOptions {
  onFeedItems?: (items: FeedItemResponse[]) => void | Promise<void>;
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function createDeviceId(): string {
  return `dev_${crypto.randomUUID()}`;
}

function loadOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing?.startsWith('dev_')) return existing;

  const created = createDeviceId();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

async function generateKeyMaterial(): Promise<DeviceSessionKeyMaterial> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKeySpki = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));

  return { privateKeyJwk, publicKeySpki };
}

async function loadOrCreateKeyMaterial(): Promise<DeviceSessionKeyMaterial> {
  const cached = localStorage.getItem(DEVICE_KEY_PAIR_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as DeviceSessionKeyMaterial;
      if (parsed.privateKeyJwk && typeof parsed.publicKeySpki === 'string') {
        await crypto.subtle.importKey(
          'jwk',
          parsed.privateKeyJwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          ['deriveBits']
        );
        return parsed;
      }
    } catch {
      // fall through and rotate material
    }
  }

  const generated = await generateKeyMaterial();
  localStorage.setItem(DEVICE_KEY_PAIR_KEY, JSON.stringify(generated));
  return generated;
}

async function registerDevice(deviceId: string, publicKeySpki: string): Promise<void> {
  const res = await fetch(apiUrl('/api/v1/device/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, public_key: publicKeySpki }),
  });
  if (!res.ok) {
    throw new Error(`register failed (${res.status})`);
  }
}

async function decryptRelayPayload(payload: FeedItemsEventPayload): Promise<FeedItemResponse[]> {
  const decrypted: FeedItemResponse[] = [];

  for (const item of payload.items ?? []) {
    const fallbackTitle = `Encrypted item from ${payload.source}`;
    let contentPreview = 'Encrypted payload received';

    try {
      const bytes = fromBase64(item.encrypted_fields);
      const maybeText = new TextDecoder().decode(bytes);
      contentPreview = maybeText.slice(0, 280);
    } catch {
      // keep fallback preview until full cryptographic decode is wired
    }

    decrypted.push({
      id: item.source_id,
      source: payload.source,
      source_type: undefined,
      content_type: undefined,
      card_type: undefined,
      title: fallbackTitle,
      author: undefined,
      url: item.url,
      content_preview: contentPreview,
      thumbnail_url: undefined,
      tags: [],
      is_discovery: Boolean(item.is_discovery),
      published_at: item.published_at,
      fetched_at: new Date().toISOString(),
      is_read: false,
      is_saved: false,
      action_label: undefined,
      action_icon: undefined,
      metadata: { encrypted: true },
    });
  }

  return decrypted;
}

function readIngestedRecords(): IngestionRecord[] {
  try {
    const raw = localStorage.getItem(INGESTED_EVENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IngestionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistIngestionRecord(record: IngestionRecord): void {
  const existing = readIngestedRecords();
  const capped = [record, ...existing].slice(0, 50);
  localStorage.setItem(INGESTED_EVENT_KEY, JSON.stringify(capped));
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

  reconnectTimer = window.setTimeout(() => {
    connect();
  }, delay);
}

export async function startDeviceSession(options: DeviceSessionOptions = {}): Promise<void> {
  const deviceId = loadOrCreateDeviceId();
  emitStatus({ deviceId, state: 'not_registered', lastError: null, connectedAt: null });

  try {
    const keyMaterial = await loadOrCreateKeyMaterial();
    await registerDevice(deviceId, keyMaterial.publicKeySpki);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'registration error';
    emitStatus({ state: 'not_registered', lastError: message });
    return;
  }

  const connect = () => {
    clearReconnectTimer();
    stream?.close();

    stream = new EventSource(`${apiUrl('/api/stream')}?device_id=${encodeURIComponent(deviceId)}`);

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
        const decrypted = await decryptRelayPayload(payload);

        persistIngestionRecord({
          id: crypto.randomUUID(),
          device_id: deviceId,
          source: payload.source,
          received_at: new Date().toISOString(),
          item_count: payload.items?.length ?? 0,
          payload,
        });

        await options.onFeedItems?.(decrypted);
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
