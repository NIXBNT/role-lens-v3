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

1. Choose a saved position on the searchable home page, or click **Add positions** and select up to 20 job descriptions. Each file creates its own position and rubric. For a batch, titles are extracted from each document and the optional company applies to every file. A title override is available for a single file.
2. Within a position, click **Add candidate CVs**. Upload up to 20 files in the interface; completed candidates save individually. Position uploads and CV uploads are separate queues, and a failed file does not stop the remaining files. Rank scores are calculated from that role's saved rubric.
3. Open a candidate or a score in **Candidate comparison** for verified source quotes, gaps, interview prompts and raw Decisions output. **Role & rubric** shows the full question set; **Export results** downloads the position's JSON.
4. Use **Remove** to hide a position or candidate, and **Undo** to restore the most recently removed item. Removing a candidate affects only its position. These are soft removals, not permanent erasure.

Supported files: PDF, Markdown (`.md`) and DOCX, up to 10 MB per file. PDF must contain readable text; scans require OCR first. PDF is capped at 150 pages. DOCX body paragraphs and tables are read; headers, text boxes and images are omitted. Extracted documents must contain 50–120,000 characters.

## Processing notifications

Each uploaded position or CV receives an individual completion or failure notice. The upload dialog shows queued, processing, completed and failed files. A batch summary reports totals. Open **Notifications** in the header for details and unread counts; the latest 100 notices are stored in this browser, survive reloads and can be cleared. If browser storage is blocked, notifications still work for the current page. These are in-app notices, not desktop/background notifications. Keep the page open until a batch finishes. Filenames and errors in notification history remain on this browser; no key or document text is stored there.

## Running without an API key

Startup, the empty workspace, viewing saved positions/results, exports, removal and Undo work without a key. New rubric generation or CV classification still requires a valid key. Without one, the server returns a clear configuration error before making an OpenAI request; each failed upload is reported in Notifications. Automated tests explicitly start a server with an empty key and reopen saved results without a key.

## Data and models

No roles, CVs, candidate identities or evaluation results are bundled. Add your own position description to begin.

New rubric generation and evidence extraction use `gpt-5.6-sol` with low reasoning. Classification uses `gpt-6-luna` through OpenAI Decisions. Weighted evidence coverage is `sum(weight × score / 3) / sum(weight) × 100`. It is not a calibrated hiring probability. Missing evidence is not proof of absent skill; a person should review the rubric and evidence and verify gaps before shortlisting.

Local changes are saved under ignored `.data/`, as atomic JSON record writes. No database service is required. Original uploads are not saved; role text, rubrics, candidate evidence, Decisions results, and extracted CV text for new uploads are retained. Restarting or rebuilding preserves positions and CV results that you subsequently add.

## Development and specification

```sh
npm test
npm run build
```

Tests use mock inference and temporary local data, with no API key required. See [SPEC.md](SPEC.md) for the retrospective specification, implemented API, persistence behavior, security boundary, acceptance evidence and limitations.

## Light editorial workspace

The interface follows `design-templates/01-editorial.png`: a light two-column positions grid, candidate comparison table and coverage matrix, and a full-page evidence reader. It adapts to narrow screens with horizontally scrollable comparison tables.

- **Positions:** search titles, departments, companies and descriptions; filter by department and Active, Draft or Archived status; sort by recent activity, title or candidate count. The card menu edits the title, company, department, short description and status. Status is organizational; archived positions remain accessible and retain results. Changing metadata does not regenerate a rubric.
- **Candidates:** browse saved evaluations across positions. **Add from bank** re-evaluates the saved CV text against the destination position’s rubric, using the existing inference pipeline and normal API charges. Scores are never copied across positions.
- **Templates:** each saved position provides a reusable rubric. Creating from a template copies its original role description and criteria into a new empty position without an inference call. Upload a new position description when the requirements have changed.
- **Insights:** counts and per-position evidence information. Coverage uses role-specific rubrics; it does not compare suitability across different positions.
- **Evidence reader:** previous/next candidate navigation, criterion filter, verified quotes, expandable rubric, raw classification, summary, interview prompts, reviewer-added supporting links and saved position-specific notes. **View full CV** displays extracted source text rather than the original file layout.
- New uploads retain extracted CV text locally so it can be read and reused. Older records remain compatible but need a new upload to enable full-text viewing and reuse. No original PDF/DOCX binaries are retained. JSON exports include the saved extracted text and notes.

The app remains empty on first launch. Design examples are not seeded into the real workspace. Notifications, batch uploads, export, soft removal and Undo remain available.

### PDF spacing and comparison sorting

PDF extraction joins text fragments by their page positions, preserving words and line breaks. Candidate comparison headers toggle ascending/descending sorting for names, overall coverage and each individual criterion. Sorting uses unrounded scores and does not change saved ranks or classifications.

For previously saved PDF extraction, `node scripts/repair-pdf-extraction.mjs /absolute/original.pdf` previews a repair using the original file; add `--apply` to save it. The repair backs up matching local candidate records under `.data/backups/`, verifies every retained quote against the repaired source, and changes whitespace only. It does not call inference or recalculate scores. Other older PDF records need their originals to be repaired reliably.
