import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'destructive'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    {children}
  </div>
);

export const Playground: Story = {
  args: { children: 'Create map', variant: 'primary', size: 'md' },
};

/** All four variants. Primary takes its hue from the family toolbar control. */
export const Variants: Story = {
  args: { children: 'Button' },
  render: () => (
    <Row>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete map</Button>
    </Row>
  ),
};

export const Sizes: Story = {
  args: { children: 'Button' },
  render: () => (
    <Row>
      <Button variant="primary" size="sm">
        Small
      </Button>
      <Button variant="primary" size="md">
        Medium
      </Button>
      <Button variant="primary" size="lg">
        Large
      </Button>
    </Row>
  ),
};

/**
 * The acceptance grid — every variant against every state.
 *
 * This is the story P1 is signed off against. If a cell here looks wrong, the
 * component is not done, regardless of how it looks in the app.
 */
export const AllStates: Story = {
  args: { children: 'Button' },
  parameters: { layout: 'padded' },
  render: () => (
    <Grid>
      {(['primary', 'secondary', 'ghost', 'destructive'] as const).map(
        (variant) => (
          <div key={variant}>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#8C8FA8',
              }}
            >
              {variant}
            </p>
            <Row>
              <Button variant={variant}>Default</Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} loading>
                Loading
              </Button>
              <Button variant={variant} autoFocus>
                Focused
              </Button>
            </Row>
          </div>
        ),
      )}
    </Grid>
  ),
};

/**
 * Loading keeps the label's width, so the button does not resize mid-press
 * and move the target out from under the finger.
 */
export const Loading: Story = {
  args: { children: 'Generating map', variant: 'primary', loading: true },
};

export const FullWidth: Story = {
  args: { children: 'Save map', variant: 'primary', fullWidth: true },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Under reduced motion the spinner stops rotating rather than speeding up.
 * Verify by enabling "Reduce motion" in the OS and reloading.
 */
export const ReducedMotion: Story = {
  args: { children: 'Reduced motion', variant: 'primary', loading: true },
  parameters: {
    docs: {
      description: {
        story:
          'Transitions collapse to 0.01ms and the spinner becomes a static ring with aria-busy. Enable Reduce Motion at the OS level to check.',
      },
    },
  },
};
