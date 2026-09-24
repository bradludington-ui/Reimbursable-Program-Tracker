# RPT — Reimbursables Program Tracker

A single-file, offline tracker for a reimbursable program: who owes what, how a
year's requirement is split across customers, what funding has been accepted,
what has been billed, and what has been collected.

Open `Reimbursables_Program_Tracker.html` in a browser. There is no build step,
no server and no install — it is one HTML file with everything inlined, and it
makes no network requests of any kind.

## The model

Four objects and three rules.

| Object | What it is |
| --- | --- |
| **Customer** | Who reimburses you. Not tied to a fiscal year — customers carry across. |
| **Cost share** | A named, reusable table of customer → percentage, held for one fiscal year. Entered as percentages or as driver quantities. |
| **Group** | An activity that spans fiscal years (DLA, say). The lasting thing: code, name, appropriation, OPR. |
| **Effort** | A line of work inside one year of a group (Warehousing, Transportation, DEMIL). Where the money lives: its own cost share, total requirement, funding documents and invoices. |

```
group DLA
  └─ FY26
       ├─ effort Warehousing     share A · requirement · MIPRs · invoices
       ├─ effort Transportation  share B · ...
       └─ effort DEMIL           share C · ...
```

1. `RPT.sharePct()` is the only place a percentage is produced.
2. **Years are fenced.** Nothing in one year is summed with, defaulted from or
   carried into another. Every function that touches money names its fiscal
   year explicitly.
3. **An invoice is a record, not a view.** Its per-customer lines are
   snapshotted from the cost share when it is raised; later edits to that table
   never rewrite them.

## When the cost share changes mid-year

A flying-hour reconciliation run in June or July applies back to 1 October, so
the whole year has to be shared on the new ratio. Prior invoices are **not**
reissued — they were sent, and the participant reconciles them against their own
records. What goes out instead is a balancing invoice.

For each participant the re-spread computes:

| | |
| --- | --- |
| **billed** | what they have actually been billed, read from the invoice snapshots |
| **should have been** | their slice of that same cumulative total, at the ratio as it stands now |
| **difference** | the signed delta — positive under-billed, negative over-billed |

A negative line is a **credit**: it raises that participant's unbilled position
and is worked off against what they are billed later in the year. Nothing is
collected against a balancing invoice, and it cannot be recomputed — its lines
are differences, not a split of a total.

**The deltas sum to zero.** A ratio change redistributes what has been billed; it
does not bill more. That is asserted rather than assumed, which is why an
unbalanced table is refused here exactly as it is for an ordinary invoice.

No historical ratio is read, because none is needed: every invoice already
carries the split it was raised on, so the cumulative billed figure *is* the
history. That is what Rule 3 buys.

## What it does

- **Groups** — the register: groups, their years, their efforts, requirements,
  funding documents and amendments. Amendments are kept as a ledger rather than
  folded into the base figure, so "the MIPR was \$2.4M and \$400K came back in
  September" stays a different fact from "the MIPR was \$2.0M".
- **Invoices** — raise, review and list. Allocation uses largest-remainder
  rounding so the lines always sum to the cent. An invoice is refused on an
  unbalanced share table.
- **Re-spread** — when the cost share changes *inside* a fiscal year and applies
  back to 1 October. Prior invoices are left exactly as sent; the difference
  goes out as a **balancing invoice** whose lines are signed differences rather
  than a total split by a ratio, and which therefore nets to zero. See below.
- **Reports** — executive summary (every group in the year), group review (one
  group in depth, plus history across years), and an ad-hoc builder. All three
  read the same facts, so a figure can never differ between two reports that
  claim to show the same thing.
- **Customers** and **Cost shares** — the shape of the program itself.
- **Import** — read a DEAMS/DFAS export, map its columns (the mapping is
  remembered against the file's header signature), and see the differences
  before anything is written. Nothing is dropped silently, nothing is created
  by guesswork, and the plan is separate from the write.
- **Vouchers** — SF 1080 and OF 1017-G field data. Debits equal credits, always.

Collections follow the budgetary identity `D + F + R = accepted funding`
(BID D unfilled customer orders, BID F filled-uncollected, BID R collected),
asserted rather than assumed. "Not marked collected" and "collected" are
different facts and the tool will not conflate them.

## Caveats carried from the source

- **Voucher layout is unverified.** Field *values* are computed from the tool's
  own data. Box numbers, printed captions and the printable layout are a draft
  to be corrected against the real form and marked verified; everything printed
  while a form is unverified says so on its face.
- **Fund cites start empty.** Which accounts a D&O MORD debits and credits is
  the comptroller's answer. A voucher built without posting rules reports the
  gap rather than inventing an account.

## Data and handling

Everything you keep lives in the file you save and in this browser's local
storage. Nothing is sent anywhere. The header chip reads
`UNCLASSIFIED — NO DATA` while empty and `CUI WHEN SAVED` once real data is
entered — treat saved files accordingly.

Theme (daylight / dark) is remembered per browser.

## Layout of the file

The single file is assembled from labelled chunks, each with a banner comment
explaining what it owns:

| Chunk | Responsibility |
| --- | --- |
| `03_core` | Namespace, helpers, state, storage. No DOM at load time. |
| `04_model` | The domain — share math, invoices, amendments, collections. No DOM. |
| `05_charts` | Chart kit (string builders, no DOM dependency). |
| `05_customers`, `06_shares`, `08_groups` | Customers, cost shares, the register. |
| `09_invoices`, `10_reports` | Invoices; the three reports. |
| `11_import`, `12_importui` | Reading the system of record; the import flow. |
| `13_vouchers`, `14_voucherui` | SF 1080 / OF 1017-G. |
| `11_boot` | Menus, navigation, save/load, first paint. |

`03_core` and `04_model` are deliberately DOM-free so the model can be loaded
into a bare Node VM and tested without a browser.

## Tests

```
npm test            # or: node test/run.js
```

No install, no dependencies, no build — Node 18 or newer and nothing else.

The suite extracts `03_core.js` and `04_model.js` from this HTML file by their
banner comments and runs them in a `vm` context with no `document` and no
`window`, so it tests the code that actually ships and enforces the DOM-free
promise those two chunks open with. The clock is frozen at a stated instant,
because `fyMonthNow()` decides which months count as elapsed and a suite that
passed all year and failed in October would be worse than none.

258 assertions covering the three rules the model holds to, the
largest-remainder allocator (by worked example and by a seeded 4,000-case
sweep), the `D + F + R = accepted` tie-out in every month of a year, and the
schema 1 → 8 migration ladder and the mid-year re-spread. The tests are
themselves checked against twenty-seven deliberately broken builds, of which
they catch twenty-six.

`node test/ui/respread.js` additionally drives the reconciliation through a real
browser. It needs Playwright and is opt-in; `npm test` stays dependency-free.

See `test/README.md` for the layout and for how to add a case.

Version: v0.1
