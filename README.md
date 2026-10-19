# Concur Config Browser

A local, read-focused admin browser for SAP Concur configuration. Pick a configuration
category in the sidebar, search and browse the objects, and inspect how they are
configured — without navigating Concur's native admin UI.

The app talks to Concur only when you explicitly refresh; day-to-day browsing runs
against local JSON snapshots, so searching thousands of list items or user profiles
is instant.

## Features

| Category | What you can do |
| --- | --- |
| **Lists** | Browse all lists (cost centers, vendors, projects…) from LIST v4 and the legacy v3 API side by side, expand item trees, search by list name or saved item value/code. |
| **Forms & Fields** | Crawl expense form types, forms, and their configured fields (Expense Form v1.1). |
| **Expense Group Configuration** | Query a user's expense group configuration (policies, expense types, payment types, attendee types) by login ID; browse all groups via v3. |
| **Locations** | Search company-valid locations (Locations v3) by country, subdivision, city, or name, with entity-scoped disk caching. |
| **Localities** | Browse Localities v5 countries, subdivisions, and locations with local caching. |
| **Expense Reports** | Search report headers by login ID or report ID (Reports v3 / Report v2), with advanced filters and drill-down into entries (Entries v3). |
| **Identity** | Find users by Login ID, Employee ID, work email, or UUID; browse locally saved User, Spend, and Travel Profiles. |
| **API Logs** | Inspect every upstream Concur call the server has made (masked, JSONL). |

### Multiple entities

Configure several Concur entities (e.g. `us-uat`, `us-production`, `eu-uat`,
`eu-production`) and switch between them from the header. Each entity has its own
credentials, data snapshot directory (`data/<entityId>/`), and log directory
(`logs/<entityId>/`).

## Getting started

### Prerequisites

- Node.js 18+
- Concur OAuth credentials per entity: client ID, client secret, and a refresh token
  (see [Concur's OAuth 2.0 docs](https://developer.concur.com/api-reference/authentication/apidoc.html))

### Setup

```bash
npm install
cp .env.example .env   # then fill in your credentials
npm run dev
```

Open <http://localhost:5173> (or your configured `PORT`).

### Configuration (`.env`)

Everything is **server-side only** — never prefix Concur credentials with `VITE_`,
or they would leak into the browser bundle.

```dotenv
# Comma-separated entity IDs (lowercase letters, digits, hyphens)
CONCUR_ENTITIES=us-uat,us-production

# Per entity: ID uppercased, non-alphanumerics become underscores
CONCUR_US_UAT_LABEL="US UAT"
CONCUR_US_UAT_BASE_URL=https://us.api.concursolutions.com
CONCUR_US_UAT_CLIENT_ID=
CONCUR_US_UAT_CLIENT_SECRET=
CONCUR_US_UAT_REFRESH_TOKEN=

CONCUR_US_PRODUCTION_LABEL="US Production"
CONCUR_US_PRODUCTION_BASE_URL=https://us.api.concursolutions.com
CONCUR_US_PRODUCTION_CLIENT_ID=
CONCUR_US_PRODUCTION_CLIENT_SECRET=
CONCUR_US_PRODUCTION_REFRESH_TOKEN=

# Optional
PORT=5173                    # dev/preview port (default 5173)
DATA_DIR=data                # where local snapshots live
LOG_DIR=logs                 # where API call logs live
LOG_LEVEL=info               # debug | info | warn | error | silent
CONCUR_NETWORK_MODE=direct   # direct | proxy
# CONCUR_PROXY_URL=http://proxy.example.com:8080
```

An entity missing any of its variables is reported as "not configured" but doesn't
block the others. If `CONCUR_ENTITIES` is unset, a single `us-uat` entity is built
from unprefixed `CLIENT_ID` / `CLIENT_SECRET` / `BASE_URL` / `REFRESH_TOKEN`.

For corporate proxies, set `CONCUR_NETWORK_MODE=proxy` and either `CONCUR_PROXY_URL`
or the standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` variables.

## Commands

```bash
npm run dev        # Vite dev server with the Concur backend middleware
npm test           # full Vitest suite (~520 tests)
npm run build      # type-check src/ + production build → dist/
npm run preview    # serve dist/ (note: preview has NO backend middleware)
node scripts/generate-geo-data.mjs   # regenerate countries/subdivisions data
```

## How it works

```text
Browser (React SPA)                Vite dev server
┌──────────────────┐   same origin   ┌────────────────────────────┐
│  src/            │ ──────────────► │  server/ middleware        │
│  category views  │  /api/local/*   │  snapshot repositories     │ ──► data/<entity>/*.json
│  api clients     │  /api/concur/*  │  authenticated proxy       │ ──► Concur APIs
│  auth store      │  /auth/token    │  OAuth token cache         │
└──────────────────┘                 │  JSONL request logger      │ ──► logs/<entity>/api.log
                                     └────────────────────────────┘
```

- **Frontend** — React 18 + TypeScript (strict), Vite 6, Tailwind CSS 3 with
  shadcn-style design tokens. No router, no state library; the category registry
  (`src/registry/categories.tsx`) is the single extension point — adding a feature
  means appending one `CategoryDescriptor`.
- **Backend** — Node handlers in `server/`, mounted as Vite dev-server middleware.
  Handles OAuth refresh-token exchange (server-side only), proxies authenticated
  calls to Concur, and persists JSON snapshots so the UI can browse locally.
- **Security** — `CLIENT_SECRET` and `REFRESH_TOKEN` never reach the browser. The
  browser only sees the short-lived access token. Every upstream call is logged
  with sensitive values masked.

## Project layout

```text
server/            Node backend handlers (auth, proxy, per-domain fetch/persist)
src/
  registry/        category registry — the single extension point
  components/      one view per category + shared UI kit
  api/             per-domain API clients (all go through concurFetch)
  auth/            token store with auto-refresh
  entities/        active-entity selection store
  data/            generated geo data (countries, subdivisions)
docs/              design system + user journey map
scripts/           geo-data generator
data/              local snapshots (git-ignored)
logs/              API call logs (git-ignored)
```

## Contributing

See [AGENTS.md](AGENTS.md) for the full contributor guide: architecture details,
conventions (TypeScript strict, colocated tests, explanatory comments documenting
*why*), testing approach, and security rules. UI changes should follow
[docs/design-system.md](docs/design-system.md) — reuse the existing primitives
rather than inventing parallel patterns.
