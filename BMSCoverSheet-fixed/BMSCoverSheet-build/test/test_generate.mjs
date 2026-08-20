import { handler } from "../netlify/functions/bms-generate-pdf.mjs";
import { writeFileSync, readFileSync } from "fs";

const cvPath = process.argv[2]; // optional path to a real CV (pdf or docx) to merge in
let cvBase64 = null;
let cvMimeType = null;
let cvText = "";

if (cvPath) {
  const isPdf = cvPath.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    cvBase64 = readFileSync(cvPath).toString("base64");
    cvMimeType = "application/pdf";
  } else {
    // Simulate what bms-extract.mjs does for Word files: extract text via
    // mammoth, and DON'T send cvBase64 (generate-pdf never embeds Word
    // bytes directly — it only ever uses the extracted text for these).
    const mammoth = await import("mammoth");
    const buffer = readFileSync(cvPath);
    const result = await mammoth.extractRawText({ buffer });
    cvText = result.value || "";
    cvMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

const event = {
  httpMethod: "POST",
  body: JSON.stringify({
    candidateData: {
      candidateName: "Jane Chapman",
      noticePeriod: "2 months",
      relevantExperience: [
        "Nearly 2 years hands-on QC Microbiology experience within cGMP pharmaceutical manufacturing environments.",
        "Strong experience in environmental monitoring across Grade A-D cleanrooms, including EMPQ activities.",
        "Hands-on microbial identification experience using MALDI-TOF, OMNILOG and MicroSEQ platforms.",
        "Experienced across LIMS and multiple quality systems including MODA, LabVantage, Veeva Vault and TrackWise.",
      ],
      rightToWork: "EU citizen, eligible to work in Ireland — PAYE worker",
      otherProcesses: "Also currently interviewing with Alexion, so a prompt process is recommended.",
    },
    cvBase64,
    cvMimeType,
    cvText,
    cvOriginalName: cvPath ? cvPath.split("/").pop() : null,
  }),
};

const result = await handler(event);
if (result.statusCode !== 200) {
  console.error("FAILED", result.statusCode, result.body);
  process.exit(1);
}
const { pdfBase64, filename } = JSON.parse(result.body);
writeFileSync(`./test/${filename}`, Buffer.from(pdfBase64, "base64"));
console.log("Wrote", `./test/${filename}`);
