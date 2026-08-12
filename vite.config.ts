import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest, handleTokenRequest } from './server/concurAuth';
import { handleGetLists, handleRefreshLists } from './server/concurLists';
import {
  handleGetExpenseGroups,
  handleGetUserExpenseGroups,
  handleRefreshExpenseGroups,
} from './server/concurExpenseGroups';
import {
  handleBulkListItems,
  handleGetChildren,
  handleGetItemsIndex,
  handleGetListItems,
  handleRefreshListItems,
} from './server/concurListItems';
import { handleGetApiLogEntries, handleListApiLogs } from './server/apiLogs';
import { handleGetForms, handleRefreshForms } from './server/concurForms';
import { handleGetLocalityCountries, handleRefreshLocalityCountries } from './server/concurLocalities';
import { handleRefreshCountryLocations, handleSearchCountryLocations } from './server/concurLocations';
import { createEntityRegistry } from './server/entities';

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
  for (const [key, value] of Object.entries(env)) {
    if ((key.startsWith('CONCUR_') || ['CLIENT_ID', 'CLIENT_SECRET', 'BASE_URL', 'REFRESH_TOKEN', 'LOG_LEVEL', 'LOG_DIR', 'DATA_DIR'].includes(key)) && value && !process.env[key]) {
      process.env[key] = value;
    }
  }

  return {
    name: 'concur-backend',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const selected = req.headers['x-concur-entity'];
        const entityHeader = Array.isArray(selected) ? selected[0] : selected;
        let entityId: string;
        try {
          entityId = createEntityRegistry().require(entityHeader).id;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(/Unknown Concur entity/.test(message) ? 404 : 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: message }));
          return;
        }
        // Order matters: match the most specific list-items routes first.
        const itemsMatch = url.match(/^\/api\/local\/list-items\/([^/?]+)(\/refresh|\/children)?(\?.*)?$/);
        const userGroupMatch = url.match(/^\/api\/local\/expense-groups\/user\/([^/?]+)(\?.*)?$/);
        const apiLogMatch = url.match(/^\/api\/local\/api-logs\/([^/?]+)$/);
        if (url.startsWith('/auth/token')) {
          void handleTokenRequest(req, res);
        } else if (url === '/api/local/entities') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ entities: createEntityRegistry().list() }));
        } else if (apiLogMatch) {
          handleGetApiLogEntries(res, entityId, decodeURIComponent(apiLogMatch[1]));
        } else if (url === '/api/local/api-logs') {
          handleListApiLogs(res, entityId);
        } else if (url.startsWith('/api/local/expense-groups/refresh')) {
          void handleRefreshExpenseGroups(res, entityId);
        } else if (userGroupMatch) {
          void handleGetUserExpenseGroups(res, entityId, decodeURIComponent(userGroupMatch[1]), userGroupMatch[2] ?? '');
        } else if (url.startsWith('/api/local/expense-groups')) {
          void handleGetExpenseGroups(res, entityId);
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
            handleBulkListItems(res, entityId, body);
          });
        } else if (url.startsWith('/api/local/list-items-index')) {
          handleGetItemsIndex(res, entityId);
        } else if (itemsMatch && itemsMatch[2] === '/children') {
          void handleGetChildren(res, entityId, decodeURIComponent(itemsMatch[1]), itemsMatch[3] ?? '');
        } else if (itemsMatch && itemsMatch[2] === '/refresh') {
          void handleRefreshListItems(res, entityId, decodeURIComponent(itemsMatch[1]));
        } else if (itemsMatch) {
          void handleGetListItems(res, entityId, decodeURIComponent(itemsMatch[1]));
        } else if (url.startsWith('/api/local/lists/refresh')) {
          void handleRefreshLists(res, entityId);
        } else if (url.startsWith('/api/local/lists')) {
          void handleGetLists(res, entityId);
        } else if (url.startsWith('/api/local/forms/refresh')) {
          void handleRefreshForms(res, entityId);
        } else if (url.startsWith('/api/local/forms')) {
          handleGetForms(res, entityId);
        } else if (url.startsWith('/api/local/localities/countries/refresh')) {
          void handleRefreshLocalityCountries(res, entityId);
        } else if (url.startsWith('/api/local/localities/countries')) {
          handleGetLocalityCountries(res, entityId);
        } else if (url.startsWith('/api/local/locations/refresh')) {
          void handleRefreshCountryLocations(res, entityId, url);
        } else if (url.startsWith('/api/local/locations')) {
          void handleSearchCountryLocations(res, entityId, url);
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
