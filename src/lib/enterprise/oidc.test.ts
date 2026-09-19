import { describe, expect, it } from 'vitest';
import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  createPkce,
  decodeJwt,
  discover,
  exchangeCode,
  verifyIdToken,
  OidcError,
  type Jwk,
} from './oidc';

/**
 * ID-token verification tests.
 *
 * ── Why this file is mostly forgeries ───────────────────────────────────────
 *
 * An ID token is a bearer assertion from a third party, and every check the
 * verifier skips is a complete authentication bypass — not a degradation, not
 * a smaller window, a bypass. So each test below mints a token that is valid
 * in every respect except one, and asserts it is refused.
 *
 * The four that have produced real-world compromises, each with a test:
 *
 *   alg: none          a token with no signature, accepted by a verifier that
 *                      trusts the header.
 *   HS256 confusion    signing with the RSA PUBLIC key as an HMAC secret; the
 *                      key is published, so anyone can forge.
 *   wrong audience     a genuine token minted for a DIFFERENT application.
 *   missing nonce      a genuine token replayed from an earlier session.
 */

// A real key pair, generated once. Signing has to be real for the verifier to
// be under test at all — a mocked signature would test nothing.
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function jwkOf(key: KeyObject, kid: string): Jwk {
  return { ...(key.export({ format: 'jwk' }) as Jwk), kid, alg: 'RS256' };
}

