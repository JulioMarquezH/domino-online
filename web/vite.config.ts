import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const https = process.env.HTTPS === '1';
const serverPort = Number(process.env.SERVER_PORT ?? 3001);

export default defineConfig({
  // Opt-in HTTPS so phones on the LAN get a secure context (required for the microphone).
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
