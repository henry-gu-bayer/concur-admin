# Journey Map — Inspect a Concur configuration object

**Persona / actor:** Anna, Concur functional administrator. She configures and supports
the Bayer Concur instance and answers questions like *"which cost centers are in that
list?"* and *"is this expense type still active?"* many times a day.

**Scenario / goal:** A colleague asks Anna: *"The Cost Center list — is the deactivated
Leverkusen R&D center really in there, and is the list still syncing?"* Her job to be
done: **find the list, confirm its contents and status, in under a minute, without
digging through Concur's admin menus.**

## The flow

| Step | Phase | User action | System feedback | Touchpoint | Thinking | Feeling | Pain point | Opportunity |
|---|---|---|---|---|---|---|---|---|
| 1 | Orient | Opens the tool; sees the category sidebar grouped by area | "Lists" is pre-selected; its table loads with a short skeleton | Sidebar + main stage | "Where do config objects live?" | Oriented | Concur's native admin buries lists under Setup → List Management → Import | All config categories visible at once, grouped logically |
| 2 | Locate | Scans the Lists table; "Cost Centers" is the top active row | Row shows type, item count, level count, Active badge, last-updated | Table row | "That's the one" | Confident | Used to open each list to see its size/level | Key facts are columns, visible without opening |
| 3 | Inspect | Clicks the "Cost Centers" row | Inline panel expands under the row with field grid + contained items | Inline row expansion | "Confirm the sync source and the items" | Focused | Native UI opens a new page, losing the list of lists | Detail is inline; the table stays put |
| 4 | Confirm | Reads the field grid ("Source: SAP Controlling, nightly") and scans the Contained items table | Sees `EMEA-1000-CC10417 … Inactive` in the nested items | Detail panel | "Yes — it's there, and it's flagged inactive" | Certainty | Had to export the list to Excel to check one item | Items visible in place, first column monospaced as machine code |
| 5 | Answer | Collapses the row; reports back | Row collapses; table state unchanged | Table row | "Done — list is healthy, item is deactivated as expected" | Done | — | One visit, zero page loads, answer in seconds |

## What this map locks in

- **One primary task** — locate + inspect a config object — owns the main stage
  end-to-end. Steps 2–5 never leave the table's context.
- **Inline expansion, not detail pages**, because the pain point at step 3 is exactly
  "losing my place in the list."
- **Columns carry the at-a-glance facts** (type, count, levels, status, updated) so step 2
  answers "is this the right object" without opening it.
- **Nested items render in place** (step 4) — the reason a separate "list items" screen
  would be wrong.

## Wireflow (screen skeleton per step)

```
[1] Sidebar + Lists table (skeleton → rows)
[2] Same table, key facts as columns
[3] Row expands: field grid inline
[4] Same panel: Contained items nested table
[5] Row collapses back to the table
```

All five skeletons are the **same screen**; only the row-expansion changes.

## Framework note — how features grow

This journey covers the **Lists** reference implementation. Every other category
(Expense Groups, Policies, Expense Types, Payment Types, …) follows the **identical
journey**, because the framework renders them from the same descriptor + table +
detail panel. Adding a feature does not create a new flow — it reuses this one.
