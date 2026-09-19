import 'server-only';
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
} from 'node:crypto';

/**
 * The OIDC protocol mechanics: discovery, PKCE, and ID-token verification.
 *
 * Kept apart from `sso.ts`, which owns the database and the user accounts. The
 * split is so that everything below can be tested with no rows at all — and
 * ID-token verification is the part that must be tested exhaustively, because
 * every check it skips is an authentication bypass.
 *
 * ── Why the token is verified here and not merely decoded ───────────────────
 *
 * An ID token is a bearer assertion from a third party. Decoding it tells you
 * what somebody claims; verifying it tells you the provider said so. The
 * shortcut — parse the JWT, read `email`, sign the user in — is a complete
 * authentication bypass, because anyone can mint that JSON. Each check below
 * closes a specific published attack, and the comments name which.
 */

export interface Discovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

interface DiscoveryDocument {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class OidcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

/**
 * Read a provider's discovery document.
 *
 * The returned `issuer` must be checked against what was configured by the
 * caller — a discovery document fetched from one host that claims to be
 * another is a redirect attack, and the URL you fetched is not evidence of
 * anything on its own.
 */
export async function discover(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Discovery> {
  const base = issuer.replace(/\/$/, '');
  const url = `${base}/.well-known/openid-configuration`;

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    // A provider that cannot answer in ten seconds is a provider that is down.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new OidcError(
      'discovery_failed',
      `Discovery returned ${response.status}`,
    );
  }

  const document = (await response.json()) as DiscoveryDocument;

  const found: Discovery = {
    issuer: asString(document.issuer),
    authorizationEndpoint: asString(document.authorization_endpoint),
    tokenEndpoint: asString(document.token_endpoint),
    jwksUri: asString(document.jwks_uri),
  };

  if (!found.authorizationEndpoint || !found.tokenEndpoint || !found.jwksUri) {
    throw new OidcError('discovery_incomplete', 'That is not an OIDC provider');
  }

  /*
   * The document's own issuer must match what we asked for.
   *
   * RFC 8414 §3.3 requires this. Without it, a provider that redirects
   * discovery elsewhere can hand us the endpoints of a different identity
   * provider, and every token we then accept is signed by somebody we never
   * chose to trust.
   */
  if (found.issuer.replace(/\/$/, '') !== base) {
    throw new OidcError(
      'issuer_mismatch',
      'The provider’s issuer does not match the configured one',
    );
  }

  // Every endpoint must be https. A token exchange carrying a client secret
  // over http is that secret published.
  for (const endpoint of [
    found.authorizationEndpoint,
    found.tokenEndpoint,
    found.jwksUri,
  ]) {
    if (!endpoint.startsWith('https://')) {
      throw new OidcError('insecure_endpoint', 'Provider endpoints must be https');
    }
  }

  return found;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/**
 * PKCE, RFC 7636.
 *
 * Used even though this is a confidential client with a secret. PKCE binds the
 * authorisation code to the browser that started the flow, so a code leaked
 * through a referrer header, a shared device, or a log line cannot be redeemed
 * by anyone else. The client secret does not provide that: it authenticates
 * the application, not the session.
 */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');

