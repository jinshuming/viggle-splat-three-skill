import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The lab pages import the skills' modules from ../skills/. Those files live outside this
// project, so (1) let the dev server read the parent folder, and (2) make `three` and the
// engine resolve to THIS project's node_modules (a second copy of three breaks instanceof checks).
export default defineConfig({
  server: { fs: { allow: ['..'] } },
  resolve: { dedupe: ['three', '@viggle/splat-engine-three'] },
  build: {
    target: 'esnext', // the lab pages use top-level await
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        'body-shape': resolve(import.meta.dirname, 'body-shape.html'),
        'held-item': resolve(import.meta.dirname, 'held-item.html'),
      },
    },
  },
});
