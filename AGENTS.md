# AGENTS.md — Concur Config Browser (`concur-admin`)

Guidance for AI coding agents working in this repository. Assumes no prior knowledge of the project.

## Project overview

A local, read-focused admin browser for SAP Concur configuration. A Concur functional administrator
picks a configuration category (Lists, Forms & Fields, Expense Groups, Locations, Localities,
Expense Reports, Users) in a sidebar, searches/browses the objects, and inspects how they are
configured — without navigating Concur's native admin UI.

The app supports **multiple Concur entities** (e.g. `us-uat`, `us-production`, `eu-uat`,
`eu-production`), each with its own credentials, local data snapshot directory, and log directory.

Key docs:

- `docs/design-system.md` — governs UI reuse; extend the existing framework instead of inventing parallel patterns.
- `docs/journey-map.md` — the primary user journey the UI is optimized for.
- `docs/superpowers/` — historical design specs and implementation plans (git-ignored working notes).

## Tech stack

- **Frontend:** React 18 + TypeScript (strict), Vite 6, Tailwind CSS 3 (design tokens via CSS
  variables / `hsl(var(--…))`, shadcn-style). No router, no state library — view switching is
  local React state in `App.tsx`; shared stores use `useSyncExternalStore`.
- **Backend:** Node handlers in `server/`, mounted as **Vite dev-server middleware** (see
  `concurBackendPlugin` in `vite.config.ts`). Uses `undici` for upstream HTTP.
- **Testing:** Vitest + jsdom + Testing Library (`@testing-library/react`, `jest-dom`, `user-event`).
- **No production build deployment story:** the backend logic is designed to be re-hosted
  (Express/Fastify/serverless) for production — see the header comment in `server/concurAuth.ts`.

## Commands

```bash
npm install            # install dependencies
npm run dev            # Vite dev server on port 5566, with the Concur backend middleware
npm test               # vitest run — full suite (27 files, ~229 tests, ~40 s)
npm run build          # tsc -b (type-check src/) + vite build → dist/
npm run preview        # serve dist/ on port 5566 (NOTE: preview has NO backend middleware)
node scripts/generate-geo-data.mjs   # regenerate src/data/countries.json + subdivisions.json
```

`npm run lint` exists in `package.json` but eslint is **not** a dependency and there is no eslint
config in the repo — the script is currently non-functional. Do not rely on it.

## Configuration (.env)

Copy `.env.example` to `.env` (git-ignored). Everything is server-side only — **never** prefix
Concur credentials with `VITE_` (that would leak them into the browser bundle).

- `CONCUR_ENTITIES` — comma-separated entity IDs (lowercase letters, digits, hyphens), e.g. `us-uat,us-production`.
- Per entity `CONCUR_<ID>_…` (ID uppercased, non-alphanumerics → `_`): `LABEL`, `BASE_URL`,
  `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`. An entity missing any of these is reported as
  "not configured" but doesn't block other entities.
