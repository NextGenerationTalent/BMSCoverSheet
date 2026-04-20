// Netlify Function: /api/bms-generate-pdf
// Generates a PDF replicating the exact BMS Candidate Submission Template
// Page 1: BMS submission form table
// Page 2+: Original CV with personal details redacted (white rectangles over contact area)

import { Buffer } from "buffer";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(str) {
  return (str || "").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, " ").trim();
}

function wrapText(text, maxWidth, fontSize, font) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, fontSize);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(page, text, { x, y, maxWidth, fontSize, font, color, lineHeight }) {
  const lines = wrapText(sanitise(text), maxWidth, fontSize, font);
  let curY = y;
  for (const line of lines) {
    if (curY < 40) break;
    page.drawText(line, { x, y: curY, size: fontSize, font, color });
    curY -= lineHeight;
  }
  return curY;
}

// ─── Personal detail redaction patterns ───────────────────────────────────────

const REDACT_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi,
  /(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
  /\b(0\d{9,10}|\+\d{10,13})\b/g,
  /linkedin\.com\/in\/[^\s,)]+/gi,
  /www\.[^\s,)]+/gi,
  /https?:\/\/[^\s,)]+/gi,
];

function redactPersonalDetails(text) {
  let out = text;
  for (const p of REDACT_PATTERNS) out = out.replace(p, "");
  return out;
}

function isPersonalDetailLine(line) {
  const l = line.toLowerCase();
  return (
    REDACT_PATTERNS.some((p) => p.test(line)) ||
    /\b(mobile|phone|tel|email|e-mail|linkedin|address|dob|date of birth)\b/i.test(l)
  );
}

// ─── PDF generation ───────────────────────────────────────────────────────────

