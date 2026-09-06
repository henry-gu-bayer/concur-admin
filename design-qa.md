# Expense Reports redesign — design QA

## Evidence

- Source visual truth:
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-13b7e761-23c1-4117-a2f9-96eaf5f9055d.png` — report cards
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-8281e390-a67e-4346-835a-4aedcea0973a.png` — report workspace and entries
  - `/var/folders/x7/n7nnpxsx32qg835nqm98v_n00000gn/T/codex-clipboard-c916f2f2-f568-4987-bbec-03edd5d55278.png` — entry detail and receipt
- Browser-rendered implementation:
  - `/tmp/concur-admin-expense-qa/report-cards.png`
  - `/tmp/concur-admin-expense-qa/entry-workspace.png`
  - `/tmp/concur-admin-expense-qa/report-header.png`
  - `/tmp/concur-admin-expense-qa/entry-workspace-1024.png`
- Combined comparisons:
  - `/tmp/concur-admin-expense-qa/cards-comparison.png`
  - `/tmp/concur-admin-expense-qa/workspace-comparison.png`
  - `/tmp/concur-admin-expense-qa/entry-comparison.png`
- Viewport: 1800 × 900 CSS px at device scale factor 1 for the primary captures; 1024 × 768 CSS px for the responsive check.
- Source pixels: 2246 × 844, 2692 × 894, and 3448 × 2086. Implementation pixels: 1800 × 900. For combined comparison, the source was proportionally normalized to the 1544 px application-content width and the implementation was cropped to the same content width; each comparison board is 3088 × 900.
- State: light theme; live report result cards, one opened report with its complete entry list, one selected entry with an inline exception and empty receipt state, and the report-header modal.

## Full-view comparison evidence

- The report cards preserve the Concur reference hierarchy: report name and date, dominant currency amount, status chips, and a colored state rail. The implementation intentionally keeps the existing application's smaller type scale, tokenized blue palette, master-detail frame, and compact density.
- The opened report follows the reference's progressive disclosure: persistent report identity and status, report-level actions, all entries in a left list, selected-entry content in the main detail area, and a dedicated receipt pane on the right.
- At 1024 px the entry list and entry detail stack without clipping persistent actions; the page remains scrollable and the selected row remains visible.

## Focused region comparison evidence

- Report actions: `Report header`, `Comments`, `Exceptions`, and `Associated requests` remain visible at header level; unavailable data is represented by a disabled state rather than removing the entry point.
- Entry signals: exception and comment bodies render inline before the field groups, while the existing modal actions remain available for longer content and metadata.
- Receipt: the right-hand pane preserves the same spatial role as the reference receipt viewer. When the APIs provide only metadata or no image, the pane presents an explicit, honest empty state and keeps receipt IDs/certification visible when available.
- Header details: the modal uses the existing field-width control and collapsible sections, so the new flow remains consistent with User and Spend profile detail conventions.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the implementation uses the product's established sans-serif scale and weights; hierarchy and truncation remain readable at both tested widths.
- Spacing and layout rhythm: card gutters, action bars, table rows, detail sections, and pane proportions are internally consistent. The denser rhythm is an intentional adaptation to this admin browser rather than a literal enlargement to the Concur source scale.
- Colors and visual tokens: all surfaces and semantic states use existing application tokens; the blue, green, amber, and destructive treatments preserve the source's meaning without introducing a parallel palette.
- Image quality and asset fidelity: the implementation does not fabricate a receipt asset. The reserved receipt viewport clearly reports whether image metadata is available.
- Copy and content: labels align with the requested tasks and distinguish report-header information from entry-level content.

## Comparison history

- Pass 1: the three normalized comparison boards showed no P0/P1/P2 issue. No visual-fix iteration was required after the comparison.

## Primary interactions tested

- Search by a non-identifying report status filter.
- Select and open a report card.
- Load and select an expense entry.
- Read inline entry exception content.
- Open report header details from the report-level action bar.
- Verify the 1024 px stacked layout.
- Browser console checked with zero errors.

## Implementation checklist

- [x] Report cards and sorting
- [x] Direct report-open action
- [x] Persistent report-level action bar
- [x] Entry list and selected-row treatment
- [x] Inline entry comments and exceptions
- [x] Receipt viewport and metadata state
- [x] Responsive check
- [x] Automated test and production build verification

final result: passed
