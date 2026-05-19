import React, { useState } from "react";
import UploadStep from "./components/coversheet/UploadStep.jsx";
import ReviewStep from "./components/coversheet/ReviewStep.jsx";
import SuccessStep from "./components/coversheet/SuccessStep.jsx";

export default function App() {
  const [step, setStep] = useState("upload"); // upload | review | success
  const [extractedData, setExtractedData] = useState(null);
  const [cvBase64, setCvBase64] = useState(null);
  const [cvOriginalName, setCvOriginalName] = useState(null);
  const [submissionMeta, setSubmissionMeta] = useState(null);
  const [downloadFilename, setDownloadFilename] = useState(null);

  function handleExtracted({ candidateData, cvBase64, cvOriginalName, roleTitle, client, consultant, date }) {
    setExtractedData(candidateData);
    setCvBase64(cvBase64);
    setCvOriginalName(cvOriginalName);
    setSubmissionMeta({ roleTitle, client, consultant, date });
    setStep("review");
  }

  function handleDownloaded(filename) {
    setDownloadFilename(filename);
    setStep("success");
  }

  function handleReset() {
    setStep("upload");
    setExtractedData(null);
    setCvBase64(null);
    setCvOriginalName(null);
    setSubmissionMeta(null);
    setDownloadFilename(null);
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* BMS Logo */}
          <img
            src="/bms-logo.png"
            alt="Bristol Myers Squibb"
            className="h-10 w-auto object-contain"
          />
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {["Upload & Extract", "Review & Edit", "Download"].map((label, i) => {
              const stepKey = ["upload", "review", "success"][i];
              const isActive = step === stepKey;
              const isDone = (step === "review" && i === 0) || (step === "success" && i <= 1);
              return (
                <React.Fragment key={label}>
                  {i > 0 && <span className="text-gray-300">›</span>}
                  <span className={`font-medium ${isActive ? "text-gray-900" : isDone ? "text-green-600" : "text-gray-400"}`}>
                    {isDone && !isActive ? "✓ " : ""}{label}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === "upload" && <UploadStep onExtracted={handleExtracted} />}
        {step === "review" && (
          <ReviewStep
            initialData={extractedData}
            cvBase64={cvBase64}
            cvOriginalName={cvOriginalName}
            submissionMeta={submissionMeta}
            onDownloaded={handleDownloaded}
            onBack={() => setStep("upload")}
          />
        )}
        {step === "success" && (
          <SuccessStep
            filename={downloadFilename}
            candidateName={extractedData?.candidateName}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}
