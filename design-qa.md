**Comparison target**

- Source visual truth: `/Users/henrygu/.codex/generated_images/019ff321-c5d1-7501-a785-224dd6d88e97/exec-02f45d56-426f-4e41-8eae-60231bae7bda.png`.
- Final implementation screenshot: `/tmp/concur-users-option3-implementation-final.png`.
- Combined comparison evidence: `/tmp/concur-users-option3-comparison-final.png`.
- Viewport/state: 1440 × 1024 CSS pixels, device scale factor 1, Identity → All Active Users, local snapshot loaded, first profile preview selected.
- Source pixels: 1487 × 1058. It was proportionally normalized and padded to 1440 × 1024 for comparison. Implementation pixels: 1440 × 1024.

**Full-view comparison evidence**

- The implementation preserves the selected option’s dual-mode task switch, compact retrieval/export/search toolbar, dense sortable table, adjustable result/detail split, and persistent entity/sidebar shell.
- The final result uses the existing product’s collapsible Identity and Enterprise detail sections instead of introducing the mock’s separate detail-tab system. This is an intentional design-system alignment.
- The mock includes selection checkboxes and a generic Filters button. They are intentionally omitted because the requested workflow is read-only browsing/export and no bulk action or additional filter model was specified.

**Focused region comparison evidence**

- Toolbar: retrieval, CSV export, saved-profile count/timestamp, and snapshot search fit on one line at the target viewport after the second iteration.
- Table: headers remain readable, sorting affordances are visible, rows use the product’s established density, and every column has an accessible resize separator.
- Detail: the selected snapshot row is clearly highlighted; the right pane shows the saved Identity and Enterprise fields immediately, then retrieves the existing full Identity and Spend detail when a row is opened.
- Retrieval progress enhancement: `/tmp/concur-users-progress-final.png` at 1280 × 720 verifies the completed state. The same component uses the primary-blue running state with live percentage, page, start index, retrieved count, total count, and request batch size.
- Large-snapshot optimization: `/tmp/concur-users-optimized-final.png` at 1280 × 720 verifies the real 100,598-user local snapshot. Only 23 virtual table rows were present in the rendered DOM while the toolbar displayed the complete local user count.

**Iteration history**

1. Initial comparison found two P2 differences: the saved-profile metadata occupied a separate toolbar row, and the detail pane was blank until a live profile request completed.
2. Fixed the toolbar hierarchy by shortening the timestamp/count treatment and placing search on the same row. Added an immediate snapshot preview using the existing collapsible detail pattern and auto-selected the first saved row.
3. Final comparison confirmed the toolbar, selected-row state, table/detail proportions, typography, spacing, colors, copy, and internal scrolling no longer have actionable P0/P1/P2 drift.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing application type family, weights, compact table text, uppercase section labels, truncation, and hierarchy are consistent with both the source and repository design system.
- Spacing and layout rhythm: passed. Toolbar, table header, row density, pane divider, borders, radii, and full-height internal scrolling align with the selected direction.
- Colors and visual tokens: passed. Existing primary blue, muted surfaces, semantic borders, selected-row tint, and section tones are reused without parallel styling.
- Image quality and asset fidelity: passed. The target is a data workspace with no required product imagery; no source logo or non-standard image asset was replaced.
- Copy and content: passed. Labels clearly distinguish exact user search from the active-profile snapshot workflow and explain local persistence.

**Interaction verification**

- Browser-rendered checks passed in the user-selected in-app browser: switched to All Active Users, loaded the entity snapshot, verified the progress presentation, filtered to one row, reversed name sorting, resized the Name column from 190 to 206 pixels, resized the result/detail split from 60% to 62%, and confirmed zero console errors.
- Automated verification: 29 test files and 251 tests passed after the pagination, virtualization, 1000ms search debounce, restart-summary, and 100,000-user scale enhancements.
- `npm run build` passed.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: a future bulk-action workflow could justify selection checkboxes and richer structured filters, but those controls should not be introduced without a concrete action model.

**Implementation checklist**

1. Completed: cursor-paginated retrieval of all active Identity profiles.
2. Completed: atomic, entity-scoped JSON snapshot persistence under the project data directory.
3. Completed: dual-mode Users UI, local filtering, sortable and resizable columns, independently scrolling table/detail panes, and resizable split.
4. Completed: CSV export and immediate snapshot detail preview with existing full Identity/Spend drill-through preserved.
5. Completed: server-side local paging/sorting/filtering, 200-row incremental loading, virtualized rendering, streamed CSV generation, and restart-safe summary metadata.

final result: passed

---

# Unified User Profiles and Spend Profiles design QA

**Comparison target**

- Source visual truth: `/Users/henrygu/.codex/generated_images/019ff321-c5d1-7501-a785-224dd6d88e97/exec-f19cf49a-2c00-43ef-b967-0cd9897c7ce0.png`.
- Final User Profiles screenshot: `/Users/henrygu/.codex/visualizations/2026/08/11/019ff321-c5d1-7501-a785-224dd6d88e97/user-profiles-final.png`.
- Final Spend Profiles screenshot: `/Users/henrygu/.codex/visualizations/2026/08/11/019ff321-c5d1-7501-a785-224dd6d88e97/spend-profiles-final.png`.
- Combined comparison evidence: `/Users/henrygu/.codex/visualizations/2026/08/11/019ff321-c5d1-7501-a785-224dd6d88e97/users-comparison.png`.
- Viewport/state: 1280 × 720 CSS pixels, US UAT, 100,598 local User Profiles and 100,592 local Spend Profiles. User Profiles used `Employee ID starts with 086`; Spend Profiles used its default hide-orphans state.

