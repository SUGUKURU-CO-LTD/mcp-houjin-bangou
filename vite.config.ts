import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

const entry = process.env['UI_ENTRY'] ?? 'corporate-card';
const uiRoot = path.resolve(process.cwd(), `src/ui/${entry}`);

export default defineConfig({
  plugins: [viteSingleFile()],
  root: uiRoot,
  build: {
    target: 'es2022',
    outDir: path.resolve(process.cwd(), `dist/ui/${entry}`),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(uiRoot, 'mcp-app.html'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});
