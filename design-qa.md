# Report header typography and API details dialog

final result: passed

## Visual evidence

- Source visual truth: `C:/Users/HENRYGU/.codex/generated_images/01a0ed11-c83b-75d3-a6a5-599ff41987f3/exec-a134400c-c942-4e28-83ac-3c38e9616104.png`, with the user's later instruction to keep the existing result cards, reduce header-form text, and move API data to a separate dialog.
- Rendered desktop captures: `docs/superpowers/report-header-form-qa/compact-header-desktop.jpg`, `opened-report-header-desktop.jpg`, and `api-modal-desktop.jpg`; narrow API-dialog capture: `api-modal-narrow.jpg`.
- Source and desktop captures measure 1487 x 1058 pixels at a 1487 x 1058 CSS viewport, approximately 1x density. The narrow capture measures 600 x 800 pixels at a 600 x 800 CSS viewport. Source and current main-view images were opened in the same comparison input. The source's outer title/canvas and illustrative result rows are not app UI; the existing live result cards remain by user request.
- Full-view captures make the name/value rows, required marks, hidden-value fill, status badges, action buttons, and dialog sections readable. No focused crop was needed.

## Findings and fidelity

No actionable P0/P1/P2 visual findings remain.

- Typography: configured header field names and values now render at 12px on desktop and narrow viewports, matching the compact scale of adjacent report data. Section headings and modal titles retain their established hierarchy.
- Layout: both the selected-report detail pane and the opened-report header use the same form component and ordered field rows. Summary metrics and v3/v4 detail groups no longer extend below the form. They open through the shared `Modal` primitive as a separately scrollable API details window. The desktop and 600px dialogs remain within the viewport.
- Colors/tokens: dark navy navigation, blue selected state, red required marks, and muted hidden-value fill remain consistent with the selected concept and app tokens.
- Assets: no raster assets are needed; existing icon-library controls remain crisp.
- Copy/content: the real report's linked list values resolve to names; absent values show an em dash. The API dialog retains the former summary and named v3/v4 groups, with provenance marks.

## Verification and comparison history

- The earlier header design's larger desktop text was the user's typography finding. Reducing the field rows from responsive 12/14px to 12px throughout produced the final desktop capture.
- The earlier header placed API summary/sections below 36 configured fields. Moving those sections into the independent dialog removes that long duplicate tail; final desktop and narrow captures show the result.
- Browser interactions checked the selected report, opened-report header, API dialog from both entry points, closing back to the opened report, and linked values. Console errors/warnings: none.
- The 58 focused report/header tests passed, and the production build passed. The full suite had 517 passing tests and seven unrelated failures: two existing `Blob.stream` incompatibilities in image-download tests and five server snapshot timeout/temporary-directory cleanup failures. The 15 server snapshot tests passed when rerun separately.

## Implementation checklist

- [x] Use 12px field rows without changing result-card layout.
- [x] Put the former API data beneath a separate, scrollable dialog action.
- [x] Use the same configured header component in search details and opened reports.
- [x] Verify desktop and narrow browser states, focused tests, and production build.

## Follow-up polish

None required for this design change. QA screenshots remain in the repository's ignored working-notes directory.

---

# Report header display - option 1

final result: passed

## Visual evidence

- Source visual truth: `C:/Users/HENRYGU/.codex/generated_images/01a0ed11-c83b-75d3-a6a5-599ff41987f3/exec-a134400c-c942-4e28-83ac-3c38e9616104.png`.
- Rendered implementation: `http://127.0.0.1:6600/`, Expense Reports, one selected live report, Cost Center properties open.
- Desktop screenshots: `docs/superpowers/report-header-form-qa/desktop.jpg` (popup) and `desktop-main.jpg` (field list).
- Narrow screenshot: `docs/superpowers/report-header-form-qa/narrow.jpg` (600 x 800, popup open).
- The source and desktop screenshots are 1487 x 1058 pixels at a 1487 x 1058 CSS viewport and approximately 1x density. They were opened together in one comparison input. The source's outer concept title and canvas padding are excluded from app fidelity.
- The source uses illustrative reports and a compact result list. This implementation uses a real report and preserves the existing card-based result list at the user's request. A focused region crop was unnecessary: the form rows, link icon, required mark, hidden-field fill, and popup attributes are legible at full resolution.

