// Device identity proofs for reader authentication — Web Crypto API only.
// The device signs a server nonce with a non-extractable ECDSA P-256 key.

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Generate a P-256 ECDSA signing keypair for device identity proofs. Private key is non-extractable. */
export async function generateSigningKeypair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ) as Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
}

/** Export an ECDSA public key as base64-encoded SPKI bytes. */
export async function exportSigningPublicKeyBase64(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return toBase64(new Uint8Array(spki));
}

/** Convert Web Crypto P1363 ECDSA signature (r‖s) to ASN.1 DER, as expected by Node's createVerify. */
function p1363ToDer(p1363: Uint8Array): Uint8Array {
  const half = p1363.length >> 1;
  let r = p1363.slice(0, half);
  let s = p1363.slice(half);
  while (r.length > 1 && r[0] === 0) r = r.slice(1);
  while (s.length > 1 && s[0] === 0) s = s.slice(1);
  if (r[0] & 0x80) r = new Uint8Array([0, ...r]);
  if (s[0] & 0x80) s = new Uint8Array([0, ...s]);
  const seqLen = 2 + r.length + 2 + s.length;
  const der = new Uint8Array(2 + seqLen);
  let i = 0;
  der[i++] = 0x30; der[i++] = seqLen;
  der[i++] = 0x02; der[i++] = r.length; der.set(r, i); i += r.length;
  der[i++] = 0x02; der[i++] = s.length; der.set(s, i);
  return der;
}

/** Sign a nonce with an ECDSA private key. Returns DER-encoded base64 signature. */
export async function signNonce(nonce: string, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(nonce);
  const p1363 = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)
  );
  return toBase64(p1363ToDer(p1363));
}