async function generateBMSPDF({ candidateData, cvBase64, roleTitle, client, consultant, date }) {
  const pdfLibModule = await import("pdf-lib");
  const { PDFDocument, rgb, StandardFonts } = pdfLibModule;

  const doc = await PDFDocument.create();

  // Fonts
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  // BMS Logo (embedded from local file)
  let bmsLogoImage = null;
  try {
    const logoPath = join(__dirname, "bms-logo.png");
    const logoBytes = readFileSync(logoPath);
    bmsLogoImage = await doc.embedPng(logoBytes);
  } catch (err) {
    console.warn("[bms-generate-pdf] Could not load BMS logo:", err.message);
  }

  // Colours
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const darkGrey = rgb(0.2, 0.2, 0.2);
  const midGrey = rgb(0.5, 0.5, 0.5);
  const lightGrey = rgb(0.9, 0.9, 0.9);
  const borderGrey = rgb(0.75, 0.75, 0.75);
  const headerBg = rgb(0.95, 0.95, 0.95);

  // Page dimensions (A4)
  const W = 595;
  const H = 842;
  const margin = 50;
  const contentW = W - margin * 2;

  // ── Page 1: BMS Submission Form ──────────────────────────────────────────────

  const page1 = doc.addPage([W, H]);

  // BMS Logo — top-left, matching Word template header position
  // Original: 137pt wide × 71pt tall, positioned at top-left margin
  const logoW = 137;
  const logoH = 71;
  const logoX = margin;
  const logoY = H - margin - logoH; // top-left, within top margin area

  if (bmsLogoImage) {
    page1.drawImage(bmsLogoImage, {
      x: logoX,
      y: logoY,
      width: logoW,
      height: logoH,
    });
  }

  // "Candidate Submission" title — positioned to the right of the logo
  const titleX = margin;
  const titleY = logoY - 20;

  page1.drawText("Candidate Submission", {
    x: titleX,
    y: titleY,
    size: 16,
    font: fontBold,
    color: black,
  });

  // Thin rule under title
  page1.drawLine({
    start: { x: margin, y: titleY - 8 },
    end: { x: W - margin, y: titleY - 8 },
    thickness: 0.5,
    color: borderGrey,
  });

  // Submission meta (role, client, consultant, date) — small line under title
  const metaParts = [];
  if (roleTitle) metaParts.push(`Role: ${roleTitle}`);
  if (client) metaParts.push(`Client: ${client}`);
  if (consultant) metaParts.push(`Consultant: ${consultant}`);
  if (date) metaParts.push(`Date: ${date}`);
  if (metaParts.length) {
    page1.drawText(metaParts.join("   |   "), {
      x: margin,
      y: titleY - 22,
      size: 7.5,
      font: fontRegular,
      color: midGrey,
    });
  }

  // ── Table layout ─────────────────────────────────────────────────────────────
  // tableTop adjusted to account for logo + title height
  const tableTop = logoY - 55;
  const tableLeft = margin;
  const tableRight = W - margin;
  const tableWidth = tableRight - tableLeft;
  const colMid = tableLeft + tableWidth / 2;

  // Helper: draw a table cell with label + value
  function drawCell(x, y, w, h, label, value, opts = {}) {
    const { labelFont = fontBold, valueFont = fontRegular, labelSize = 7, valueSize = 9, multiline = false, rows = 1 } = opts;

    // Cell border
    page1.drawRectangle({
      x,
      y: y - h,
      width: w,
      height: h,
      borderColor: borderGrey,
      borderWidth: 0.5,
      color: white,
    });

    // Label
    page1.drawText(sanitise(label).toUpperCase(), {
      x: x + 6,
      y: y - 14,
      size: labelSize,
      font: labelFont,
      color: midGrey,
    });

    // Value
    if (multiline && value) {
      const lines = wrapText(sanitise(value), w - 12, valueSize, valueFont);
      let vy = y - 26;
      for (const line of lines) {
        if (vy < y - h + 6) break;
        page1.drawText(line, { x: x + 6, y: vy, size: valueSize, font: valueFont, color: darkGrey });
        vy -= valueSize + 3;
      }
    } else if (value) {
      page1.drawText(sanitise(value).substring(0, 80), {
        x: x + 6,
        y: y - 26,
        size: valueSize,
        font: valueFont,
        color: darkGrey,
      });
    }
  }

  // Row 1: Candidate Name | Notice Period
  const row1H = 50;
  drawCell(tableLeft, tableTop, tableWidth / 2, row1H, "Candidate Name", candidateData.candidateName);
  drawCell(colMid, tableTop, tableWidth / 2, row1H, "Notice Period", candidateData.noticePeriod);

  // Row 2: Relevant Experience (large — calculate height needed)
  const row2Top = tableTop - row1H;
  const expText = sanitise(candidateData.relevantExperience || "");
  const expLines = wrapText(expText, tableWidth - 12, 9, fontRegular);
  const row2H = Math.max(180, expLines.length * 13 + 30);

  // Draw cell background
  page1.drawRectangle({
    x: tableLeft,
    y: row2Top - row2H,
    width: tableWidth,
    height: row2H,
    borderColor: borderGrey,
    borderWidth: 0.5,
    color: white,
  });

  // Label
  page1.drawText("RELEVANT EXPERIENCE", {
    x: tableLeft + 6,
    y: row2Top - 14,
    size: 7,
    font: fontBold,
    color: midGrey,
  });

  // Value — multi-line
  let expY = row2Top - 26;
  for (const line of expLines) {
    if (expY < row2Top - row2H + 8) break;
    page1.drawText(line, { x: tableLeft + 6, y: expY, size: 9, font: fontRegular, color: darkGrey });
    expY -= 13;
  }

  // Row 3: Right to Work | Worker Status
  const row3Top = row2Top - row2H;
  const row3H = 50;
  drawCell(tableLeft, row3Top, tableWidth / 2, row3H, "Right to Work", candidateData.rightToWork);
  drawCell(colMid, row3Top, tableWidth / 2, row3H, "Candidate Worker Status", candidateData.workerStatus);

  // Row 4: Other Processes
  const row4Top = row3Top - row3H;
  const otherText = sanitise(candidateData.otherProcesses || "");
  const otherLines = wrapText(otherText, tableWidth - 12, 9, fontRegular);
  const row4H = Math.max(60, otherLines.length * 13 + 30);

  page1.drawRectangle({
    x: tableLeft,
    y: row4Top - row4H,
    width: tableWidth,
    height: row4H,
    borderColor: borderGrey,
    borderWidth: 0.5,
    color: white,
  });

  // Label with description
  page1.drawText("OTHER PROCESSES", {
    x: tableLeft + 6,
    y: row4Top - 14,
    size: 7,
    font: fontBold,
    color: midGrey,
  });
  page1.drawText("(Does the candidate have any other ongoing processes? Please specify.)", {
    x: tableLeft + 6,
    y: row4Top - 23,
    size: 6.5,
    font: fontOblique,
    color: midGrey,
  });

  let othY = row4Top - 35;
  for (const line of otherLines) {
    if (othY < row4Top - row4H + 6) break;
    page1.drawText(line, { x: tableLeft + 6, y: othY, size: 9, font: fontRegular, color: darkGrey });
    othY -= 13;
  }

  // Footer
  page1.drawLine({
    start: { x: margin, y: 35 },
    end: { x: W - margin, y: 35 },
    thickness: 0.5,
    color: borderGrey,
  });
  page1.drawText("CONFIDENTIAL — Submitted via Next Generation Recruitment", {
    x: margin,
    y: 22,
    size: 7,
    font: fontRegular,
    color: midGrey,
  });
  page1.drawText(`${date}`, {
    x: W - margin - 60,
    y: 22,
    size: 7,
    font: fontRegular,
    color: midGrey,
  });

  // ── Pages 2+: CV (original PDF with redaction overlay) ───────────────────────

  if (cvBase64) {
    try {
      const cvBytes = Buffer.from(cvBase64, "base64");
      const cvDoc = await PDFDocument.load(cvBytes, { ignoreEncryption: true });
      const cvPageCount = cvDoc.getPageCount();
      const cvPageIndices = Array.from({ length: cvPageCount }, (_, i) => i);
      const copiedPages = await doc.copyPages(cvDoc, cvPageIndices);

      for (let i = 0; i < copiedPages.length; i++) {
        const cvPage = copiedPages[i];
        doc.addPage(cvPage);

        // On the first CV page, draw white rectangles over the top contact area
        // This covers phone, email, address which typically appear in the top 80-100px
        if (i === 0) {
          const { width: cvW, height: cvH } = cvPage.getSize();

          // White bar over top contact zone (top 90px of the page)
          // Most CV templates put contact info in the header area
          cvPage.drawRectangle({
            x: 0,
            y: cvH - 90,
            width: cvW,
            height: 90,
            color: white,
            opacity: 1,
          });

          // Also cover any contact details that appear in a sidebar (right 35% of top half)
          // This handles two-column CVs where contact is on the right
          cvPage.drawRectangle({
            x: cvW * 0.62,
            y: cvH - 200,
            width: cvW * 0.38,
            height: 120,
            color: white,
            opacity: 1,
          });

          // Redacted label
          cvPage.drawText("[ Personal details redacted ]", {
            x: 50,
            y: cvH - 20,
            size: 7,
            font: fontOblique,
            color: midGrey,
          });
        }
      }
    } catch (err) {
      console.error("[bms-generate-pdf] CV embed error:", err.message);
      // Add a note page if CV embed fails
      const notePage = doc.addPage([W, H]);
      notePage.drawText("CV could not be embedded. Please attach separately.", {
        x: margin,
        y: H / 2,
        size: 11,
        font: fontRegular,
        color: midGrey,
      });
    }
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
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

    const { candidateData, cvBase64, roleTitle, client, consultant, date } = body;

    if (!candidateData?.candidateName?.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Candidate Name is required." }),
      };
    }

    const pdfBuffer = await generateBMSPDF({ candidateData, cvBase64, roleTitle, client, consultant, date });

    const safeName = (candidateData.candidateName || "Candidate").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const safeClient = (client || "BMS").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const filename = `BMS_Submission_${safeName}_${safeClient}.pdf`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: pdfBuffer.toString("base64"),
        filename,
      }),
    };
  } catch (err) {
    console.error("[bms-generate-pdf]", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `PDF generation failed: ${err.message}` }),
    };
  }
};
