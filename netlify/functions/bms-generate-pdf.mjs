// Netlify Function: /api/bms-generate-pdf
//
// Renders page 1 as a VECTOR-EXACT reproduction of the real BMS Candidate
// Submission Template — every coordinate below was measured directly off
// the client-supplied .docx (unzipped + inspected via python-docx) and off
// a LibreOffice render of that same file (via pdfplumber), not estimated.
// See MEASUREMENTS.md in this folder for how each number was derived and
// how to re-verify them if BMS ever issues a new template.
//
// Known, accepted deviation from the source file: the real template uses
// Calibri (a licensed Microsoft font not embeddable in open PDF tooling
// without a supplied font file). This renders in Helvetica instead — same
// size/weight/layout, different typeface. Confirmed acceptable by NG.
//
// Page 2+: the candidate's actual CV, merged into the SAME pdf (not a
// separate file) per BMS's own instruction ("insert the candidate CV below
// the table... save as PDF"). PDF CVs: pages copied in directly with
// adaptive contact-detail redaction. Word CVs: pdf-lib cannot embed a
// Word file, so the extracted text is paginated as plain redacted text
// pages instead (same fallback NextGen-Cover-Sheet uses).
//
// No Next Generation branding, footer, or identification appears anywhere
// in this document — BMS's template explicitly requires "no personal
// details, company logos or agency identification visible on the
// submitted PDF document."

import { Buffer } from "buffer";
import { BMS_LOGO_BASE64 } from "./lib/bms-logo-data.mjs";

// ─── Measured geometry (see header comment) ───────────────────────────────────
// All values in PDF points, bottom-left origin, A4 page.
const PAGE_W = 595.32;
const PAGE_H = 841.92;

// Logo: measured directly from the embedded image + its drawing extent in
// word/header1.xml (cx=1733550 EMU, cy=898463 EMU -> 136.5 x 70.75pt).
const LOGO_X = 72.0;
const LOGO_W = 136.5;
const LOGO_H = 70.75;
const LOGO_Y = PAGE_H - 106.10076377952805; // bottom edge of the image

// Table outer bounds (measured via pdfplumber table detection on a
// LibreOffice render of the untouched client template).
const TBL_X0 = 72.3;
const TBL_X1 = 523.1;
const TBL_W = TBL_X1 - TBL_X0;
const LABEL_X1 = 185.0; // end of the label column / start of the value column

// Row 1 (Candidate Name | Notice Period) sub-column boundaries.
const ROW1_COLS = [72.3, 185.0, 297.7, 410.4, 523.1];

// Row top-origin boundaries measured off the real file (top = distance from
// page top, matching pdfplumber's coordinate convention).
const ROW0_TOP = 128.95, ROW0_BOT = 142.85; // "Candidate Submission" header
const ROW1_TOP = 142.85, ROW1_BOT = 156.85; // Name | Notice Period
const ROW2_TOP = 156.85, ROW2_MIN_BOT = 216.45; // Relevant Experience
const ROW3_TOP = 216.45, ROW3_MIN_BOT = 243.75; // Right to Work
const ROW4_TOP = 243.75, ROW4_MIN_BOT = 286.95; // Other Processes

const BORDER_W = 0.5; // measured: w:sz="4" (eighths of a point) = 0.5pt

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(str) {
  return (str || "").replace(/[^\x20-\x7E\u00A0-\u00FF\u2022]/g, " ").trim();
}