## Findings and fidelity

No actionable P0/P1/P2 findings remain. The first narrow capture found a P2 popup clipping issue; the popup's top constraint now accounts for its full 70vh maximum height, and the second 600 x 800 capture shows the entire popup inside the viewport. The first desktop capture also showed a cramped right panel; changing the default split from 64% to 52% for the result pane widened the header while leaving the result cards intact. The final desktop capture verifies both changes.

- Typography: existing app type scale and font remain; form names are stronger than values, long names wrap, and the red required mark stays adjacent to the name.
- Layout: the configured form order is visible as compact two-column rows with an attribute control in each row. The right pane is scrollable, and the existing result cards remain unchanged. The desktop popup fits beside the field list; the narrow popup fits within the viewport.
- Colors: the far-left navigation is dark navy with blue active state; hidden values have muted gray backgrounds. Other surfaces reuse the existing card, border, muted, and primary tokens.
- Assets: no raster images were required. Attribute, link, and close controls use the app's existing Phosphor icon set.
- Copy/content: the real form returned 36 fields. Main rows show only configured names and resolved report values; other non-null field attributes appear in the popup. Some configured fields have no report value and show an em dash. The live Concur linked list-item response is a single-item array, and its display value is now shown rather than the identifier.

## Interaction verification

- Live report search loaded the selected report and its form definition. Linked Company, Business Unit, and Cost Center names resolved through the authenticated API path. The Cost Center attribute button opened a popup with all returned non-null attributes and dismissed with Close.
- Desktop and 600px views were checked. Browser console reported no errors or warnings after the final reload.
- After the final layout refinements, 78 focused tests and the production build passed; `git diff --check` found no whitespace errors.

## Implementation checklist

- [x] Keep the existing report result cards and use the selected option-1 header list in the detail pane.
- [x] Render values in form order with required and hidden indicators.
- [x] Resolve linked values and expose other attributes through a popup.
- [x] Apply dark navy navigation and verify desktop/narrow layouts.
- [x] Check real API data, browser console, tests, and build.

## Follow-up polish

None required. QA screenshots remain under the repository's ignored working-notes directory.

---

# Header form fields - option 2

final result: passed

## Visual evidence

- Source visual truth: `C:/Users/HENRYGU/.codex/generated_images/01a0ed11-c83b-75d3-a6a5-599ff41987f3/exec-43b8df8b-9592-4309-a2ac-7d92634e9df3.png`.
- Implementation: `http://localhost:6600/`, Expense Reports, Header form fields popup.
- Desktop screenshot: `docs/superpowers/form-fields-qa/desktop.jpg`.
- Narrow screenshot: `docs/superpowers/form-fields-qa/narrow.jpg`.
- Source and desktop capture: 1487 x 1058 pixels; desktop CSS viewport 1487 x 1058 at approximately 1x density. Narrow capture and CSS viewport: 600 x 800 at 1x. No density rescaling was needed.
- Compared source and implementation images together in one tool result. Both show the popup with the first field expanded. The reference has three illustrative fields; the live report has 36. Its larger modal height and scrolling content are expected adaptations to real data. Source canvas title/padding are not application UI.
- Full-view comparison confirms the centered white popup, dimmed report background, title/subtitle, search, comparison columns, expanded two-column attributes, and count footer. Text and attributes are readable in the full-resolution capture, so a separate region crop was unnecessary.

## Findings and fidelity

No actionable P0/P1/P2 visual findings remain.

