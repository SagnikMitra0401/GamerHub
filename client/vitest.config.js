import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Component tests run on their own config so the production build stays
 * byte-for-byte what it was: `vite.config.js` is still the only thing
 * `npm run build` reads.
 */
export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  test: {
    environment: 'jsdom',
    globals: true,          // React Testing Library needs a global afterEach to clean up
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true
  }
});
