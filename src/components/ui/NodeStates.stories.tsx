import type { Meta, StoryObj } from '@storybook/react';
import { NodePreview } from './NodePreview';
import {
  tokens,
  type FamilyName,
  type NodeStateName,
} from '@/lib/styles/tokens.generated';

const FAMILIES = Object.keys(tokens.color.family) as FamilyName[];
const STATES = Object.keys(tokens.nodeState) as NodeStateName[];

/**
 * The node state sheet — a P1 deliverable and the reference P3's canvas
 * renderer is built to match.
 *
 * These are SVG, not the real renderer. See the note in NodePreview.tsx.
 */
const meta = {
  title: 'Map/Node state sheet',
  parameters: {
    layout: 'fullscreen',
    // Judged on the map ground. Neon on #07070C is a different colour.
    backgrounds: { default: 'canvas' },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const Page = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      padding: 32,
      background: tokens.color.ground.canvas,
      minHeight: '100vh',
    }}
  >
    {children}
  </div>
);

const Caption = ({ children }: { children: React.ReactNode }) => (
  <p
    style={{
      margin: '0 0 24px',
      maxWidth: 640,
      color: '#8C8FA8',
      fontSize: 13,
      lineHeight: 1.6,
    }}
  >
    {children}
  </p>
);

const Cell = ({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) => (
  <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
    {children}
    <code
      style={{
        fontFamily: 'var(--face-mono)',
        fontSize: 11,
        color: '#8C8FA8',
      }}
    >
      {label}
    </code>
  </div>
);

/**
 * All nine states in one family.
 *
 * The rule to check here: every state must differ from every other in AT
 * LEAST TWO channels (§10). Squint, or view in greyscale — if two states
 * become indistinguishable, the spec is broken, not the screenshot.
 */
export const AllStates: Story = {
  render: () => (
    <Page>
      <Caption>
        Nine states, one family. Each differs from the others in at least two
        channels — stroke style, glow level, opacity, scale or badge — so none
        depends on hue alone. Check this in greyscale.
      </Caption>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 24,
        }}
      >
        {STATES.map((state) => (
          <Cell key={state} label={state}>
            <NodePreview state={state} family="discover" />
          </Cell>
        ))}
      </div>
    </Page>
  ),
};

/** Every state against every family — the full 54-cell matrix. */
export const StateByFamily: Story = {
  render: () => (
    <Page>
      <Caption>
        Every state in every family. Scan the columns for a state that stops reading
        correctly in a particular hue — Create (lime) and Commerce (teal) are the
        two most likely to lose their badge contrast.
      </Caption>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th />
              {FAMILIES.map((family) => (
                <th
                  key={family}
                  style={{
                    padding: 8,
                    fontFamily: 'var(--face-mono)',
                    fontSize: 11,
                    fontWeight: 400,
                    color: '#8C8FA8',
                    textAlign: 'center',
                  }}
                >
                  {family}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATES.map((state) => (
              <tr key={state}>
                <th
                  style={{
                    padding: 8,
                    fontFamily: 'var(--face-mono)',
                    fontSize: 11,
                    fontWeight: 400,
                    color: '#8C8FA8',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {state}
                </th>
                {FAMILIES.map((family) => (
                  <td key={family} style={{ padding: 4, textAlign: 'center' }}>
                    <NodePreview state={state} family={family} size={44} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  ),
};

/** Ring one as it will appear on the Community Map, with labels and numbers. */
export const RingOnePreview: Story = {
  render: () => (
    <Page>
      <Caption>
        Ring one with labels and numbers. Labels are always ink, never the family
        hue, and truncate at 18 characters on canvas (§10). Five live, the rest
        Coming Soon — ADR-0001.
      </Caption>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {(
          [
            ['Mind Mapping', 'create', 'active'],
            ['Link-to-Mind-Map', 'create', 'active'],
            ['Page Watcher', 'discover', 'active'],
            ['Build With Us', 'services', 'active'],
            ['Active Projects', 'services', 'active'],
            ['People & Networks', 'people', 'comingSoon'],
            ['Freelance & Marketplace', 'services', 'comingSoon'],
            ['AI Tools', 'create', 'comingSoon'],
            ['Ideas & Innovation', 'discover', 'comingSoon'],
            ['Tasks & Projects', 'organise', 'comingSoon'],
            ['Commerce & Payments', 'commerce', 'comingSoon'],
            ['Partners & Sponsors', 'people', 'comingSoon'],
          ] as const
        ).map(([label, family, state], index) => (
          <NodePreview
            key={label}
            state={state as NodeStateName}
            family={family as FamilyName}
            label={label}
            index={index + 1}
          />
        ))}
      </div>
    </Page>
  ),
};