- Typography: existing application fonts and weights retained; field names, identifiers and metadata have a clear hierarchy. Long metadata wraps. Raw identifiers use monospace.
- Spacing/layout: shared Modal and Input primitives; compact table rows, internal scrolling, sticky column headings, and persistent close/footer controls. At 600px, the dialog stays inside 16px margins and the 760px table scrolls horizontally within the dialog.
- Colors/tokens: existing card, border, muted and primary tokens; subtle selected-row tint and visible keyboard focus ring.
- Assets: the design needs no raster assets. Disclosure uses the existing Phosphor icon dependency; the close icon comes from the shared Modal.
- Copy/content: corrected the generated mock's duplicated/misaligned headings. Field ID appears below the field name to keep related data together. All remaining non-null attributes appear in disclosure rows; false, zero, empty strings and structured values remain inspectable.

## Verification and history

- The first live request exposed an invalid v3 policy ID being passed to the v4 endpoint. Removed the optional policy override so Concur selects the report's own policy. Subsequent live retrieval returned 36 fields; the desktop screenshot records the successful result.
- Live search reduced the table from 36 to 1 field; clearing it restored all rows. Keyboard disclosure collapsed and reopened the first field.
- Automated tests cover loading, sorting, non-null attributes, searching, empty/error/retry, cancellation, entity/report changes, and Escape dismissal. All 65 focused API/modal/report-view tests passed.
- Production build passed. Existing large bundle warning remains.
- Browser console checked: only an earlier Vite websocket connection warning was recorded; no feature runtime errors were observed. A reload restored the stale app before verification.
- No visual correction iteration was needed after the first source/implementation comparison.

## Implementation checklist

- [x] Use the existing authenticated, entity-bound and logged proxy.
- [x] Open from both report detail locations using the report ID required by Reports v4.
- [x] Search, expand, retry and dismiss the popup.
- [x] Verify live data, desktop and narrow layout.
- [x] Run focused tests and production build.

## Follow-up polish

None required. QA screenshots remain in the repository's ignored working-notes directory.

---

# Lists refinement — 2026-10-18

## Source and scope

- Primary source visual: `/Users/henrygu/.codex/generated_images/01a08060-4528-7840-ae44-909f378429ac/exec-66c8af98-9ffb-4a18-aa82-36d91ef420ec.png`.
- Details source visual: `/Users/henrygu/.codex/generated_images/01a08060-4528-7840-ae44-909f378429ac/exec-ad18a7b8-5321-4fdc-914e-c41d5da51062.png`.
- Latest user amendments override the mock: remove every version switch, prefer v4 with a v3-only fallback, and search both versions' list and item IDs.
- Existing production repository and API behavior retained; no prototype scaffold, external assets, or new routes.

## Evidence

- Implementation: `http://127.0.0.1:5566/`.
- Desktop screenshot: `/tmp/concur-lists-final-desktop.png`.
- Details screenshot: `/tmp/concur-lists-final-details.png`.
- Mobile scroll/close screenshot: `/tmp/concur-lists-final-mobile-details.png`.
- Combined source-left / implementation-right comparison: `/tmp/concur-lists-compare-desktop.png` and `/tmp/concur-lists-compare-details.png`.
- Source and implementation desktop images: 1487 × 1058 pixels; CSS viewport 1487 × 1058, device scale factor 1. No density normalization required. Comparison canvases contain both images at native size, side by side.
- Narrow viewport: 390 × 844 CSS pixels, device scale factor 1.
- Browser: Playwright Chromium, explicitly approved by the user because the Product Design Browser integration is unavailable.
- Fixtures contain seven v4 lists, a name-matched v3 record and one v3-only list. OAuth and local endpoints were intercepted. No live Concur retrieval was performed.
- Full-frame comparisons and separate native-size Details images were inspected; the modal and tree columns were readable without an additional crop.

## Comparison history and findings

