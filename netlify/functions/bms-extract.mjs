// Netlify Function: /api/bms-extract
// Accepts multipart form data: cv (Word .docx only), notes, roleTitle, client, consultant
// Returns: { candidateData, cvBase64, cvOriginalName }

const MAX_SIZE = 5.5 * 1024 * 1024;

// ─── Multipart parser ─────────────────────────────────────────────────────────
// Uses explicit byte values for CR (13) and LF (10) — no string escape sequences.
function indexOfBytes(haystack, needle, start) {
  start = start || 0;
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parseMultipart(buf, contentType) {
  const boundaryMatch = contentType.match(/boundary=("?)([^";,\s]+)\1/i);
  if (!boundaryMatch) throw new Error("No boundary found in Content-Type");
  const boundaryStr = boundaryMatch[2];

  const CR = 13, LF = 10, DASH = 45;
  const boundaryBytes = Buffer.from(boundaryStr, "utf8");

  // startBoundary = "--" + boundary + CRLF
  const startBoundary = Buffer.concat([
    Buffer.from([DASH, DASH]),
    boundaryBytes,
    Buffer.from([CR, LF])
  ]);

  // delimiter = CRLF + "--" + boundary
  const delimiter = Buffer.concat([
    Buffer.from([CR, LF, DASH, DASH]),
    boundaryBytes
  ]);

  const fields = {};
  let file = null;

  let pos = indexOfBytes(buf, startBoundary, 0);
  if (pos === -1) {
    const altStart = Buffer.concat([Buffer.from([DASH, DASH]), boundaryBytes]);
    pos = indexOfBytes(buf, altStart, 0);
    if (pos === -1) throw new Error("Could not find start boundary");
    pos += altStart.length;
    if (buf[pos] === CR && buf[pos + 1] === LF) pos += 2;
  } else {
    pos += startBoundary.length;
  }

  const headerSep = Buffer.from([CR, LF, CR, LF]);

  while (pos < buf.length) {
    const headerEnd = indexOfBytes(buf, headerSep, pos);
    if (headerEnd === -1) break;

    const headerStr = buf.slice(pos, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;

    let bodyEnd = indexOfBytes(buf, delimiter, bodyStart);
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
    if (buf[pos] === DASH && buf[pos + 1] === DASH) break;
    if (buf[pos] === CR && buf[pos + 1] === LF) pos += 2;
  }

  return { fields, file };
}

// ─── CV text extraction (Word / Mammoth) ──────────────────────────────────────
async function extractTextFromWord(buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

// ─── LLM extraction ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = "You are a recruitment data extraction engine for BMS (Bristol Myers Squibb) candidate submissions. Output ONLY a raw JSON object — no markdown, no explanation, no code fences.\n\nThe output JSON must strictly match this schema:\n{\n  \"candidateName\": \"string\",\n  \"noticePeriod\": \"string\",\n  \"relevantExperience\": \"string\",\n  \"rightToWork\": \"string\",\n  \"workerStatus\": \"string\",\n  \"otherProcesses\": \"string\"\n}";

async function extractWithLLM(cvText, notes, roleTitle, client) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Netlify environment variables.");

  const rolePart = roleTitle || "role";
  const clientPart = client || "the client";

  const userMessage = "=== INTERVIEW NOTES ===\n"
    + (notes || "No notes provided.")
    + "\n=== END NOTES ===\n\n=== CV TEXT ===\n"
    + "Extract the candidate's name and experience from this CV.\n"
    + "Focus on: current role, relevant experience summary, technical skills, sector experience, qualifications, achievements.\n"
    + "Do NOT include personal contact details (phone, email, address, LinkedIn) in any extracted field.\n\n"
    + cvText
    + "\n=== END CV ===\n\n"
    + "Extract the following and return ONLY this JSON object:\n"
    + "{\n"
    + "  \"candidateName\": \"Full name from CV\",\n"
    + "  \"noticePeriod\": \"Notice period from notes or CV (e.g. '3 months', '1 month')\",\n"
    + "  \"relevantExperience\": \"3-5 paragraph professional summary of why this candidate suits the " + rolePart + " at " + clientPart + ". Include technical skills, achievements, sector experience, qualifications. No personal details.\",\n"
    + "  \"rightToWork\": \"Right to work status (e.g. 'EU Citizen', 'Stamp 4')\",\n"
    + "  \"workerStatus\": \"Worker status (e.g. 'PAYE', 'Limited Company')\",\n"
    + "  \"otherProcesses\": \"Any other ongoing interview processes, or blank if none\"\n"
    + "}";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Claude API error " + response.status + ": " + err);
  }

  const result = await response.json();
  const content = result.content && result.content[0] && result.content[0].text;
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
        body: JSON.stringify({ error: "No CV file uploaded. Please attach a Word (.docx) file." }),
      };
    }

    const isWordDoc =
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.toLowerCase().endsWith(".docx");

    if (!isWordDoc) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Please upload a Word (.docx) file for parsing. The system will automatically convert it to PDF for the final BMS submission.",
        }),
      };
    }

    if (file.size > MAX_SIZE) {
      return {
        statusCode: 413,
        body: JSON.stringify({ error: "CV file exceeds 5.5 MB. Please compress it and re-upload." }),
      };
    }

    let cvText = "";
    try {
      cvText = await extractTextFromWord(file.buffer);
    } catch (err) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: "Could not extract text from Word document: " + err.message + ". Try re-saving the file and re-uploading.",
        }),
      };
    }

    if (!cvText.trim()) {
      return {
        statusCode: 422,
        body: JSON.stringify({
          error: "CV text was empty or unreadable. Please ensure the Word document contains text.",
        }),
      };
    }

    let candidateData;
    try {
      candidateData = await extractWithLLM(cvText, notes, roleTitle, client);
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Could not parse AI response: " + err.message + ". Click Extract again — it usually succeeds on retry.",
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
        cvMimeType: file.mimetype,
        cvOriginalName: file.originalname,
      }),
    };
  } catch (err) {
    console.error("[bms-extract]", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
