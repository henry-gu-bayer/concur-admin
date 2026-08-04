import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest, handleTokenRequest } from './server/concurAuth';
import { handleGetLists, handleRefreshLists } from './server/concurLists';
import { handleGetExpenseGroups, handleRefreshExpenseGroups } from './server/concurExpenseGroups';
import {
  handleBulkListItems,
  handleGetChildren,
  handleGetItemsIndex,
  handleGetListItems,
  handleRefreshListItems,
} from './server/concurListItems';

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
        // Order matters: match the most specific list-items routes first.
        const itemsMatch = url.match(/^\/api\/local\/list-items\/([^/?]+)(\/refresh|\/children)?(\?.*)?$/);
        if (url.startsWith('/auth/token')) {
          void handleTokenRequest(res);
        } else if (url.startsWith('/api/local/expense-groups/refresh')) {
          void handleRefreshExpenseGroups(res);
        } else if (url.startsWith('/api/local/expense-groups')) {
          void handleGetExpenseGroups(res);
        } else if (url.startsWith('/api/local/list-items/bulk')) {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            let body: { listIds?: string[]; listNames?: Record<string, string>; maxItems?: number } = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
            } catch {
              /* keep default */
            }
            handleBulkListItems(res, body);
          });
        } else if (url.startsWith('/api/local/list-items-index')) {
          handleGetItemsIndex(res);
        } else if (itemsMatch && itemsMatch[2] === '/children') {
          void handleGetChildren(res, decodeURIComponent(itemsMatch[1]), itemsMatch[3] ?? '');
        } else if (itemsMatch && itemsMatch[2] === '/refresh') {
          void handleRefreshListItems(res, decodeURIComponent(itemsMatch[1]));
        } else if (itemsMatch) {
          void handleGetListItems(res, decodeURIComponent(itemsMatch[1]));
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
    server: { port: 5566 },
    preview: { port: 5566 },
  };
});
