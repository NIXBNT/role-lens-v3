# Role Lens v3 — retrospective specification

Status: implemented, 20 October 2026. This document describes the delivered v3 code and verification, rather than a plan for future implementation.

## Purpose and scope

Role Lens is a single-user local recruitment review workspace. It generates classification criteria from a position description, evaluates CV evidence against the saved criteria, and presents a ranked comparison with traceable source quotations. Its scores support human review; it does not make or execute employment decisions.

V3 retains v2's position picker, file uploads, role-specific rubrics, candidate comparison, evidence details, export, removal and Undo. V3 replaces the hosted application with a Node HTTP server and a filesystem record store. It has no hosted authentication, Sites integration, platform identifiers, cloud storage binding, deployment archive or serverless Worker requirement. Browser assets and PDF parsing code are served locally, and the UI uses system fonts. New inference still calls OpenAI over HTTPS.

## Runtime and configuration

- Runtime: Node.js 22.16+ and npm; ES modules throughout.
- `npm ci` installs pinned dependencies. `npm start` invokes `prestart` to build assets, then runs `server.mjs`, loading `.env` if present. An absent key does not block startup or the empty workspace.
- Default address: `http://127.0.0.1:4183`. `PORT` can select another integer port from 1 to 65535. The server always binds to IPv4 loopback.
- `OPENAI_API_KEY` is supplied through the process environment or a Git-ignored `.env`. `.env.example` contains names and a blank value, not a credential.
- `DATA_DIR` selects a local record directory; the default is `.data` beside the application. A relative override resolves from the process working directory.
- A busy port produces a specific terminal message. Missing browser build output produces an HTTP 503 response with build instructions. SIGINT/SIGTERM close the listener gracefully; forced cancellation of in-flight inference is not implemented.

## User-visible behavior

### Position home

The home page lists active positions, their companies, classification counts and candidate counts. Search filters title and company locally. Selecting a position loads only its rubric and candidates. A notice explains when no API key is configured. A fresh workspace has no positions or candidates; the empty state invites the user to add a position.

### Add a position

The user selects one PDF, Markdown or DOCX file, with optional title and company overrides. The browser extracts its text and POSTs structured document sections to the local server. Sol receives only the role, not candidate CVs, and creates 8–12 criteria. A criterion contains a unique identifier, title, question, role basis, positive weight, preferred flag and four ordered evidence levels. Weights must sum to 100, and identifiers must satisfy a bounded alphanumeric/underscore/hyphen pattern.

A valid role and rubric are saved as a new UUID position before the UI opens its empty candidate list. No candidate evaluation occurs at this stage. A failed API call or invalid generated rubric leaves no partial position record. Progress is displayed while the request is pending; the upload dialog cannot be dismissed during processing.

### Add candidate CVs

The UI accepts up to 20 files per selection and processes them sequentially. Each browser-extracted CV is submitted to the selected position's candidate endpoint. A matching active filename or extracted-text SHA-256 fingerprint is rejected as a duplicate within that position. The same CV can be evaluated independently for another position.

Decisions answers one score question per saved criterion against the CV text. Sol separately extracts supporting quotations, source locations, gaps and interview prompts; it does not replace Decisions scores. Every displayed quotation must match the cited extracted section after whitespace normalization. Unmatched proposed quotes are omitted and the omission is recorded. Missing, duplicate, refused or invalid classification answers prevent saving a misleading ranking.

A completed candidate is saved separately and scored. When a later file fails, earlier successes remain saved and the dialog reports the failures. If a position was removed during evaluation, the new candidate is not saved. Batch-size enforcement is in the UI; each backend request contains one CV.

### Results and removal

