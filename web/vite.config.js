import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// The static SE guide (public/idjag-se-guide.html) links ../src/standalone-ui.css, which the dev server serves as is.
// The build rewrites dist/idjag-se-guide.html with that <link> replaced by the vendored stylesheet inlined in a <style>,
// so the built guide is self-contained: styled in the SE Guide tab and when the downloaded file is opened from disk.
// One vendored copy stays in the repo; the React bundle is unchanged.
const GUIDE_LINK = '<link rel="stylesheet" href="../src/standalone-ui.css">';
let outDir = 'dist';
const guideInlineStylesheet = {
  name: 'guide-inline-standalone-ui-css',
  apply: 'build',
  configResolved(c) {
    outDir = path.resolve(c.root, c.build.outDir);
  },
  writeBundle() {
    const file = path.join(outDir, 'idjag-se-guide.html');
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes(GUIDE_LINK)) throw new Error(`idjag-se-guide.html: expected ${GUIDE_LINK} to inline`);
    const css = fs.readFileSync(new URL('./src/standalone-ui.css', import.meta.url), 'utf8');
    fs.writeFileSync(file, html.replace(GUIDE_LINK, () => `<style>\n${css}</style>`));
  },
};

export default defineConfig({
  plugins: [react(), guideInlineStylesheet],
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
