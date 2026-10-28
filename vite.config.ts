import { defineConfig } from 'vitest/config';

// base: '/packet-lab/' assumes the GitHub repository is named "packet-lab".
// Change this if you use a different repo name.
export default defineConfig({
  base: '/packet-lab/',
  build: {
    // Two pages: the game (index.html) and the raw event-log debug page (debug.html).
    rollupOptions: {
      input: { main: 'index.html', debug: 'debug.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
