import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook is the design system's acceptance surface.
 *
 * P1's acceptance criterion is "every primitive rendered in all states, and
 * reduced-motion honoured". That is checked here, not in the app — the app
 * only ever shows a component in the states its screens happen to need, which
 * is exactly how a broken disabled or error state ships unnoticed.
 *
 * BUILDER — why Vite rather than @storybook/nextjs:
 * the Next builder runs Storybook's webpack plugins against Next's *bundled*
 * webpack, and that combination is broken on Next 15 + Storybook 8
 * ("Cannot read properties of undefined (reading 'tap')"). The Vite builder
 * avoids it entirely and starts far faster.
 *
 * The cost is that Next-specific APIs are not mocked here — next/image,
 * next/font, next/navigation. That is acceptable because no design-system
 * primitive imports them: fonts are applied through CSS variables, and the
 * only next/navigation use is the SSR registry, which the app owns, not the
 * component library. A component that needs a Next API is a signal it belongs
 * in a route, not in src/components/ui.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],

  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    // Runs axe against every story. Catches the contrast and label failures
    // that §23 warns become expensive if only found at P13.
    '@storybook/addon-a11y',
  ],

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  staticDirs: ['../public'],

  core: {
    disableTelemetry: true,
  },

  docs: {
    autodocs: 'tag',
  },
};

export default config;
