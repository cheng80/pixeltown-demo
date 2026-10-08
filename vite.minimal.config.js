import { defineConfig } from 'vite';
export default defineConfig({
  root: 'minimal/game', envDir: '../..',
  server: { host: '127.0.0.1', port: Number(process.env.MINIMAL_WEB_PORT || 5270), strictPort: true, fs: { allow: ['.'] } },
  build: { outDir: '../../dist-minimal', emptyOutDir: true, target: 'es2020' },
});
