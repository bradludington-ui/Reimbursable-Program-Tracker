# The regression suite

```
node test/run.js              everything
node test/run.js allocate     only tests whose group or name matches
node test/run.js --list       names only, run nothing
npm test                      the same as the first
```

No install, no dependencies, no build. Node 18 or newer.

## How it runs the real code

`03_core.js` and `04_model.js` are the two chunks of the app that hold no DOM
reference at load time. `test/extract.js` finds them by their banner comments
inside `Reimbursables_Program_Tracker.html` and hands back the source between
them; `test/harness.js` runs that source in a `vm` context with **no `document`
and no `window` at all**.

Two things follow from that. The suite tests the code that actually ships
rather than a copy that drifts — edit the HTML and the next run picks it up.
And the DOM-free promise those two chunks open with is enforced: a stray
top-level `document` reference fails the first test rather than waiting to
surprise whoever next tries to test the model.

`RPT_APP=/path/to/other.html node test/run.js` points the suite at a different
build.

## The frozen clock

`RPT.fyMonthNow()` reads the wall clock, and it decides which months
`bidByMonth` marks `future`, which decides the month `upfrontEffort` reports
its position as of. Left alone, a suite asserting a BID D figure would pass all
year and fail in October.

Every `load()` therefore gets a `Date` pinned to a stated instant — **15 May
2026**, fiscal month 8 of 12, so the "as of" paths are genuinely exercised. A
test wanting a closed year asks for one: `load({ now: '2027-06-01T12:00:00Z' })`.

Each `load()` also builds its own context, so `RPT.state` in one test can never
leak into the next.

## What is covered

| File | What it pins down |
| --- | --- |
| `00-smoke` | The chunks load with no browser; state is isolated per test |
| `01-core` | Fiscal year and months, money and percent parsing, formatting, escaping |
| `02-share-math` | Rule 1 — `sharePct` as the only source of percentages; the largest-remainder allocator |
| `03-invoices` | Rule 3 — an invoice is a record; what raising one refuses; amendments |
| `04-collections-bid` | Collections, and `D + F + R = accepted` asserted in every month |
| `05-splits-rollups` | The effort split; Rule 2 — years are fenced |
| `06-reports` | The fact table accounts for every dollar; the ad-hoc builder |
| `07-upfront` | The up-front position; the D&O MORD as a position, not a running total |
| `08-migrate` | The schema ladder, 1 → 7 |
| `09-validation` | Uniqueness and cross-year rules; rolling a year forward |

The allocator is tested by worked example *and* by a 4,000-case sweep against
its stated invariant — the parts sum exactly to `round2(pool × Σpct / 100)`.
The sweep is seeded, so a failure reproduces exactly.

## Known defects

Some tests are wrapped in `todo(name, why, fn)`. They assert what *should* be
true, are expected to fail, and are reported separately from real failures — so
the suite stays green and a genuine regression is still visible, while the
defect is recorded precisely rather than in a comment nobody reads.

If one starts passing, the runner reports that as a failure: the fix landed and
the wrapper has to come off, or the protection is quietly lost.

Two are recorded, both in `migrate()` and both reachable only from a schema-4
file:

- A cumulative D&O MORD ledger carried down from a **year-level** up-front
  position is never converted to monthly positions. The conversion runs inside
  the efforts loop; the carry-down runs after it. The same ledger in a
  schema-5 file converts correctly.
- A year-level up-front position on a year with **no efforts** is discarded
  entirely — funder and amount both — because the carry-down only runs when
  there are efforts to carry it down to.

## Adding a test

Cases live in `test/cases/`, are discovered in filename order, and each exports
one function:

```js
module.exports = ({ describe, test, todo, eq, ok, near, deep, mentions, silent,
                    load, builder, standard }) => {
  describe('what this group is about', () => {
    test('what should be true', () => {
      const RPT = load();
      const b = standard(RPT);           // DLA FY2026, two efforts, DEU/ITA/USA 40/35/25
      b.doc('Warehousing', { cust: 'DEU', amount: 400000, status: 'Accepted', rcvd: '2025-11-10' });
      eq(RPT.yearRollup(b.obj.group('DLA'), 2026).mipr, 400000);
    });
  });
};
```

`standard()` builds a small program you can hold in your head; `builder()` gives
you an empty one. Both go through the app's own mutators, so fixtures exercise
`addEffort` and `raiseInvoice` rather than hand-rolling state the real code
would never produce. Customers are addressed by code, ids stay opaque.

## Checking the suite itself

The tests were checked against thirteen deliberately broken copies of the app —
naive per-line rounding, an off-by-one fiscal year boundary, `docNet` ignoring
amendments, the MORD summed instead of read as a position, `parseMoney`
returning 0 for unreadable input, the fact table dropping its remainder row, an
invoice raised on an unbalanced table, the invoice panel recomputing from the
live cost share, and others. All thirteen were caught.