1. Initial comparison: Details width and row anatomy drifted from the source (P2). Reduced the modal from max-w-4xl to max-w-3xl, introduced one shared Name field, increased title/body readability and preserved the scrollable body with fixed close controls. Recaptured both states and compared again.
2. Initial comparison: tree values lacked aligned Name / Code / ID headings (P2). Added shared fixed-width grid columns for both tree renderers, retained constant-height virtual rows and horizontal access. Verified root/child rendering tests and the v3-only browser path.
3. Toolbar Search placement and narrow filter clipping (P2) were corrected: the explicit Search action follows the filters on desktop, the field selector accommodates ID-search options, and narrow screens stack controls instead of shrinking labels.
4. Final comparison: no actionable P0/P1/P2 findings remain within the amended scope.

## Required fidelity surfaces

- Typography: existing sans-serif UI and monospaced identifier tokens retained; 14px list names and metadata, clear column labels and a 24px modal title. Long IDs wrap in Details rather than disappear.
- Spacing/layout: compact two-line toolbar, table-first structure, inline item tree, icon-only refresh, selected-row blue edge, dual-source modal sections and persistent header/footer close controls follow the selected layout.
- Colors/tokens: existing semantic white/cool-gray surfaces, primary enterprise blue, border and muted tokens retained; no independent theme or decorative gradients.
- Assets/icons: this surface needs no raster assets. Existing product navigation and UI icons remain code-native; no screenshot is shipped as interactive UI. V3 tree disclosure uses the installed icon family.
- Copy/content: changed description and added List ID / Item ID options are explicit consequences of the user's amendments. No global or row-level source switches remain. Missing metadata is shown as unavailable rather than invented.
- Responsive behavior: table/tree content remains horizontally accessible; Details stacks its source sections on narrow screens and scrolls without losing either close control.

## Functional checks

- One row per same-name list; v4 preferred; v3-only lists visibly marked.
- Refresh has an accessible name and tooltip but no visible text label.
- Details includes both real source IDs and source-specific metadata; missing versions have an explicit empty state.
- A v3 List ID finds the grouped v4-preferred list.
- V3 and v4 Item ID searches retain the preferred source and identify the matching version in result context.
- Search uses only saved local snapshots; clearing the query restores all lists.
- Old asynchronous search results are ignored after cancellation or unmount.
- Browser page identity, nonblank content and primary interactions passed; no runtime console errors or Vite overlay were observed.
- Full suite: 66 files, 557 tests passed. Production build passed with the pre-existing large-bundle warning.

## Intentional deviations and remaining risk

- Live metadata and fixture counts differ from the illustrative generated mock; categories are actual schema values, missing values remain missing, and alphabetic quick-jump and pagination are preserved existing features.
- The user explicitly removed the mock's version switches and added ID search. The source chip is only shown for a v3-only fallback.
- Existing level badges, token typography and the shared Modal primitive are retained instead of reproducing every rasterized pixel.
- Backend requests were covered by unit tests; live Concur data and authenticated upstream retrieval were not exercised by browser QA.
- No new dependency, repository push, or deployment was performed.

final result: passed


# Lists — Option 2 implementation — 2026-10-19

This section supersedes the earlier full-width table/modal design above.

### Source and evidence

- Selected visual truth: `/Users/henrygu/.codex/generated_images/01a08060-4528-7840-ae44-909f378429ac/exec-c05bab4c-2266-4344-9a9d-e263bfb47eb6.png` (second displayed option).
- Browser plugin not available. Regular Playwright was explicitly authorized by the user earlier in this task.
- URL: `http://127.0.0.1:5566/`; title: `Concur Admin — Sync Console`.
- Desktop implementation: `/tmp/concur-workspace-desktop.png`.
- Full-view combined comparison: `/tmp/concur-workspace-comparison.png` (source left, implementation right).
- Focused combined comparison: `/tmp/concur-workspace-focus.png` (source workspace crop left, actual selected-item detail right). Different vertical crop origins are intentional to compare legible field typography, labels, values and disclosures.
- Full selected-item capture: `/tmp/concur-workspace-item-details.png`.
- Mobile implementation: `/tmp/concur-workspace-mobile.png`.
- Source and desktop implementation: 1487 × 1058 pixels, CSS viewport 1487 × 1058, deviceScaleFactor 1. Full comparison: 2974 × 1058. Mobile: 390 × 844, deviceScaleFactor 1. No image-density resampling.
- State: Cost centers selected, both item sources present, v3 Operations selected, actual resource-response fields shown, technical disclosures collapsed. Fixture IDs/extra fields differ from the illustrative mock; no missing API data is invented.

