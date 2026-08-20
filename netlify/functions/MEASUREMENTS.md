# How the layout constants in bms-generate-pdf.mjs were derived

Every coordinate is measured, not estimated. If BMS ever issues a new
version of the template, re-run this process rather than hand-editing the
constants.

## 1. Unzip the real .docx and read the XML directly

```bash
unzip BMS_Candidate_Submission_Template.docx -d unpacked/
```

- `unpacked/word/media/image1.png` — the BMS logo, byte-for-byte. Copy this
  file in as `bms-logo.png`; never re-export or re-save it.
- `unpacked/word/header1.xml` — contains `<wp:extent cx="1733550" cy="898463"/>`,
  the logo's drawing size in EMU. Convert to points: `pt = EMU / 12700`.
  → 136.5 x 70.75pt.
- `unpacked/word/document.xml` — the `<w:tbl>` element. Use `python-docx` to
  walk `document.tables[0]` and read `gridSpan`, `tcW` (column width in
  twips — `pt = twips / 20`), and `trHeight` for each row.
- `unpacked/word/styles.xml` — look up the table's referenced style
  (`TableGrid` here) for `tblBorders` weight/colour: `sz="4"` = 0.5pt,
  `color="auto"` = black.
- `unpacked/word/theme/theme1.xml` — `<a:minorFont>` gives the real
  typeface (Calibri here).

## 2. Render the untouched file and measure the actual output

Word's on-screen row heights don't always match `trHeight` once content and
cell margins are applied, so cross-check against a real render:

```bash
soffice --headless --convert-to pdf BMS_Candidate_Submission_Template.docx
```

Then use `pdfplumber` to get exact point-space bounding boxes:

```python
import pdfplumber
pdf = pdfplumber.open("BMS_Candidate_Submission_Template.pdf")
page = pdf.pages[0]
for t in page.find_tables():
    print(t.bbox)
    for row in t.rows:
        print(row.bbox, row.cells)
for im in page.images:
    print(im["x0"], im["top"], im["x1"], im["bottom"])
```

`pdfplumber` coordinates are top-origin (distance from page top). The
constants in `bms-generate-pdf.mjs` convert to pdf-lib's bottom-origin with
`y_bottom = PAGE_H - y_top`.

## 3. What's a measurement vs. a judgment call

Measured (re-derive these if the template changes): page size, margins,
logo position/size, table bounds, column widths, row minimum heights,
border weight/colour, font family/size, which runs are bold/italic.

Judgment calls (re-confirm with NG if the template changes): Helvetica as
the Calibri substitute (no licensed font file available); minimum row
heights grow rather than shrink when content overflows; cell padding
(8pt bullet indent, 12pt text indent) approximates but doesn't exactly
replicate Word's internal cell margins, since exact fidelity there is
moot once the typeface itself has already changed.
