import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Vite config for Storybook only. The application itself is built by Next.
 *
 * The `@` alias is declared explicitly rather than through a tsconfig-paths
 * plugin: that plugin is ESM-only and this config is loaded as CJS, and a
 * one-line alias is not worth a module-format fight. It must stay in step
 * with the identical alias in vitest.config.ts and the `paths` entry in
 * tsconfig.json — three places, one value, because a story, a test and the
 * app must all resolve a component to the same file.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
