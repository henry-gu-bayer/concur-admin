# Concur Config Browser — Design Guideline

This document governs reuse of the UI in `src/`. It exists so the next contributor
**extends the framework** instead of inventing parallel patterns.

## 1. Primary task contract

> **Pick a configuration category, find the object you need, and inspect how it's configured.**

The app retrieves Concur configuration (Lists, Expense Groups, Expense Policies,
Expense Types, Payment Types, Attendee Types, Allocations…) and presents it in a
manageable, read-focused UI.

Rules that follow from this contract:

1. The selected category's **object table is the main stage**. It gets the largest,
   most central area.
2. **No stacked summary-card farm.** No KPI tiles, no "overview dashboard" — the
   category table is the content.
3. First viewport holds **at most 2–3 visual groups**: sidebar (nav) + slim toolbar
   + table. Nothing else earns a permanent spot.
4. Detail is **inline and contextual** — expanding a row, never navigating away.
5. Reference (raw JSON, API settings) stays **off the main stage**, on demand.

## 2. The framework — read this before adding a feature

The whole app is a **category registry**. Each Concur configuration feature is one
`CategoryDescriptor` (`src/types.ts`). A descriptor owns navigation metadata and a
`render` function; `App.tsx` never grows a category-specific routing branch.

```
src/
├─ types.ts                    ← domain types + CategoryDescriptor contract
├─ auth/
│  ├─ config.ts                ← VITE_* env, REFRESH_LEEWAY_SEC, retry policy
│  ├─ tokenStore.ts            ← ★ single source of truth for the access token
│  ├─ useAccessToken.ts        ← reactive hook (useSyncExternalStore)
│  └─ useCountdown.ts          ← live seconds-to-expiry ticker
├─ api/concurFetch.ts          ← authenticated fetch — checks token before every call
├─ registry/categories.tsx     ← ★ THE extension point: add a descriptor here
├─ registry/icons.tsx          ← nav icons keyed by category id
├─ components/
│  ├─ *View.tsx                ← category workspaces rendered by the registry
│  ├─ CountryRegionPicker.tsx  ← shared country-code input and lookup
│  ├─ useVirtualTableRows.ts   ← shared large-table window calculation
│  └─ ui/  Button·Badge·Input·Modal·Tabs·AsyncState·Resizable
```

### Auth — the access-token contract

**No secrets in the browser.** The OAuth refresh-token exchange runs server-side;
the SPA only ever holds the short-lived access token.

```
server/concurAuth.ts   ← Node handlers (run inside the Vite dev server)
vite.config.ts         ← wires them as middleware: /auth/token + /api/concur/*
src/auth/tokenStore.ts ← client store: token + expiry + auto-refresh + countdown
```