  return {
    verifier,
    // S256, never `plain`. A plain challenge is the verifier, so an attacker
    // who sees the authorisation request already has what redeems the code.
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

export interface JwtParts {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

/** Split and decode a JWT. Decoding only — this proves nothing. */
export function decodeJwt(token: string): JwtParts {
  const segments = token.split('.');
  if (segments.length !== 3) throw new OidcError('malformed_token', 'Not a JWT');

  const [headerPart, claimsPart, signaturePart] = segments as [
    string,
    string,
    string,
  ];

  const parseJson = (part: string): Record<string, unknown> => {
    /*
     * Every failure here becomes an OidcError, including a JSON syntax error.
     *
     * Base64url-decoding arbitrary bytes and handing them to JSON.parse throws
     * a SyntaxError, which would escape this module as an unhandled exception
     * — a 500 rather than a refused sign-in, and indistinguishable in a log
     * from a bug of ours. A malformed token is a protocol failure, and every
     * protocol failure in this file reports itself the same way.
     */
    try {
      const decoded = Buffer.from(part, 'base64url').toString('utf8');
      const parsed: unknown = JSON.parse(decoded);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new OidcError('malformed_token', 'Not a JWT');
      }

      return parsed as Record<string, unknown>;
    } catch (cause) {
      if (cause instanceof OidcError) throw cause;
      throw new OidcError('malformed_token', 'Not a JWT');
    }
  };

  return {
    header: parseJson(headerPart),
    claims: parseJson(claimsPart),
    signingInput: `${headerPart}.${claimsPart}`,
    signature: Buffer.from(signaturePart, 'base64url'),
  };
}

export interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

/** Fetch the provider's signing keys. */
export async function fetchJwks(
  jwksUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Jwk[]> {
  const response = await fetchImpl(jwksUri, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new OidcError('jwks_failed', `JWKS returned ${response.status}`);
  }

  const document = (await response.json()) as { keys?: unknown };
  return Array.isArray(document.keys) ? (document.keys as Jwk[]) : [];
}

/**
 * The algorithms accepted.
 *
 * ── An allow-list, because `alg` is attacker-controlled ─────────────────────
 *
 * The algorithm is a field in the token's own header, which the sender writes.
 * Two published attacks follow from trusting it:
 *
 *   alg: none    the classic. A token with no signature verifies against
 *                nothing, and a library that honours the header accepts it.
 *
 *   HS256 with   an RSA public key is public. If the verifier reads `alg` and
 *   the RSA key   symmetric-signs with the "key" it has, anyone can forge a
 *   as the HMAC   token using the key they downloaded from the JWKS endpoint.
 *   secret
 *
 * Both are closed by deciding the algorithm HERE, from a list, and refusing
 * anything the provider's key type cannot support.
 */
const ALLOWED_ALGORITHMS = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384']);

function keyFromJwk(jwk: Jwk): ReturnType<typeof createPublicKey> {
  // Node imports a JWK directly, which avoids hand-assembling DER — the part
  // of this that would otherwise be easy to get subtly wrong.
  return createPublicKey({ key: jwk as never, format: 'jwk' });
}

export interface VerifyOptions {
  /** The configured issuer, not the one in the token. */
  issuer: string;
  /** Our client id. The token must be addressed to us. */
  audience: string;
  /** The nonce we generated for this attempt. */
  nonce: string;
  keys: readonly Jwk[];
  nowSeconds?: number;
  /** Tolerance for clock skew between us and the provider. */
  leewaySeconds?: number;
}

export interface IdentityClaims {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Verify an ID token and return the identity it asserts.
 *
 * Throws on any failure, with a code naming which check failed. There is no
 * "partially valid" token: every branch below is a reason to refuse a sign-in.
 */
export function verifyIdToken(
  token: string,
  options: VerifyOptions,
): IdentityClaims {
  const { header, claims, signingInput, signature } = decodeJwt(token);

  const algorithm = asString(header.alg);
  if (!ALLOWED_ALGORITHMS.has(algorithm)) {
    throw new OidcError(
      'bad_algorithm',
      `Refusing algorithm ${algorithm || 'none'}`,
    );
  }

  /*
   * Match on `kid` when the token names one, otherwise try every key.
   *
   * Trying all of them is not a weakness — a signature either verifies under a
   * key or it does not — and it keeps working through a provider's key
   * rotation, which is when a strict kid match breaks in production at three
   * in the morning.
   */
  const kid = asString(header.kid);
  const candidates = kid
    ? options.keys.filter((key) => !key.kid || key.kid === kid)
    : options.keys;

  if (candidates.length === 0) {
    throw new OidcError('unknown_key', 'No signing key matched this token');
  }

  const nodeAlgorithm = algorithm.startsWith('ES')
    ? `sha${algorithm.slice(2)}`
    : `RSA-SHA${algorithm.slice(2)}`;

  const verified = candidates.some((jwk) => {
    try {
      const key = keyFromJwk(jwk);

      // The key TYPE must suit the algorithm. This is the second half of the
      // HS256-confusion defence: an RSA key can never verify an EC signature
      // and vice versa, so a mismatched pair is refused rather than attempted.
      if (algorithm.startsWith('ES') && key.asymmetricKeyType !== 'ec')
        return false;
      if (algorithm.startsWith('RS') && key.asymmetricKeyType !== 'rsa')
        return false;

      const verifier = createVerify(nodeAlgorithm);
      verifier.update(signingInput);
      verifier.end();

      return verifier.verify(
        algorithm.startsWith('ES')
          ? { key, dsaEncoding: 'ieee-p1363' as const }
          : key,
        signature,
      );
    } catch {
      // A malformed key in the JWKS must not abort the whole verification —
      // providers publish keys for algorithms we do not use.
      return false;
    }
  });

  if (!verified) throw new OidcError('bad_signature', 'Signature did not verify');

  // ---- claims -------------------------------------------------------------

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const leeway = options.leewaySeconds ?? 60;

  if (
    asString(claims.iss).replace(/\/$/, '') !== options.issuer.replace(/\/$/, '')
  ) {
    throw new OidcError('bad_issuer', 'Token issuer does not match');
  }

  /*
   * The audience must contain OUR client id.
   *
   * Without this, a token the provider minted for a DIFFERENT application —
   * one the same user also signs into, perhaps one the attacker controls — is
   * accepted here. It is a correctly signed, unexpired, genuine token, and it
   * was never meant for us. `aud` is the only thing that says so.
   */
  const audience = Array.isArray(claims.aud)
    ? (claims.aud as unknown[]).map(asString)
    : [asString(claims.aud)];

  if (!audience.includes(options.audience)) {
    throw new OidcError(
      'bad_audience',
      'Token was not issued for this application',
    );
  }

  const expiry = typeof claims.exp === 'number' ? claims.exp : 0;
  if (!expiry || now > expiry + leeway) {
    throw new OidcError('expired', 'Token has expired');
  }

  const issuedAt = typeof claims.iat === 'number' ? claims.iat : 0;
  if (issuedAt && issuedAt - leeway > now) {
    throw new OidcError('not_yet_valid', 'Token is issued in the future');
  }

  /*
   * The nonce ties this token to THIS sign-in attempt.
   *
   * It is what stops a token replayed from an earlier, legitimate session
   * being presented again later. The state parameter protects the redirect;
   * the nonce protects the token.
   */
  if (asString(claims.nonce) !== options.nonce) {
    throw new OidcError('bad_nonce', 'Token does not match this sign-in attempt');
  }

  const subject = asString(claims.sub);
  if (!subject) throw new OidcError('no_subject', 'Token carries no subject');

  return {
    subject,
    email: asString(claims.email).toLowerCase(),
    /*
     * `email_verified` is honoured, and matters more than it looks.
     *
     * Accounts are matched by email. A provider that lets somebody set an
     * unverified address to a colleague's would otherwise be an account
     * takeover — so an unverified email is carried through and `sso.ts`
     * refuses to match an existing account on it.
     */
    emailVerified: claims.email_verified === true,
    name: asString(claims.name) || asString(claims.preferred_username),
  };
}

export interface TokenResponse {
  idToken: string;
  accessToken: string;
}

/** Exchange the authorisation code for tokens. */
export async function exchangeCode(
  options: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });

  const response = await fetchImpl(options.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    /*
     * The provider's error body is logged, never returned. It can echo the
     * client secret back in a description, and a 400 shown to the browser is
     * a 400 in somebody's screenshot.
     */
    const detail = await response.text().catch(() => '');
    console.error(
      '[oidc] token exchange failed:',
      response.status,
      detail.slice(0, 500),
    );

    throw new OidcError('exchange_failed', 'Could not complete sign-in');
  }

  const payload = (await response.json()) as {
    id_token?: unknown;
    access_token?: unknown;
  };

  const idToken = asString(payload.id_token);
  if (!idToken) throw new OidcError('no_id_token', 'Provider returned no ID token');

  return { idToken, accessToken: asString(payload.access_token) };
}

/** Build the URL the browser is sent to. */
export function authorizationUrl(options: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: 'openid email profile',
    state: options.state,
    nonce: options.nonce,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${options.authorizationEndpoint}?${params.toString()}`;
}
