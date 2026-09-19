import { describe, expect, it } from 'vitest';
import { clientSchema, serverSchema } from './env';

describe('client environment schema', () => {
  it('applies safe local defaults so a fresh clone runs with no .env', () => {
    const parsed = clientSchema.parse({});
    expect(parsed.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    expect(parsed.NEXT_PUBLIC_ANALYTICS_PROVIDER).toBe('console');
  });

  it('rejects a site URL that is not absolute', () => {
    const result = clientSchema.safeParse({ NEXT_PUBLIC_SITE_URL: '/maps' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown analytics provider', () => {
    const result = clientSchema.safeParse({
      NEXT_PUBLIC_ANALYTICS_PROVIDER: 'segment',
    });
    expect(result.success).toBe(false);
  });
});

describe('server environment schema', () => {
  it('defaults APP_ENV to local', () => {
    expect(serverSchema.parse({}).APP_ENV).toBe('local');
  });

  it('rejects an unknown APP_ENV', () => {
    expect(serverSchema.safeParse({ APP_ENV: 'prod' }).success).toBe(false);
  });

  it('accepts each deployable environment', () => {
    for (const env of ['local', 'preview', 'staging', 'production']) {
      expect(serverSchema.safeParse({ APP_ENV: env }).success).toBe(true);
    }
  });
});

describe('secret hygiene', () => {
  it('exposes nothing to the browser that is not NEXT_PUBLIC_ prefixed', () => {
    // The client bundle inlines these values. Anything here is public
    // forever, including in previously deployed builds.
    const clientKeys = Object.keys(clientSchema.shape);
    for (const key of clientKeys) {
      expect(key, `${key} would be inlined into the browser bundle`).toMatch(
        /^NEXT_PUBLIC_/,
      );
    }
  });

  it('keeps server keys out of the client schema', () => {
    const serverKeys = Object.keys(serverSchema.shape);
    const clientKeys = Object.keys(clientSchema.shape);
    for (const key of serverKeys) {
      expect(clientKeys).not.toContain(key);
    }
  });
});
