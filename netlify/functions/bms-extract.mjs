// Netlify Function: /api/bms-extract
// Accepts multipart form data: cv (PDF only), notes, roleTitle, client, consultant
// Returns: { candidateData, cvBase64, cvOriginalName }

import { Buffer } from "buffer";

const MAX_SIZE = 5.5 * 1024 * 1024;

// ─── Multipart parser ─────────────────────────────────────────────────────────

function parseMultipart(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) throw new Error("No boundary found in Content-Type");
  const boundary = boundaryMatch[1];

  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "base64");
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const closeDelimiter = Buffer.from(`\r\n--${boundary}--`);

  const fields = {};
  let file = null;

  const startBoundary = Buffer.from(`--${boundary}\r\n`);
  let pos = buf.indexOf(startBoundary);
  if (pos === -1) throw new Error("Could not find start boundary");
  pos += startBoundary.length;

  while (pos < buf.length) {
    const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"), pos);
    if (headerEnd === -1) break;

    const headerStr = buf.slice(pos, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;

    let bodyEnd = buf.indexOf(delimiter, bodyStart);
    if (bodyEnd === -1) bodyEnd = buf.indexOf(closeDelimiter, bodyStart);
    if (bodyEnd === -1) bodyEnd = buf.length;

    const partBody = buf.slice(bodyStart, bodyEnd);

    const dispositionMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    const filenameMatch = headerStr.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"/i);
    const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    if (dispositionMatch) {
      const name = dispositionMatch[1];
      if (filenameMatch) {
        file = {
          fieldname: name,
          originalname: filenameMatch[1],
          mimetype: mimeMatch ? mimeMatch[1].trim() : "application/octet-stream",
          buffer: partBody,
          size: partBody.length,
        };
      } else {
        fields[name] = partBody.toString("utf8");
      }
    }

    pos = bodyEnd + delimiter.length;
    if (buf.slice(bodyEnd, bodyEnd + closeDelimiter.length).equals(closeDelimiter)) break;
    pos += 2;
  }

  return { fields, file };
}

// ─── CV text extraction ───────────────────────────────────────────────────────

async function extractTextFromPDF(buffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const data = await pdfParse(buffer);
  return data.text || "";
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recruitment data extraction engine for BMS (Bristol Myers Squibb) candidate submissions. Output ONLY a raw JSON object — no markdown, no explanation, no code fences.

CRITICAL RULES:

RULE 1 — RECRUITER NOTES ARE PRIMARY SOURCE:
The RECRUITER NOTES section contains the most important information.
Extract notice period, right to work, worker status, other processes, and motivation primarily from the notes.
If salary/package is mentioned in notes, include it in the relevant experience summary.

RULE 2 — RELEVANT EXPERIENCE (MANDATORY — this is the most important field):
Write a detailed, professional summary of why this candidate is suitable for the role.
This should be 3–5 paragraphs covering:
- Their most relevant technical skills and domain expertise for this specific role
- Key achievements and quantifiable results from their career
- Sector experience directly relevant to the client
- Any specific qualifications or certifications relevant to the role
- Why they are a strong fit for this particular position at this client
Draw from both the CV and the recruiter notes. This field will appear directly on the BMS submission form.
Do NOT include personal details (phone, email, address) in this field.

RULE 3 — RIGHT TO WORK:
Extract from notes first. If not in notes, infer from CV (e.g. Irish/EU name/address = "EU Citizen").
Common values: "EU Citizen", "Irish Citizen", "Stamp 4", "Critical Skills Work Permit", "General Work Permit".

RULE 4 — WORKER STATUS:
Extract from notes. Common values: "PAYE", "Limited Company", "Umbrella Company", "Contract".
If not mentioned, leave blank.

RULE 5 — OTHER PROCESSES:
Extract from notes only. If the candidate has other interviews or processes ongoing, note them.
If not mentioned, leave blank.

RULE 6 — CANDIDATE NAME:
Extract from the CV. Use full name only, no titles.`;

async function extractWithLLM(cvText, notes, roleTitle, client) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in environment variables.");

  const hasNotes = notes && notes.trim().length > 10;

  const userMessage = `ROLE: ${roleTitle || "Not specified"}
CLIENT: ${client || "Not specified"}

=== RECRUITER INTERVIEW NOTES ===
IMPORTANT: Read these notes carefully FIRST. Extract notice period, right to work, worker status, other processes, and any salary/package information from here.
${hasNotes ? notes : "(No recruiter notes provided — extract what you can from the CV)"}
=== END RECRUITER NOTES ===

=== CV TEXT ===
Use the CV for: candidate name, relevant experience summary, technical skills, sector experience, qualifications, achievements.
Do NOT include personal contact details (phone, email, address, LinkedIn) in any extracted field.
${cvText}
=== END CV ===

Extract the following and return ONLY this JSON object:
{
  "candidateName": "Full name from CV",
  "noticePeriod": "Notice period from notes or CV (e.g. '3 months', '1 month')",
  "relevantExperience": "3-5 paragraph professional summary of why this candidate suits the ${roleTitle || "role"} at ${client || "the client"}. Include technical skills, achievements, sector experience, qualifications. No personal details.",
  "rightToWork": "Right to work status (e.g. 'EU Citizen', 'Stamp 4')",
  "workerStatus": "Worker status (e.g. 'PAYE', 'Limited Company')",
  "otherProcesses": "Any other ongoing interview processes, or blank if none"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text;
  if (!content) throw new Error("Claude returned empty response");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse JSON from Claude response. Click Extract again.");

  return JSON.parse(jsonMatch[0]);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Request must be multipart/form-data" }),
      };
    }

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    const { fields, file } = parseMultipart(bodyBuffer, contentType);

    const notes = fields.notes || "";
    const roleTitle = fields.roleTitle || "";
    const client = fields.client || "";

    if (!file) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No CV file uploaded. Please attach a PDF file." }),
      };
    }

    // BMS requires PDF only — hard reject any other format
    if (file.mimetype !== "application/pdf") {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "BMS requires PDF format only. Word, Google Docs, and other formats are not accepted and risk automatic rejection. Please convert the CV to PDF and re-upload.",
        }),
      };
    }

    if (file.size > MAX_SIZE) {
      return {
        statusCode: 413,
        body: JSON.stringify({
          error: `CV file exceeds 5.5 MB. Please compress it at ilovepdf.com and re-upload.`,
        }),
      };
    }

    // Extract text from PDF
    let cvText = "";
    try {
      cvText = await extractTextFromPDF(file.buffer);
    } catch (err) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: `Could not extract text from CV: ${err.message}. Try re-saving the PDF and re-uploading.`,
        }),
      };
    }

    if (!cvText.trim()) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: "CV text was empty or unreadable. This may be a scanned/image PDF. Please use a text-based PDF.",
        }),
      };
    }

    // Extract with Claude
    let candidateData;
    try {
      candidateData = await extractWithLLM(cvText, notes, roleTitle, client);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: `Could not parse AI response: ${err.message}. Click Extract again — it usually succeeds on retry.`,
        }),
      };
    }

    const cvBase64 = file.buffer.toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateData,
        cvBase64,
        cvMimeType: "application/pdf",
        cvOriginalName: file.originalname,
      }),
    };
  } catch (err) {
    console.error("[bms-extract]", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Server error: ${err.message}` }),
    };
  }
};
