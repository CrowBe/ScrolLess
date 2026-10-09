import { openDB, type IDBPDatabase } from 'idb';

// Local device state only: the signing key used for reader authentication and
// the enrollment token. Feed content lives on the host.

export interface DeviceRecord {
  id: 'singleton';
  device_id: string;
  signing_public_key_b64: string;   // ECDSA public key for challenge/verify auth
  signing_private_key: CryptoKey;   // ECDSA private key, non-extractable
  registered_at: string;
  session_token?: string;           // Current dsess_* session token
  session_expires_at?: string;      // ISO timestamp when session_token expires
}

export type PreferenceKey = 'enrollment_token';

interface ScrolLessDB {
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
    // v2 dropped the encrypted-relay feed stores and device encryption keys
    dbPromise = openDB<ScrolLessDB>('scrolless', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 2) {
          for (const name of Array.from(db.objectStoreNames)) {
            db.deleteObjectStore(name as never);
          }
        }
        db.createObjectStore('device', { keyPath: 'id' });
        db.createObjectStore('preferences', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}
