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
- **Personal-detail redaction is a fixed-height band on page 1**, not
  adaptive text-position detection. An earlier version used `pdfjs-dist` to
  find and redact exactly the name/contact cluster wherever it sat on the
  page — that proved too heavy for Netlify's serverless environment and
  caused the function to crash outright (HTTP 502) rather than fail
  cleanly. This trades some precision for reliability: a fixed white band
  covers a typical name + address/phone/email header. Known limitation: an
  unusually short header may lose part of the next heading too; an
  unusually tall one (e.g. a wrapped address plus a LinkedIn line) may not
  be fully covered. Revisit with a lighter-weight adaptive approach if this
  proves too imprecise in practice.
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

## Real bugs found and fixed along the way

Two separate crashes and one data-quality bug have hit this project, all
worth understanding if something breaks again:

1. **`pdfjs-dist` caused an unhandled crash (HTTP 502) under Netlify's
   serverless function environment**, not a normal error. Traded for a
   simpler, dependency-free fixed-band redaction (see above) that cannot
   time out or crash.
2. **The logo file couldn't be found at runtime.** The code used
   `import.meta.url` to resolve `bms-logo.png`'s path relative to the
   function file — this works fine locally, but Netlify's bundler
   sometimes compiles functions to CommonJS output, where
   `import.meta.url` comes back empty. That crashed `fileURLToPath()` at
   module-load time, before the request handler even ran — which is why
   it surfaced as a bare 502 with zero error detail instead of a normal
   caught error. Fixed by embedding the logo as a base64 constant
   (`netlify/functions/lib/bms-logo-data.mjs`) instead of reading it from
   disk, removing the dependency on file-path resolution entirely.
3. **Duplicate cover-page table appears in the output.** This happens when
   the file uploaded as "the CV" already has a filled BMS submission table
   as its own first page — e.g. a candidate package someone assembled by
   hand before uploading it here. The tool now detects this pattern (the
   BMS template's own fixed labels — "Candidate Submission", "Relevant
   Experience", "Right to Work", "Other Processes" — appearing together on
   a page) and skips that page rather than merging it in as if it were
   real CV content. It also stops the candidate-name auto-guess from ever
   picking up template boilerplate text like "Candidate Submission" as a
   name. If a genuinely unusual CV format still slips past this detection,
   it's a pattern-matching heuristic (see `looksLikeDuplicateCoverPage` in
   `bms-generate-pdf.mjs`), not foolproof — worth knowing if this ever
   recurs with a different-looking duplicate.

**If you change the logo or the redaction approach later**, don't
reintroduce file-path resolution (`import.meta.url`, `__dirname`, etc.) in
these two functions — embed data as a constant instead, the way the logo
already is. It's the only way to be sure it survives whichever bundling
mode Netlify picks.

**Verifying against Netlify's actual bundler, not just local Node:**
running a function locally with plain `node` uses Node's own ESM loader
and will NOT catch a bug like #2 above — it only shows up when compiled
through Netlify's actual bundler. To check faithfully:

```bash
npm install -g netlify-cli
netlify functions:build --src netlify/functions
# Watch for warnings, especially "import.meta" ones.
unzip netlify/functions/bms-generate-pdf.zip -d /tmp/check
node -e "require('/tmp/check/bms-generate-pdf.js').handler({httpMethod:'POST', body: '...'})"
```

## If BMS issues a new template

Don't hand-edit the constants in `bms-generate-pdf.mjs`. Re-run the
measurement process in `netlify/functions/MEASUREMENTS.md` against the new
file and update the constants from that — that's what keeps this
"identical," rather than an approximation that drifts over time.
