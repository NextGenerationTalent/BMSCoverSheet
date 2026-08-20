import React, { useState } from "react";

export default function ReviewStep({ initialData, cvBase64, cvMimeType, cvText, cvOriginalName, submissionMeta, onDownloaded, onBack }) {
  const [data, setData] = useState({
    candidateName: initialData?.candidateName || "",
    noticePeriod: initialData?.noticePeriod || "",
    relevantExperience: Array.isArray(initialData?.relevantExperience)
      ? initialData.relevantExperience.join("\n")
      : (initialData?.relevantExperience || ""),
    // Single combined field — the real BMS template has ONE cell here
    // ("Right to Work" label, one bulleted value), not two side-by-side
    // fields. Always starts blank: never pre-filled from the CV.
    rightToWork: initialData?.rightToWork || "",
    otherProcesses: initialData?.otherProcesses || "",
  });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setData((d) => ({ ...d, [field]: e.target.value }));

  const validate = () => {
    if (!data.candidateName.trim()) return "Candidate Name is required.";
    if (!data.rightToWork.trim()) {
      return "Right to Work / worker status is required. This must be an explicit answer from the candidate or consultant — never inferred from the CV (an address or driving licence doesn't confirm current legal work status).";
    }
    return "";
  };

  const handleDownload = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError("");
    setDownloading(true);
    try {
      const res = await fetch("/api/bms-generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateData: {
            ...data,
            relevantExperience: data.relevantExperience.split("\n").map((s) => s.trim()).filter(Boolean),
            otherProcesses: data.otherProcesses.split("\n").map((s) => s.trim()).filter(Boolean),
          },
          cvBase64,
          cvMimeType,
          cvText,
          cvOriginalName,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "PDF generation failed.");

      const bytes = Uint8Array.from(atob(json.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename;
      a.click();
      URL.revokeObjectURL(url);
      onDownloaded(json.filename);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="sticky top-14 z-40 -mx-6 px-6 py-3 bg-gray-900 text-white flex items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-6 text-xs overflow-x-auto">
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Role</span>
            <p className="font-semibold truncate max-w-[180px]">{submissionMeta.roleTitle || "—"}</p>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          <div>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              CV pages merged into this PDF — personal details redacted
            </span>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
        >
          {downloading ? "Generating…" : "↓ Download PDF"}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Submission</h1>
          <p className="text-sm text-gray-500 mt-1">All fields are editable. Review carefully before downloading — this document is submitted as-is via Beeline.</p>
        </div>
        <button onClick={onBack} className="btn-secondary text-xs">← Back</button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <span className="text-red-500 text-base leading-none mt-0.5">▲</span>
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="section-title">BMS Candidate Submission Form</p>
        </div>

        <div className="p-5 space-y-0">
          <div className="grid grid-cols-2 border border-gray-200 rounded-t-lg overflow-hidden">
            <div className="p-4 border-r border-gray-200">
              <label className="field-label">Candidate Name <span className="text-red-400">*</span></label>
              <input className="field-input" placeholder="Full name" value={data.candidateName} onChange={set("candidateName")} />
            </div>
            <div className="p-4">
              <label className="field-label">Notice Period</label>
              <input className="field-input" placeholder="e.g. 2 months" value={data.noticePeriod} onChange={set("noticePeriod")} />
            </div>
          </div>

          <div className="border-l border-r border-b border-gray-200">
            <div className="p-4">
              <label className="field-label">
                Relevant Experience
                <span className="normal-case font-normal text-gray-400 ml-1">— one line per bullet; this fills a compact cell, keep it short (3-4 lines)</span>
              </label>
              <textarea className="field-textarea" rows={5} placeholder="One bullet per line..." value={data.relevantExperience} onChange={set("relevantExperience")} />
            </div>
          </div>

          {/* Single field — matches the real template's one combined cell */}
          <div className="border-l border-r border-b border-gray-200">
            <div className="p-4">
              <label className="field-label">
                Right to Work <span className="text-red-400">*</span>
                <span className="normal-case font-normal text-gray-400 ml-1">— candidate worker status (right to work + PAYE/Ltd/Umbrella). Must be an explicit answer, never guessed from the CV.</span>
              </label>
              <input className="field-input" placeholder="e.g. EU citizen, eligible to work in Ireland — PAYE worker" value={data.rightToWork} onChange={set("rightToWork")} />
            </div>
          </div>

          <div className="border-l border-r border-b border-gray-200 rounded-b-lg overflow-hidden">
            <div className="p-4">
              <label className="field-label">
                Other Processes
                <span className="normal-case font-normal text-gray-400 ml-1">— does the candidate have any other ongoing processes? Please specify, or leave blank for none.</span>
              </label>
              <textarea className="field-textarea" rows={2} placeholder="e.g. Also interviewing with Company X — final round pending." value={data.otherProcesses} onChange={set("otherProcesses")} />
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{cvOriginalName}</p>
          <p className="text-xs text-gray-500">
            {cvMimeType === "application/pdf"
              ? "Original CV pages copied into this PDF, with contact details redacted."
              : "Word CV — text extracted, redacted, and paginated into this PDF (pdf-lib can't embed Word files directly)."}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={handleDownload} disabled={downloading} className="btn-primary px-8 py-3 text-base">
          {downloading ? "Generating PDF…" : "↓ Download Combined PDF"}
        </button>
      </div>
    </div>
  );
}
