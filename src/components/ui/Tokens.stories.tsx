import type { Meta, StoryObj } from '@storybook/react';
import {
  tokens,
  type FamilyName,
  type TypeScaleName,
} from '@/lib/styles/tokens.generated';

/**
 * The token reference sheet.
 *
 * Generated from design/tokens.json at build time, so it cannot go stale —
 * a hand-maintained swatch page always drifts from the values in the code,
 * and a drifted reference is worse than none.
 */
const meta = {
  title: 'Foundation/Tokens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const Page = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 32, minHeight: '100vh' }}>{children}</div>
);

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h3
    style={{
      margin: '32px 0 12px',
      fontFamily: 'var(--face-display)',
      fontSize: 18,
      color: 'var(--ground-ink)',
    }}
  >
    {children}
  </h3>
);

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code style={{ fontFamily: 'var(--face-mono)', fontSize: 11, color: '#8C8FA8' }}>
    {children}
  </code>
);

export const Colour: Story = {
  render: () => (
    <Page>
      <Heading>Ground and surface</Heading>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(tokens.color.ground).map(([name, hex]) => (
          <div key={name} style={{ display: 'grid', gap: 6, width: 132 }}>
            <div
              style={{
                height: 64,
                background: hex,
                border: '1px solid #22253A',
                borderRadius: 12,
              }}
            />
            <Mono>
              {name}
              <br />
              {hex}
            </Mono>
          </div>
        ))}
      </div>

      <Heading>Family accents and their three ramps</Heading>
      <p style={{ maxWidth: 620, color: '#8C8FA8', fontSize: 13, lineHeight: 1.6 }}>
        Six families, six hues. <Mono>core</Mono> strokes, <Mono>glow</Mono> is core
        at 55% for halos, <Mono>wash</Mono> is core at 8% for fills. Six rather than
        twelve because nobody learns twelve hue-to-meaning pairs, and six survive
        colour-vision deficiency when paired with an icon and a badge (ADR-0003).
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {(Object.keys(tokens.color.family) as FamilyName[]).map((family) => {
          const ramp = tokens.familyRamp[family];
          return (
            <div
              key={family}
              style={{ display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <span style={{ width: 96 }}>
                <Mono>{family}</Mono>
              </span>
              {(['core', 'glow', 'wash'] as const).map((step) => (
                <div key={step} style={{ display: 'grid', gap: 4 }}>
                  <div
                    style={{
                      width: 120,
                      height: 40,
                      background: ramp[step],
                      border: '1px solid #22253A',
                      borderRadius: 10,
                    }}
                  />
                  <Mono>{step}</Mono>
                </div>
              ))}
              <div style={{ display: 'grid', gap: 4 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    border: `2px solid ${ramp.core}`,
                    background: ramp.wash,
                    boxShadow: tokens.glow[family][2],
                  }}
                />
                <Mono>glow-2</Mono>
              </div>
            </div>
          );
        })}
      </div>

      <Heading>Semantic — never reused as accents</Heading>
      <div style={{ display: 'flex', gap: 12 }}>
        {Object.entries(tokens.color.semantic).map(([name, hex]) => (
          <div key={name} style={{ display: 'grid', gap: 6, width: 132 }}>
            <div style={{ height: 48, background: hex, borderRadius: 10 }} />
            <Mono>
              {name}
              <br />
              {hex}
            </Mono>
          </div>
        ))}
      </div>
    </Page>
  ),
};

export const Typography: Story = {
  render: () => (
    <Page>
      <Heading>Type scale</Heading>
      <p style={{ maxWidth: 620, color: '#8C8FA8', fontSize: 13, lineHeight: 1.6 }}>
        Sizes shown are the current breakpoint&apos;s. Resize the window past 1024px
        to see the desktop scale — the CSS variables swap, no component changes.
      </p>
      <div style={{ display: 'grid', gap: 20 }}>
        {(Object.keys(tokens.typography.scale) as TypeScaleName[]).map((name) => {
          const step = tokens.typography.scale[name];
          return (
            <div key={name}>
              <Mono>
                {name} · {step.mobile} / {step.desktop} · {step.face} · lh{' '}
                {step.lineHeight}
              </Mono>
              <div
                style={{
                  fontFamily: `var(--face-${step.face})`,
                  fontSize: `var(--text-${name})`,
                  lineHeight: step.lineHeight,
                  color: 'var(--ground-ink)',
                  marginTop: 4,
                }}
              >
                God gives the vision. We build the connections.
              </div>
            </div>
          );
        })}
      </div>

      <Heading>Faces</Heading>
      <div style={{ display: 'grid', gap: 16 }}>
        {Object.entries(tokens.typography.face).map(([name]) => (
          <div key={name}>
            <Mono>{name}</Mono>
            <div
              style={{
                fontFamily: `var(--face-${name})`,
                fontSize: 20,
                color: 'var(--ground-ink)',
              }}
            >
              ABCDEFGHIJKLM abcdefghijklm 0123456789
            </div>
          </div>
        ))}
      </div>
    </Page>
  ),
};

export const SpacingAndShape: Story = {
  render: () => (
    <Page>
      <Heading>Spacing — 4px base</Heading>
      <div style={{ display: 'grid', gap: 8 }}>
        {Object.entries(tokens.space).map(([step, value]) => (
          <div
            key={step}
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <span style={{ width: 72 }}>
              <Mono>
                {step} · {value}
              </Mono>
            </span>
            <div
              style={{
                width: value,
                height: 16,
                background: '#2FD9F5',
                borderRadius: 2,
              }}
            />
          </div>
        ))}
      </div>

      <Heading>Radius — deliberately varied</Heading>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {Object.entries(tokens.radius).map(([name, value]) => (
          <div
            key={name}
            style={{ display: 'grid', gap: 6, justifyItems: 'center' }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                background: 'var(--ground-surface)',
                border: '1px solid #22253A',
                borderRadius: value,
              }}
            />
            <Mono>
              {name} · {value}
            </Mono>
          </div>
        ))}
      </div>

      <Heading>Control sets — both ship in P1</Heading>
      <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: 8,
                color: '#8C8FA8',
                fontWeight: 400,
              }}
            >
              Token
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: 8,
                color: '#8C8FA8',
                fontWeight: 400,
              }}
            >
              touch
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: 8,
                color: '#8C8FA8',
                fontWeight: 400,
              }}
            >
              pointer
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(tokens.control.touch).map((key) => (
            <tr key={key} style={{ borderTop: '1px solid #22253A' }}>
              <td style={{ padding: 8 }}>
                <Mono>{key}</Mono>
              </td>
              <td style={{ padding: 8, color: 'var(--ground-ink)' }}>
                {tokens.control.touch[key as keyof typeof tokens.control.touch]}
              </td>
              <td style={{ padding: 8, color: 'var(--ground-ink)' }}>
                {tokens.control.pointer[key as keyof typeof tokens.control.pointer]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  ),
};

export const Motion: Story = {
  render: () => (
    <Page>
      <Heading>Motion</Heading>
      <p style={{ maxWidth: 620, color: '#8C8FA8', fontSize: 13, lineHeight: 1.6 }}>
        Every duration collapses to 0.01ms under <Mono>prefers-reduced-motion</Mono>
        , the camera becomes instant and the ambient breathe stops. Shipped in P1,
        not P13 — enable Reduce Motion at the OS level and reload to verify.
      </p>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
        <thead>
          <tr>
            {['Motion', 'Duration', 'Easing'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  padding: 8,
                  color: '#8C8FA8',
                  fontWeight: 400,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(tokens.motion.duration).map(([name, value]) => (
            <tr key={name} style={{ borderTop: '1px solid #22253A' }}>
              <td style={{ padding: 8 }}>
                <Mono>{name}</Mono>
              </td>
              <td style={{ padding: 8, color: 'var(--ground-ink)' }}>{value}</td>
              <td style={{ padding: 8 }}>
                <Mono>
                  {tokens.motion.easing[
                    name as keyof typeof tokens.motion.easing
                  ] ?? '—'}
                </Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  ),
};
