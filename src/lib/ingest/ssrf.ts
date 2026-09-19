import 'server-only';
import { isIP } from 'node:net';

/**
 * SSRF address policy.
 *
 * §19 names this mandatory, not optional: "it is a fetcher you are exposing to
 * the internet — SSRF protections, private-IP blocking and a redirect cap are
 * mandatory". A server that fetches a URL the user chose is, by default, an
 * HTTP client sitting *inside* the trust boundary. Left unguarded it will
 * happily read the cloud metadata endpoint and hand the caller a set of
 * credentials.
 *
 * This module is the address policy alone — pure, synchronous, no I/O — so it
 * can be tested exhaustively without a network. `fetcher.ts` applies it at
 * three separate points, which is the part that actually matters:
 *
 *   1. before the first request        (rejects the obvious)
 *   2. at every redirect hop           (rejects the classic bypass)
 *   3. at TCP connect, on the real IP  (rejects DNS rebinding)
 *
 * Only the third is sufficient on its own. The first two exist to fail early
 * and to give the user an honest message rather than a socket error.
 */

/** The only schemes worth supporting. `file:`, `gopher:` and friends are attacks. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Ports. Restricting these is not paranoia: a URL is a general-purpose way to
 * point our socket at any listening service on the internal network, and most
 * of those speak a protocol that will cheerfully ignore an HTTP preamble.
 */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Hostnames that never legitimately appear in a user-submitted public URL. */
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.corp',
  '.home',
  '.lan',
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

export type AddressRejection =
  'protocol' | 'port' | 'credentials' | 'hostname' | 'private-ip';

export interface AddressVerdict {
  ok: boolean;
  reason?: AddressRejection;
  detail?: string;
}

const OK: AddressVerdict = { ok: true };

function reject(reason: AddressRejection, detail: string): AddressVerdict {
  return { ok: false, reason, detail };
}

/**
 * Is this IPv4 address one we must never connect to?
 *
 * Written out range by range rather than with a clever bitmask, because this
 * is a list a reviewer has to be able to audit by eye.
 */
function isBlockedIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    // Unparseable is blocked. Anything we cannot classify, we refuse.
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8      this host
  if (a === 10) return true; // 10.0.0.0/8     private
  if (a === 127) return true; // 127.0.0.0/8    loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local — AWS/GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12  private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24   IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.* broadcast

  return false;
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0]!; // drop any zone index

  if (lower === '::' || lower === '::1') return true; // unspecified, loopback

  /**
   * IPv4-mapped and IPv4-compatible forms (::ffff:169.254.169.254).
   *
   * These are the single most commonly missed bypass: the address is an IPv6
   * literal, so an IPv4-only range check never runs, and the kernel then opens
   * an IPv4 connection to the metadata endpoint anyway.
   */
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]!);

  // Also the hex form of a v4-mapped address: ::ffff:a9fe:a9fe
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1]!, 16);
    const low = parseInt(hexMapped[2]!, 16);
    const v4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isBlockedIPv4(v4);
  }

  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7  unique local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // ff00::/8  multicast
  if (lower.startsWith('64:ff9b:')) return true; // NAT64 — reaches v4 space
  if (lower.startsWith('2002:')) return true; // 6to4 — likewise

  return false;
}

/**
 * The single question every layer asks: may we open a socket to this IP?
 *
 * Exported because the undici connect hook calls it on the address the kernel
 * actually resolved, which is the only check that cannot be raced.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true; // not an IP at all — refuse
}

/**
 * Static checks on the URL itself. No DNS, no sockets.
 *
 * Returning a reason rather than throwing, because each reason maps to a
 * different message in §12's failure taxonomy and the caller decides.
 */
export function checkUrl(raw: string): AddressVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('hostname', 'That does not look like a web address.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return reject(
      'protocol',
      `Only http and https are supported, not ${url.protocol}`,
    );
  }

  /**
   * Credentials in the URL. Beyond being a phishing vector in the preview
   * chip, `https://evil.com@internal-host/` is read by humans as evil.com and
   * by the fetcher as internal-host.
   */
  if (url.username || url.password) {
    return reject(
      'credentials',
      'Web addresses with a username or password are not supported.',
    );
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return reject('port', `Port ${url.port} is not supported.`);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, ''); // trailing dot is still localhost

  if (BLOCKED_HOSTS.has(host)) {
    return reject('hostname', 'That address points at this server.');
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return reject('hostname', 'That address points inside a private network.');
  }
  if (!host.includes('.') && !isIP(host)) {
    // A bare label is a hostname only a private resolver can answer.
    return reject('hostname', 'That address is not a public web address.');
  }

  /**
   * A literal IP in the URL is checked here directly. Note the decimal and
   * octal forms — `http://2130706433/` and `http://0177.0.0.1/` are both
   * loopback, and `URL` preserves them verbatim in `hostname`.
   */
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      return reject('private-ip', 'That address points inside a private network.');
    }
    return OK;
  }
  if (/^\d+$/.test(host) || /^0[0-7]+(\.|$)/.test(host)) {
    return reject('private-ip', 'That address is not a public web address.');
  }

  return OK;
}
