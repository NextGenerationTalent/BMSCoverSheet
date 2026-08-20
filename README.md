# BMS Candidate Submission Generator

Generates a BMS-compliant candidate submission PDF: page 1 is a vector-exact
reproduction of the real BMS Candidate Submission Template (measured
directly off the client's .docx, not redrawn from memory), page 2+ is the
candidate's actual CV, merged into the same file with personal contact
details redacted. One combined PDF, ready to submit via Beeline.

## What's actually implemented (verified, not just claimed)

- **Page 1 layout is measured, not guessed.** Table bounds, column widths,
  row heights, border weight/colour, logo size/position, and font were all
  read directly out of the unzipped client `.docx` and cross-checked
  against a LibreOffice render of the untouched file. See
  `netlify/functions/MEASUREMENTS.md` for exactly how, so this can be
  re-verified if BMS issues a new template.
- **One known, accepted deviation:** the real template uses Calibri, a
  licensed Microsoft font. This renders in Helvetica instead (same size/
  weight/layout, different typeface) — there's no redistributable Calibri
  file to embed. Confirmed acceptable by NG.
- **The CV is actually merged into the output PDF**, not left as a
  separate file with an "attach this yourself" note. PDF CVs: original
  pages copied in directly. Word CVs: pdf-lib can't embed a Word file
  directly, so the extracted text is paginated as plain text pages instead
  (same fallback used in `NextGen-Cover-Sheet`).
- **Personal-detail redaction is adaptive, not a fixed-size box.** It finds
  the actual name/address/phone/email cluster on the CV's own terms and
  redacts only that, rather than a guessed pixel height that either misses
  content or (as an earlier bug in this codebase did) eats into legitimate
  CV content below it.
- **Right to Work is a single required field**, matching the real
  template's single combined cell — never split into two side-by-side
  columns, and never inferred by the AI from the CV. It's always left
  blank until a consultant explicitly fills it in, and the PDF generator
  refuses to produce a document if it's empty.
- **No Next Generation branding, footer, or identification anywhere** in
  the generated document — the BMS template explicitly requires this.

## Fields

| Field | Source |
|-------|--------|
| Candidate Name | Guessed from CV text as a starting point, always editable |
| Notice Period | AI-extracted from interview notes only (never guessed from CV) |
| Relevant Experience | AI-generated from CV + notes, 3-4 short bullets (fits the template's compact cell) |
| Right to Work | **Always blank until the consultant fills it in.** Required before download. |
| Other Processes | **Always blank until the consultant fills it in.** Never defaulted to "N/A" automatically. |

## Deployment to Netlify

```bash
git init && git add . && git commit -m "BMS Submission Generator"
gh repo create bms-coversheet --private --push --source=.
```

Then in [app.netlify.com](https://app.netlify.com): **Add new site → Import
an existing project**, connect the repo (it auto-reads `netlify.toml`), and
set the environment variable:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |

No other runtime dependencies are needed — specifically, **no LibreOffice
or other document-conversion service is required at runtime.** The cover
page is drawn as vectors from measured constants, not by converting the
live docx on each request, so it works within Netlify Functions' normal
Node.js environment.

## Local development

```bash
npm install
npm install -g netlify-cli
netlify env:set ANTHROPIC_API_KEY sk-ant-xxxxxxxxxxxxxxxx
netlify dev
```

## Testing the PDF generation directly (no browser needed)

`test/test_generate.mjs` calls the `bms-generate-pdf` handler directly with
sample data and, optionally, a real CV file (PDF or `.docx`) to merge in —
useful for checking layout or redaction changes without going through the
UI:

```bash
node test/test_generate.mjs                     # cover page only, sample data
node test/test_generate.mjs path/to/a-cv.pdf     # + real PDF CV merge
node test/test_generate.mjs path/to/a-cv.docx    # + real Word CV merge
```

Output lands in `test/`. Render it to check visually:

```bash
pdftoppm -jpeg -r 150 test/BMS_Submission_*.pdf test/out
```

## If BMS issues a new template

Don't hand-edit the constants in `bms-generate-pdf.mjs`. Re-run the
measurement process in `netlify/functions/MEASUREMENTS.md` against the new
file and update the constants from that — that's what keeps this
"identical," rather than an approximation that drifts over time.