const RSA_JWK = jwkOf(rsa.publicKey, 'key-1');
const EC_JWK = { ...(ec.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'ec-1' };

const ISSUER = 'https://idp.example.com';
const AUDIENCE = 'client-abc';
const NONCE = 'nonce-xyz';

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

interface TokenOptions {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  key?: KeyObject;
  algorithm?: string;
  /** Replace the signature with arbitrary bytes. */
  signature?: string;
}

function makeToken(options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT', ...options.header };

  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'provider-subject-1',
    nonce: NONCE,
    email: 'person@example.com',
    email_verified: true,
    name: 'A Person',
    iat: now,
    exp: now + 3600,
    ...options.claims,
  };

  const signingInput = `${base64url(header)}.${base64url(claims)}`;

  if (options.signature !== undefined) {
    return `${signingInput}.${options.signature}`;
  }

  const algorithm = options.algorithm ?? 'RSA-SHA256';
  const signer = createSign(algorithm);
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(
    algorithm.startsWith('sha')
      ? { key: options.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' as const }
      : (options.key ?? rsa.privateKey),
  );

  return `${signingInput}.${signature.toString('base64url')}`;
}

const OPTIONS = {
  issuer: ISSUER,
  audience: AUDIENCE,
  nonce: NONCE,
  keys: [RSA_JWK],
};

// ------------------------------------------------------------------- happy

describe('a genuine token', () => {
  it('verifies and yields the identity', () => {
    const claims = verifyIdToken(makeToken(), OPTIONS);

    expect(claims.subject).toBe('provider-subject-1');
    expect(claims.email).toBe('person@example.com');
    expect(claims.emailVerified).toBe(true);
    expect(claims.name).toBe('A Person');
  });

  it('lower-cases the email', () => {
    // Accounts are matched on `email_lower`. A provider that returns mixed
    // case must not create a second account for the same person.
    const claims = verifyIdToken(
      makeToken({ claims: { email: 'Person@Example.COM' } }),
      OPTIONS,
    );

    expect(claims.email).toBe('person@example.com');
  });

  it('verifies an ES256 token', () => {
    const token = makeToken({
      header: { alg: 'ES256', kid: 'ec-1' },
      algorithm: 'sha256',
      key: ec.privateKey,
    });

    expect(verifyIdToken(token, { ...OPTIONS, keys: [EC_JWK] }).subject).toBe(
      'provider-subject-1',
    );
  });

  it('still verifies when the token names no kid', () => {
    // Key rotation is when a strict kid match breaks, in production, at night.
    const token = makeToken({ header: { alg: 'RS256', kid: undefined } });

    expect(verifyIdToken(token, OPTIONS).subject).toBe('provider-subject-1');
  });

  it('ignores a key in the JWKS it cannot use', () => {
    // Providers publish keys for algorithms we do not accept. One malformed or
    // irrelevant entry must not abort the whole verification.
    const token = makeToken();

    expect(
      verifyIdToken(token, {
        ...OPTIONS,
        keys: [{ kty: 'oct', kid: 'nonsense' }, RSA_JWK],
      }).subject,
    ).toBe('provider-subject-1');
  });
});

// --------------------------------------------------------------- forgeries

describe('the signature', () => {
  it('refuses alg: none', () => {
    /*
     * The classic. A verifier that honours the header's algorithm accepts a
     * token with no signature at all — and the header is written by whoever
     * sent the token.
     */
    const token = makeToken({ header: { alg: 'none' }, signature: '' });

    expect(() => verifyIdToken(token, OPTIONS)).toThrow(
      expect.objectContaining({ code: 'bad_algorithm' }) as Error,
    );
  });

  it('refuses HS256 signed with the public key', () => {
    /*
     * Algorithm confusion. An RSA public key is PUBLIC — it is published at
     * the JWKS endpoint. A verifier that reads `alg: HS256` and HMACs with the
     * key it holds can be forged against by anyone who downloaded it.
     */
    const publicPem = rsa.publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;

    const header = { alg: 'HS256', kid: 'key-1' };
    const claims = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'attacker',
      nonce: NONCE,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const signingInput = `${base64url(header)}.${base64url(claims)}`;
    const forged = createHash('sha256')
      .update(publicPem)
      .update(signingInput)
      .digest();

    const token = `${signingInput}.${forged.toString('base64url')}`;

    expect(() => verifyIdToken(token, OPTIONS)).toThrow(
      expect.objectContaining({ code: 'bad_algorithm' }) as Error,
    );
  });

  it('refuses a token signed by the wrong key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(() =>
      verifyIdToken(makeToken({ key: other.privateKey }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_signature' }) as Error);
  });

  it('refuses a token whose claims were edited after signing', () => {
    const genuine = makeToken();
    const [header, , signature] = genuine.split('.') as [string, string, string];

    const tampered = base64url({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'somebody-else',
      nonce: NONCE,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(() =>
      verifyIdToken(`${header}.${tampered}.${signature}`, OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_signature' }) as Error);
  });

  it('refuses an RSA algorithm against an EC key', () => {
    // The type check that is the second half of the confusion defence.
    expect(() =>
      verifyIdToken(makeToken(), { ...OPTIONS, keys: [EC_JWK] }),
    ).toThrow(OidcError);
  });

  it('refuses when the JWKS is empty', () => {
    expect(() => verifyIdToken(makeToken(), { ...OPTIONS, keys: [] })).toThrow(
      expect.objectContaining({ code: 'unknown_key' }) as Error,
    );
  });

  it('refuses something that is not a JWT', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'not.a.jwt']) {
      expect(() => verifyIdToken(bad, OPTIONS)).toThrow(OidcError);
    }
  });
});

describe('the claims', () => {
  it('refuses a token from a different issuer', () => {
    expect(() =>
      verifyIdToken(
        makeToken({ claims: { iss: 'https://evil.example.com' } }),
        OPTIONS,
      ),
    ).toThrow(expect.objectContaining({ code: 'bad_issuer' }) as Error);
  });

  it('refuses a token issued for a different application', () => {
    /*
     * This is the check people skip, and it is the subtlest. The token is
     * genuine, correctly signed, unexpired — and was minted for somebody
     * else's client id. Without `aud`, any application the same provider
     * serves can hand us a token and sign its users in as ours.
     */
    expect(() =>
      verifyIdToken(makeToken({ claims: { aud: 'some-other-client' } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_audience' }) as Error);
  });

  it('accepts an audience array that contains us', () => {
    // `aud` may legitimately be a list.
    expect(
      verifyIdToken(makeToken({ claims: { aud: ['other', AUDIENCE] } }), OPTIONS)
        .subject,
    ).toBe('provider-subject-1');
  });

  it('refuses an audience array that does not', () => {
    expect(() =>
      verifyIdToken(makeToken({ claims: { aud: ['other', 'another'] } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_audience' }) as Error);
  });

  it('refuses an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;

    expect(() =>
      verifyIdToken(makeToken({ claims: { exp: past, iat: past - 60 } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'expired' }) as Error);
  });

  it('refuses a token with no expiry at all', () => {
    // A token that never expires is a permanent credential nobody can revoke.
    expect(() =>
      verifyIdToken(makeToken({ claims: { exp: undefined } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'expired' }) as Error);
  });

  it('allows a little clock skew', () => {
    const now = Math.floor(Date.now() / 1000);

    expect(
      verifyIdToken(makeToken({ claims: { exp: now - 30 } }), OPTIONS).subject,
    ).toBe('provider-subject-1');
  });

  it('refuses a token issued in the future', () => {
    const ahead = Math.floor(Date.now() / 1000) + 7200;

    expect(() =>
      verifyIdToken(
        makeToken({ claims: { iat: ahead, exp: ahead + 3600 } }),
        OPTIONS,
      ),
    ).toThrow(expect.objectContaining({ code: 'not_yet_valid' }) as Error);
  });

  it('refuses a token with the wrong nonce', () => {
    /*
     * The replay defence. A genuine token captured from an earlier, legitimate
     * sign-in is otherwise reusable — the state parameter protects the
     * redirect, and only the nonce protects the token.
     */
    expect(() =>
      verifyIdToken(makeToken({ claims: { nonce: 'a-different-nonce' } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_nonce' }) as Error);
  });

  it('refuses a token with no nonce', () => {
    expect(() =>
      verifyIdToken(makeToken({ claims: { nonce: undefined } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'bad_nonce' }) as Error);
  });

  it('refuses a token with no subject', () => {
    expect(() =>
      verifyIdToken(makeToken({ claims: { sub: undefined } }), OPTIONS),
    ).toThrow(expect.objectContaining({ code: 'no_subject' }) as Error);
  });

  it('carries email_verified through rather than assuming it', () => {
    // `sso.ts` refuses to link an existing account on an unverified address,
    // so this flag has to survive the trip intact.
    const claims = verifyIdToken(
      makeToken({ claims: { email_verified: false } }),
      OPTIONS,
    );

    expect(claims.emailVerified).toBe(false);
  });

  it('treats a string "true" as unverified', () => {
    // Some providers send a string. Truthiness would accept it; a strict
    // comparison does not, and this is the safe direction to be wrong in.
    const claims = verifyIdToken(
      makeToken({ claims: { email_verified: 'true' } }),
      OPTIONS,
    );

    expect(claims.emailVerified).toBe(false);
  });
});

// ---------------------------------------------------------------- discovery

describe('discovery', () => {
  const document = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
  };

  const respond = (body: unknown, status = 200) =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status }),
      )) as unknown as typeof fetch;

  it('reads the endpoints', async () => {
    const found = await discover(ISSUER, respond(document));

    expect(found.tokenEndpoint).toBe(`${ISSUER}/token`);
    expect(found.jwksUri).toBe(`${ISSUER}/jwks`);
  });

  it('refuses a document claiming a different issuer', async () => {
    /*
     * RFC 8414 §3.3. Without this, a provider that redirects discovery
     * elsewhere hands us another identity provider's endpoints — and every
     * token we then accept is signed by somebody we never chose to trust.
     */
    await expect(
      discover(
        ISSUER,
        respond({ ...document, issuer: 'https://evil.example.com' }),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'issuer_mismatch' }) as Error,
    );
  });

  it('refuses http endpoints', async () => {
    // A token exchange carrying a client secret over http is that secret
    // published.
    await expect(
      discover(
        ISSUER,
        respond({ ...document, token_endpoint: 'http://idp.example.com/token' }),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'insecure_endpoint' }) as Error,
    );
  });

  it('refuses an incomplete document', async () => {
    await expect(discover(ISSUER, respond({ issuer: ISSUER }))).rejects.toThrow(
      expect.objectContaining({ code: 'discovery_incomplete' }) as Error,
    );
  });

  it('refuses a non-200', async () => {
    await expect(discover(ISSUER, respond({}, 404))).rejects.toThrow(
      expect.objectContaining({ code: 'discovery_failed' }) as Error,
    );
  });
});

// --------------------------------------------------------------------- PKCE

describe('PKCE', () => {
  it('derives an S256 challenge from the verifier', () => {
    const pkce = createPkce();

    expect(pkce.challenge).toBe(
      createHash('sha256').update(pkce.verifier).digest('base64url'),
    );
  });

  it('never returns the verifier as the challenge', () => {
    // A `plain` challenge IS the verifier, so anyone who sees the
    // authorisation request already holds what redeems the code.
    const pkce = createPkce();
    expect(pkce.challenge).not.toBe(pkce.verifier);
  });

  it('is different every time', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
  });
});

describe('the token exchange', () => {
  it('sends the verifier and returns the id token', async () => {
    let sent = '';

    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ id_token: 'abc', access_token: 'def' }));
    }) as unknown as typeof fetch;

    const tokens = await exchangeCode(
      {
        tokenEndpoint: `${ISSUER}/token`,
        clientId: AUDIENCE,
        clientSecret: 'shh',
        code: 'the-code',
        codeVerifier: 'the-verifier',
        redirectUri: 'https://app.example.com/api/sso/callback',
      },
      fetchImpl,
    );

    expect(tokens.idToken).toBe('abc');
    expect(sent).toContain('code_verifier=the-verifier');
    expect(sent).toContain('grant_type=authorization_code');
  });

  it('does not leak the provider’s error to the caller', async () => {
    /*
     * A provider's error description can echo the client secret back. A 400
     * shown to the browser is a 400 in somebody's screenshot.
     */
    const fetchImpl = (async () =>
      new Response('{"error_description":"bad client_secret shh"}', {
        status: 400,
      })) as unknown as typeof fetch;

    await expect(
      exchangeCode(
        {
          tokenEndpoint: `${ISSUER}/token`,
          clientId: AUDIENCE,
          clientSecret: 'shh',
          code: 'x',
          codeVerifier: 'y',
          redirectUri: 'https://app.example.com/cb',
        },
        fetchImpl,
      ),
    ).rejects.toThrow(/Could not complete sign-in/);
  });

  it('refuses a response with no id token', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ access_token: 'only' }),
      )) as unknown as typeof fetch;

    await expect(
      exchangeCode(
        {
          tokenEndpoint: `${ISSUER}/token`,
          clientId: AUDIENCE,
          clientSecret: 'shh',
          code: 'x',
          codeVerifier: 'y',
          redirectUri: 'https://app.example.com/cb',
        },
        fetchImpl,
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'no_id_token' }) as Error);
  });
});

describe('decodeJwt', () => {
  it('separates the parts without validating anything', () => {
    // Decoding proves nothing. Named as such so nobody reaches for it thinking
    // it does.
    const parts = decodeJwt(makeToken());

    expect(parts.claims.sub).toBe('provider-subject-1');
    expect(parts.header.alg).toBe('RS256');
  });
});
