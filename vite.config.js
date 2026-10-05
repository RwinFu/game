import { defineConfig } from 'vite';

// GitHub Pages hosts this repository at /game/. Local development and Arena's
// live preview use the origin root instead.
const base = process.env.GITHUB_ACTIONS === 'true' ? '/game/' : '/';

export default defineConfig({
  base,
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
