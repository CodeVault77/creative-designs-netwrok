export const metadata = { title: 'Offline' };

/**
 * Shown when a navigation fails and the device has no connection.
 *
 * Deliberately plain: no fetch, no client component, no font that has to load.
 * It is the one page that must render from cache with nothing else available,
 * so anything it depends on is something that can stop it working.
 */
export default function Page() {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '28rem' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
          You are offline
        </h1>

        <p style={{ lineHeight: 1.6, opacity: 0.75 }}>
          Maps you have already opened are still on this device, and changes you
          make are queued. They will sync as soon as you are back online.
        </p>
      </div>
    </main>
  );
}
