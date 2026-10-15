import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const https = process.env.HTTPS === '1';
const serverPort = Number(process.env.SERVER_PORT ?? 3001);
/** Unique per build: open pages compare it with /version.json to know they are stale. */
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Writes dist/version.json with this build's id. */
function buildVersion(): Plugin {
  return {
    name: 'domino-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  // Opt-in HTTPS so phones on the LAN get a secure context (required for the microphone).
  plugins: [react(), buildVersion(), ...(https ? [basicSsl()] : [])],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
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
