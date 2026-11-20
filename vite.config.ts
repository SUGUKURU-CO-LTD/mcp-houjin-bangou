import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

const entry = process.env['UI_ENTRY']?.trim() ?? '';
const uiRoot = entry ? path.resolve(process.cwd(), `src/ui/${entry}`) : path.resolve(process.cwd(), 'src/ui');
const outDir = entry ? path.resolve(process.cwd(), `dist/ui/${entry}`) : path.resolve(process.cwd(), 'dist/ui');

export default defineConfig({
  plugins: [viteSingleFile()],
  root: uiRoot,
  build: {
    target: 'es2022',
    outDir,
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