- **Server side (`server/concurAuth.ts`)** reads plain `CLIENT_ID / CLIENT_SECRET /
  BASE_URL / REFRESH_TOKEN` from `.env` via `process.env` and:
  - `GET /auth/token` → performs the refresh_token exchange (POST `/oauth2/v0/token`),
    caches the token, returns `{ access_token, expires_at }` to the SPA.
  - `/api/concur/*` → proxies to Concur attaching the server-side Bearer token
    (retries once on 401). Secrets never leave the server.
  - Routes every Concur OAuth and API request through the shared server transport.
    `CONCUR_NETWORK_MODE=direct` forces a direct connection. `proxy` uses
    `CONCUR_PROXY_URL`, or standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`
    settings inherited by the process or loaded from `.env`.
- **Client store (`auth/tokenStore.ts`)** calls the local `/auth/token`, exposes
  `useAccessToken()` (reactive) and `await getValidToken()` (imperative), and
  auto-refreshes `REFRESH_LEEWAY_SEC` (300s) before `expiresAt` with backoff retries.
- **Startup:** `initAuth()` runs once in `main.tsx`.
- **Every API call checks availability** via `api/concurFetch.ts` →
  `await getValidToken()` before sending.
- **Countdown UI:** `components/AuthStatus.tsx` ticks once/sec (live / expiring-soon /
  refreshing / error + retry).
- **Env (.env):** plain non-`VITE_` keys only — they are read by the Node layer and
  are **not** bundled into the client. For production, host the same two handlers in
  your real server (Express/Fastify/serverless); the client code is unchanged.

### API logging — every call, secrets masked

`server/logger.ts` records **every** request through the backend (token exchange +
Concur API proxy) with: request datetime, method, URL, request headers, request
params/body, response time (ms), response status, response headers, response body,
and the `concur-correlationid` response header.

- **Masking:** `client_id`, `client_secret`, `access_token`, `refresh_token`,
  `id_token`, any key containing `secret`/`token`/`password`, the `Authorization`
  and `set-cookie` headers, and any JWT-shaped string (`eyJ…`) anywhere in the
  payload are masked as `xxxx…***(len)`. Non-secret metadata like `token_type`,
  `expires_in`, `scope` is left readable. Verified: the real secrets never appear
  in any log.
- **What is logged:** request datetime, method, URL, request headers, request
  params/body, response time (ms), response status, response body, and the
  `concur-correlationid` header. **Full response headers are NOT logged** — only the
  correlation id is kept.
- **Sinks:**
  - **File (always):** all entries appended as JSONL to a single file, `logs/api.log`.
  - **Rollover:** when `api.log` exceeds **10 MB** it rolls over — `api.log → api.1.log`,
    `api.1.log → api.2.log`, … keeping at most 5 archives. `logs/` is git-ignored.
  - **Terminal (concise):** one line per call —
    `[<entity-id>] GET <url> → <status> <ms>ms corr=<id>`.
- **Level:** driven by `LOG_LEVEL` in `.env` (`debug` = also dump the full JSON entry
  to the terminal, `info` = concise line only, `silent` = off). The log file is written
  regardless of level.
- Server-side only by design — masking on the client would be too late, since the
  secrets only ever transit the backend.

### To add a feature (e.g. Expense Groups)

1. Add the domain API client and a focused `*View` workspace using the shared UI primitives.
2. Add one descriptor whose `render` function mounts that workspace.
3. The sidebar and main stage now discover it without modifying `App.tsx`.

### Reference implementation: Lists (live LIST v4)

Lists is the first fully-wired feature and the template for the rest.

```
server/concurLists.ts  ← fetchAllLists(): follows links.next across ALL pages
                         (limit=100 → 10 pages → 958 lists), persists to
                         data/lists.json; serves GET /api/local/lists and
                         POST /api/local/lists/refresh
