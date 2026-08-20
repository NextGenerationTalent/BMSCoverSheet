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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const SECTION_HEADING_RE = /^(professional\s+summary|summary|profile|about(\s+me)?|objective|career\s+objective|work\s+experience|experience|employment(\s+history)?|education|qualifications?|certifications?|key\s+skills|skills|competenc(?:y|ies)|core\s+competenc(?:y|ies)|achievements?|references?|interests?|hobbies|projects?|publications?|languages?|training)\s*:?$/i;

// Many PDF generators insert a stray extra space inside a heading's glyphs
// (kerning/tracking artifacts), e.g. "P rofile" or "Work Ex perience" — the
// space is real in the text layer, not a rendering illusion. Matching only
// the space-collapsed form of both the candidate line and the heading list
// catches these without becoming so loose it starts matching body text.
const HEADING_KEYWORDS_NOSPACE = [
  "professionalsummary", "summary", "profile", "about", "aboutme", "objective",
  "careerobjective", "workexperience", "experience", "employmenthistory",
  "education", "qualification", "qualifications", "certification", "certifications",
  "keyskills", "skills", "competency", "competencies", "corecompetency", "corecompetencies",
  "achievement", "achievements", "reference", "references", "interest", "interests",
  "hobbies", "project", "projects", "publication", "publications", "language", "languages",
  "training",
];

function isHeadingLine(text) {
  if (SECTION_HEADING_RE.test(text)) return true;
  const collapsed = (text || "").replace(/\s+/g, "").replace(/:$/, "").toLowerCase();
  return HEADING_KEYWORDS_NOSPACE.includes(collapsed);
}

async function redactPersonalDetailsInPdf(pages, cvBytes) {
  // SAFE_FLOOR is a last-resort fallback height, used ONLY if detection
  // fails entirely (encrypted/corrupt PDF). When detection succeeds, the
  // redacted band is sized to the actual measured header content — using
  // SAFE_FLOOR as a floor there was a real bug: on short headers (name +
  // one contact line, ~50pt tall) it forced a 150pt-tall white box that
  // swallowed the next section's heading and several lines of legitimate
  // CV content along with the personal details. Over-redaction is its own
  // fidelity failure, not a safe default.
  const SAFE_FLOOR = 150;
  let detectionSucceeded = false;

  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(cvBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;

    const { rgb } = await import("pdf-lib");
    const white = rgb(1, 1, 1);

    for (let i = 0; i < pages.length && i < doc.numPages; i++) {
      const pdfjsPage = await doc.getPage(i + 1);
      const textContent = await pdfjsPage.getTextContent();
      const page = pages[i];
      const { width: pW, height: pH } = page.getSize();

      const buckets = new Map();
      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) continue;
        const key = Math.round(item.transform[5] / 2) * 2;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
      const lines = [...buckets.values()]
        .map((items) => ({
          y: items[0].transform[5],
          text: items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim(),
          minX: Math.min(...items.map((it) => it.transform[4])),
          maxX: Math.max(...items.map((it) => it.transform[4] + (it.width || 0))),
          maxH: Math.max(...items.map((it) => it.height || Math.abs(it.transform[3]) || 10)),
          items,
        }))
        .sort((a, b) => b.y - a.y);

      let headerBandBottomY = null;

      if (i === 0) {
        const headerLines = [];
        for (const line of lines) {
          if (headerLines.length >= 10) break;
          if (isHeadingLine(line.text)) break;
          if (line.text.length > 100) break;
          headerLines.push(line);
        }
        const headerHasPersonal = headerLines.some(
          (l) => isPersonalLine(l.text) || l.items.some((it) => isPersonalLine(it.str))
        );
        if (headerHasPersonal && headerLines.length) {
          const lastLine = headerLines[headerLines.length - 1];
          const bottomY = lastLine.y - lastLine.maxH * 0.35 - 10;
          // Sized to the actual measured header block only — no artificial
          // minimum. This is real detected content, not a fallback guess.
          const blockH = pH - bottomY;
          headerBandBottomY = pH - blockH;
          page.drawRectangle({ x: 0, y: headerBandBottomY, width: pW, height: blockH, color: white });
          detectionSucceeded = true;
        }
      }

      for (const line of lines) {
        if (headerBandBottomY !== null && line.y >= headerBandBottomY) continue;
        const matches = isPersonalLine(line.text) || line.items.some((it) => isPersonalLine(it.str));
        if (!matches) continue;
        const pad = 3;
        const boxX = Math.max(0, line.minX - pad);
        const boxW = Math.min(pW - boxX, line.maxX - line.minX + pad * 2);
        const boxY = line.y - line.maxH * 0.3 - pad;
        const boxH = line.maxH * 1.3 + pad * 2;
        page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: white });
        detectionSucceeded = true;
      }
    }
  } catch {
    // Parsing failed (encrypted/corrupt PDF) — fall through to safety net.
  }

  if (!detectionSucceeded && pages.length) {
    const { rgb } = await import("pdf-lib");
    const white = rgb(1, 1, 1);
    const first = pages[0];
    const { width: pW, height: pH } = first.getSize();
    first.drawRectangle({ x: 0, y: pH - SAFE_FLOOR, width: pW, height: SAFE_FLOOR, color: white });
  }
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
  try {
    const logoPath = join(__dirname, "bms-logo.png");
    const logoBytes = readFileSync(logoPath);
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

  const ROW4_TOP_PAD = 28; // room for the fixed 2-line label ("Other processes" + italic instruction)
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
  // the client template)
  sd(page, "Other processes", { x: TBL_X0 + 6, y: PAGE_H - row4TopActual - 14, size: 11, font, color: BLACK });
  sd(page, "(Does the candidate have any other ongoing processes? Please specify.)", {
    x: TBL_X0 + 6, y: PAGE_H - row4TopActual - 24, size: 8, font: fontItalic, color: BLACK,
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

  return page;
}

// ─── CV pages (page 2+) ────────────────────────────────────────────────────────

async function buildCVTextPages(pdfDoc, cvText, cvOriginalName) {
  const raw = (cvText || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return;

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
      const pages = await pdfDoc.copyPages(cvDoc, cvDoc.getPageIndices());
      for (const p of pages) pdfDoc.addPage(p);
      if (pages.length) await redactPersonalDetailsInPdf(pages, cvBytes);
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
