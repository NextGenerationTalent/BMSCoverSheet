import React, { useState } from "react";

export default function ReviewStep({ initialData, cvBase64, cvOriginalName, submissionMeta, onDownloaded, onBack }) {
  const [data, setData] = useState({
    candidateName: initialData?.candidateName || "",
    noticePeriod: initialData?.noticePeriod || "",
    relevantExperience: initialData?.relevantExperience || "",
    rightToWork: initialData?.rightToWork || "",
    workerStatus: initialData?.workerStatus || "",
    otherProcesses: initialData?.otherProcesses || "",
  });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setData((d) => ({ ...d, [field]: e.target.value }));

  const handleDownload = async () => {
    if (!data.candidateName.trim()) {
      setError("Candidate Name is required before downloading.");
      return;
    }
    setError("");
    setDownloading(true);
    try {
      const res = await fetch("/api/bms-generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateData: data,
          cvBase64,
          roleTitle: submissionMeta.roleTitle,
          client: submissionMeta.client,
          consultant: submissionMeta.consultant,
          date: submissionMeta.date,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "PDF generation failed.");

      // Trigger download
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
      {/* Sticky banner */}
      <div className="sticky top-14 z-40 -mx-6 px-6 py-3 bg-gray-900 text-white flex items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-6 text-xs overflow-x-auto">
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Client</span>
            <p className="font-semibold truncate max-w-[140px]">{submissionMeta.client}</p>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Role</span>
            <p className="font-semibold truncate max-w-[180px]">{submissionMeta.roleTitle}</p>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          {submissionMeta.consultant && (
            <>
              <div>
                <span className="text-gray-400 uppercase tracking-wider text-[10px]">Consultant</span>
                <p className="font-semibold truncate max-w-[140px]">{submissionMeta.consultant}</p>
              </div>
              <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
            </>
          )}
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Date</span>
            <p className="font-semibold">{submissionMeta.date}</p>
          </div>
          <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
          <div>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              PDF — personal details redacted
            </span>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex-shrink-0 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50"
        >
          {downloading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating…
            </>
          ) : (
            <>↓ Download PDF</>
          )}
        </button>
      </div>

      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Submission</h1>
          <p className="text-sm text-gray-500 mt-1">All fields are editable. Review carefully before downloading.</p>
        </div>
        <button onClick={onBack} className="btn-secondary text-xs">← Back</button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <span className="text-red-500 text-base leading-none mt-0.5">▲</span>
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* BMS Submission Table Preview */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="section-title">BMS Candidate Submission Form</p>
          <span className="text-xs text-gray-400">Matches official BMS template exactly</span>
        </div>

        {/* The form fields mirroring the BMS table */}
        <div className="p-5 space-y-0">
          {/* Row 1: Candidate Name | Notice Period */}
          <div className="grid grid-cols-2 border border-gray-200 rounded-t-lg overflow-hidden">
            <div className="p-4 border-r border-gray-200">
              <label className="field-label">Candidate Name <span className="text-red-400">*</span></label>
              <input
                className="field-input"
                placeholder="Full name"
                value={data.candidateName}
                onChange={set("candidateName")}
              />
            </div>
            <div className="p-4">
              <label className="field-label">Notice Period</label>
              <input
                className="field-input"
                placeholder="e.g. 3 months"
                value={data.noticePeriod}
                onChange={set("noticePeriod")}
              />
            </div>
          </div>

          {/* Row 2: Relevant Experience (full width, large) */}
          <div className="border-l border-r border-b border-gray-200">
            <div className="p-4">
              <label className="field-label">
                Relevant Experience
                <span className="normal-case font-normal text-gray-400 ml-1">— specific skills and experience that make this candidate suitable for the vacancy</span>
              </label>
              <textarea
                className="field-textarea"
                rows={12}
                placeholder="Describe the candidate's relevant experience, key skills, and why they are suitable for this specific role. Include technical competencies, sector experience, notable achievements, and any directly relevant qualifications..."
                value={data.relevantExperience}
                onChange={set("relevantExperience")}
              />
            </div>
          </div>

          {/* Row 3: Right to Work | Worker Status */}
          <div className="grid grid-cols-2 border-l border-r border-b border-gray-200">
            <div className="p-4 border-r border-gray-200">
              <label className="field-label">Right to Work</label>
              <input
                className="field-input"
                placeholder="e.g. EU Citizen, Stamp 4, Work Permit"
                value={data.rightToWork}
                onChange={set("rightToWork")}
              />
            </div>
            <div className="p-4">
              <label className="field-label">Candidate Worker Status</label>
              <input
                className="field-input"
                placeholder="e.g. PAYE, Limited Company, Umbrella"
                value={data.workerStatus}
                onChange={set("workerStatus")}
              />
            </div>
          </div>

          {/* Row 4: Other Processes (full width) */}
          <div className="border-l border-r border-b border-gray-200 rounded-b-lg overflow-hidden">
            <div className="p-4">
              <label className="field-label">
                Other Processes
                <span className="normal-case font-normal text-gray-400 ml-1">— does the candidate have any other ongoing processes? Please specify.</span>
              </label>
              <textarea
                className="field-textarea"
                rows={3}
                placeholder="e.g. First interview with Pfizer scheduled for next week. Final round with Merck pending. No other active processes."
                value={data.otherProcesses}
                onChange={set("otherProcesses")}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CV info */}
      <div className="card p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{cvOriginalName}</p>
          <p className="text-xs text-gray-500">Will be appended to the submission — personal details (phone, email, address) redacted</p>
        </div>
      </div>

      {/* Download button */}
      <div className="flex justify-end">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary px-8 py-3 text-base"
        >
          {downloading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating PDF…
            </>
          ) : (
            <>↓ Download Combined PDF</>
          )}
        </button>
      </div>
    </div>
  );
}