function wrap(text, font, size, maxW) {
  const words = (text || "").split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    let width;
    try { width = font.widthOfTextAtSize(test, size); } catch { width = 0; }
    if (width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function sd(page, text, opts) {
  const clean = sanitise(text);
  if (!clean) return;
  try { page.drawText(clean, opts); } catch {}
}

// Draws a bulleted block of lines (one bullet per entry in `items`, each
// item may itself wrap to multiple lines) starting at top-origin `top`,
// inside column [x0,x1]. Returns the bottom-origin y where drawing stopped
// (top-origin "top" of next content), i.e. still in top-origin terms.
function drawBulletBlock(page, items, top, x0, x1, font, size, lineH, pdfH, topPad = 10) {
  const padL = 8, textIndent = 12;
  let topOrigin = top + topPad; // padding before first bullet
  for (const raw of items) {
    const text = sanitise(raw);
    if (!text) continue;
    const lines = wrap(text, font, size, x1 - x0 - padL - textIndent);
    // bullet glyph
    sd(page, "\u2022", { x: x0 + padL, y: pdfH - topOrigin - size, size, font, color: BLACK });
    for (const line of lines) {
      sd(page, line, { x: x0 + padL + textIndent, y: pdfH - topOrigin - size, size, font, color: BLACK });
      topOrigin += lineH;
    }
  }
  return topOrigin + 6; // bottom padding
}

// ─── Personal detail redaction (ported from NextGen-Cover-Sheet) ─────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\s\-.]?){7,15}/g;
const LINKEDIN_RE = /linkedin\.com\/in\/[^\s]*/gi;

function isPersonalLine(line) {
  const t = (line || "").trim();
  if (!t) return false;
  if (/(?:\+?\d[\s\-.]?){7,15}/.test(t) && /\d{4,}/.test(t)) return true;
  if (EMAIL_RE.test(t)) return true;
  if (/linkedin\.com\/in\//i.test(t)) return true;
  if (/^[\d\s()+\-.]{7,20}$/.test(t)) return true;
  if (/\b(mobile|phone|tel|email|e-mail|address|dob|date of birth)\b/i.test(t)) return true;
  return false;
}

function redactPersonalDetails(text) {
  if (!text) return text;
  return String(text)
    .replace(EMAIL_RE, "[redacted]")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 7 ? "[redacted]" : m))
    .replace(LINKEDIN_RE, "[redacted]");
}

// Detects whether a page's extracted text is itself a filled BMS
// "Candidate Submission" table rather than genuine CV content — e.g. a
// candidate package where someone already prepended a completed submission
// table before the real CV. Requires several of the template's own fixed
// labels together (not just one word) so real CV content mentioning e.g.
// "right to work" in passing doesn't get misidentified.
function looksLikeDuplicateCoverPage(text) {
  const t = (text || "").toLowerCase();
  let hits = 0;
  if (t.includes("candidate submission")) hits++;
  if (t.includes("relevant experience")) hits++;
  if (t.includes("right to work")) hits++;
  if (t.includes("other processes")) hits++;
  return hits >= 3;
}

async function redactPersonalDetailsInPdf(pages) {
  // Earlier version used pdfjs-dist to find and redact exactly the
  // name/contact line cluster, wherever it actually sat on the page. That
  // approach turned out to be too heavy/fragile for Netlify's serverless
  // function environment — it caused an unhandled crash (HTTP 502, not a
  // normal caught error) rather than a clean failure, likely a timeout or
  // an incompatibility with pdfjs-dist's rendering internals outside a
  // browser. Precision was traded for reliability: this draws one fixed
  // white band across the top of page 1 only, sized generously enough to
  // cover a typical name + address/phone/email header. No PDF parsing
  // library is used here at all — just pdf-lib primitives already loaded
  // elsewhere in this file — so this step cannot time out or crash.
  //
  // Known trade-off: a CV with an unusually short header (e.g. name and
  // phone number only, no address) may lose part of the next heading too.
  // A CV with an unusually tall header (long address wrapped to 2 lines,
  // plus a LinkedIn URL) may not have every line fully covered. Flagged to
  // NG as an accepted limitation — precise adaptive redaction can be
  // revisited later with a lighter-weight approach if this proves too
  // imprecise in practice.
  const FIXED_BAND_H = 115;
  if (!pages.length) return;
  const { rgb } = await import("pdf-lib");
  const white = rgb(1, 1, 1);
  const first = pages[0];
  const { width: pW, height: pH } = first.getSize();
  first.drawRectangle({ x: 0, y: pH - FIXED_BAND_H, width: pW, height: FIXED_BAND_H, color: white });
}

// ─── Colours ───────────────────────────────────────────────────────────────────
let BLACK; // set once doc/rgb is available

// ─── Cover page (page 1): vector-exact BMS table ──────────────────────────────

async function buildCoverPage(pdfDoc, data) {
  const pdfLibModule = await import("pdf-lib");
  const { StandardFonts, rgb } = pdfLibModule;
  BLACK = rgb(0, 0, 0);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // Logo — byte-identical to the one embedded in the real client template.
  // Embedded as base64 data (see bms-logo-data.mjs) rather than read from
  // disk, so this can't fail based on how Netlify's bundler resolves file
  // paths at runtime.
  try {
    const logoBytes = Buffer.from(BMS_LOGO_BASE64, "base64");
    const logoImage = await pdfDoc.embedPng(logoBytes);
    page.drawImage(logoImage, { x: LOGO_X, y: LOGO_Y, width: LOGO_W, height: LOGO_H });
  } catch (err) {
    console.warn("[bms-generate-pdf] Could not load BMS logo:", err.message);
  }

  // ── Compute actual row heights (grow past the measured minimum only if
  // the content genuinely needs more room; never shrink below it) ──────────
  const relevantExperience = Array.isArray(data.relevantExperience)
    ? data.relevantExperience
    : sanitise(data.relevantExperience).split(/\n+/).filter(Boolean);
  const rightToWorkItems = [sanitise(data.rightToWork)].filter(Boolean);
  const otherProcessesItems = Array.isArray(data.otherProcesses)
    ? data.otherProcesses
    : sanitise(data.otherProcesses).split(/\n+/).filter(Boolean);

  const measureBlockHeight = (items, x0, x1, size, lineH, topPad = 10) => {
    const padL = 8, textIndent = 12, botPad = 6;
    let h = topPad;
    for (const raw of items) {
      const text = sanitise(raw);
      if (!text) continue;
      const lines = wrap(text, font, size, x1 - x0 - padL - textIndent);
      h += lines.length * lineH;
    }
    return h + botPad;
  };

  const row2ContentH = measureBlockHeight(relevantExperience, LABEL_X1, TBL_X1, 9, 12);
  const row2Bot = ROW2_TOP + Math.max(ROW2_MIN_BOT - ROW2_TOP, row2ContentH);

  const row3ContentH = measureBlockHeight(rightToWorkItems, LABEL_X1, TBL_X1, 9, 12);
  const row3TopActual = row2Bot;
  const row3Bot = row3TopActual + Math.max(ROW3_MIN_BOT - ROW3_TOP, row3ContentH);

  // The italic instruction text is long enough that it needs to wrap
  // within the label column's width rather than being drawn as one line —
  // drawing it unwrapped let it run straight through the vertical divider
  // into the value column. Wrap it first, then size the row's top padding
  // to however many lines that produces (varies slightly by font metrics,
  // so don't hardcode a line count).
  const instructionText = "(Does the candidate have any other ongoing processes? Please specify.)";
  const labelColMaxW = LABEL_X1 - TBL_X0 - 12; // 6pt padding each side
  const instructionLines = wrap(instructionText, fontItalic, 8, labelColMaxW);
  const ROW4_TOP_PAD = 14 + instructionLines.length * 9 + 6; // "Other processes" label + wrapped instruction lines + gap before bullets
  const row4ContentH = measureBlockHeight(otherProcessesItems, LABEL_X1, TBL_X1, 9, 12, ROW4_TOP_PAD);
  const row4TopActual = row3Bot;
  const row4Bot = row4TopActual + Math.max(ROW4_MIN_BOT - ROW4_TOP, row4ContentH);

  // Row 0: "Candidate Submission" header, centered, regular weight (measured:
  // no bold run in the source XML).
  const headerText = "Candidate Submission";
  const headerW = font.widthOfTextAtSize(headerText, 11);
  sd(page, headerText, {
    x: TBL_X0 + (TBL_W - headerW) / 2,
    y: PAGE_H - ROW0_BOT + 3,
    size: 11, font, color: BLACK,
  });

  // Row 1: Candidate Name | value | Notice Period | value
  const row1LabelY = PAGE_H - ROW1_BOT + 3;
  sd(page, "Candidate Name", { x: ROW1_COLS[0] + 6, y: row1LabelY, size: 11, font, color: BLACK });
  sd(page, sanitise(data.candidateName), { x: ROW1_COLS[1] + 6, y: row1LabelY, size: 11, font, color: BLACK });
  sd(page, "Notice Period", { x: ROW1_COLS[2] + 6, y: row1LabelY, size: 11, font, color: BLACK });
  sd(page, sanitise(data.noticePeriod), { x: ROW1_COLS[3] + 6, y: row1LabelY, size: 11, font, color: BLACK });

  // Row 2: Relevant Experience
  sd(page, "Relevant Experience", { x: TBL_X0 + 6, y: PAGE_H - ROW2_TOP - 14, size: 11, font, color: BLACK });
  drawBulletBlock(page, relevantExperience, ROW2_TOP, LABEL_X1, TBL_X1, font, 9, 12, PAGE_H);

  // Row 3: Right to Work (single combined field — matches the real
  // template's single bulleted cell; never split into two columns).
  sd(page, "Right to Work", { x: TBL_X0 + 6, y: PAGE_H - row3TopActual - 14, size: 11, font, color: BLACK });
  drawBulletBlock(page, rightToWorkItems, row3TopActual, LABEL_X1, TBL_X1, font, 9, 12, PAGE_H);

  // Row 4: Other processes (label + fixed italic instruction, verbatim from
  // the client template, wrapped to fit the label column width)
  sd(page, "Other processes", { x: TBL_X0 + 6, y: PAGE_H - row4TopActual - 14, size: 11, font, color: BLACK });
  instructionLines.forEach((line, i) => {
    sd(page, line, {
      x: TBL_X0 + 6, y: PAGE_H - row4TopActual - 24 - i * 9, size: 8, font: fontItalic, color: BLACK,
    });
  });
  drawBulletBlock(page, otherProcessesItems, row4TopActual, LABEL_X1, TBL_X1, font, 9, 12, PAGE_H, ROW4_TOP_PAD);

  // ── Borders: outer rect + horizontal row dividers + vertical column
  // dividers, all 0.5pt black (measured "Table Grid" style — sz=4, auto). ──
  const tableBottomTop = ROW0_TOP;
  const tableBottomBot = row4Bot;

  page.drawRectangle({
    x: TBL_X0, y: PAGE_H - tableBottomBot, width: TBL_W, height: tableBottomBot - tableBottomTop,
    borderColor: BLACK, borderWidth: BORDER_W,
  });

  for (const rowY of [ROW0_BOT, ROW1_BOT, row2Bot, row3Bot]) {
    page.drawLine({
      start: { x: TBL_X0, y: PAGE_H - rowY },
      end: { x: TBL_X1, y: PAGE_H - rowY },
      thickness: BORDER_W, color: BLACK,
    });
  }

  page.drawLine({
    start: { x: LABEL_X1, y: PAGE_H - ROW0_BOT },
    end: { x: LABEL_X1, y: PAGE_H - row4Bot },
    thickness: BORDER_W, color: BLACK,
  });

  page.drawLine({
    start: { x: ROW1_COLS[2], y: PAGE_H - ROW1_TOP },
    end: { x: ROW1_COLS[2], y: PAGE_H - ROW1_BOT },
    thickness: BORDER_W, color: BLACK,
  });

  // Missing until now: the boundary between the "Notice Period" label and
  // its value cell — a 4-column row needs 3 internal dividers total, and
  // only 2 were being drawn (LABEL_X1 above, plus this row's first split).
  // Without it, a filled-in Notice Period value visually ran together with
  // its own label instead of sitting in a separate bordered cell.
  page.drawLine({
    start: { x: ROW1_COLS[3], y: PAGE_H - ROW1_TOP },
    end: { x: ROW1_COLS[3], y: PAGE_H - ROW1_BOT },
    thickness: BORDER_W, color: BLACK,
  });

  return page;
}

// ─── CV pages (page 2+) ────────────────────────────────────────────────────────

async function buildCVTextPages(pdfDoc, cvText, cvOriginalName) {
  let raw = (cvText || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return;

  // Same duplicate-cover-page problem can occur in a Word CV — strip a
  // leading block that's actually a pre-filled submission table before
  // paginating, rather than rendering it as if it were CV content.
  if (looksLikeDuplicateCoverPage(raw.slice(0, 1500))) {
    const otherProcessesIdx = raw.toLowerCase().indexOf("other processes");
    if (otherProcessesIdx !== -1) {
      const nextBreak = raw.indexOf("\n\n", otherProcessesIdx);
      if (nextBreak !== -1) raw = raw.slice(nextBreak).trim();
    }
  }

  const { StandardFonts } = await import("pdf-lib");
  const W = 595, H = 842, M = 50;
  const fReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodySize = 9.5, lineH = 13, maxW = W - M * 2;

  const rawLines = raw.split("\n");
  const lines = [];
  for (const rl of rawLines) {
    if (!rl.trim()) { lines.push(""); continue; }
    if (isPersonalLine(rl)) continue;
    const clean = redactPersonalDetails(rl);
    lines.push(...wrap(clean, fReg, bodySize, maxW));
  }

  let page = null, y = 0;
  const newPage = (first) => {
    page = pdfDoc.addPage([W, H]);
    y = H - M;
    if (first) {
      sd(page, "Candidate CV", { x: M, y, size: 9, font: fBold, color: BLACK });
      if (cvOriginalName) sd(page, cvOriginalName, { x: M, y: y - 12, size: 7.5, font: fReg, color: BLACK });
      page.drawLine({ start: { x: M, y: y - 18 }, end: { x: W - M, y: y - 18 }, thickness: 0.5, color: BLACK });
      y -= 30;
    }
    return page;
  };

  newPage(true);
  for (const line of lines) {
    if (y < 40 + lineH) newPage(false);
    if (line) sd(page, line, { x: M, y, size: bodySize, font: fReg, color: BLACK });
    y -= lineH;
  }
}

async function buildCVPages(pdfDoc, cvBase64, cvMimeType, cvText, cvOriginalName) {
  const { PDFDocument } = await import("pdf-lib");
  try {
    if (cvMimeType === "application/pdf") {
      if (!cvBase64) return;
      const cvBytes = Buffer.from(cvBase64, "base64");
      const cvDoc = await PDFDocument.load(cvBytes, { ignoreEncryption: true });
      let pageIndices = cvDoc.getPageIndices();

      // Some uploaded "CVs" are actually a candidate package that already
      // has a filled-in BMS submission table as its own first page (built
      // separately, e.g. by a colleague, before being uploaded here). If we
      // don't catch this, the final PDF ends up with two tables: the one
      // this tool just built from the web form, followed by the file's own
      // pre-existing one underneath. Detect that pattern and skip that page
      // rather than merging it in as if it were part of the CV content.
      try {
        const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
        const parsed = await pdfParse(cvBytes, { max: 1 }); // first page only
        if (looksLikeDuplicateCoverPage(parsed.text)) {
          pageIndices = pageIndices.slice(1);
        }
      } catch {
        // If detection fails for any reason, fall through and keep every
        // page — better to risk an unwanted duplicate than to accidentally
        // drop a real CV page.
      }

      const pages = await pdfDoc.copyPages(cvDoc, pageIndices);
      for (const p of pages) pdfDoc.addPage(p);
      if (pages.length) await redactPersonalDetailsInPdf(pages);
    } else {
      // Word (.doc/.docx) — pdf-lib cannot embed these directly, so the
      // extracted, redacted text is paginated instead.
      await buildCVTextPages(pdfDoc, cvText, cvOriginalName);
    }
  } catch (err) {
    console.error("buildCVPages error:", err);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = typeof event.body === "string"
      ? (event.isBase64Encoded ? JSON.parse(Buffer.from(event.body, "base64").toString("utf8")) : JSON.parse(event.body))
      : event.body;

    const { candidateData, cvBase64, cvMimeType, cvText, cvOriginalName } = body;

    if (!candidateData?.candidateName?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Candidate Name is required." }) };
    }
    if (!candidateData?.rightToWork?.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Right to Work / worker status is required — this must be an explicit answer, never inferred from the CV." }),
      };
    }
    if (!candidateData?.noticePeriod?.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Notice Period is required." }),
      };
    }

    const { PDFDocument } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.create();

    await buildCoverPage(pdfDoc, candidateData);
    await buildCVPages(pdfDoc, cvBase64, cvMimeType, cvText, cvOriginalName);

    const pdfBytes = await pdfDoc.save();
    const safeName = (candidateData.candidateName || "Candidate").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const filename = `BMS_Submission_${safeName}.pdf`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString("base64"), filename }),
    };
  } catch (err) {
    console.error("[bms-generate-pdf]", err);
    return { statusCode: 500, body: JSON.stringify({ error: `PDF generation failed: ${err.message}` }) };
  }
};