**Comparison and implementation checks**

1. The shared Column Explorer hierarchy is preserved across User Profiles and Spend Profiles: compact retrieval toolbar, nested filter builder, expression summary, progress strip, field-group controls, virtualized table, and a resizable local-detail pane.
2. Login ID and Employee ID remain required and visible. UUID is available in Manage Columns but hidden by default. Identity, Enterprise/Spend User, and Custom Data groups can be shown or hidden without weakening required-column rules.
3. The real saved datasets validated large-list behavior rather than fixture-only behavior. User Profiles reduced 100,598 records to 2,172 matches after the one-second debounce. Spend Profiles displayed 200 loaded rows out of 100,452 matching records while rendering only 23 virtual table rows.
4. Completed retrieval progress is now authoritative: both saved snapshots display 100%, and the Spend Profiles completion state reports 100,592 of 100,592 profiles.
5. Find One and both local workspaces use the same resizable list/detail pattern. Result rows are fully clickable; local Identity and Spend snapshots are used first, with live APIs reserved for users absent from local data.

**Required fidelity surfaces**

- Typography, spacing, colors, borders, row density, and collapsible detail sections pass against the selected direction and the repository design system.
- Filter and column controls remain compact enough for the 1280-pixel enterprise workspace while the table retains horizontal scrolling for wide schemas.
- No new imagery was required; the existing application iconography and semantic color tokens remain intact.
- Browser verification found zero console errors after loading and filtering both real 100,000-record snapshots.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: on substantially narrower screens, field-group controls could move into the Manage Columns popover to give the table a little more horizontal room.

final result: passed

---

# Spend Profiles design QA

**Comparison target**

- Source visual truth: `/Users/henrygu/.codex/generated_images/019ff321-c5d1-7501-a785-224dd6d88e97/exec-f19cf49a-2c00-43ef-b967-0cd9897c7ce0.png`.
- Final implementation screenshot: `/tmp/concur-spend-profiles-implementation-final.jpg`.
- Combined side-by-side evidence: `/tmp/concur-spend-profiles-design-comparison.png`.
- Viewport/state: 1440 × 1024 CSS pixels, Identity → Spend Profiles, complete local fixture, exact nested filter `Country = PT AND (custom19 = 1344 OR custom19 = 0913)`, first matching row selected.
- Source pixels: 1487 × 1058, proportionally normalized and padded to 1440 × 1024. Implementation pixels: 1440 × 1024.

**Comparison and iteration history**

1. The first implementation pass preserved the selected Column Explorer direction but opened Identity and Spend detail sections by default and reported only nested groups.
2. The final pass matches the source hierarchy more closely: Identity, Enterprise, and Spend sections start collapsed; Custom Data starts expanded; the expression summary reports three conditions and two groups, including the root group.
3. The existing product shell and page title were intentionally retained instead of adding a parallel breadcrumb treatment. This follows the repository design system while preserving the source workspace layout, filter hierarchy, column explorer, table, and local detail pane.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing application type tokens, compact data-table sizing, uppercase group labels, and detail hierarchy remain consistent and readable.
- Spacing and layout: passed. Retrieval actions, filter builder, expression preview, progress strip, field-group summary, table, and resizable detail pane preserve the selected direction's order and density.
- Colors and tokens: passed. Existing primary blue and muted tokens are reused, with green snapshot progress and restrained section tones matching the target intent.
- Shape and surfaces: passed. Borders, radii, dividers, sticky headers, and selected-row treatment use existing UI primitives rather than a parallel card system.
- Image and icon fidelity: passed. This is a data workspace with no required imagery. Existing application icons remain intact and no fake asset substitutes were introduced.
- Copy and content: passed. Labels explain local persistence, required columns, match semantics, and local-only detail behavior.

**Interaction and accessibility verification**

- Browser checks passed in the user-selected in-app browser: nested AND/OR groups are editable; the exact expression is visible with parentheses; one-second debounce returns 40 matches; row selection opens only local snapshots; Identity and Spend sections are collapsed while Custom Data is expanded.
- Manage Columns exposes all discovered fields. ID, Login ID, and Employee ID controls are disabled so required identity columns cannot be hidden.
- Sort controls, column resize separators, the result/detail resize separator, independent table scrolling, filter labels, progress semantics, and collapsible detail controls are keyboard-addressable.
- Tablet (1024 × 768) and narrow (768 × 900) checks retained the filter, table, and detail landmarks with zero console warnings or errors. At narrow width the enterprise desktop shell intentionally prioritizes the table and horizontal scrolling rather than transforming into a mobile card list.
- Automated verification: 32 test files and 261 tests passed. `npm run build` passed; only the repository's existing Vite chunk-size warning remains.

**Findings**

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: if this administrator tool later requires phone support, the sidebar and multi-column condition rows should receive a dedicated compact breakpoint instead of relying on horizontal workspace scrolling.

final result: passed
