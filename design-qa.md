# Expense Reports cards, entry table, and receipt preview — design QA

## Evidence

- Source visual truth:
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-13b7e761-23c1-4117-a2f9-96eaf5f9055d.png` — Concur report cards and information hierarchy.
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-8281e390-a67e-4346-835a-4aedcea0973a.png` — report header and entry list.
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-c916f2f2-f568-4987-bbec-03edd5d55278.png` — selected entry and receipt viewer.
- Browser-rendered implementation:
  - `/tmp/concur-admin-expense-qa-v2/report-cards.png`
  - `/tmp/concur-admin-expense-qa-v2/entry-workspace.png`
- Combined comparisons inspected:
  - `/tmp/concur-admin-expense-qa-v2/cards-comparison.png`
  - `/tmp/concur-admin-expense-qa-v2/entry-comparison.png`
- Viewport: 1280 × 720 CSS px at device scale factor 1.
- Source pixels: 2246 × 844 and 3448 × 2086. Implementation pixels: 1280 × 720. Sources were proportionally normalized to 720 px height before horizontal comparison; comparison boards are 3196 × 720 and 2470 × 720.
- State: light theme; live report results filtered by approval status and receipt availability, selected report, complete live entry list, selected entry, report-level actions, and receipt empty state.

## Full-view comparison evidence

- Report cards retain the reference hierarchy of name, dates, total, owner, approval, payment, and actions. The source's colored left rail was intentionally removed per the design brief. State now lives in semantic badges, while selection uses the application's border/background tokens.
- The implementation uses flatter neutral surfaces, smaller radii, no hover lift, and no decorative shadows. This is consistent with the application's enterprise admin patterns and avoids assigning decorative color to the whole card.
- The opened-report structure remains faithful to the reference: persistent report header/actions, a dense entry table, selected-entry details, and a dedicated receipt pane.

## Focused region comparison evidence

- Cards: approval/payment values no longer clip in the two-column card grid; each is presented as a labeled full-width row. Exception remains a single amber semantic badge instead of an orange structural border.
- Entry list: every column has a visible-on-hover resize affordance plus a keyboard-accessible separator. The table keeps a stable fixed layout and horizontal scrolling when adjusted beyond the pane width.
- Signals: exception, comments, and receipt use Phosphor interface icons with semantic colors, native tooltips, and accessible names. Personal remains text because it is a classification rather than an activity signal.
- Entry detail: the field-label default was reduced and the detail/receipt split rebalanced after the first capture showed character-by-character wrapping.
- Receipt: the pane embeds the PDF returned through Image v1 and keeps explicit loading, unavailable, and no-image states. The live supplied Entry ID was verified to return an `application/pdf` response with a valid PDF signature; the browser capture uses a no-image entry, while PDF rendering is covered by the component test.

## Required fidelity surfaces

- Fonts and typography: existing application font, weights, tabular amounts, and compact enterprise scale are preserved. Long entry values wrap without collapsing the layout.
- Spacing and layout rhythm: neutral one-pixel card borders, compact 16 px card padding, structured status rows, and restrained action footers match the surrounding admin workspaces.
- Colors and visual tokens: only existing semantic tokens are used. Approval/payment/exception meaning remains color-coded locally; no full-height decorative status rail remains.
- Image quality and asset fidelity: Phosphor's production icon components are used for signals. Receipt PDFs are shown from the real API response rather than a fabricated asset or placeholder illustration.
- Copy and content: labels distinguish report header data, entry signals, and receipt states; action names remain terse and task-oriented.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: at a 1280 px viewport, long machine IDs still wrap in the narrow detail pane. This is acceptable because they remain readable and the outer list/detail divider can be resized.

## Comparison history

- Pass 1 finding (P2): the selected entry detail allocated too much width to field labels, causing ordinary values to wrap one character per line beside the receipt pane.
- Fix: changed the default field-label width from 188 px to 144 px and rebalanced the detail/receipt grid from 1.2/0.8 with a 260 px receipt minimum to 1.3/0.7 with a 220 px receipt minimum.
- Pass 2 evidence: `/tmp/concur-admin-expense-qa-v2/entry-workspace.png` shows normal word wrapping and a preserved receipt region. No P0/P1/P2 issue remains.

## Primary interactions tested

- Search reports using non-identifying approval and image filters.
- Select and open a report card.
- Retrieve and select report entries.
- Resize the Date column by keyboard; all six columns expose resize separators.
- Verify icon-only signal semantics through accessible names.
- Resolve the supplied Entries v3 ID through Image v1, download the signed receipt URL through the restricted proxy, and validate the PDF signature.
- Browser console checked with zero errors.

## Implementation checklist

- [x] Neutral enterprise report cards without colored left borders
- [x] Semantic report status and exception treatment
- [x] Resizable Entry table columns
- [x] Accessible icon-only exception/comment/image signals
- [x] Image v1 metadata lookup by Entries v3 ID
- [x] Restricted, entity-aware receipt PDF proxy
- [x] Embedded receipt PDF plus loading/error/empty states
- [x] Signed receipt URL masking in API logs
- [x] Automated tests, production build, live API check, and browser QA

final result: passed

---

# Collapsible Navigation — design QA addendum

## Evidence

- Source visual truth: `/Users/henrygu/.codex/generated_images/01a08060-4528-7840-ae44-909f378429ac/exec-f7e630fd-c5bb-466f-b207-80b83a4c12e6.png` (selected Product Design direction).
- Browser-rendered implementation: Codex in-app preview at `http://127.0.0.1:5566/`, inspected in both expanded and 64 px compact-navigation states.
- Viewport: Codex in-app browser, approximately 768 CSS px wide. The source direction was generated at 1440 × 1024; this addendum evaluates the navigation interaction and compact layout rather than table-density fidelity.
- State: compact icon rail, expanded grouped categories, and Identity selected from the compact rail.

## Focused comparison evidence

- The compact state retains the app mark, category icons, blue selected-item treatment, API Logs utility, and a clearly labeled expand control.
- The expanded state restores the product's existing grouped category labels and exposes a Collapse navigation control.
- Category buttons retain accessible names in the compact state and selecting Identity from the rail updates the main-stage workspace.

## Required fidelity surfaces

- Fonts and typography: existing Inter-based compact navigation type is preserved; visually hidden labels remain available to assistive technology.
- Spacing and layout rhythm: the sidebar transitions from 256 px to 64 px over 200 ms, creating additional main-stage space while retaining comfortably sized icon targets.
- Colors and visual tokens: the existing primary blue active state, muted inactive icon treatment, and card/border tokens are reused.
- Image quality and asset fidelity: no raster imagery is required. Existing category icons are retained and the caret uses the installed Phosphor icon set.
- Copy and content: category labels and API Logs remain unchanged; the new controls are named “Collapse navigation” and “Expand navigation”.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested collapsible navigation behavior.
- P3: the selected direction depicts a persistent narrow rail plus a secondary drawer; this implementation intentionally uses a single sidebar that transitions between the two widths so it preserves the project's existing grouped navigation without permanently taking additional width.

## Primary interactions tested

- Collapse navigation into the compact icon rail.
- Select Identity from the compact rail and confirm the Identity workspace renders.
- Expand navigation and confirm group headings and category labels return.

final result: passed