### Findings and iteration history

- [P2, fixed] The initial toolbar and full-width alphabet strip pushed the selected-item region too far down. Search/retrieve controls now share a desktop row, alphabet navigation belongs to the left pane, and technical list data was moved below the task content. Post-fix full comparison was captured and inspected.
- [P2, fixed] Long IDs wrapped onto a near-empty second line in the narrow result table. The table now has fixed tracks and a truncated identifier preview with a full-value tooltip; the complete ID remains available in the workspace metadata. Latest desktop screenshot confirms compact, aligned rows.
- No remaining actionable P0/P1/P2 visual findings. Expanded production fields can extend below the first viewport; normal page scrolling exposes all fields and the close control stays in its own header.

### Required fidelity surfaces

- Typography: existing sans UI and monospace identifier tokens retained. Heading hierarchy, compact labels and wrapped full detail values are readable in the focused comparison. No font/dependency change required.
- Spacing/layout: approximately 30/70 master/detail composition, resizable separator, metadata comparison, simultaneous version trees and inline selected-item detail follow option 2. Mobile stacks sections with no document-level horizontal overflow.
- Colors/tokens: existing primary blue, neutral table surfaces, semantic errors and selected-row tints reused. No independent palette introduced.
- Assets/icons: no raster assets are required by this data interface. Installed Phosphor refresh/close icons are used in the new workspace; existing app shell and tree primitives are preserved.
- Copy/content: version provenance is explicit, missing data is not fabricated, v3 URLs are dereferenced and their returned fields rendered. URLs/raw JSON remain in collapsed technical disclosures.
- Intentional production differences: pagination, alphabet navigation, lazy-tree expand/collapse controls and loaded-data search guidance remain available. Tree depth is conveyed by hierarchy and full selected-item fields instead of an additional always-visible level column. Complete payload fields, rather than the mock's illustrative fixed subset, determine the detail height.

### Functional verification

- App identity, meaningful content, no framework overlay and console health passed (zero captured runtime/console errors).
- List selection opens the adjacent workspace; both versions appear without version switches.
- Actual v3 list and item resource URLs are requested through the existing entity-scoped authenticated proxy, not directly from the browser to arbitrary destinations.
- Browser fixture includes an extra field returned only by the item detail API; it appears after selecting v3 Operations. Selecting a v4 item removes the previous v3 detail content.
- Shared item filter updates both trees. List-ID search finds the grouped List by its v3 ID.
- Automated tests cover URL validation, entity/signal forwarding, retry, cached fallback, stale response cancellation, unknown/nested/falsy fields, independent version selection, partial ID matching and deep ancestor visibility.
- Bulk v3 retrieval uses v3 IDs rather than matched v4 IDs, and completed bulk retrieval remounts the item workspace to read the updated snapshots.
- Full suite: 68 files, 573 tests passed. Production build passed; existing large-chunk warning remains.
- Real authenticated Concur responses, upstream performance, and exhaustive browser/device coverage were not tested. Browser QA uses intercepted fixture responses and does not modify real snapshots.

### Implementation checklist

- [x] Integrate option 2 using existing category framework and resizable/virtualized primitives.
- [x] Show both source configurations and item trees; dereference selected v3 resources.
- [x] Exercise desktop and mobile interactions, inspect combined source/rendered evidence, and fix identified layout issues.
- [x] Run tests and production build. No push, PR, dependency installation or deployment performed.

final result: passed
