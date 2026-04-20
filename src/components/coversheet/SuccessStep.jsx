import React, { useState } from "react";

export default function SuccessStep({ filename, candidateName, onReset }) {
  const [copied, setCopied] = useState(false);

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const belineNote = `Candidate submitted via BMS Submission Generator. PDF includes completed BMS Candidate Submission form with relevant experience, right to work, worker status, and notice period. CV appended with personal details redacted as per BMS requirements.`;

  return (
    <div className="max-w-xl mx-auto space-y-6 py-8">
      {/* Success icon */}
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Submission Ready</h1>
        <p className="text-sm text-gray-500 mt-1">
          {filename ? <span className="font-medium text-gray-700">{filename}</span> : "Your PDF"} has been downloaded.
        </p>
      </div>

      {/* Next steps */}
      <div className="card p-5 space-y-4">
        <p className="section-title">Next Steps</p>
        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">1</span>
            <span>Verify the PDF looks correct — open it and check the submission form and CV pages.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">2</span>
            <span>Submit via <strong>Beeline</strong> as required by BMS.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">3</span>
            <span>Log the submission in your ATS / Tracker.</span>
          </li>
        </ol>
      </div>

      {/* Beeline/ATS note copy */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="section-title">ATS / Tracker Note</p>
          <button
            onClick={() => copy(belineNote)}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 leading-relaxed">{belineNote}</p>
      </div>

      {/* New submission */}
      <div className="text-center">
        <button onClick={onReset} className="btn-primary px-8 py-3">
          + New Submission
        </button>
      </div>
    </div>
  );
}
