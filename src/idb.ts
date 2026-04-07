import { openDB, type IDBPDatabase } from 'idb';

export interface FeedItem {
  id: string;           // "source:source_id"
  user_id: string;
  source: string;
  source_id: string;
  url: string;
  url_hash: string;     // SHA-256(normalised url) — used for dedup
  published_at: string;
  fetched_at: string;   // used for retention (not published_at)
  is_discovery: boolean;
  is_read: boolean;
  is_saved: boolean;
  title: string;
  author?: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags: string[];       // stored as parsed array
}

export interface SyncLogEntry {
  id?: number;          // autoincrement — omit on insert
  source: string;
  synced_at: string;
  items_added: number;
  items_duped: number;
}

export interface DeviceRecord {
  id: 'singleton';
  user_id: string;
  public_key_b64: string;
  private_key: CryptoKey;  // non-extractable; stored via structured clone
  registered_at: string;
}

export type PreferenceKey =
  | 'blocked_keywords'
  | 'max_items_per_source'
  | 'retention_days';

interface ScrolLessDB {
  feed_items: {
    key: string;
    value: FeedItem;
    indexes: {
      by_url_hash: string;
      by_published_at: string;
      by_source: string;
      by_is_read: number;
      by_is_discovery: number;
      by_is_saved: number;
    };
  };
  sync_log: {
    key: number;
    value: SyncLogEntry;
  };
  device: {
    key: 'singleton';
    value: DeviceRecord;
  };
  preferences: {
    key: PreferenceKey;
    value: { key: PreferenceKey; value: unknown };
  };
}

let dbPromise: Promise<IDBPDatabase<ScrolLessDB>> | null = null;

export function openScrollessDb(): Promise<IDBPDatabase<ScrolLessDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ScrolLessDB>('scrolless', 1, {
      upgrade(db) {
        const feedStore = db.createObjectStore('feed_items', { keyPath: 'id' });
        feedStore.createIndex('by_url_hash', 'url_hash', { unique: true });
        feedStore.createIndex('by_published_at', 'published_at');
        feedStore.createIndex('by_source', 'source');
        feedStore.createIndex('by_is_read', 'is_read');
        feedStore.createIndex('by_is_discovery', 'is_discovery');
        feedStore.createIndex('by_is_saved', 'is_saved');

        db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('device', { keyPath: 'id' });
        db.createObjectStore('preferences', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}
