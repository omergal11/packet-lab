import { defineConfig } from 'vitest/config';

// base: '/packet-lab/' assumes the GitHub repository is named "packet-lab".
// Change this if you use a different repo name.
export default defineConfig({
  base: '/packet-lab/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
