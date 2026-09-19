import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TextField } from './TextField';
import { Chip } from './Chip';
import { Card } from './Card';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { useToast } from './Toast';
import { tokens, type FamilyName } from '@/lib/styles/tokens.generated';

const FAMILIES = Object.keys(tokens.color.family) as FamilyName[];

const meta = {
  title: 'Primitives/All states',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section style={{ marginBottom: 40 }}>
    <h3
      style={{
        margin: '0 0 12px',
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: '#8C8FA8',
      }}
    >
      {title}
    </h3>
    {children}
  </section>
);

const Row = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}
  >
    {children}
  </div>
);

// ------------------------------------------------------------------ TextField

export const TextFields: Story = {
  render: function TextFieldStates() {
    const [value, setValue] = useState('');
    return (
      <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
        <TextField label="Default" placeholder="Map name" />
        <TextField
          label="With value"
          value={value || 'Product research'}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="With hint"
          hint="Visible to collaborators only"
          placeholder="Description"
        />
        <TextField
          label="Error"
          error="A map with this name already exists"
          defaultValue="Ideas"
        />
        <TextField label="Disabled" disabled placeholder="Not editable" />
        <TextField
          label="Search"
          hideLabel
          shape="pill"
          placeholder="Search the network"
          iconStart={
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M11 11l3 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      </div>
    );
  },
};

// ----------------------------------------------------------------------- Chip

export const Chips: Story = {
  render: function ChipStates() {
    const [selected, setSelected] = useState<string[]>(['discover']);
    const toggle = (name: string) =>
      setSelected((current) =>
        current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name],
      );

    return (
      <div style={{ display: 'grid', gap: 24 }}>
        <Section title="Selectable — interest picker (Page Watcher)">
          <Row>
            {FAMILIES.map((family) => (
              <Chip
                key={family}
                family={family}
                selected={selected.includes(family)}
                onClick={() => toggle(family)}
              >
                {family}
              </Chip>
            ))}
          </Row>
        </Section>

        <Section title="With family dot — filter bar">
          <Row>
            {FAMILIES.map((family) => (
              <Chip key={family} family={family} showDot readOnly>
                {family}
              </Chip>
            ))}
          </Row>
        </Section>

        <Section title="With count, and disabled">
          <Row>
            <Chip count={12}>Maps</Chip>
            <Chip count={3} selected>
              Shared
            </Chip>
            <Chip disabled>Archived</Chip>
          </Row>
        </Section>
      </div>
    );
  },
};

// ----------------------------------------------------------------------- Card

export const Cards: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}
    >
      <Card header="Plain">A card with no family and no interaction.</Card>
      <Card family="create" header="With family dot">
        The dot is the only hue on a card. Glow belongs to the map.
      </Card>
      <Card interactive header="Interactive">
        Hover and focus change the border only.
      </Card>
      <Card interactive selected header="Selected">
        Selected borrows the family hue for its border.
      </Card>
      <Card
        family="services"
        header="With footer"
        footer={
          <>
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
            <Button size="sm" variant="primary">
              Open
            </Button>
          </>
        }
      >
        Footer actions sit below a hairline.
      </Card>
    </div>
  ),
};

// -------------------------------------------------------------------- Skeleton

export const Skeletons: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 420 }}>
      <Section title="Text — single and multi-line">
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton width="70%" />
          <Skeleton lines={4} />
        </div>
      </Section>
      <Section title="Block and circle — a loading map card">
        <div style={{ display: 'flex', gap: 12 }}>
          <Skeleton shape="circle" width={48} height={48} />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <Skeleton width="50%" />
            <Skeleton lines={2} />
          </div>
        </div>
      </Section>
      <Section title="Block">
        <Skeleton shape="block" height={120} />
      </Section>
    </div>
  ),
};

// ---------------------------------------------------------------------- Avatar

export const Avatars: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <Section title="Sizes">
        <Row>
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Ada Lovelace" size="md" />
          <Avatar name="Ada Lovelace" size="lg" />
        </Row>
      </Section>
      <Section title="States">
        <Row>
          <Avatar name="Ada Lovelace" />
          <Avatar name="Grace Hopper" present />
          <Avatar name="Alan Turing" admin />
          <Avatar name="Katherine Johnson" present admin />
          <Avatar name="Broken Image" src="/does-not-exist.png" />
          <Avatar name="Prince" />
        </Row>
      </Section>
      <Section title="Presence stack — P11 collaboration">
        <div style={{ display: 'flex' }}>
          {['Ada Lovelace', 'Grace Hopper', 'Alan Turing'].map((name, index) => (
            <span key={name} style={{ marginLeft: index === 0 ? 0 : -8 }}>
              <Avatar name={name} present />
            </span>
          ))}
        </div>
      </Section>
    </div>
  ),
};

// ----------------------------------------------------------------------- Sheet

export const Sheets: Story = {
  render: function SheetStates() {
    const [placement, setPlacement] = useState<
      'bottom' | 'right' | 'center' | null
    >(null);

    return (
      <>
        <Row>
          <Button onClick={() => setPlacement('bottom')}>
            Bottom sheet (mobile)
          </Button>
          <Button onClick={() => setPlacement('right')}>
            Right sheet (tablet)
          </Button>
          <Button onClick={() => setPlacement('center')}>Centred (confirm)</Button>
        </Row>

        <Sheet
          open={placement !== null}
          onClose={() => setPlacement(null)}
          placement={placement ?? 'bottom'}
          title="Mind Mapping"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPlacement(null)}>
                Cancel
              </Button>
              <Button variant="primary" fullWidth>
                Open
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: '#8C8FA8', lineHeight: 1.55 }}>
            Escape closes. Focus moves in on open and returns to the trigger on
            close. The scrim blurs the map rather than hiding it.
          </p>
        </Sheet>
      </>
    );
  },
};

// ----------------------------------------------------------------------- Toast

export const Toasts: Story = {
  render: function ToastStates() {
    const { show } = useToast();
    return (
      <Row>
        <Button onClick={() => show({ message: 'Map saved' })}>Neutral</Button>
        <Button onClick={() => show({ message: 'Map published', tone: 'success' })}>
          Success
        </Button>
        <Button
          onClick={() => show({ message: 'Working offline', tone: 'warning' })}
        >
          Warning
        </Button>
        <Button
          onClick={() =>
            show({ message: 'Could not reach the server', tone: 'danger' })
          }
        >
          Danger
        </Button>
        <Button
          onClick={() =>
            show({
              message: 'Node deleted',
              action: {
                label: 'Undo',
                onPress: () => show({ message: 'Restored' }),
              },
            })
          }
        >
          With action (persists)
        </Button>
      </Row>
    );
  },
};
