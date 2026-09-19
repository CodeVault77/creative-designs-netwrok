'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, Checkbox, TextField, useToast } from '@/components/ui';

/**
 * API keys and webhook endpoints, on one screen.
 *
 * ── The secret is shown once, and the screen has to mean it ─────────────────
 *
 * A newly minted key is displayed in a panel that stays until it is dismissed,
 * and the copy says plainly that it will not be shown again. That is not
 * decoration: the secret is stored as a digest and genuinely cannot be
 * recovered, so a UI that let someone navigate away casually would be
 * producing dead credentials.
 */

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  description: string;
  active: boolean;
  failures: number;
  secret?: string;
}

const Section = styled.section`
  margin-top: var(--space-12);
`;

const Heading = styled.h2`
  font-size: var(--text-title);
  margin: 0 0 var(--space-3);
`;

const Muted = styled.p`
  margin: 0;
  color: var(--ground-muted);
  line-height: 1.6;
`;

const Row = styled.div<{ $dim?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--ground-border);
  opacity: ${({ $dim }) => ($dim ? 0.5 : 1)};
`;

const Name = styled.span`
  flex: 1 1 12rem;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const Mono = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Secret = styled.pre`
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  border-radius: var(--radius-card);
  background: var(--ground-raised);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const Warn = styled.p`
  margin: var(--space-2) 0 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--color-warning);
`;

const Scopes = styled.div`
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  margin: var(--space-3) 0;
`;

const Fields = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  align-items: end;
  margin-bottom: var(--space-3);
`;

