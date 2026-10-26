import { sortCandidates, nextComparisonSort } from "./comparison.mjs";
import { extractFile } from "./extract.mjs";
import { processBatch, createNotificationLog } from "./batch.mjs";
let jobs = [],
  data = null,
  view = "ranking",
  busy = false,
  page = "positions",
  positionFilter = "all",
  selectedCandidate = null,
  detailTab = "evidence",
  selectedCriterion = "",
  allCandidates = [];
let comparisonSort = { key: "overall", direction: "descending" };
let storage;
try {
  storage = window.localStorage;
} catch {}
const notificationLog = createNotificationLog(storage);
const $ = (s) => document.querySelector(s);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pct = (x) => `${Number(x || 0).toFixed(0)}%`;
const answer = (c, q) => c.decisions.answers.find((a) => a.name === q.id);
const value = (c, q) => ((answer(c, q)?.score || 0) / 3) * 100;
const initials = (s) =>
  String(s)
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const icon = (name = "briefcase") => {
  const paths = {
    code: "M8 5 2 12l6 7M16 5l6 7-6 7M14 3l-4 18",
    chart: "M4 21V11h4v10M10 21V7h4v14M16 21V3h4v18",
    data: "M3 5c0-4 18-4 18 0S3 9 3 5M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0",
    palette:
      "M12 3C1 3-1 19 10 21c5 1-2-5 2-5h5c8 0 5-13-5-13M7 9h.01M12 7h.01M17 10h.01M6 14h.01",
    briefcase: "M8 6V4h8v2M3 7h18v14H3zM3 12h18M10 12v3h4v-3",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    users:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M13 3a4 4 0 0 1 0 8M22 21v-3a4 4 0 0 0-3-3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    upload: "M12 16V3M7 8l5-5 5 5M3 15v6h18v-6",
    file: "M14 2H4v20h16V8zM14 2v6h6M8 13h8M8 17h6",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    arrow: "M5 12h14M14 7l5 5-5 5",
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.briefcase}"/></svg>`;
};
function departmentVisual(department = "General") {
  const d = department.toLowerCase();
  if (/engineer/.test(d)) return ["code", 1];
  if (/people|human/.test(d)) return ["users", 3];
  if (/market/.test(d)) return ["chart", 2];
  if (/design/.test(d)) return ["palette", 4];
  if (/data/.test(d)) return ["data", 0];
  if (/finance/.test(d)) return ["chart", 1];
  return ["briefcase", 0];
}
const progress = (n) =>
  `<div class="bar"><i style="width:${Math.max(0, Math.min(100, n))}%;background:${n >= 75 ? "#32ba85" : n >= 50 ? "#438bea" : n >= 25 ? "#efb73b" : "#ee9a45"}"></i></div>`;
const date = (s) =>
  s
    ? new Date(s).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