- `DATA_DIR` (default `data`), `LOG_DIR` (default `logs`), `LOG_LEVEL` (`debug|info|warn|error|silent`).
- `CONCUR_NETWORK_MODE` — `direct` (default) or `proxy`, applied globally to OAuth and every
  Concur API request. In proxy mode, `CONCUR_PROXY_URL` takes precedence; otherwise the server
  reads standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` variables from `.env` or its process
  environment. Lowercase variants are also supported. `CONCUR_PROXY=env|<url>` remains a legacy
  fallback when `CONCUR_NETWORK_MODE` is unset.
- Legacy fallback: if `CONCUR_ENTITIES` is unset, a single `us-uat` entity is built from
  unprefixed `CLIENT_ID`/`CLIENT_SECRET`/`BASE_URL`/`REFRESH_TOKEN`.

## Architecture

Two halves, both TypeScript, connected through same-origin HTTP:

### Backend — `server/` (Node, inside the Vite dev server)

Routing lives in `vite.config.ts` (`concurBackendPlugin`), which also copies `CONCUR_*` and
credential env vars into `process.env`. Every request may carry an `X-Concur-Entity` header to
select the entity (default: first configured). Endpoints:

- `GET /auth/token` — returns `{ access_token, expires_at }` for the SPA.
- `ANY /api/concur/*` — generic authenticated proxy to Concur (attaches server-side Bearer token; retries once on 401).
- `GET/POST /api/local/…` — cached-data repositories: `lists`, `list-items`, `expense-groups`,
  `forms`, `localities/countries`, `locations`, `api-logs`, plus `…/refresh` variants that re-fetch
  from Concur. These persist JSON snapshots under `data/<entityId>/` so the UI browses local data
  and only hits Concur on explicit refresh.

Key modules:

- `server/entities.ts` — entity registry from env (`createEntityRegistry`).
- `server/concurAuth.ts` — OAuth refresh-token exchange + per-entity token cache (refreshes 5 min
  before expiry) + the `/api/concur/*` proxy.
- `server/upstreamFetch.ts` — the shared outbound transport for OAuth and every direct server-side
  Concur API call; enforces the configured direct/proxy mode.
- `server/logger.ts` — writes every upstream call as JSONL to `logs/<entityId>/api.log`, rolling at
  10 MB (keeps 6 files). **Masks sensitive values** (tokens, secrets, Authorization headers, JWTs)
  before writing.
- `server/concur{Lists,ListItems,ExpenseGroups,Forms,Localities,Locations}.ts` — per-domain
  fetch/paginate/persist/serve handlers.

### Frontend — `src/` (React SPA)

- `src/registry/categories.tsx` — **the single extension point.** Adding a Concur configuration
  feature = appending one `CategoryDescriptor` here (navigation metadata plus its `render`
  function). The sidebar and main stage consume it without an `App.tsx` routing branch.
- `src/components/` — one view per category (`ListsView`, `FormsView`, `ExpenseGroupsView`,
  `LocalitiesView`, `LocationsView`, `ReportsView`, `UsersView`, `ApiLogsView`) plus shared
  shared framework pieces (`CountryRegionPicker`, `ItemTree`, async states, virtual tables, …) and a small
  shadcn-style `ui/` kit (`Badge`, `Button`, `Input`, `Modal`, `Tabs`, `Resizable`).
- `src/api/` — per-domain API clients. All Concur calls go through `concurFetch`/`concurGet`
  (`src/api/concurFetch.ts`), which awaits a valid token and adds the entity header.
- `src/auth/` — token store with countdown/auto-refresh (`getValidToken`, `useAccessToken`).
- `src/entities/entityStore.ts` — active-entity selection, shared via `useSyncExternalStore`.
- `src/data/` — generated geo data (`countries.json`, `subdivisions.json`).
- Cross-view state uses entity-keyed cache modules. Reports and Find One User also mirror durable
  tab state to `sessionStorage`; large local result sets stay in memory to avoid serializing them.

## Conventions

- **Language:** all code, comments, and docs are in English. Keep it that way.
- **TypeScript strict** with `noUnusedLocals`/`noUnusedParameters`. `tsc -b` type-checks only
  `src/` (see `tsconfig.json`); `server/` runs untyped-checked through Vite, so keep its types
  honest by hand.
- **Comments:** the codebase uses explanatory block comments that document *why* (e.g. why secrets
  stay server-side, why `Accept-Encoding` must not be set manually, why `expires_in` is the only
  valid lifetime). Preserve and match this style.
- **UI changes:** follow `docs/design-system.md`. Reuse `src/components/ui/` primitives and the
  category framework; don't create parallel patterns. The category table is the main stage — no
  dashboard-style KPI cards.
- **Data files and logs** (`data/`, `logs/`, `.env`, `.superpowers/`, `docs/superpowers/`) are
  git-ignored — never commit them.
- **Minimal diffs:** don't refactor or reformat surrounding code; match neighboring style.

## Testing

- `npm test` runs the full Vitest suite once (jsdom environment, setup in `src/test/setup.ts`).
- Tests are colocated: `*.test.ts`/`*.test.tsx` next to the code they cover, both in `src/` and
  `server/`. Server handler tests stub env vars and filesystem roots rather than hitting the network.
- Expect tests to assert user-visible behavior via Testing Library (roles/labels), not implementation details.
- Add tests for any new behavior, in the same colocated style.

## Security considerations

- `CLIENT_SECRET` and `REFRESH_TOKEN` must never reach the browser bundle: no `VITE_` prefix, no
  importing of `server/` modules from `src/`.
- The browser only ever sees the short-lived access token; the OAuth exchange and the Concur proxy
  are server-side.
- All API traffic is logged to `logs/<entityId>/api.log`; when adding new upstream calls, route
  them through the existing logger so masking (`maskValue`/`maskDeep`/JWT regex) applies. Never log
  unmasked tokens or secrets.
- `.env` is git-ignored; keep it that way.
