import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest, handleTokenRequest } from './server/concurAuth';
import { handleGetLists, handleRefreshLists } from './server/concurLists';

/**
 * Local Concur auth/API backend, served as Vite dev middleware.
 *
 * The OAuth exchange runs server-side (Node) so CLIENT_SECRET and REFRESH_TOKEN
 * stay out of the browser bundle. The SPA calls same-origin endpoints:
 *   GET  /auth/token        → { access_token, expires_at }
 *   ANY  /api/concur/*      → proxied to Concur with a server-side Bearer token
 */
function concurBackendPlugin(env: Record<string, string>): Plugin {
  // Make .env keys available to the Node handlers via process.env.
  for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'BASE_URL', 'REFRESH_TOKEN', 'LOG_LEVEL', 'DATA_DIR']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    name: 'concur-backend',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url.startsWith('/auth/token')) {
          void handleTokenRequest(res);
        } else if (url.startsWith('/api/local/lists/refresh')) {
          void handleRefreshLists(res);
        } else if (url.startsWith('/api/local/lists')) {
          void handleGetLists(res);
        } else if (url.startsWith('/api/concur')) {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => void handleApiRequest(req, res, Buffer.concat(chunks)));
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), concurBackendPlugin(env)],
  };
});
