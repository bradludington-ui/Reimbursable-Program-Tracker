# Contract Execution Dashboard

A single-file, dependency-free browser tool for F-35 sustainment finance. It reads the
monthly per-contract *ULO Summary* workbooks and reports obligations, expenditures and
unliquidated balance by contract, participant, appropriation, CLIN and cancellation date.

Open `Contract_Execution_Dashboard.html` in a browser. There is nothing to install, no
build step and no server.

## Handling

Every byte is parsed and rendered in the browser tab. The page makes no network call and
fetches no library, so nothing leaves the machine it is opened on.

- **The file in this repository carries no data.** Its payload slot is empty and it opens
  marked `UNCLASSIFIED — NO DATA`.
- **A saved copy does carry data.** *File → Save copy* writes the loaded records into a
  duplicate of the page so it opens on another machine with no import step. That file is a
  CUI artefact and is marked `CUI//DL ONLY//F-35 PARTNERS`. Do not commit one here.

## Importing

*File → Import ULO summaries* (Ctrl+O) takes one or more
`<contract> … ULO Summary <date>.xlsx` files. The contract number is read from each file
name; a month is a set of per-contract files imported in one go, and several months can be
held at once.

Columns are resolved **by header name, never by position**. The real workbooks disagree on
layout — one carries a spacer column and no Appropriation, CLIN Type or Comments, which
shifts every field after CLIN Title by one. Reading that by position yields a dashboard
that is entirely wrong while looking entirely normal, so each field declares the headings
it answers to and the Verify view prints the resolved mapping for every file.

## Views

| View | What it shows |
| --- | --- |
| Portfolio | The position across every loaded contract |
| Cancellation Risk | Balance against expiration and cancellation dates |
| Month over Month | Bridge between two periods, including unexplained movement |
| Trend | Balance over the loaded periods |
| Contracts | Per-contract rollup |
| CLIN Lines | The flat line register, filterable and sortable |
| Actions | The action register, with aging by owner and confidence |
| Contacts | POC rules that resolve an owner for a line, most specific rule winning |
| Slides | PowerPoint builder over the embedded JPO templates |
| Verify | Tie-outs, and the column mapping resolved per file |

## Output

PowerPoint (Spend Plan, SFWG/SFCB Membership and CFO Execution Review templates), `.xlsx`,
CLIN lines `.csv`, print/PDF, and JSON export/merge for the action register, contact
register and send log. Worklists can be sent per POC and taken back in.

Light and dark themes are under *View → Appearance*; the choice is remembered per browser
and is never part of the data payload.

## Layout

One file, on purpose. The domain logic in it has no DOM dependency so that a regression
suite can exercise it directly. The embedded PowerPoint template parts are generated
output — do not hand-edit them.

### Template metadata

The embedded templates came from real decks and arrived carrying their original Office
metadata: author and last-modified-by names, a Purview sensitivity label with its tenant
`siteId`, SharePoint site GUIDs and content-type ids, and the source decks' own slide
titles. None of it is read by any code here — it was only being carried into the generated
`.pptx` — so it has been cleared from `docProps/core.xml`, `docProps/app.xml`,
`docProps/custom.xml`, `docMetadata/LabelInfo.xml` and the `customXml/` parts. Every part
that draws a slide is untouched and the generated deck is byte-identical apart from those
metadata parts.

`tools/make_tpl.py` regenerates the templates from source decks and will reintroduce that
metadata, so strip it again after any regeneration.
