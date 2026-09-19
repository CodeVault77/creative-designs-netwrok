import Link from 'next/link';
import { routes } from '@/lib/routes';

export const metadata = { title: 'Not found' };

/**
 * 404.
 *
 * This page is also what a non-staff visitor sees at /admin/moderation, by
 * design (§08 screen 21) — so its copy must not hint that a permission
 * boundary exists. "Nothing here" is true for a mistyped URL and true for a
 * route you are not allowed to know about, and it gives an attacker nothing.
 */
export default function NotFound() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        padding: 'var(--space-4)',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: '26rem' }}>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--face-mono)',
            fontSize: 'var(--text-caption)',
            color: 'var(--ground-muted)',
            letterSpacing: '0.16em',
          }}
        >
          404
        </p>
        <h1 style={{ fontSize: 'var(--text-display-m)' }}>
          Nothing at this address
        </h1>
        <p style={{ margin: 0, color: 'var(--ground-muted)', lineHeight: 1.55 }}>
          The node or page you were looking for does not exist, or the link has
          expired.
        </p>
        <Link
          href={routes.map}
          style={{ color: 'var(--fam-discover-core)', marginTop: 'var(--space-2)' }}
        >
          Go to the map →
        </Link>
      </div>
    </div>
  );
}
