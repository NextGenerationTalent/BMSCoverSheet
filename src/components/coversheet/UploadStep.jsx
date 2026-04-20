import React, { useState, useRef, useCallback } from "react";

const MAX_SIZE = 5.5 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function today() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function UploadStep({ onExtracted }) {
  const [cvFile, setCvFile] = useState(null);
  const [notes, setNotes] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [client, setClient] = useState("");
  const [consultant, setConsultant] = useState("");
  const [date] = useState(today());
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const validateFile = (file) => {
    if (!file) return "Please select a file.";
    if (file.type !== "application/pdf") {
      return "PDF files only. BMS requires PDF format — Word, Google Docs, and other formats are not accepted and risk automatic rejection.";
    }
    if (file.size > MAX_SIZE) {
      return `File is ${formatBytes(file.size)} — maximum is 5.5 MB. Please compress it at ilovepdf.com and re-upload.`;
    }
    return null;
  };

  const handleFile = (file) => {
    const err = validateFile(file);
    if (err) { setError(err); setCvFile(null); return; }
    setError("");
    setCvFile(file);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cvFile) { setError("Please upload the candidate CV (PDF only)."); return; }
    if (!roleTitle.trim()) { setError("Please enter the Role Title."); return; }
    if (!client.trim()) { setError("Please enter the Client / Company name."); return; }
    setError("");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("cv", cvFile);
      formData.append("notes", notes);
      formData.append("roleTitle", roleTitle);
      formData.append("client", client);
      formData.append("consultant", consultant);

      const res = await fetch("/api/bms-extract", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Extraction failed.");

      onExtracted({
        candidateData: json.candidateData,
        cvBase64: json.cvBase64,
        cvOriginalName: json.cvOriginalName,
        roleTitle,
        client,
        consultant,
        date,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New BMS Submission</h1>
        <p className="text-sm text-gray-500 mt-1">Upload the candidate CV and complete the details below, then click Extract.</p>
      </div>

      {/* BMS compliance notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-semibold text-amber-900 mb-2">BMS CV & Document Requirements (Non-Negotiable)</p>
            <ul className="text-xs text-amber-800 space-y-1">
              <li>☐ CV is in <strong>PDF format only</strong></li>
              <li>☐ CV uses the <strong>official BMS CV template</strong></li>
              <li>☐ CV contains <strong>NO company branding</strong></li>
              <li>☐ No Word, Google Docs, or alternative formats attached</li>
              <li>☐ All uploaded documents are <strong>PDF only</strong></li>
            </ul>
            <p className="text-xs text-amber-700 mt-2 font-medium">❗ Any non-PDF or non-BMS template = automatic rejection risk</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
            <span className="text-red-500 text-base leading-none mt-0.5">▲</span>
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left column */}
          <div className="lg:col-span-3 space-y-5">
            {/* CV Upload */}
            <div className="card p-5">
              <p className="section-title mb-4">Step 1 — Candidate CV (PDF Only)</p>
              <div
                className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                  dragging ? "border-blue-400 bg-blue-50" : cvFile ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
                }`}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files[0])}
                />
                {cvFile ? (
                  <div className="flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{cvFile.name}</p>
                      <p className="text-xs text-gray-500">{formatBytes(cvFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCvFile(null); setError(""); }}
                      className="text-gray-400 hover:text-gray-600 p-1"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                    <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center mb-3 shadow-sm">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Drop PDF here or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">PDF only · Max 5.5 MB</p>
                  </div>
                )}
              </div>
            </div>

            {/* Interview Notes */}
            <div className="card p-5">
              <p className="section-title mb-4">Step 2 — Interview Notes</p>
              <label className="field-label">
                Recruiter notes, Fireflies transcript, or structured bullets
                <span className="normal-case font-normal text-gray-400 ml-1">— include all salary and package figures here</span>
              </label>
              <textarea
                className="field-textarea"
                rows={8}
                placeholder="Paste recruiter notes here. Include: notice period, current salary, bonus, pension, health, car allowance, target salary, motivation for move, availability..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-2 space-y-5">
            <div className="card p-5">
              <p className="section-title mb-4">Step 3 — Submission Details</p>
              <div className="space-y-4">
                <div>
                  <label className="field-label">Role Title <span className="text-red-400">*</span></label>
                  <input className="field-input" placeholder="e.g. Senior QA Specialist" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Client / Company <span className="text-red-400">*</span></label>
                  <input className="field-input" placeholder="e.g. BMS Ireland" value={client} onChange={(e) => setClient(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Consultant</label>
                  <input className="field-input" placeholder="Your name" value={consultant} onChange={(e) => setConsultant(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Date</label>
                  <input className="field-input bg-gray-50 text-gray-500 cursor-default" value={date} readOnly />
                </div>
              </div>
            </div>

            {/* Tips */}
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-xs font-semibold text-blue-800 mb-2">Tips for best results</p>
              <ul className="text-xs text-blue-700 space-y-1.5">
                <li>• Include all salary figures in the notes — the AI uses notes as the primary source</li>
                <li>• Mention notice period and availability explicitly</li>
                <li>• Include motivation for move if discussed</li>
                <li>• The AI will extract relevant experience from the CV automatically</li>
              </ul>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Extracting… (10–20s)
                </>
              ) : (
                <>⚡ Extract Candidate Data</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