export function DeveloperPanel() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [catalogue, setCatalogue] = useState<Record<string, string>>({});
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [keyName, setKeyName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [freshHookSecret, setFreshHookSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [keyResponse, hookResponse] = await Promise.all([
      fetch('/api/keys'),
      fetch('/api/webhooks'),
    ]);

    if (keyResponse.ok) {
      const body = (await keyResponse.json()) as {
        keys: ApiKey[];
        scopes: Record<string, string>;
      };
      setKeys(body.keys);
      // The scope catalogue comes from the server, so the form offers exactly
      // what is enforced rather than a copy that drifts.
      setCatalogue(body.scopes);
    }

    if (hookResponse.ok) {
      const body = (await hookResponse.json()) as {
        endpoints: Endpoint[];
        events: string[];
      };
      setEndpoints(body.endpoints);
      setEventTypes(body.events);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const createKey = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName.trim(), scopes: chosen }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        secret?: string;
        error?: string;
      };

      if (!response.ok || !body.secret) {
        toast.show({ tone: 'danger', message: body.error ?? 'Could not create.' });
        return;
      }

      setFreshSecret(body.secret);
      setKeyName('');
      setChosen([]);
      await load();
    } finally {
      setBusy(false);
    }
  }, [chosen, keyName, load, toast]);

  const revoke = useCallback(
    async (keyId: string) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/keys?id=${encodeURIComponent(keyId)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          toast.show({ tone: 'danger', message: 'Could not revoke.' });
          return;
        }

        toast.show({ tone: 'success', message: 'Revoked. It stops working now.' });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const createEndpoint = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: hookUrl.trim(), events: hookEvents }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        endpoint?: Endpoint;
        error?: string;
      };

      if (!response.ok || !body.endpoint) {
        // The server's own wording, which names the rule that was broken —
        // "that address points inside a private network" is actionable in a
        // way that "invalid URL" is not.
        toast.show({
          tone: 'danger',
          message: body.error ?? 'Could not add that.',
        });
        return;
      }

      setFreshHookSecret(body.endpoint.secret ?? null);
      setHookUrl('');
      setHookEvents([]);
      await load();
    } finally {
      setBusy(false);
    }
  }, [hookEvents, hookUrl, load, toast]);

  const removeEndpoint = useCallback(
    async (endpointId: string) => {
      setBusy(true);
      try {
        await fetch(`/api/webhooks?id=${encodeURIComponent(endpointId)}`, {
          method: 'DELETE',
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const reactivateEndpoint = useCallback(
    async (endpointId: string) => {
      setBusy(true);
      try {
        await fetch(`/api/webhooks?id=${encodeURIComponent(endpointId)}`, {
          method: 'PATCH',
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <>
      {freshSecret && (
        <Card>
          <Heading>Copy this key now</Heading>
          <Secret>{freshSecret}</Secret>
          <Warn>
            THIS IS THE ONLY TIME IT WILL BE SHOWN. It is stored hashed and cannot
            be recovered.
          </Warn>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={() => setFreshSecret(null)}>
              I have copied it
            </Button>
          </div>
        </Card>
      )}

      <Section>
        <Heading>API keys</Heading>
        <Muted>
          A key can do only what you can do. Giving it a permission never grants it
          access you do not have, and taking your access away takes the key&rsquo;s
          away in the same instant.
        </Muted>

        <Fields>
          <TextField
            label="What is it for"
            placeholder="CI, Zapier, my script"
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
          />
        </Fields>

        <Scopes>
          {Object.entries(catalogue).map(([scope, description]) => (
            <Checkbox
              key={scope}
              label={`${scope} — ${description}`}
              checked={chosen.includes(scope)}
              onChange={() => setChosen((current) => toggle(current, scope))}
            />
          ))}
        </Scopes>

        <Button
          onClick={() => void createKey()}
          disabled={busy || !keyName.trim() || chosen.length === 0}
        >
          Create key
        </Button>

        <div style={{ marginTop: 'var(--space-6)' }}>
          {keys.length === 0 && <Muted>No keys yet.</Muted>}

          {keys.map((key) => (
            <Row key={key.id} $dim={Boolean(key.revokedAt)}>
              <Name>
                {key.name}
                {key.revokedAt && ' (revoked)'}
              </Name>
              <Mono>
                cdn_live_{key.prefix}… · {key.scopes.join(' ')} ·{' '}
                {key.lastUsedAt
                  ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                  : 'never used'}
              </Mono>
              {!key.revokedAt && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void revoke(key.id)}
                >
                  Revoke
                </Button>
              )}
            </Row>
          ))}
        </div>
      </Section>

      {freshHookSecret && (
        <Card>
          <Heading>Your signing secret</Heading>
          <Secret>{freshHookSecret}</Secret>
          <Warn>
            SHOWN ONCE. Verify every delivery with it — an endpoint that does not
            check the signature will accept anything anyone sends it.
          </Warn>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={() => setFreshHookSecret(null)}>
              I have copied it
            </Button>
          </div>
        </Card>
      )}

      <Section>
        <Heading>Webhooks</Heading>
        <Muted>
          We POST to your URL when something happens, signed so you can tell it came
          from us. Public https addresses only.
        </Muted>

        <Fields>
          <TextField
            label="Endpoint URL"
            placeholder="https://example.com/hooks/cdn"
            value={hookUrl}
            onChange={(event) => setHookUrl(event.target.value)}
          />
        </Fields>

        <Scopes>
          {eventTypes.map((event) => (
            <Checkbox
              key={event}
              label={event}
              checked={hookEvents.includes(event)}
              onChange={() => setHookEvents((current) => toggle(current, event))}
            />
          ))}
        </Scopes>

        <Button
          onClick={() => void createEndpoint()}
          disabled={busy || !hookUrl.trim() || hookEvents.length === 0}
        >
          Add endpoint
        </Button>

        <div style={{ marginTop: 'var(--space-6)' }}>
          {endpoints.length === 0 && <Muted>No endpoints yet.</Muted>}

          {endpoints.map((endpoint) => (
            <Row key={endpoint.id} $dim={!endpoint.active}>
              <Name>{endpoint.url}</Name>
              <Mono>
                {endpoint.events.join(' ')}
                {!endpoint.active &&
                  ` · switched off after ${endpoint.failures} failures`}
              </Mono>

              {!endpoint.active && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void reactivateEndpoint(endpoint.id)}
                >
                  Switch back on
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void removeEndpoint(endpoint.id)}
              >
                Delete
              </Button>
            </Row>
          ))}
        </div>
      </Section>
    </>
  );
}
