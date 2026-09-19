import type { Decorator, Preview } from '@storybook/react';
import { DensityProvider } from '../src/lib/styles/DensityProvider';
import { GlobalStyle } from '../src/lib/styles/GlobalStyle';
import { ToastProvider } from '../src/components/ui/Toast';
import { tokens } from '../src/lib/styles/tokens.generated';

/**
 * Every story runs through the real provider stack, not a simplified one.
 *
 * A story that renders under a hand-rolled theme proves nothing about what
 * ships. The two toolbar controls below — density and family — exist because
 * those are the two axes every component varies along, and reviewing a
 * primitive in only one of them is how the pointer-density regression gets
 * missed until someone opens the app on a laptop.
 */
const withProviders: Decorator = (Story, context) => {
  const density = context.globals.density as 'touch' | 'pointer';
  const family = context.globals.family as keyof typeof tokens.color.family;

  return (
    <DensityProvider density={density} family={family}>
      <GlobalStyle />
      <ToastProvider>
        <div style={{ padding: 24, minHeight: '100vh' }}>
          <Story />
        </div>
      </ToastProvider>
    </DensityProvider>
  );
};

const preview: Preview = {
  decorators: [withProviders],

  globalTypes: {
    density: {
      description: 'Control set (§17)',
      defaultValue: 'touch',
      toolbar: {
        title: 'Density',
        icon: 'mobile',
        items: [
          { value: 'touch', title: 'Touch — 48px controls, 88px targets' },
          { value: 'pointer', title: 'Pointer — 40px controls, 44px targets' },
        ],
        dynamicTitle: true,
      },
    },
    family: {
      description: 'Family accent',
      defaultValue: 'discover',
      toolbar: {
        title: 'Family',
        icon: 'paintbrush',
        items: Object.keys(tokens.color.family).map((name) => ({
          value: name,
          title: name,
        })),
        dynamicTitle: true,
      },
    },
  },

  parameters: {
    layout: 'centered',

    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: tokens.color.ground.background },
        { name: 'surface', value: tokens.color.ground.surface },
        // The map ground. Neon is judged against pure black or not at all.
        { name: 'canvas', value: tokens.color.ground.canvas },
      ],
    },

    a11y: {
      config: {
        rules: [
          {
            // The map canvas is exempt from colour-contrast because its
            // accessible equivalent is the tree view (§17), not the pixels.
            id: 'color-contrast',
            selector: '*:not([data-map-canvas] *)',
          },
        ],
      },
    },

    controls: {
      matchers: { color: /(background|color)$/i },
      expanded: true,
    },
  },
};

export default preview;