src/api/listsApi.ts    ← getLists() / refreshLists() against the local snapshot
src/components/ListsView.tsx  ← the lists workbench, mounted by its registry renderer
```

- **Paging:** the server walks `links[].rel === 'next'` until exhausted, resolving
  relative hrefs against `BASE_URL`. Every page call is logged + masked.
- **Local snapshot:** the UI reads `data/lists.json` (instant); it never pages
  Concur directly. A **Retrieve again** button POSTs to re-fetch everything and
  updates the snapshot + a "retrieved x ago" stamp.
- **Browsing hundreds of lists** (the UX point of the feature): search-as-you-type
  (name / id / format), category filter chips (Normal/Configuration/Vendor/Commodity),
  level-count filter, **sortable columns**, an **alphabetical quick-jump** strip
  (A–Z/#, computed from the current result set), and pagination (50/page). Filters
  reset to page 1 on change; the table is the main stage.
- **Detail:** expanding a row shows an inline field grid (IDs in mono).
- New categories should follow the same shape: server fetch+persist, local snapshot,
  a workbench view tuned to that object's cardinality.

This is the deliberate pay-off of the framework: **features are data + one flag, not new screens.**

## Task model

| Level | Goal | UI consequence |
|---|---|---|
| **Primary goal** | Browse/search a category's config objects, open one to inspect its settings | Category table IS the main stage |
| **Secondary goal** | Re-retrieve config from Concur (refresh), filter by active/inactive | Slim toolbar above table; inline detail expansion |
| **Low-frequency goal** | Compare objects, see where an object is used | Inside the inline detail panel |
| **Rare goal** | API connection settings, export/dump raw JSON | Rail/deferred views, never main stage |

## 3. Information architecture

Every block carries exactly one role:

| Role | Rule | Examples |
|---|---|---|
| `action-critical` | May occupy the main stage | Category table, search/filter, expand |
| `decision-supporting` | Conditional, contextual | Inline detail panel (fields, items) |
| `status-feedback` | Slim, transient | "Retrieved from Concur" stamp, loading skeletons |
| `reference` | On-demand only | Raw JSON, API settings, docs |
| `exception-handling` | Only in failure state | Retrieval-error retry panel |
| `audit/history` | Never first-viewport | Change history (future) |

### Content audit — first-viewport budget

| Bucket | Items | First-viewport? |
|---|---|---|
| `must-see-now` | Category object table | Yes — main stage |
| `next-step-only` | Search + status filter | Yes, slim single row |
| `error-only` | Retrieval-error retry | Only on fetch failure |
| `on-demand-reference` | Object detail, raw JSON, settings | Deferred — row expansion / modal |
| `keep-off-first-viewport` | Change history, cross-category reports | Never first viewport |

## Usage

### Category workspaces
Each `*View` owns its domain-specific retrieval and presentation. Reuse `AsyncState`
for loading/error/empty states, `CountryRegionPicker` for country lookup,
`useVirtualTableRows` for large local snapshots, and `Resizable` for table/detail
and column resizing. Do not duplicate these mechanics inside another view.

## Layout

- **Shell:** 64-unit category **sidebar** (left, nav only) + main column. The sidebar
  groups categories by their `group` field; it never becomes a content panel.
- **Main column:** sticky top bar (category title + retrieve/refresh + settings) →
  one-line category description → slim toolbar → **table fills the viewport**.
  No right rail.
- **Spacing:** 8-px base scale. No arbitrary values.
- **Responsive:** table workspaces choose their essential columns and allow horizontal
  scrolling or column management. Large tables remain tables rather than cards.

## Anatomy

### Result row and detail
Rows expose the useful identifiers and status fields for their domain. Selection is
keyboard reachable and keeps the result context visible. Detail may be an inline row
expansion or a resizable adjacent pane; modal windows are reserved for secondary
collections such as comments and exceptions.

## States

- Every interactive element: **default / hover / active / focus-visible / disabled**.
- **Loading:** table shimmer skeleton (`aria-busy`); detail panel 280 ms skeleton.
- **Error:** retrieval failure → destructive retry panel (`role="alert"`).
- **Empty:** category returns no objects → "none configured" state.
- **No-results:** filters match nothing → "clear filters" state.
- **Tokens:** `src/index.css` HSL custom properties via Tailwind semantic names;
  dark mode mirrors slots. One accent (`--primary`); status colors semantic only.
  Type: Inter (sans) / JetBrains Mono (IDs, codes, raw values). Motion 150/220/300 ms,
  `prefers-reduced-motion` collapses it. **No raw hex/px/shadow in components.**

## Interaction

- **Row click** toggles inline detail (`aria-expanded`). The chevron stops propagation.
- **Keyboard:** real `<button>`/`<input>`; `ring-2 ring-ring ring-offset-2` focus.
- **Live feedback:** "N of M objects" counter uses `aria-live="polite"`.
- **Category switch** preserves entity-specific search, selection, and loaded local
  results when the workspace provides a session cache.
- **Refresh / Retrieve again** is an explicit domain action; navigation never triggers it.

## 9. Content & asset

- **Voice:** terse, factual. Names are the primary identifier; summaries give context
  ("Connected · 1,284 items · 3 levels").
- **Mono = machine values** (List IDs, codes, GL accounts); **sans = interface**.
- **Inactive objects** dim (`opacity-70`) but stay visible — admins need the full picture.

## 10. State model

| State | Entry | Must show | Primary CTA |
|---|---|---|---|
| `loading` | category select / refresh | skeleton table | — |
| `error` | fetch rejects | retry panel | Retry retrieval |
| `empty` | category has 0 objects | "none configured" | (informational) |
| `no-results` | filters match nothing | message | Clear filters |
| `ready` | objects retrieved | table | expand a row |
| `expanded` | row clicked | inline detail | collapse |

## 11. Visibility plan — deferred blocks

Each deferred block records why it's hidden, what reveals it, and its container
(`hidden_now_because` / `reveal_trigger` / `container`):

| Deferred block | hidden_now_because | reveal_trigger | container |
|---|---|---|---|
| Object field detail | Meaningless before an object is chosen | Row expand | Inline row panel |
| Contained items (list items) | Only relevant to the selected object | Row expand | Nested table in panel |
| Raw JSON dump | Rare debug need, noisy | "View raw JSON" | Modal |
| Connection/API settings | Security-sensitive, ~once | Gear icon | Modal / separate view |
| Change history | Not needed for daily browsing | (future) per-object | Inline panel tab |

## 12. Anti-patterns — do not reintroduce

- ❌ A KPI/stat-card row above the table (stacked UI).
- ❌ A separate detail *page* per object (detail is inline).
- ❌ Adding a category-specific routing branch to `App.tsx` instead of a registry renderer.
- ❌ Copying loading/error/empty, country lookup, virtual scrolling, or resize mechanics.
- ❌ Raw color/spacing values instead of tokens.
