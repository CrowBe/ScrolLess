// Client-side cryptography — Web Crypto API only (no Node dependencies)
// Scheme: ECIES-P256-AES256GCM
//   shared_secret = ECDH(device_private_key, ephemeral_public_key)
//   aes_key       = HKDF-SHA256(shared_secret, salt=[], info="scrolless-v1", length=32)
//   plaintext     = AES-256-GCM decrypt(iv || ciphertext || tag)

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Generate a new P-256 keypair. Private key is non-extractable (stored in IndexedDB via structured clone). */
export async function generateKeypair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // non-extractable — cannot be exported to JWK, only stored/used
    ['deriveBits']
  ) as Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
}

/** Export a public key as base64-encoded SPKI bytes (suitable for sending to the server). */
export async function exportPublicKeyBase64(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return toBase64(new Uint8Array(spki));
}

/** Import a base64-encoded SPKI public key for verification/ECDH use. */
export async function importPublicKeySpki(b64: string): Promise<CryptoKey> {
  const bytes = fromBase64(b64);
  return crypto.subtle.importKey(
    'spki',
    bytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

/** Import a base64-encoded raw (uncompressed, 65-byte 0x04-prefixed) P-256 public key. */
export async function importEphemeralPublicKeyRaw(b64: string): Promise<CryptoKey> {
  const bytes = fromBase64(b64);
  return crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

export interface DecryptedFields {
  title: string;
  author?: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags: string[];
}

/**
 * Decrypt a single encrypted_fields blob from an agent relay payload.
 *
 * @param encryptedFieldsB64  base64(iv[12] || ciphertext || authTag[16])
 * @param ephemeralPublicKeyB64  base64 of the agent's ephemeral P-256 public key (raw uncompressed)
 * @param devicePrivateKey  the device's non-extractable ECDH private key
 */
export async function decryptFields(
  encryptedFieldsB64: string,
  ephemeralPublicKeyB64: string,
  devicePrivateKey: CryptoKey,
): Promise<DecryptedFields> {
  // 1. Import ephemeral public key (raw uncompressed P-256 point, 65 bytes)
  const ephemeralKey = await importEphemeralPublicKeyRaw(ephemeralPublicKeyB64);

  // 2. ECDH: derive shared secret bits
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralKey },
    devicePrivateKey,
    256
  );

  // 3. Import shared secret as HKDF key material
  const hkdfKeyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecretBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  // 4. Derive AES-256-GCM key via HKDF-SHA256
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('scrolless-v1'),
    },
    hkdfKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 5. Decode payload: iv[12] || ciphertext || authTag[16]
  const bytes = fromBase64(encryptedFieldsB64);
  if (bytes.length < 12 + 16) {
    throw new Error('encrypted_fields too short to contain IV and auth tag');
  }
  const iv = bytes.slice(0, 12);
  const cipherWithTag = bytes.slice(12); // AES-GCM tag is appended at end by Web Crypto

  // 6. Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    cipherWithTag
  );

  // 7. Parse JSON
  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;

  return {
    title: typeof decoded.title === 'string' ? decoded.title : '(no title)',
    author: typeof decoded.author === 'string' ? decoded.author : undefined,
    content_preview: typeof decoded.content_preview === 'string' ? decoded.content_preview : undefined,
    thumbnail_url: typeof decoded.thumbnail_url === 'string' ? decoded.thumbnail_url : undefined,
    tags: Array.isArray(decoded.tags) ? (decoded.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
  };
}

/** Normalise a URL for deduplication (matches server-side normaliseUrl in db.ts). */
export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase();

    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1);
      url.hostname = 'www.youtube.com';
      url.pathname = '/watch';
      url.search = '';
      url.searchParams.set('v', videoId);
    }

    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      's', 'ref', 'feature',
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }

    url.searchParams.sort();
    url.hash = '';

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return raw;
  }
}

/** Compute SHA-256 of a normalised URL, returned as lowercase hex. */
export async function hashUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