- Candidate ranking orders the selected position's candidates by descending evidence coverage.
- Compare classifications displays per-criterion scores across candidates. A score or candidate opens evidence details, gaps, interview prompts, rubric levels and raw classification data.
- Role & rubric displays the position text and criterion definitions.
- Export results downloads the currently loaded position and its active candidates as JSON.
- Removing a candidate affects only that position. Removing a position hides its entire candidate list. Both actions write a persistent `deleted` flag; records remain on disk.
- Undo restores the most recently removed item through an explicit restore endpoint. The toast is browser-session UI, not a persistent recycle-bin view. Restore endpoints remain usable with known identifiers after restarting.
- A permanent erase UI, account management, multiple recruiters and cross-role suitability ranking are outside this version's scope.

## Input extraction

Extraction occurs in the browser, not through a hosted parser service. The backend receives JSON text sections rather than original file bytes.

| Type | Implemented extraction | Limits and omissions |
| --- | --- | --- |
| `.md` | UTF-8 text, `Markdown` source location | No Markdown execution |
| `.pdf` | Bundled PDF.js with a locally served PDF worker; `Page N` locations | At most 150 pages; pages with fewer than 20 readable characters fail, including blank or scanned pages; no OCR |
| `.docx` | fflate extracts `word/document.xml`, then DOMParser reads body paragraphs/tables in document order; `Block N` locations | Selected XML expansion capped at 2 MB; headers, text boxes and embedded images are not supported |

The browser caps original files at 10 MB. The backend independently checks filename/type, section shape, at most 1,000 sections, bounded location strings and reconstructed extracted-text length of 50–120,000 characters. The HTTP adapter caps request bodies at 2 MiB, including chunked bodies. These are different limits: source file size is not the same as extracted JSON size.

## Model and scoring contract

The inherited model integration is unchanged: `gpt-5.6-sol`, low reasoning, uses Responses with strict JSON schemas for rubrics and evidence; `gpt-6-luna` uses `/v1/decisions` for classification. Account availability of these models is required. Each request has a 180-second network timeout. There is no automatic retry, alternative-model substitution or fabricated fallback. API errors are shown to the user.

Prompts instruct models to treat documents as untrusted evidence, ignore embedded instructions and exclude personal/protected characteristics from evaluation. This is an instruction-level mitigation, not a guarantee against model mistakes or injection. Full extracted document text is nevertheless transmitted for inference and may contain personal information.

For criterion weights `w_i` and Decisions scores `s_i` on levels 0–3:

`evidence_coverage = 100 × sum(w_i × s_i / 3) / sum(w_i)`

The score is role-specific documented evidence coverage, not confidence, probability of suitability or a recommendation to hire. Decisions confidence/probabilities and the rubric are available for inspection. No calibration or hiring-outcome validation has been performed. Missing resume evidence is not evidence of inability. No historical evaluations or personal resume evidence are bundled.

## Architecture and persistence

| Component | Responsibility |
| --- | --- |
| `server.mjs` | Loopback HTTP listener, Host/Origin checks, body limits, static allowlist, health endpoint and Request/Response adapter |
| `src/backend.mjs` | Position/candidate API, validation, inference orchestration, duplicate detection, scoring and removal/restore |
| `src/inference.mjs` | Structured rubric/evidence calls, Decisions requests and response validation, weighted ranking |
| `src/store.mjs` | Local JSON record storage using encoded keys and atomic write/rename |
| `ui/` | Position selection, extraction, uploads, progress, ranking, evidence dialogs and Undo |
| `scripts/build.mjs` | esbuild browser bundle and copy of HTML, CSS and PDF worker into `dist/` |
| `tests/fixtures.mjs` | Synthetic test-only criteria and records; not loaded by the app |

Records use keys such as `jobs/{id}.json` and `candidates/{jobId}/{candidateId}.json`. Each key is URI-encoded into a single filename, preventing keys from navigating outside the data directory. New directories request mode 0700 and record files 0600 where supported. Writes use a unique temporary file followed by rename; interrupted writes do not expose half-written JSON. Temporary files are excluded from listing. Filesystem errors and corrupt records surface as errors rather than silently resetting user data.

