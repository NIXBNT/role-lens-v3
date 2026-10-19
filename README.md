# Role Lens v3

A local web app for comparing CV evidence against position-specific classification rubrics. It runs on your computer with a Node.js server and local JSON storage. No Sites account, cloud storage or hosted deployment is needed.

## Run locally

Requires Node.js 22.16+ and npm. From this directory:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4183**. `npm start` builds browser assets automatically. The app starts with no positions or candidates.

For new evaluations, copy `.env.example` to `.env` and set your own `OPENAI_API_KEY`, then restart. Alternatively supply the key in the process environment. Keys stay on the server and are excluded from Git. Standard OpenAI API charges apply; document text is sent to OpenAI when you create a rubric or evaluate a CV. There are no synthetic fallback scores.

Optional `.env` settings:

```dotenv
PORT=4183
DATA_DIR=.data
```

The server binds only to `127.0.0.1`. It is intended for one trusted local user, with no login system. Do not expose it through a public tunnel or reverse proxy. Local operation does not mean offline inference: new model evaluations require Internet access and API access to the configured models.

## Use

1. Choose a saved position on the searchable home page, or click **Add a position** and upload a job description. A role-only rubric is created before any CV is evaluated.
2. Within a position, click **Add candidate CVs**. Upload up to 20 files in the interface; completed candidates save individually. Rank scores are calculated from that role's saved rubric.
3. Open a candidate or a score in **Compare classifications** for verified source quotes, gaps, interview prompts and raw Decisions output. **Role & rubric** shows the full question set; **Export results** downloads the position's JSON.
4. Use **Remove** to hide a position or candidate, and **Undo** to restore the most recently removed item. Removing a candidate affects only its position. These are soft removals, not permanent erasure.

Supported files: PDF, Markdown (`.md`) and DOCX, up to 10 MB per file. PDF must contain readable text; scans require OCR first. PDF is capped at 150 pages. DOCX body paragraphs and tables are read; headers, text boxes and images are omitted. Extracted documents must contain 50–120,000 characters.

## Data and models

No roles, CVs, candidate identities or evaluation results are bundled. Add your own position description to begin.

New rubric generation and evidence extraction use `gpt-5.6-sol` with low reasoning. Classification uses `gpt-6-luna` through OpenAI Decisions. Weighted evidence coverage is `sum(weight × score / 3) / sum(weight) × 100`. It is not a calibrated hiring probability. Missing evidence is not proof of absent skill; a person should review the rubric and evidence and verify gaps before shortlisting.

Local changes are saved under ignored `.data/`, as atomic JSON record writes. No database service is required. Original uploads are not saved; role text, rubrics, candidate evidence and Decisions results are retained. Restarting or rebuilding preserves positions and CV results that you subsequently add.

## Development and specification

```sh
npm test
npm run build
```

Tests use mock inference and temporary local data, with no API key required. See [SPEC.md](SPEC.md) for the retrospective specification, implemented API, persistence behavior, security boundary, acceptance evidence and limitations.