function ago(s) {
  if (!s) return "Recently";
  const days = Math.max(0, Math.floor((Date.now() - new Date(s)) / 86400000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
function header() {
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === page);
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
async function api(url, options = {}) {
  const r = await fetch(
    "/api" + url,
    options.body
      ? {
          ...options,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : options,
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Request failed.");
  return d;
}
async function home() {
  try {
    const [listing, health] = await Promise.all([api("/jobs"), api("/health")]);
    jobs = listing.jobs;
    data = null;
    selectedCandidate = null;
    page = "positions";
    header();
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#status").hidden = true;
    $("#main").innerHTML =
      `<div class="homehero"><div><h1>Your positions</h1><p class="intro">Compare candidate evidence against position-specific<br class="desktop"> classification rubrics.</p></div><button class="primary" data-action="addJob">＋ Add position</button></div>${health.apiKeyConfigured ? "" : '<div class="notice">Set OPENAI_API_KEY in your local .env file to create rubrics and evaluate CVs. Saved results remain available.</div>'}<div class="searchtools"><label class="searchfield">${icon("search")}<input id="search" type="search" aria-label="Search positions" placeholder="Search positions, departments or keywords…"></label><select id="department" aria-label="Filter department"><option value="">All departments</option>${[
        ...new Set(jobs.map((j) => j.department || "General")),
      ]
        .sort()
        .map((d) => `<option>${esc(d)}</option>`)
        .join(
          "",
        )}</select></div><div class="filterline"><div class="tabs" role="group" aria-label="Position status">${["all", "active", "draft", "archived"].map((s) => `<button data-filter="${s}" class="${positionFilter === s ? "active" : ""}">${{ all: "All positions", active: "Active", draft: "Drafts", archived: "Archived" }[s]} <span class="count">${jobs.filter((j) => s === "all" || (j.status || "active") === s).length}</span></button>`).join("")}</div><label class="sortlabel">Sort by <select id="sort" aria-label="Sort positions"><option value="recent">Most recent</option><option value="title">Title A–Z</option><option value="candidates">Most candidates</option></select></label></div><div id="positionList"></div>`;
    positionList();
    for (const id of ["search", "department", "sort"])
      $("#" + id).addEventListener(
        id === "search" ? "input" : "change",
        positionList,
      );
  } catch (e) {
    error(e);
  }
}
function positionList() {
  const term = $("#search").value.toLowerCase(),
    dept = $("#department").value;
  const found = jobs.filter(
    (j) =>
      (positionFilter === "all" || (j.status || "active") === positionFilter) &&
      (!dept || (j.department || "General") === dept) &&
      [j.title, j.company, j.department, j.description]
        .join(" ")
        .toLowerCase()
        .includes(term),
  );
  found.sort((a, b) =>
    $("#sort").value === "title"
      ? a.title.localeCompare(b.title)
      : $("#sort").value === "candidates"
        ? b.candidateCount - a.candidateCount
        : new Date(b.updatedAt) - new Date(a.updatedAt),
  );
  $("#positionList").innerHTML = found.length
    ? `<div class="positioncards">${found.map((j, i) => `<article class="positioncard"><span class="roleicon color${departmentVisual(j.department)[1]}">${icon(departmentVisual(j.department)[0])}</span><div class="positioncopy"><span class="company">${esc(j.department || "General")}</span><h2><button class="textbutton" data-open="${j.id}">${esc(j.title)}</button></h2><p>${esc(j.description)}</p></div><details class="cardmenu"><summary aria-label="Options for ${esc(j.title)}">•••</summary><div><button data-settings="${j.id}">Edit position</button><button data-remove-job="${j.id}">Remove</button></div></details><div class="positionstats"><span>${icon("users")} ${j.candidateCount} candidate${j.candidateCount === 1 ? "" : "s"}</span><span>Updated ${ago(j.updatedAt)}</span></div></article>`).join("")}</div>`
    : `<div class="empty"><h2>${jobs.length ? "No matching positions" : "Your workspace starts here"}</h2><p>${jobs.length ? "Try another search or filter." : "Add a position description to create a rubric, then compare candidate evidence."}</p><button class="primary" data-action="addJob">＋ Add position</button></div>`;
}
async function openJob(id, candidateId) {
  try {
    $("#status").hidden = false;
    $("#status").textContent = "Loading position…";
    if (data?.id !== id)
      comparisonSort = { key: "overall", direction: "descending" };
    data = await api("/jobs/" + id);
    view = "ranking";
    selectedCandidate = null;
    page = "positions";
    header();
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#status").hidden = true;
    if (candidateId) detail(data.candidates.find((c) => c.id === candidateId));
    else job();
  } catch (e) {
    error(e);
  }
}
function job() {
  window.scrollTo({ top: 0, behavior: "instant" });
  selectedCandidate = null;
  const j = data;
  $("#main").innerHTML =
    `<button class="back" data-action="home">← Back to positions</button><div class="homehero roleheading"><div><h1>${esc(j.title)}</h1><p class="intro">Compare candidate evidence against the role rubric to see how each candidate<br class="desktop"> meets the classification criteria.</p></div><div class="actions"><button data-set-view="rubric">${icon("briefcase")} Role & rubric</button><button class="primary" data-action="export">Export results ↓</button></div></div><div class="tabs role-tabs">${[
      [
        "ranking",
        `Candidates <span class="count">${j.candidates.length}</span>`,
      ],
      ["rubric", "Rubric"],
      ["role", "Role details"],
      ["activity", "Activity"],
    ]
      .map(
        ([v, t]) =>
          `<button data-view="${v}" class="${view === v ? "active" : ""}">${t}</button>`,
      )
      .join("")}</div><div id="view"></div>`;
  render();
}
function rubricContent() {
  return `<p class="subtle">Generated from the position description before any CVs were evaluated.</p><p>${esc(data.method)}</p>${data.criteria.map((q) => `<article class="criterion"><span class="eyebrow">${q.weight}% weight ${q.preferred ? "· Preferred" : ""}</span><h3>${esc(q.title)}</h3><p>${esc(q.question)}</p><p class="subtle">${esc(q.basis)}</p>${q.levels.map((l, i) => `<div class="level"><strong>${i} · ${esc(l.label)}</strong>${esc(l.description)}</div>`).join("")}</article>`).join("")}`;
}
function comparisonHeading(key, label) {
  const active = comparisonSort.key === key;
  return `<th scope="col" aria-sort="${active ? comparisonSort.direction : "none"}"><button class="sortheading" data-comparison-sort="${esc(key)}" aria-label="Sort by ${esc(label.replace(/<[^>]*>/g, " "))}"><span class="sortlabeltext">${label}</span><span class="sortindicator" aria-hidden="true">${active ? (comparisonSort.direction === "ascending" ? "↑" : "↓") : "↕"}</span></button></th>`;
}
function render() {
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const cs = sortCandidates(data.candidates, comparisonSort);
  if (view === "ranking" || view === "compare")
    $("#view").innerHTML =
      `<div class="uploadstrip"><span class="uploadicon">${icon("upload")}</span><div><strong>Add candidate CVs</strong><p>Upload CVs (PDF, DOCX or Markdown) or add from your candidate bank.</p></div><div class="actions"><button data-action="addCV">Upload CVs</button><button data-action="bank">Add from bank</button></div></div><div class="sectionheading"><div><h2>Candidate comparison</h2><p class="subtle">Evidence coverage across rubric criteria, weighted by importance.</p></div><small class="subtle">ⓘ Evidence coverage, not hiring probability.</small></div>${cs.length ? `<div class="tablewrap"><table class="comparison"><thead><tr>${comparisonHeading("candidate", "Candidate")}${comparisonHeading("overall", "Overall<br>coverage")}${data.criteria.map((q) => comparisonHeading("criterion:" + q.id, `${esc(q.title)}<br><span>(${q.weight}%)</span>`)).join("")}</tr></thead><tbody>${cs.map((c) => `<tr><td><button class="candidatecell" data-candidate="${c.id}"><span class="avatar">${esc(initials(c.label))}</span><span><strong>${esc(c.label)}</strong><small>${esc(c.filename)}</small></span></button></td><td><button class="scorecell" data-candidate="${c.id}"><strong>${pct(c.score)}</strong>${progress(c.score)}</button></td>${data.criteria.map((q) => `<td><button class="scorecell" data-candidate="${c.id}" data-question="${q.id}">${pct(value(c, q))}${progress(value(c, q))}</button></td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="sectionheading"><div><h2>Rubric coverage by candidate</h2><p class="subtle">How each candidate meets the individual criteria.</p></div><select id="coverageFilter" aria-label="Filter rubric coverage"><option value="all">All criteria</option><option value="gaps">Criteria with gaps</option><option value="strong">Strong evidence</option></select></div><div class="tablewrap"><table class="coverage"><thead><tr><th>Criterion (weight)</th>${cs.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody id="coverageRows">${coverageRows("all")}</tbody></table></div>` : `<div class="empty"><h2>Your rubric is ready.</h2><p>Upload a CV to start comparing documented evidence.</p><button class="primary" data-action="addCV">＋ Add candidate CVs</button></div>`}`;
  if (view === "rubric") $("#view").innerHTML = rubricContent();
  if (view === "role")
    $("#view").innerHTML =
      `<div class="sectionheading"><h2>Role details</h2><button data-settings="${data.id}">Edit position</button></div><div class="panel"><dl><dt>Company</dt><dd>${esc(data.company)}</dd><dt>Department</dt><dd>${esc(data.department || "General")}</dd><dt>Status</dt><dd>${esc(data.status || "active")}</dd><dt>Created</dt><dd>${date(data.createdAt)}</dd></dl><p>${esc(data.description)}</p><h3>Position description</h3><pre>${esc(data.role.text)}</pre></div>`;
  if (view === "activity")
    $("#view").innerHTML = `<h2>Position activity</h2><div class="panel">${(data
      .activity?.length
      ? data.activity
      : [
          { text: "Position created", at: data.createdAt },
          ...cs.map((c) => ({
            text: `Candidate added: ${c.label}`,
            at: c.createdAt,
          })),
        ]
    )
      .slice()
      .reverse()
      .map(
        (a) =>
          `<div class="activityrow"><span class="activitydot"></span><div>${esc(a.text)}<small>${date(a.at)}</small></div></div>`,
      )
      .join("")}</div>`;
}
function coverageRows(filter) {
  const candidates = sortCandidates(data.candidates, comparisonSort);
  return (
    data.criteria
      .filter(
        (q) =>
          filter === "all" ||
          (filter === "gaps"
            ? data.candidates.some((c) => value(c, q) < 75)
            : data.candidates.some((c) => value(c, q) >= 75)),
      )
      .map(
        (q) =>
          `<tr><td><details><summary>${esc(q.title)} (${q.weight}%)</summary><p>${esc(q.question)}</p></details></td>${candidates.map((c) => `<td><button class="dotbutton" data-candidate="${c.id}" data-question="${q.id}" aria-label="${esc(c.label)}: ${esc(q.title)}, ${pct(value(c, q))}"><span class="dot ${value(c, q) >= 75 ? "green" : value(c, q) >= 50 ? "blue" : "amber"}"></span></button></td>`).join("")}</tr>`,
      )
      .join("") || "<tr><td>No criteria match this filter.</td></tr>"
  );
}
function detail(c, q) {
  if (!c) return;
  selectedCandidate = c;
  detailTab = "evidence";
  selectedCriterion = q?.id || "";
  renderDetail();
}
function renderDetail() {
  const c = selectedCandidate,
    idx = data.candidates.findIndex((x) => x.id === c.id);
  $("#main").innerHTML =
    `<div class="detailnav"><button class="back" data-action="comparison">← Back to comparison</button><div class="actions"><button class="back" data-direction="-1" ${idx === 0 ? "disabled" : ""}>← Previous</button><button class="back" data-direction="1" ${idx === data.candidates.length - 1 ? "disabled" : ""}>Next →</button></div></div><div class="candidatehero"><span class="avatar large">${esc(initials(c.label))}</span><div><h1>${esc(c.label)}</h1><p class="subtle">${esc(data.title)} · ${esc(data.company)}</p></div><button data-action="fullCV">${icon("file")} View full CV ↗</button></div><div class="tabs detail-tabs">${[
      ["evidence", "Evidence & rubric"],
      ["summary", "Summary"],
      ["interview", "Interview prompts"],
      ["notes", "Notes"],
    ]
      .map(
        ([v, t]) =>
          `<button data-detail-tab="${v}" class="${detailTab === v ? "active" : ""}">${t}</button>`,
      )
      .join(
        "",
      )}</div><div class="coveragebanner"><div class="ring" style="--coverage:${Math.min(100, Math.max(0, c.score)) * 3.6}deg"><strong>${pct(c.score)}</strong></div><div><strong>Overall evidence coverage</strong><p class="subtle">Weighted coverage across all rubric criteria.</p></div><small class="subtle">ⓘ Evidence coverage, not hiring probability.</small></div><div id="candidateContent"></div>`;
  const host = $("#candidateContent");
  if (detailTab === "evidence") {
    host.innerHTML = `<div class="evidencegrid"><section class="panel"><h3>CV evidence</h3><p class="subtle">Key evidence used to assess this candidate against the rubric.</p><select id="criterionSelect" aria-label="Filter evidence by criterion"><option value="">All criteria</option>${data.criteria.map((q) => `<option value="${q.id}" ${selectedCriterion === q.id ? "selected" : ""}>${esc(q.title)}</option>`).join("")}</select><div id="quotes"></div></section><section class="panel"><h3>Rubric criteria</h3><div id="rubricDetail"></div></section></div>`;
    renderEvidence();
  }
  if (detailTab === "summary")
    host.innerHTML = `<div class="panel"><h2>Evidence summary</h2><p class="subtle">Missing evidence is not proof of absent skill. Verify gaps before shortlisting.</p>${data.criteria.map((q) => `<div class="summaryrow"><div><strong>${esc(q.title)}</strong><p>${esc(c.evidence.find((e) => e.id === q.id)?.gap)}</p></div><button data-candidate="${c.id}" data-question="${q.id}">${pct(value(c, q))} ↗</button></div>`).join("")}<button class="remove" data-remove-candidate="${c.id}">Remove candidate from this position</button></div>`;
  if (detailTab === "interview")
    host.innerHTML = `<div class="panel"><h2>Suggested interview prompts</h2>${data.criteria.map((q) => `<article class="prompt"><strong>${esc(q.title)}</strong><p>${esc(c.evidence.find((e) => e.id === q.id)?.followup || "No prompt returned.")}</p></article>`).join("")}</div>`;
  if (detailTab === "notes")
    host.innerHTML = `<form id="notesForm" class="panel"><h2>Candidate notes</h2><label for="candidateNotes">Your review notes for this position</label><textarea id="candidateNotes" maxlength="20000" rows="10">${esc(c.notes || "")}</textarea><button class="primary">Save notes</button><span id="notesStatus" role="status"></span></form>`;
  window.scrollTo({ top: 0, behavior: "instant" });
}
function renderEvidence() {
  const c = selectedCandidate,
    qs = selectedCriterion
      ? data.criteria.filter((q) => q.id === selectedCriterion)
      : data.criteria;
  const evidence = qs
    .map((q) => c.evidence.find((x) => x.id === q.id))
    .filter(Boolean);
  const seen = new Set();
  const quotes = evidence
    .flatMap((e) => e.quotes || [])
    .filter((quote) => {
      const key = quote.location + "\n" + quote.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const quoteCard = (quote) =>
    `<blockquote>“${esc(quote.text)}”<footer>${esc(quote.location)} · ${esc(c.filename)}</footer></blockquote>`;
  $("#quotes").innerHTML =
    `<div class="sourcefile">${icon("file")}<div><strong>${esc(c.filename)}</strong><small>Verified source excerpts</small></div></div>${quotes.length ? quotes.slice(0, 4).map(quoteCard).join("") : '<p class="subtle">No verified source quotes available for this criterion.</p>'}${quotes.length > 4 ? `<details><summary>Show ${quotes.length - 4} more source excerpts</summary>${quotes.slice(4).map(quoteCard).join("")}</details>` : ""}${[...new Set(evidence.map((e) => e.verification).filter(Boolean))].map((message) => `<p class="subtle">${esc(message)}</p>`).join("")}`;
  document
    .querySelectorAll(".supportheading,.supportlink,.supportdescription")
    .forEach((el) => el.remove());
  $("#quotes").insertAdjacentHTML(
    "afterend",
    `<div class="supportheading"><h4>Other supporting evidence</h4><button class="textbutton" data-action="sources">Edit links</button></div><p class="subtle supportdescription">Reviewer-added references. These do not affect scores.</p>${(c.sources || []).map((s) => `<a class="supportlink" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon("file")}<span><strong>${esc(s.title)}</strong><small>${esc(s.description)}</small></span><span>↗</span></a>`).join("") || '<p class="subtle supportdescription">Add a portfolio, project or reference link.</p>'}`,
  );
  $("#rubricDetail").innerHTML = qs
    .map((q, i) => {
      const a = answer(c, q),
        e = c.evidence.find((x) => x.id === q.id),
        n = value(c, q);
      return `<details class="rubricitem" ${i === 0 ? "open" : ""}><summary>${esc(q.title)} (${q.weight}%)</summary><div class="evidencestatus"><strong><span class="dot ${n >= 75 ? "green" : n >= 50 ? "blue" : "amber"}"></span> ${n >= 75 ? "Strong evidence" : n >= 50 ? "Direct / partial evidence" : "Limited evidence"}</strong><div class="row"><span>Coverage</span><strong>${pct(n)}</strong></div>${progress(n)}</div><p>${esc(q.question)}</p><h4>Gap to verify</h4><p class="subtle">${esc(e?.gap)}</p><h4>Suggested interview prompt</h4><div class="prompt">${esc(e?.followup)}</div><details><summary>Rubric & raw classification</summary>${q.levels.map((l, i) => `<div class="level"><strong>${i} · ${esc(l.label)}</strong>${esc(l.description)}</div>`).join("")}<pre>${esc(JSON.stringify(a, null, 2))}</pre></details></details>`;
    })
    .join("");
}
async function globalPage(name) {
  try {
    page = name;
    window.scrollTo({ top: 0, behavior: "instant" });
    data = null;
    selectedCandidate = null;
    header();
    const listing = await api("/jobs");
    jobs = listing.jobs;
    if (name === "candidates") {
      allCandidates = (await api("/candidates")).candidates;
      $("#main").innerHTML =
        `<div class="homehero"><div><h1>Your candidates</h1><p class="intro">A bank of saved CV evidence across your positions.</p></div></div><label class="searchfield">${icon("search")}<input id="bankSearch" placeholder="Search candidates or positions…" type="search" aria-label="Search candidates"></label><div id="bankList"></div>`;
      const draw = () => {
        $("#bankList").innerHTML = bankRows(
          allCandidates.filter((c) =>
            (c.label + " " + c.jobTitle)
              .toLowerCase()
              .includes($("#bankSearch").value.toLowerCase()),
          ),
          false,
        );
      };
      draw();
      $("#bankSearch").oninput = draw;
    }
    if (name === "templates") {
      $("#main").innerHTML =
        `<h1>Rubric templates</h1><p class="intro">Start a new position with a saved role’s rubric. Candidates are evaluated separately.</p><div class="positioncards">${jobs.map((j) => `<article class="panel"><span class="eyebrow">${esc(j.department || "General")}</span><h2>${esc(j.title)}</h2><p class="subtle">${j.criterionCount} criteria · ${esc(j.company)}</p><button data-template="${j.id}">Use rubric →</button><button class="textbutton" data-rubric-job="${j.id}">View rubric</button></article>`).join("") || '<div class="empty">Add a position to save your first rubric template.</div>'}</div>`;
    }
    if (name === "insights") {
      const bank = (await api("/candidates")).candidates;
      $("#main").innerHTML =
        `<h1>Workspace insights</h1><p class="intro">A view of your positions and documented evidence.</p><div class="metrics">${[
          ["Positions", jobs.length],
          [
            "Active positions",
            jobs.filter((j) => (j.status || "active") === "active").length,
          ],
          ["CV evaluations", bank.length],
          ["Rubric criteria", jobs.reduce((n, j) => n + j.criterionCount, 0)],
        ]
          .map(
            ([t, n]) =>
              `<article class="panel"><span class="subtle">${t}</span><strong>${n}</strong></article>`,
          )
          .join(
            "",
          )}</div><section class="panel"><h2>Evidence by position</h2><p class="subtle">Coverage uses each role’s own rubric and cannot measure suitability across roles.</p>${jobs.map((j) => `<div class="summaryrow"><button class="textbutton" data-open="${j.id}">${esc(j.title)}</button><span>${j.candidateCount} candidates · ${j.criterionCount} criteria</span></div>`).join("") || "<p>No positions yet.</p>"}</section>`;
    }
  } catch (e) {
    error(e);
  }
}
function bankRows(cs, select) {
  return cs.length
    ? `<div class="bankrows">${cs.map((c) => `<div class="summaryrow"><span class="avatar">${esc(initials(c.label))}</span><div class="bankcopy"><strong>${esc(c.label)}</strong><small>${esc(c.jobTitle)} · ${esc(c.filename)}</small></div><button ${select ? `data-reuse="${c.id}" data-source-job="${c.jobId}" ${!c.hasSource ? 'disabled title="Upload this legacy CV again to save its source text"' : ""}` : `data-bank-candidate="${c.id}" data-bank-job="${c.jobId}"`}>${select ? "Add to position" : "View evidence →"}</button></div>`).join("")}</div>`
    : '<div class="empty">No saved candidates found.</div>';
}
async function bank() {
  try {
    allCandidates = (await api("/candidates")).candidates;
    const available = allCandidates.filter((c) => c.jobId !== data.id);
    $("#detailBody").innerHTML =
      `<h2>Add from candidate bank</h2><p class="subtle">The saved CV is evaluated against this position’s rubric. Standard inference charges apply. Earlier CVs without saved source text must be uploaded again.</p><label class="searchfield">${icon("search")}<input id="reuseSearch" placeholder="Search candidates…" aria-label="Search candidate bank"></label><div id="reuseList"></div><p id="reuseStatus" role="status"></p>`;
    const draw = () => {
      $("#reuseList").innerHTML = bankRows(
        available.filter((c) =>
          c.label.toLowerCase().includes($("#reuseSearch").value.toLowerCase()),
        ),
        true,
      );
    };
    draw();
    $("#reuseSearch").oninput = draw;
    $("#detail").showModal();
  } catch (e) {
    error(e);
  }
}
function editSources() {
  const rows = [
    ...(selectedCandidate.sources || []),
    { title: "", url: "", description: "" },
  ];
  $("#detailBody").innerHTML =
    `<h2>Supporting evidence links</h2><p class="subtle">Add references for human review. Links do not affect the saved evaluation. Clear a link's title and URL to remove it.</p><form id="sourcesForm">${rows.map((s) => `<fieldset class="sourceeditor"><legend>Supporting link</legend><label>Title<input data-source-title maxlength="150" value="${esc(s.title)}"></label><label>URL<input data-source-url type="url" maxlength="2000" placeholder="https://…" value="${esc(s.url)}"></label><label>Description<input data-source-description maxlength="500" value="${esc(s.description)}"></label></fieldset>`).join("")}<button class="primary">Save links</button><p role="status"></p></form>`;
  $("#detail").showModal();
}
async function settings(id) {
  try {
    const j = await api("/jobs/" + id);
    $("#detailBody").innerHTML =
      `<h2>Edit position</h2><form id="settingsForm" data-id="${id}"><label>Position title<input name="title" value="${esc(j.title)}" maxlength="200" required></label><label>Company<input name="company" value="${esc(j.company)}" maxlength="150"></label><label>Department<input name="department" value="${esc(j.department || "General")}" maxlength="100"></label><label>Short description<textarea name="description" maxlength="500" rows="3">${esc(j.description || "")}</textarea></label><label>Status<select name="status">${["active", "draft", "archived"].map((s) => `<option ${s === (j.status || "active") ? "selected" : ""}>${s}</option>`).join("")}</select></label><p class="subtle">These details organize your workspace. The saved rubric and scores stay tied to the original position description.</p><button class="primary">Save position</button><p id="settingsStatus" role="status"></p></form>`;
    $("#detail").showModal();
  } catch (e) {
    error(e);
  }
}
async function template(id) {
  const j = jobs.find((j) => j.id === id);
  $("#detailBody").innerHTML =
    `<h2>Use rubric template</h2><p class="subtle">Copy ${esc(j.title)} into a new position, preserving the rubric and original role description.</p><form id="templateForm" data-id="${id}"><label>Position title<input name="title" value="${esc(j.title)}" maxlength="200" required></label><label>Company<input name="company" value="${esc(j.company)}" maxlength="150"></label><button class="primary">Create position</button><p id="templateStatus" role="status"></p></form>`;
  $("#detail").showModal();
}
function upload(kind) {
  const isJob = kind === "job";
  $("#uploadBody").innerHTML =
    `<span class="step">${isJob ? "1 · CREATE A ROLE RUBRIC" : "2 · EVALUATE CANDIDATE CVS"}</span><h2>${isJob ? "Add positions" : "Add candidates"}</h2><p class="subtle">${isJob ? "Upload one or more position descriptions. Each file creates a separate position and rubric." : `CVs will be evaluated against ${esc(data.title)} using its saved rubric.`}</p><form id="upload" data-kind="${kind}">${isJob ? '<label>Position title <small>Optional for one file · for batches, titles come from each document</small><input type="text" name="title" maxlength="200" placeholder="e.g. Senior Data Engineer"></label><label>Department<input type="text" name="department" maxlength="100" placeholder="e.g. Product"></label><label>Company <small>Optional · applied to every position in this batch</small><input type="text" name="company" maxlength="150" placeholder="Company name"></label>' : ""}<label>${isJob ? "Position descriptions" : "Candidate CVs"}<input type="file" name="files" accept=".pdf,.md,.docx" multiple required><small>PDF, Markdown or DOCX · 10 MB per file · text PDFs only. DOCX headers, text boxes and images are not read.</small></label><button class="primary">${isJob ? "Upload positions & create rubrics" : "Upload & rank candidates"}</button><div class="progress" id="uploadStatus" role="status"></div><ol id="batchResults" aria-label="Upload progress" aria-live="polite"></ol></form>`;
  $("#uploadDialog").showModal();
}
function error(e) {
  $("#status").hidden = false;
  $("#status").textContent = e.message;
  $("#status").className = "error";
}
function toast(message, undo) {
  const t = $("#toast");
  t.hidden = false;
  t.innerHTML = `${esc(message)} <button id="undo">Undo</button>`;
  $("#undo").onclick = async () => {
    try {
      await undo();
      t.hidden = true;
      if (data) await openJob(data.id);
      else await home();
    } catch (e) {
      t.textContent = e.message;
    }
  };
}
async function removeJob(id) {
  try {
    await api("/jobs/" + id, { method: "DELETE" });
    await home();
    toast(
      "Position removed. Its candidates and results are hidden with it.",
      () => api("/jobs/" + id + "/restore", { method: "POST" }),
    );
  } catch (e) {
    error(e);
  }
}
async function removeCandidate(id) {
  const jobId = data.id;
  try {
    await api(`/jobs/${jobId}/candidates/${id}`, { method: "DELETE" });
    data = await api("/jobs/" + jobId);
    job();
    toast("Candidate removed from this position.", () =>
      api(`/jobs/${jobId}/candidates/${id}/restore`, { method: "POST" }),
    );
  } catch (e) {
    error(e);
  }
}
function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  a.download = "role-lens-" + data.id + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}
$("#uploadDialog").addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
function notificationView() {
  const items = notificationLog.list();
  const unread = items.filter((n) => !n.read).length;
  $("#notificationCount").textContent = unread;
  $("#notificationCount").hidden = unread === 0;
  $("#notificationButton").setAttribute(
    "aria-label",
    `Notifications, ${unread} unread`,
  );
  $("#notificationList").innerHTML = items.length
    ? items
        .map(
          (n) =>
            `<article class="notification ${n.status}"><strong>${n.status === "success" ? "Completed" : "Failed"}</strong><p>${esc(n.message)}</p><small>${esc(new Date(n.createdAt).toLocaleString())}</small></article>`,
        )
        .join("")
    : '<p class="subtle">No notifications yet. Uploads will report completion or failure here.</p>';
}
function notify(message, status) {
  notificationLog.add({ message, status });
  notificationView();
  $("#announcements").textContent = message;
}
$("#notificationButton").onclick = () => {
  notificationLog.markRead();
  notificationView();
  $("#notifications").showModal();
};
$("#clearNotifications").onclick = () => {
  notificationLog.clear();
  notificationView();
};
notificationView();
document.addEventListener("change", (e) => {
  if (e.target.matches('#upload input[type="file"]')) {
    const title = $('#upload input[name="title"]');
    if (title) title.disabled = e.target.files.length > 1;
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "upload") return;
  e.preventDefault();
  if (busy) return;
  const form = e.target;
  const files = [...form.elements.files.files];
  const isJob = form.dataset.kind === "job";
  const target = data?.id;
  const status = $("#uploadStatus");
  status.classList.remove("error");
  if (!files.length || files.length > 20) {
    status.textContent = "Select 1–20 files per batch.";
    return;
  }
  const title = isJob && files.length === 1 ? form.elements.title.value : "";
  const company = isJob ? form.elements.company.value : "";
  busy = true;
  form.querySelector("button").disabled = true;
  $("#uploadDialog .close").disabled = true;
  const controls = [...form.querySelectorAll("input")];
  controls.forEach((c) => (c.disabled = true));
  const rows = files.map((f) => ({
    name: f.name,
    status: "queued",
    message: "Waiting",
  }));
  const drawRows = () => {
    $("#batchResults").innerHTML = rows
      .map(
        (r) =>
          `<li class="batch-item ${r.status}"><strong>${esc(r.name)}</strong><span>${esc(r.message)}</span></li>`,
      )
      .join("");
  };
  drawRows();
  try {
    const results = await processBatch(files, {
      process: async (file, index) => {
        status.textContent = `${index + 1} of ${files.length}: reading ${file.name}…`;
        const document = await extractFile(file);
        status.textContent = `${index + 1} of ${files.length}: ${isJob ? "creating the position rubric" : "classifying the CV and checking source evidence"}. Keep this page open.`;
        return isJob
          ? await api("/jobs", {
              method: "POST",
              body: {
                document,
                title,
                company,
                department: form.elements.department?.value || "General",
              },
            })
          : await api(`/jobs/${target}/candidates`, {
              method: "POST",
              body: { document },
            });
      },
      onState: (r) => {
        rows[r.index].status = r.status;
        rows[r.index].message =
          r.status === "processing"
            ? "Processing…"
            : r.status === "success"
              ? "Completed"
              : r.error;
        drawRows();
      },
      onComplete: (r) =>
        notify(
          `${isJob ? "Position" : "Candidate"} ${r.file.name}: ${r.status === "success" ? (isJob ? "rubric created." : "evaluated and ranked.") : "failed — " + r.error}`,
          r.status,
        ),
    });
    const added = results.filter((r) => r.status === "success").length;
    status.textContent = `Batch finished: ${added} completed, ${results.length - added} failed. Each result is in Notifications. You can close this window.`;
    if (added < results.length) status.classList.add("error");
    if (isJob) await home();
    else {
      data = await api("/jobs/" + target);
      view = "ranking";
      job();
    }
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    notify("Upload batch: " + error.message, "error");
  } finally {
    busy = false;
    form.querySelector("button").disabled = false;
    $("#uploadDialog .close").disabled = false;
    controls.forEach((c) => (c.disabled = false));
    if (isJob && files.length > 1) form.elements.title.disabled = true;
  }
});
$(".brand").onclick = (e) => {
  e.preventDefault();
  home();
};
home();
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.classList.contains("close")) {
      if (busy && b.closest("#uploadDialog")) return;
      b.closest("dialog").close();
      return;
    }
    if (b.dataset.page) {
      if (b.dataset.page === "positions") await home();
      else await globalPage(b.dataset.page);
    } else if (b.dataset.action === "home") {
      await home();
      if (b.classList.contains("headersearch")) $("#search")?.focus();
    } else if (b.dataset.action === "comparison") job();
    else if (b.dataset.action === "addJob") upload("job");
    else if (b.dataset.action === "addCV") upload("cv");
    else if (b.dataset.action === "export") download();
    else if (b.dataset.action === "bank") await bank();
    else if (b.dataset.action === "sources") editSources();
    else if (b.dataset.action === "fullCV") {
      $("#detailBody").innerHTML =
        `<h2>${esc(selectedCandidate.filename)}</h2><p class="subtle">Extracted source text. Original upload formatting is not retained.</p>${selectedCandidate.resume ? selectedCandidate.resume.sections.map((s) => `<section><h3>${esc(s.location)}</h3><pre>${esc(s.text)}</pre></section>`).join("") : "<p>This older evaluation does not have saved CV text. Upload the CV again to enable this view.</p>"}`;
      $("#detail").showModal();
    } else if (b.dataset.open) await openJob(b.dataset.open);
    else if (b.dataset.settings) await settings(b.dataset.settings);
    else if (b.dataset.removeJob) {
      $("#detail").close();
      await removeJob(b.dataset.removeJob);
    } else if (b.dataset.removeCandidate)
      await removeCandidate(b.dataset.removeCandidate);
    else if (b.dataset.filter) {
      positionFilter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("active", x === b));
      positionList();
    } else if (b.dataset.comparisonSort) {
      comparisonSort = nextComparisonSort(
        comparisonSort,
        b.dataset.comparisonSort,
      );
      const scroll = $(".comparison").closest(".tablewrap").scrollLeft;
      const coverageFilter = $("#coverageFilter").value;
      render();
      $(".comparison").closest(".tablewrap").scrollLeft = scroll;
      $("#coverageFilter").value = coverageFilter;
      $("#coverageRows").innerHTML = coverageRows(coverageFilter);
      document.querySelectorAll("[data-comparison-sort]").forEach((button) => {
        if (button.dataset.comparisonSort === comparisonSort.key)
          button.focus({ preventScroll: true });
      });
    } else if (b.dataset.view || b.dataset.setView) {
      view = b.dataset.view || b.dataset.setView;
      render();
    } else if (b.dataset.candidate)
      detail(
        data.candidates.find((c) => c.id === b.dataset.candidate),
        data.criteria.find((q) => q.id === b.dataset.question),
      );
    else if (b.dataset.detailTab) {
      detailTab = b.dataset.detailTab;
      renderDetail();
    } else if (b.dataset.direction) {
      const idx = data.candidates.findIndex(
        (c) => c.id === selectedCandidate.id,
      );
      detail(data.candidates[idx + Number(b.dataset.direction)]);
    } else if (b.dataset.bankCandidate)
      await openJob(b.dataset.bankJob, b.dataset.bankCandidate);
    else if (b.dataset.template) await template(b.dataset.template);
    else if (b.dataset.rubricJob) {
      await openJob(b.dataset.rubricJob);
      view = "rubric";
      render();
    } else if (b.dataset.reuse) {
      const target = data.id;
      $("#reuseStatus").textContent =
        "Evaluating saved CV against this role. Keep this page open…";
      document
        .querySelectorAll("[data-reuse]")
        .forEach((x) => (x.disabled = true));
      try {
        await api(`/jobs/${target}/candidates`, {
          method: "POST",
          body: {
            sourceJobId: b.dataset.sourceJob,
            sourceCandidateId: b.dataset.reuse,
          },
        });
        notify(
          "Saved candidate evaluated against the position rubric.",
          "success",
        );
        $("#detail").close();
        await openJob(target);
      } catch (error) {
        $("#reuseStatus").textContent = error.message;
        document
          .querySelectorAll("[data-reuse]")
          .forEach(
            (x) =>
              (x.disabled = !allCandidates.find(
                (c) =>
                  c.id === x.dataset.reuse && c.jobId === x.dataset.sourceJob,
              )?.hasSource),
          );
      }
    }
  } catch (errorMessage) {
    error(errorMessage);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "criterionSelect") {
    selectedCriterion = e.target.value;
    renderEvidence();
  }
  if (e.target.id === "coverageFilter")
    $("#coverageRows").innerHTML = coverageRows(e.target.value);
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (
    !["notesForm", "settingsForm", "templateForm", "sourcesForm"].includes(f.id)
  )
    return;
  e.preventDefault();
  const b = f.querySelector("button");
  b.disabled = true;
  try {
    if (f.id === "sourcesForm") {
      const sources = [...f.querySelectorAll(".sourceeditor")]
        .map((row) => ({
          title: row.querySelector("[data-source-title]").value,
          url: row.querySelector("[data-source-url]").value,
          description: row.querySelector("[data-source-description]").value,
        }))
        .filter((s) => s.title || s.url);
      const result = await api(
        `/jobs/${data.id}/candidates/${selectedCandidate.id}/sources`,
        { method: "POST", body: { sources } },
      );
      selectedCandidate.sources = result.sources;
      $("#detail").close();
      renderDetail();
    }
    if (f.id === "notesForm") {
      const c = selectedCandidate;
      const notes = $("#candidateNotes").value;
      await api(`/jobs/${data.id}/candidates/${c.id}/notes`, {
        method: "POST",
        body: { notes },
      });
      c.notes = notes;
      $("#notesStatus").textContent = "Notes saved.";
    }
    if (f.id === "settingsForm") {
      const j = await api(`/jobs/${f.dataset.id}/settings`, {
        method: "POST",
        body: Object.fromEntries(new FormData(f)),
      });
      $("#detail").close();
      if (data?.id === j.id) {
        data = j;
        job();
      } else await home();
    }
    if (f.id === "templateForm") {
      const j = await api("/jobs", {
        method: "POST",
        body: {
          templateId: f.dataset.id,
          ...Object.fromEntries(new FormData(f)),
        },
      });
      $("#detail").close();
      await openJob(j.id);
    }
  } catch (err) {
    const status = f.querySelector('[role="status"]');
    status.textContent = err.message;
    status.classList.add("error");
  } finally {
    b.disabled = false;
  }
});
