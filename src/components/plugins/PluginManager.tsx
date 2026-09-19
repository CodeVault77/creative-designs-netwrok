'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Card, Checkbox, useToast } from '@/components/ui';

/**
 * Installing and managing plugins.
 *
 * ── The consent screen is the whole point ───────────────────────────────────
 *
 * Everything a plugin can ever do is decided here, by a person, once. So the
 * permissions are shown as individual checkboxes with the plain-English
 * description the server supplies — not a summary, not a count, and not
 * pre-ticked. A consent screen everybody clicks through is not consent.
 *
 * Declining a permission is a first-class outcome: install proceeds with less,
 * and the plugin gets a key that can do less. It is not an error state.
 */

interface Manifest {
  name: string;
  version: string;
  summary: string;
  homepage?: string;
  scopes: string[];
  events: string[];
  webhookUrl?: string;
  nodeTypes: { id: string; label: string; description: string }[];
}

interface Plugin {
  id: string;
  slug: string;
  name: string;
  manifest: Manifest;
  version: string;
  status: string;
}

interface Installation {
  id: string;
  pluginId: string;
  pluginSlug: string;
  pluginName: string;
  grantedScopes: string[];
  version: string;
  enabled: boolean;
  needsReconsent: boolean;
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

const Grid = styled.div`
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
`;

const Box = styled.article<{ $dim?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--ground-border);
  border-radius: var(--radius-card);
  background: var(--ground-surface);
  opacity: ${({ $dim }) => ($dim ? 0.6 : 1)};
`;

const Title = styled.h3`
  margin: 0;
  font-family: var(--face-display);
  font-size: var(--text-title);
`;

const Meta = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Warn = styled.p`
  margin: 0;
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--color-warning);
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

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  margin-top: var(--space-2);
`;

export function PluginManager({
  scopeCatalogue,
}: {
  scopeCatalogue: Record<string, string>;
}) {
  const toast = useToast();
  const [published, setPublished] = useState<Plugin[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [consenting, setConsenting] = useState<Plugin | null>(null);
  const [granted, setGranted] = useState<string[]>([]);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/plugins');
    if (!response.ok) return;

    const body = (await response.json()) as {
      published: Plugin[];
      installations: Installation[];
    };

    setPublished(body.published);
    setInstallations(body.installations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch('/api/plugins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as {
          apiKey?: string;
          error?: string;
        };

        if (!response.ok) {
          toast.show({
            tone: 'danger',
            message: body.error ?? 'That did not work.',
          });
          return null;
        }

        await load();
        return body;
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const confirmInstall = useCallback(async () => {
    if (!consenting) return;

    const body = await post({
      action: 'install',
      pluginId: consenting.id,
      scopes: granted,
    });

    if (body) {
      // The key exists in clear exactly once, here. It goes to the person
      // installing, who passes it to the plugin.
      setIssuedKey(body.apiKey ?? null);
      setConsenting(null);
      setGranted([]);
    }
  }, [consenting, granted, post]);

  const installedIds = new Set(installations.map((i) => i.pluginId));

  return (
    <>
      {issuedKey && (
        <Card>
          <Heading>Give this key to the plugin</Heading>
          <Secret>{issuedKey}</Secret>
          <Warn>
            SHOWN ONCE. It acts as you, limited to what you just allowed, and you
            can revoke it any time by removing the plugin.
          </Warn>
          <Row>
            <Button variant="secondary" onClick={() => setIssuedKey(null)}>
              I have copied it
            </Button>
          </Row>
        </Card>
      )}

      {consenting && (
        <Card>
          <Heading>{consenting.manifest.name} wants permission</Heading>
          <Muted>{consenting.manifest.summary}</Muted>

          {consenting.manifest.homepage && (
            <Meta>
              Runs on{' '}
              <a
                href={consenting.manifest.homepage}
                target="_blank"
                rel="noreferrer noopener"
              >
                {consenting.manifest.homepage}
              </a>
            </Meta>
          )}

          <div style={{ margin: 'var(--space-4) 0' }}>
            {consenting.manifest.scopes.map((scope) => (
              <Checkbox
                key={scope}
                label={`${scopeCatalogue[scope] ?? scope} (${scope})`}
                checked={granted.includes(scope)}
                onChange={() =>
                  setGranted((current) =>
                    current.includes(scope)
                      ? current.filter((item) => item !== scope)
                      : [...current, scope],
                  )
                }
              />
            ))}
          </div>

          {consenting.manifest.webhookUrl && (
            <Meta>
              It will also receive {consenting.manifest.events.join(', ')} at{' '}
              {consenting.manifest.webhookUrl}
            </Meta>
          )}

          {/*
            Said explicitly, because it is the property that makes any of this
            safe and it is not obvious from a list of checkboxes.
          */}
          <Muted style={{ marginTop: 'var(--space-3)' }}>
            Whatever you allow, this plugin can only ever do things you can already
            do — and only for as long as you leave it installed.
          </Muted>

          <Row>
            <Button onClick={() => void confirmInstall()} disabled={busy}>
              {granted.length === 0 ? 'Install with no permissions' : 'Install'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConsenting(null);
                setGranted([]);
              }}
            >
              Cancel
            </Button>
          </Row>
        </Card>
      )}

      <Section>
        <Heading>Installed</Heading>

        {installations.length === 0 ? (
          <Muted>Nothing installed.</Muted>
        ) : (
          <Grid>
            {installations.map((installation) => (
              <Box key={installation.id} $dim={!installation.enabled}>
                <Title>{installation.pluginName}</Title>
                <Meta>
                  {installation.pluginSlug} · v{installation.version} ·{' '}
                  {installation.grantedScopes.join(' ') || 'no permissions'}
                </Meta>

                {installation.needsReconsent && (
                  <Warn>
                    A new version wants more than you allowed. It keeps the old
                    permissions until you agree.
                  </Warn>
                )}

                <Row>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void post({
                        action: 'enable',
                        installationId: installation.id,
                        enabled: !installation.enabled,
                      })
                    }
                  >
                    {installation.enabled ? 'Disable' : 'Enable'}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void post({
                        action: 'uninstall',
                        installationId: installation.id,
                      })
                    }
                  >
                    Remove
                  </Button>
                </Row>
              </Box>
            ))}
          </Grid>
        )}
      </Section>

      <Section>
        <Heading>Available</Heading>

        {published.length === 0 ? (
          <Muted>
            No plugins have been published yet. They appear here once one passes
            review.
          </Muted>
        ) : (
          <Grid>
            {published.map((plugin) => (
              <Box key={plugin.id}>
                <Title>{plugin.manifest.name}</Title>
                <Meta>
                  {plugin.slug} · v{plugin.version}
                </Meta>
                <Muted>{plugin.manifest.summary}</Muted>

                {plugin.manifest.nodeTypes.length > 0 && (
                  <Meta>
                    Adds:{' '}
                    {plugin.manifest.nodeTypes.map((type) => type.label).join(', ')}
                  </Meta>
                )}

                <Row>
                  {installedIds.has(plugin.id) ? (
                    <Meta>Installed</Meta>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setConsenting(plugin);
                        /*
                         * Nothing is pre-ticked. A consent screen that starts
                         * with everything selected is a consent screen that
                         * gets everything, from people who did not read it.
                         */
                        setGranted([]);
                      }}
                    >
                      Install
                    </Button>
                  )}
                </Row>
              </Box>
            ))}
          </Grid>
        )}
      </Section>
    </>
  );
}
