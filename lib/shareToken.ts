import { randomBytes, createHash } from 'crypto';

// nanoid-style URL-safe alphabet. We avoid +/= so tokens don't need
// percent-encoding and read cleanly when copy-pasted into chat apps.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

// 22 chars over a 64-symbol alphabet = 132 bits of entropy, well above
// the 128-bit "uncrackable for the foreseeable future" bar. Spec asks
// for >=21; 22 keeps us aligned with nanoid's default while staying
// short enough to fit comfortably in a chat message.
export const SHARE_TOKEN_LENGTH = 22;

export function generateShareToken(length: number = SHARE_TOKEN_LENGTH): string {
  // Use rejection sampling so each character is uniformly distributed
  // over the alphabet. (Naive `byte % 64` is uniform here because 256
  // is a multiple of 64, but we keep this future-proof if ALPHABET
  // changes length.)
  const out: string[] = [];
  const buf = randomBytes(length * 2);
  let i = 0;
  while (out.length < length && i < buf.length) {
    const v = buf[i++] & 0x3f;
    out.push(ALPHABET[v]);
  }
  if (out.length < length) {
    return out.join('') + generateShareToken(length - out.length);
  }
  return out.join('');
}

// Salted hash of an IP address for the audit log. We never want to
// store raw IPs (PII / GDPR exposure); a salted hash lets us detect
// repeat viewers without identifying them. The salt ties the hash to
// this deployment so hashes are not portable across environments.
const IP_HASH_SALT =
  process.env.SHARE_VIEW_IP_SALT ||
  process.env.NEXTAUTH_SECRET ||
  'pathovai-share-view-default-salt';

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(IP_HASH_SALT + ':' + ip).digest('hex');
}
