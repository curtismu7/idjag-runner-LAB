import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

// The static SE guide (public/idjag-se-guide.html) links ../src/standalone-ui.css, i.e. /src/standalone-ui.css.
// The dev server serves that file as is; the build emits the same vendored file at that path, byte for byte,
// so the guide and the React app load one copy and the React bundle is unchanged.
const guideStylesheet = {
  name: 'guide-standalone-ui-css',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'src/standalone-ui.css', source: fs.readFileSync(new URL('./src/standalone-ui.css', import.meta.url)) });
  },
};

export default defineConfig({
  plugins: [react(), guideStylesheet],
  server: {
    proxy: { '/api': 'http://127.0.0.1:4780' },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.jsx', 'src/**/*.test.js'],
    setupFiles: ['src/testSetup.js'],
  },
});
