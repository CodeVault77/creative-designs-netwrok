'use client';

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import {
  Button,
  Card,
  Checkbox,
  Select,
  TextField,
  useToast,
} from '@/components/ui';

/**
 * The organisation admin dashboard: policy, SSO, branding, audit.
 *
 * ── One screen, because they are one job ────────────────────────────────────
 *
 * An administrator configuring SSO is the same person setting the MFA policy
 * and the same person who will read the audit log when something looks wrong.
 * Four screens would mean four navigations to answer one question — "is this
 * organisation set up safely" — and that question is the reason the screen
 * exists.
 */

interface Settings {
  orgId: string;
  requireMfa: boolean;
  sessionHours: number;
  brandName: string;
  brandLogoUrl: string;
  brandAccent: string;
  brandSupportEmail: string;
  customDomain: string;
  domainToken: string;
  domainVerified: boolean;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface Connection {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  emailDomain: string;
  enforced: boolean;
  active: boolean;
}

interface AuditEntry {
  id: string;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
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

const Fields = styled.div`
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  align-items: end;
  margin: var(--space-3) 0;
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--ground-border);
`;

const Name = styled.span`
  flex: 1 1 10rem;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const Mono = styled.span`
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  color: var(--ground-muted);
  overflow-wrap: anywhere;
`;

const Pre = styled.pre`
  margin: var(--space-3) 0;
  padding: var(--space-3);
  border-radius: var(--radius-card);
  background: var(--ground-raised);
  font-family: var(--face-mono);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const Log = styled.div`
  overflow-x: auto;
`;

export function OrgAdminPanel() {
  const toast = useToast();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [txtName, setTxtName] = useState('_cdn-verify');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [redirect, setRedirect] = useState('');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const [brand, setBrand] = useState({
    name: '',
    accent: '',
    logo: '',
    support: '',
  });
  const [domain, setDomain] = useState('');
  const [sso, setSso] = useState({
    name: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    emailDomain: '',
  });

  const load = useCallback(async (id: string) => {
    const query = id ? `?org=${encodeURIComponent(id)}` : '';

    const [settingsResponse, ssoResponse, auditResponse] = await Promise.all([
      fetch(`/api/org/settings${query}`),
      fetch(`/api/sso${query}`),
      id ? fetch(`/api/org/audit${query}`) : Promise.resolve(null),
    ]);

    if (settingsResponse.ok) {
      const body = (await settingsResponse.json()) as {
        organizations: Organization[];
        settings: Settings | null;
        role?: string | null;
        txtRecordName?: string;
      };

      setOrgs(body.organizations);
      setSettings(body.settings);
      setRole(body.role ?? null);
      if (body.txtRecordName) setTxtName(body.txtRecordName);

      if (body.settings) {
        setBrand({
          name: body.settings.brandName,
          accent: body.settings.brandAccent,
          logo: body.settings.brandLogoUrl,
          support: body.settings.brandSupportEmail,
        });
        setDomain(body.settings.customDomain);
      }
    }

    if (ssoResponse.ok) {
      const body = (await ssoResponse.json()) as {
        connections: Connection[];
        redirectUri: string;
      };
      setConnections(body.connections);
      setRedirect(body.redirectUri);
    }

    if (auditResponse?.ok) {
      const body = (await auditResponse.json()) as { entries: AuditEntry[] };
      setAudit(body.entries);
    }
  }, []);

  useEffect(() => {
    void load(orgId);
  }, [load, orgId]);

  const post = useCallback(
    async (url: string, payload: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          token?: string;
        };

        if (!response.ok) {
          // The server's own wording. "That provider reports a different
          // issuer" is actionable; "invalid" is not.
          toast.show({
            tone: 'danger',
            message: body.error ?? 'That did not work.',
          });
          return null;
        }

        await load(orgId);
        return body;
      } finally {
        setBusy(false);
      }
    },
    [load, orgId, toast],
  );

  const isAdmin = role === 'owner' || role === 'admin';

  if (orgs.length === 0) {
    return (
      <Muted>
        You are not in an organisation. Enterprise settings apply to organisations
        rather than personal accounts.
      </Muted>
    );
  }

