import type { Meta, StoryObj } from '@storybook/react';
import { TabBar } from './TabBar';
import { NavRail, type RailVariant } from './NavRail';
import { TopBar } from './TopBar';
import { NAV_ITEMS } from './navItems';
import type { TabId } from '@/lib/routes';

/**
 * The shell in every breakpoint configuration.
 *
 * AppShell itself is not storied: it reads `usePathname()` and a live
 * `window.innerWidth`, so a story of it would either need a router mock or
 * would silently show whichever layout the Storybook iframe happens to be.
 * Storying the three pieces it composes is honest; storying the composer
 * would not be. AppShell's own logic is covered by the route tests and by
 * the 22-route navigation smoke test.
 */
const meta = {
  title: 'Shell/Navigation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const Frame = ({
  label,
  height = 320,
  children,
}: {
  label: string;
  height?: number;
  children: React.ReactNode;
}) => (
  <div style={{ marginBottom: 32 }}>
    <p
      style={{
        margin: '0 0 8px',
        fontFamily: 'var(--face-mono)',
        fontSize: 11,
        color: '#8C8FA8',
      }}
    >
      {label}
    </p>
    <div
      style={{
        position: 'relative',
        height,
        border: '1px solid #22253A',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--ground-background)',
      }}
    >
      {children}
    </div>
  </div>
);

/** All four tabs, each shown active in turn. */
export const TabBarStates: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      {NAV_ITEMS.map((item) => (
        <Frame key={item.id} label={`Tab bar — ${item.label} active`} height={110}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <TabBar activeTab={item.id} />
          </div>
        </Frame>
      ))}
    </div>
  ),
};

/**
 * The three rail variants (§17).
 *
 * Note the board variant is bottom-anchored: someone standing at a
 * wall-mounted display cannot reach the top of it.
 */
export const NavRailVariants: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      {(
        [
          ['compact', 'Desktop 1024–1599 — icons only, 72px'],
          ['expanded', 'Large ≥1600 — icons + labels, 208px'],
          ['board', 'Touch board ≥2400 — bottom-anchored for standing reach'],
        ] as [RailVariant, string][]
      ).map(([variant, label]) => (
        <Frame key={variant} label={label} height={420}>
          <NavRail activeTab="map" variant={variant} />
        </Frame>
      ))}
    </div>
  ),
};

export const TopBarStates: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      <Frame label="Phone — brand only" height={90}>
        <TopBar />
      </Frame>
      <Frame label="Tablet — brand + search + notifications" height={90}>
        <TopBar showSearch showNotifications />
      </Frame>
      <Frame label="Unread notifications" height={90}>
        <TopBar showSearch showNotifications unreadCount={3} />
      </Frame>
      <Frame label="Sub-screen — back + title" height={90}>
        <TopBar showBack backHref="/maps" title="Product research" />
      </Frame>
      <Frame
        label="Desktop — rail shows the brand, so the bar does not"
        height={90}
      >
        <TopBar showBrand={false} showNotifications title="Community Map" />
      </Frame>
    </div>
  ),
};

/** Every tab in every chrome, for a one-screen review of the whole shell. */
export const Matrix: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      <p style={{ maxWidth: 620, color: '#8C8FA8', fontSize: 13, lineHeight: 1.6 }}>
        The active indicator is never colour alone: the tab bar adds a lit bar above
        the tab, the rail adds one on the leading edge, the label goes to medium
        weight, and the icon switches to its filled variant.
      </p>
      {(['map', 'search', 'maps', 'you'] as TabId[]).map((tab) => (
        <div key={tab} style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Frame label={`${tab} — rail`} height={300}>
            <NavRail activeTab={tab} variant="expanded" />
          </Frame>
          <div style={{ flex: 1 }}>
            <Frame label={`${tab} — tab bar`} height={110}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <TabBar activeTab={tab} />
              </div>
            </Frame>
          </div>
        </div>
      ))}
    </div>
  ),
};