All position and candidate records originate from user uploads. There are no bundled defaults or fallback records. Rebuilding or restarting does not modify local records. Original PDF/DOCX/Markdown uploads are not retained. Position records retain extracted role text and criteria; candidate records retain filename/label, fingerprint for newly evaluated CVs, Decisions outputs, score-related evidence and creation time. There is no automatic data retention policy, encryption at rest, backup process or multi-process write coordination. Concurrent operations can have last-write-wins behavior.

## Implemented HTTP interface

| Method and route | Behavior |
| --- | --- |
| `GET /api/health` | Version/status and boolean `apiKeyConfigured`; never returns the key |
| `GET /api/jobs` | Active position summaries and candidate counts |
| `POST /api/jobs` | Generate and save a rubric from `{document, title?, company?}` |
| `GET /api/jobs/:id` | Position, rubric and ranked active candidates |
| `DELETE /api/jobs/:id` | Persist soft removal |
| `POST /api/jobs/:id/restore` | Restore removed position |
| `POST /api/jobs/:id/candidates` | Evaluate/save one `{document, label?}` |
| `DELETE /api/jobs/:id/candidates/:candidateId` | Persist candidate soft removal |
| `POST /api/jobs/:id/candidates/:candidateId/restore` | Restore candidate |

A document is `{filename, sections: [{location, text}]}`. The backend reconstructs its evidence text. Successful creates use 201; normal reads/mutations use 200. Invalid input or model failures use 400, rejected origins/hosts 403, missing records/routes 404, duplicate CVs or a removed in-flight position 409. The local adapter rejects oversized bodies with 413, non-JSON POSTs with 415 and unsupported API methods with 405. GET assets are restricted to `/`, `/app.js`, `/style.css` and `/pdf-worker.mjs`; `.env`, application sources and runtime records are not static routes.

## Security and external dependencies

This is a trusted single-user local application, not an authenticated shared web service. Loopback binding is the main reachability boundary. Allowed Host values are `127.0.0.1:<actual port>` and `localhost:<actual port>`. Supplied Origins must match the request origin. JSON-only POSTs and absence of permissive CORS headers further restrict browser-origin mutation. Local CLI clients may omit Origin. These controls do not protect against malicious processes already running as the same user, or against exposure through a tunnel/proxy.

Keys remain in the server process/environment and are never sent to the browser, written to application records or included in the public repository. `.env`, runtime data, dependencies, generated assets, key files and logs are ignored by Git. The current source tree contains no uploaded resume evidence or historical evaluation dataset. Earlier Git commits may still contain the previously bundled examples; this change does not rewrite repository history. npm installation requires network access, and new inference requires OpenAI. Apart from inference and user-followed source links, the built UI does not require remote fonts, scripts, authentication or storage.

## Acceptance and verification evidence

The v3 automated suite contains nine tests. The five inherited backend checks cover empty startup, per-position removal/restore and isolation, rubric-before-CV ordering, mocked Decisions/evidence calls, weighted scores, duplicate rejection, failed-call atomicity and input/Origin rejection. Four new checks exercise the filesystem and actual loopback HTTP server:

1. Local records survive reopening, prefix listing isolates records, path-like keys are encoded, and completed writes leave no temporary file.
2. Health and an empty position list work without a key, required assets are served, private paths are unavailable and new inference reports a missing key.
3. Mock-generated roles and candidates survive a full server restart; removal and restore persist through the HTTP API.
4. Foreign Origins, hostile Host headers, non-JSON POSTs, oversized bodies and unsupported methods are rejected.

`npm run build` produces the local browser assets. Tests use temporary data directories and mock inference; they do not incur API charges or represent fresh live model validation. Test data is entirely synthetic and is not imported by runtime modules. Automated browser interaction and a fresh live inference run are not part of the v3 automated test suite. No claim is made that extraction handles every document layout, or that hiring scores are unbiased, calibrated or sufficient for a final decision.