  return (
    <>
      <Select
        label="Organisation"
        value={orgId}
        onChange={(event) => setOrgId(event.target.value)}
        options={[
          { value: '', label: 'Choose one' },
          ...orgs.map((org) => ({ value: org.id, label: org.name })),
        ]}
      />

      {orgId && !isAdmin && (
        <Muted style={{ marginTop: 'var(--space-4)' }}>
          You are a member of this organisation but not an administrator.
        </Muted>
      )}

      {orgId && isAdmin && settings && (
        <>
          <Section>
            <Heading>Policy</Heading>

            <Checkbox
              label="Require two-factor authentication for everyone"
              checked={settings.requireMfa}
              onChange={(event) =>
                void post('/api/org/settings', {
                  action: 'update',
                  orgId,
                  requireMfa: event.target.checked,
                })
              }
            />
          </Section>

          <Section>
            <Heading>Single sign-on</Heading>

            <Card>
              <Muted>
                Register this exact redirect URI with your provider. It must match
                character for character.
              </Muted>
              <Pre>{redirect}</Pre>
            </Card>

            <Fields>
              <TextField
                label="Provider name"
                placeholder="Okta"
                value={sso.name}
                onChange={(event) => setSso({ ...sso, name: event.target.value })}
              />
              <TextField
                label="Issuer URL"
                placeholder="https://example.okta.com"
                value={sso.issuer}
                onChange={(event) => setSso({ ...sso, issuer: event.target.value })}
              />
              <TextField
                label="Client ID"
                value={sso.clientId}
                onChange={(event) =>
                  setSso({ ...sso, clientId: event.target.value })
                }
              />
              <TextField
                label="Client secret"
                type="password"
                value={sso.clientSecret}
                onChange={(event) =>
                  setSso({ ...sso, clientSecret: event.target.value })
                }
              />
              <TextField
                label="Email domain"
                placeholder="example.com"
                value={sso.emailDomain}
                onChange={(event) =>
                  setSso({ ...sso, emailDomain: event.target.value })
                }
              />
            </Fields>

            <Button
              disabled={busy || !sso.issuer.trim() || !sso.clientId.trim()}
              onClick={() =>
                void post('/api/sso', { action: 'create', orgId, ...sso })
              }
            >
              Add connection
            </Button>

            <div style={{ marginTop: 'var(--space-6)' }}>
              {connections.length === 0 && <Muted>No connections yet.</Muted>}

              {connections.map((connection) => (
                <Row key={connection.id}>
                  <Name>{connection.name}</Name>
                  <Mono>
                    {connection.issuer} · {connection.emailDomain || 'no domain'}
                    {connection.enforced && ' · ENFORCED'}
                  </Mono>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void post('/api/sso', {
                        action: 'update',
                        connectionId: connection.id,
                        enforced: !connection.enforced,
                      })
                    }
                  >
                    {connection.enforced ? 'Stop enforcing' : 'Enforce'}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void post('/api/sso', {
                        action: 'delete',
                        connectionId: connection.id,
                      })
                    }
                  >
                    Delete
                  </Button>
                </Row>
              ))}
            </div>

            {/*
              Said plainly, because an administrator about to enforce SSO is
              about to make a decision they cannot easily undo.
            */}
            <Muted style={{ marginTop: 'var(--space-4)' }}>
              Enforcing means members can only sign in through this provider. You
              can only enforce a connection somebody has already used, and the
              organisation owner always keeps their password as a way back in.
            </Muted>
          </Section>

          <Section>
            <Heading>Branding</Heading>

            <Fields>
              <TextField
                label="Name"
                value={brand.name}
                onChange={(event) =>
                  setBrand({ ...brand, name: event.target.value })
                }
              />
              <TextField
                label="Accent colour"
                placeholder="#4F46E5"
                value={brand.accent}
                onChange={(event) =>
                  setBrand({ ...brand, accent: event.target.value })
                }
              />
              <TextField
                label="Logo URL"
                placeholder="https://…"
                value={brand.logo}
                onChange={(event) =>
                  setBrand({ ...brand, logo: event.target.value })
                }
              />
              <TextField
                label="Support email"
                value={brand.support}
                onChange={(event) =>
                  setBrand({ ...brand, support: event.target.value })
                }
              />
            </Fields>

            <Button
              disabled={busy}
              onClick={() =>
                void post('/api/org/settings', {
                  action: 'update',
                  orgId,
                  brandName: brand.name,
                  brandAccent: brand.accent,
                  brandLogoUrl: brand.logo,
                  brandSupportEmail: brand.support,
                })
              }
            >
              Save branding
            </Button>
          </Section>

          <Section>
            <Heading>Custom domain</Heading>

            <Fields>
              <TextField
                label="Hostname"
                placeholder="maps.example.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
              <Button
                disabled={busy || !domain.trim()}
                onClick={() =>
                  void post('/api/org/settings', {
                    action: 'claim_domain',
                    orgId,
                    domain,
                  })
                }
              >
                Claim
              </Button>
            </Fields>

            {settings.customDomain && !settings.domainVerified && (
              <>
                <Muted>Publish this TXT record, then verify:</Muted>
                <Pre>
                  {txtName}.{settings.customDomain} TXT &quot;
                  {settings.domainToken}&quot;
                </Pre>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void post('/api/org/settings', {
                      action: 'verify_domain',
                      orgId,
                    })
                  }
                >
                  Verify
                </Button>
              </>
            )}

            {settings.domainVerified && (
              <Muted>
                {settings.customDomain} is verified and serving your branding.
              </Muted>
            )}
          </Section>

          <Section>
            <Heading>Audit log</Heading>

            <Muted>
              Who did what, and when. Kept for two years.{' '}
              <a
                href={`/api/org/audit?org=${encodeURIComponent(orgId)}&format=csv`}
              >
                Export as CSV
              </a>
              .
            </Muted>

            <Log>
              {audit.length === 0 ? (
                <Muted style={{ marginTop: 'var(--space-3)' }}>Nothing yet.</Muted>
              ) : (
                audit.map((entry) => (
                  <Row key={entry.id}>
                    <Mono>{new Date(entry.createdAt).toLocaleString()}</Mono>
                    <Name>{entry.action}</Name>
                    <Mono>
                      {entry.actorLabel || 'system'}
                      {entry.targetId && ` → ${entry.targetType} ${entry.targetId}`}
                    </Mono>
                  </Row>
                ))
              )}
            </Log>
          </Section>
        </>
      )}
    </>
  );
}
