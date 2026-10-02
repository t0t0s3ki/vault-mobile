/**
 * The device lock. One AES-GCM key encrypts everything this app keeps on the
 * phone (token, note copies, drafts, images, reading positions). The key exists
 * only in memory while unlocked.
 *
 * Preferred: a passkey with the WebAuthn PRF extension (Face ID on iOS 18+). The
 * authenticator returns the same secret for the same salt, so nothing secret is
 * stored on the device. Fallback: a passphrase stretched with PBKDF2.
 */
export type LockRecord =
  | { kind: 'passkey'; credentialId: string; salt: string; check: Sealed }
  | { kind: 'passphrase'; salt: string; iterations: number; check: Sealed };

export type Sealed = { iv: string; ct: string };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: ArrayBuffer | Uint8Array) => {
  const bytes = u instanceof Uint8Array ? u : new Uint8Array(u);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const CHECK = 'vault-mobile-lock-v1';

export class Key {
  private constructor(
    private aes: CryptoKey,
    private mac: CryptoKey,
  ) {}

  static async fromSecret(secret: Uint8Array) {
    const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
    const info = (s: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(s) });
    const aes = await crypto.subtle.deriveKey(info('vault-mobile/aes'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const mac = await crypto.subtle.deriveKey(info('vault-mobile/hmac'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    return new Key(aes, mac);
  }

  async seal(bytes: Uint8Array): Promise<Uint8Array> {
    const iv = random(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.aes, bytes as BufferSource));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  async open(sealed: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) as BufferSource }, this.aes, sealed.subarray(12) as BufferSource));
  }
  async sealText(text: string): Promise<Sealed> {
    const all = await this.seal(enc.encode(text));
    return { iv: b64(all.subarray(0, 12)), ct: b64(all.subarray(12)) };
  }
  async openText(s: Sealed) {
    const iv = unb64(s.iv),
      ct = unb64(s.ct);
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv);
    all.set(ct, iv.length);
    return dec.decode(await this.open(all));
  }
  /** Storage keys are hashed so file paths (which carry note titles) are not readable either. */
  async tag(text: string) {
    return b64(await crypto.subtle.sign('HMAC', this.mac, enc.encode(text)));
  }
}

async function withCheck(key: Key) {
  return key.sealText(CHECK);
}
async function verify(key: Key, check: Sealed) {
  try {
    return (await key.openText(check)) === CHECK;
  } catch {
    return false;
  }
}

/** iOS 18 Safari and recent Chrome. Whether the authenticator itself supports PRF is only known after creation. */
export function passkeyAvailable() {
  return typeof PublicKeyCredential !== 'undefined' && isSecureContext;
}

function prfOutput(cred: PublicKeyCredential | null): Uint8Array | undefined {
  const r = cred?.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } } | undefined;
  return r?.prf?.results?.first ? new Uint8Array(r.prf.results.first) : undefined;
}

async function assertPrf(credentialId: Uint8Array, salt: Uint8Array) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: credentialId as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  return prfOutput(cred);
}

export async function createPasskeyLock(): Promise<{ record: LockRecord; key: Key }> {
  const salt = random(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Vault' },
      user: { id: random(16), name: 'vault-mobile', displayName: 'Vault（この端末）' },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('パスキーを作れませんでした');
  const id = new Uint8Array(cred.rawId);
  // Some platforms only return PRF output on assertion, not on creation.
  const secret = prfOutput(cred) ?? (await assertPrf(id, salt));
  if (!secret) throw new Error('この端末のパスキーは暗号化に対応していません（PRF）。パスフレーズを使ってください');
  const key = await Key.fromSecret(secret);
  return { key, record: { kind: 'passkey', credentialId: b64(id), salt: b64(salt), check: await withCheck(key) } };
}

export async function createPassphraseLock(passphrase: string, iterations = 600_000) {
  if (passphrase.length < 10) throw new Error('パスフレーズは10文字以上にしてください');
  const salt = random(16);
  const key = await stretch(passphrase, salt, iterations);
  return { key, record: { kind: 'passphrase', salt: b64(salt), iterations, check: await withCheck(key) } as LockRecord };
}

async function stretch(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256);
  return Key.fromSecret(new Uint8Array(bits));
}

export async function unlock(record: LockRecord, passphrase?: string): Promise<Key> {
  let key: Key;
  if (record.kind === 'passkey') {
    const secret = await assertPrf(unb64(record.credentialId), unb64(record.salt));
    if (!secret) throw new Error('パスキーから鍵を取り出せませんでした');
    key = await Key.fromSecret(secret);
  } else {
    if (!passphrase) throw new Error('パスフレーズを入力してください');
    key = await stretch(passphrase, unb64(record.salt), record.iterations);
  }
  if (!(await verify(key, record.check))) throw new Error(record.kind === 'passkey' ? '鍵が一致しません' : 'パスフレーズが違います');
  return key;
}
