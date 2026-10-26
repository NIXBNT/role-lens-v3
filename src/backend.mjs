import { generateRubric, evaluateResume, rank } from "./inference.mjs";
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const positionTitle = (value) => {
  const title = String(value ?? "").trim();
  return (
    title
      .replace(/(?:\s*[:—–-]\s*|\s+)Evidence Classification Questions\s*$/i, "")
      .trim() || title
  );
};
const models = {
  questions: "gpt-5.6-sol",
  reasoning: "low",
  classification: "gpt-6-luna",
};
const method =
  "Weighted average of Decisions scores / 3, scaled to 100. Evidence coverage, not hiring probability.";
export function validateDocument(d) {
  if (
    !d ||
    typeof d.filename !== "string" ||
    d.filename.length > 250 ||
    !/\.(pdf|md|docx)$/i.test(d.filename) ||
    !Array.isArray(d.sections) ||
    !d.sections.length ||
    d.sections.length > 1000
  )
    throw Error("Upload a readable PDF, Markdown or DOCX document.");
  if (
    d.sections.some(
      (s) =>
        typeof s.location !== "string" ||
        s.location.length > 100 ||
        typeof s.text !== "string",
    )
  )
    throw Error("Invalid extracted document.");
  const text = d.sections.map((s) => `[${s.location}]\n${s.text}`).join("\n\n");
  if (text.trim().length < 50 || text.length > 120000)
    throw Error(
      "Document must contain 50–120,000 characters of readable text.",
    );
  return { filename: d.filename, sections: d.sections, text };
}
export function createBackend({ requestOverride } = {}) {
  const object = async (env, key, fallback) =>
    (await env.store.get(key)) ?? fallback;
  const put = (env, key, data) => env.store.put(key, data);
  async function list(env, prefix) {
    return Promise.all(
      (await env.store.list(prefix)).map((key) => env.store.get(key)),
    );
  }
  async function job(env, id) {
    return object(env, `jobs/${id}.json`);
  }
  async function activity(env, id, text) {
    const current = await job(env, id);
    const at = new Date().toISOString();
    await put(env, `jobs/${id}.json`, {
      ...current,
      updatedAt: at,
      activity: [...(current.activity || []), { text, at }].slice(-500),
    });
  }
  async function candidates(env, id) {
    return (await list(env, `candidates/${id}/`)).filter((c) => !c.deleted);
  }
  async function request(env, endpoint, body) {
    if (requestOverride) return requestOverride(endpoint, body);
    if (!env.OPENAI_API_KEY)
      throw Error(
        "Set OPENAI_API_KEY in your local .env file and restart the app.",
      );
    const r = await fetch(`https://api.openai.com/v1/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const data = await r.json();
    if (!r.ok)
      throw Error(
        `OpenAI ${endpoint}: ${data.error?.message || `HTTP ${r.status}`}`,
      );
    return data;
  }
  return async function api(req, env) {
    try {
      if (!env.store) throw Error("Persistent storage is not configured.");
      const url = new URL(req.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const [, resource, id, child, cid, action] = segments;
      if (
        req.method !== "GET" &&
        req.headers.get("Origin") &&
        req.headers.get("Origin") !== url.origin
      )
        return json({ error: "Origin rejected." }, 403);
      if (resource === "candidates" && req.method === "GET" && !id) {
        const records = (await list(env, "jobs/")).filter((j) => !j.deleted);
        const bank = [];
        for (const j of records)
          for (const c of rank(await candidates(env, j.id), j.criteria))
            bank.push({
              id: c.id,
              label: c.label,
              filename: c.filename,
              score: c.score,
              hasSource: Boolean(c.resume),
              jobId: j.id,
              jobTitle: j.title,
              company: j.company,
            });
        return json({ candidates: bank });
      }
      if (resource !== "jobs") return json({ error: "Not found" }, 404);
      if (req.method === "GET" && !id) {
        const records = await list(env, "jobs/");
        const jobs = await Promise.all(
          records
            .filter((j) => !j.deleted)
            .map(async (j) => {
              const cs = rank(await candidates(env, j.id), j.criteria);
              return {
                id: j.id,
                title: j.title,
                company: j.company,
                createdAt: j.createdAt,
                sourceUrl: j.sourceUrl,
                department: j.department || "General",
                status: j.status || "active",
                description:
                  j.description ||
                  j.criteria
                    .slice(0, 2)
                    .map((q) => q.title)
                    .join(" · "),
                updatedAt: j.updatedAt || j.createdAt,
                criterionCount: j.criteria.length,
                candidateCount: cs.length,
                top: cs[0] ? { label: cs[0].label, score: cs[0].score } : null,
              };
            }),
        );
        return json({ jobs });
      }
      if (req.method === "POST" && !id) {
        if (Number(req.headers.get("Content-Length") || 0) > 1000000)
          throw Error("Upload text is too large.");
        const body = await req.json();
        const template = body.templateId
          ? await job(env, body.templateId)
          : null;
        if (body.templateId && (!template || template.deleted))
          throw Error("Template position not found.");
        const role = template ? template.role : validateDocument(body.document);
        const policy = template
          ? { title: template.title, criteria: template.criteria }
          : await generateRubric(role, (e, b) => request(env, e, b));
        const j = {
          id: crypto.randomUUID(),
          title: positionTitle(body.title || policy.title).slice(0, 200),
          company: String(body.company || "Uploaded position").slice(0, 150),
          role,
          criteria: policy.criteria,
          models,
          method,
          createdAt: new Date().toISOString(),
          sourceUrl: null,
          department: String(
            body.department || template?.department || "General",
          ).slice(0, 100),
          description: String(
            body.description || template?.description || "",
          ).slice(0, 500),
          status: "active",
          activity: [
            {
              text: template
                ? "Position created from a saved rubric"
                : "Position and rubric created",
              at: new Date().toISOString(),
            },
          ],
        };
        await put(env, `jobs/${j.id}.json`, j);
        return json({ ...j, candidates: [] }, 201);
      }
      const j = await job(env, id);
      if (!j) return json({ error: "Position not found" }, 404);
      if (req.method === "POST" && child === "restore") {
        await put(env, `jobs/${id}.json`, { ...j, deleted: false });
        return json({ restored: true });
      }
      if (j.deleted) return json({ error: "Position has been removed" }, 404);
      if (req.method === "GET" && !child)
        return json({
          ...j,
          candidates: rank(await candidates(env, id), j.criteria),
        });
      if (req.method === "POST" && child === "settings") {
        const body = await req.json();
        if (!["active", "draft", "archived"].includes(body.status))
          throw Error("Invalid position status.");
        if (
          typeof body.title !== "string" ||
          !body.title.trim() ||
          body.title.length > 200
        )
          throw Error("Enter a title of 1–200 characters.");
        const updated = {
          ...j,
          title: positionTitle(body.title),
          company: String(body.company || "").slice(0, 150),
          department: String(body.department || "General").slice(0, 100),
          description: String(body.description || "").slice(0, 500),
          status: body.status,
          updatedAt: new Date().toISOString(),
          activity: [
            ...(j.activity || []),
            { text: "Position details updated", at: new Date().toISOString() },
          ],
        };
        await put(env, `jobs/${id}.json`, updated);
        return json({
          ...updated,
          candidates: rank(await candidates(env, id), j.criteria),
        });
      }
      if (req.method === "DELETE" && !child) {
        await put(env, `jobs/${id}.json`, { ...j, deleted: true });
        return json({ removed: true });
      }
      if (child === "candidates" && req.method === "POST" && !cid) {
        const body = await req.json();
        let source;
        if (body.sourceJobId && body.sourceCandidateId) {
          const sourceJob = await job(env, body.sourceJobId);
          if (!sourceJob || sourceJob.deleted)
            throw Error("Source position is unavailable.");
          source = await object(
            env,
            `candidates/${body.sourceJobId}/${body.sourceCandidateId}.json`,
          );
          if (!source || source.deleted || !source.resume)
            throw Error("Source CV text is unavailable. Upload this CV again.");
        }
        const resume = validateDocument(source ? source.resume : body.document);
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(resume.text),
            ),
          ),
        )
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        const duplicate = (await candidates(env, id)).find(
          (c) => c.fingerprint === hash || c.filename === resume.filename,
        );
        if (duplicate)
          return json(
            {
              error:
                "This CV is already in the position. Remove the existing version before replacing it.",
            },
            409,
          );
        const candidate = await evaluateResume(
          resume,
          j.criteria,
          (e, b) => request(env, e, b),
          {
            label:
              source?.label ||
              (typeof body.label === "string" && body.label.trim()
                ? body.label.trim().slice(0, 150)
                : null),
          },
        );
        if ((await job(env, id)).deleted)
          return json(
            {
              error:
                "Position was removed while this CV was evaluated. No candidate was added.",
            },
            409,
          );
        candidate.resume = resume;
        candidate.notes = "";
        candidate.fingerprint = hash;
        candidate.createdAt = new Date().toISOString();
        await put(env, `candidates/${id}/${candidate.id}.json`, candidate);
        await activity(env, id, `Candidate added: ${candidate.label}`);
        return json(rank([candidate], j.criteria)[0], 201);
      }
      if (child === "candidates" && cid) {
        const c = await object(env, `candidates/${id}/${cid}.json`);
        if (!c) return json({ error: "Candidate not found" }, 404);
        if (c.deleted && !(req.method === "POST" && action === "restore"))
          return json({ error: "Candidate has been removed" }, 404);
        if (req.method === "POST" && action === "sources") {
          const body = await req.json();
          if (!Array.isArray(body.sources) || body.sources.length > 30)
            throw Error("Add at most 30 supporting links.");
          const sources = body.sources.map((source) => {
            if (
              typeof source.title !== "string" ||
              !source.title.trim() ||
              source.title.length > 150 ||
              typeof source.url !== "string" ||
              source.url.length > 2000 ||
              typeof source.description !== "string" ||
              source.description.length > 500
            )
              throw Error(
                "Enter a title, URL and short description for each supporting link.",
              );
            const url = new URL(source.url);
            if (!["http:", "https:"].includes(url.protocol))
              throw Error("Supporting links must use HTTP or HTTPS.");
            return {
              title: source.title.trim(),
              url: url.href,
              description: source.description,
            };
          });
          await put(env, `candidates/${id}/${cid}.json`, { ...c, sources });
          return json({ sources });
        }
        if (req.method === "POST" && action === "notes") {
          const body = await req.json();
          if (typeof body.notes !== "string" || body.notes.length > 20000)
            throw Error("Notes must be at most 20,000 characters.");
          const updated = { ...c, notes: body.notes };
          await put(env, `candidates/${id}/${cid}.json`, updated);
          return json({ saved: true });
        }
        if (req.method === "DELETE" && !action) {
          await put(env, `candidates/${id}/${cid}.json`, {
            ...c,
            deleted: true,
          });
          await activity(env, id, `Candidate removed: ${c.label}`);
          return json({ removed: true });
        }
        if (req.method === "POST" && action === "restore") {
          await put(env, `candidates/${id}/${cid}.json`, {
            ...c,
            deleted: false,
          });
          await activity(env, id, `Candidate restored: ${c.label}`);
          return json({ restored: true });
        }
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  };
}
