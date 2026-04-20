# BMS Candidate Submission Generator

A Netlify-deployable tool that generates BMS-compliant candidate submission PDFs, replicating the official BMS Candidate Submission Template exactly.

## Features

- **PDF-only enforcement** — rejects Word, Google Docs, and other formats with a clear BMS compliance message
- **AI extraction** — uses Claude to populate the submission form from the CV and recruiter notes
- **Exact BMS template** — the generated PDF matches the official BMS Candidate Submission table layout
- **Personal detail redaction** — phone numbers, emails, and addresses are removed from the appended CV
- **Fully editable review** — all fields can be edited before downloading

## Deployment to Netlify

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "BMS Submission Generator"
gh repo create bms-coversheet --private --push --source=.
```

### Step 2 — Connect to Netlify

1. Log in to [app.netlify.com](https://app.netlify.com)
2. **Add new site → Import an existing project**
3. Connect your GitHub repo — Netlify auto-reads `netlify.toml`

### Step 3 — Set Environment Variable

In Netlify → **Site configuration → Environment variables → Add a variable**:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (your Claude API key) |

Get your API key at [console.anthropic.com](https://console.anthropic.com).

### Step 4 — Deploy

Click **Deploy site** — builds in ~30 seconds.

## BMS Requirements Enforced

- PDF format only (Word/Google Docs rejected)
- Personal details (phone, email, address) redacted from CV
- No company branding visible on submitted PDF
- Matches official BMS Candidate Submission table layout exactly

## Fields

| Field | Source |
|-------|--------|
| Candidate Name | CV |
| Notice Period | Recruiter notes (primary), CV (fallback) |
| Relevant Experience | AI-generated from CV + notes |
| Right to Work | Recruiter notes (primary), CV (fallback) |
| Candidate Worker Status | Recruiter notes |
| Other Processes | Recruiter notes |
