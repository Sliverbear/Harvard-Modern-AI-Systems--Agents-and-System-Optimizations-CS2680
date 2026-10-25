import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.MADS_PORT ?? 5174);

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
