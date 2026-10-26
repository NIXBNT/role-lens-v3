import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalServer } from "../server.mjs";
import { FileStore } from "../src/store.mjs";
import { criteria } from "./fixtures.mjs";
const document = {
  filename: "engineer.md",
  sections: [
    {
      location: "Markdown",
      text: "Production software engineering role building Python and SQL services and APIs, testing pipelines and mentoring engineers.",
    },
  ],
};
const liveMock = async (endpoint, body) => {
  if (endpoint === "decisions")
    return {
      answers: criteria.map((c) => ({ name: c.id, type: "score", score: 2 })),
      model: "gpt-6-luna",
    };
  const value =
    body.text.format.name === "role_questions"
      ? { title: "Test Engineer", criteria }
      : {
          items: criteria.map((c) => ({
            id: c.id,
            quotes: [],
            gap: "Verify evidence in interview.",
            followup: "Describe a production example.",
          })),
        };
  return {
    output: [
      { content: [{ type: "output_text", text: JSON.stringify(value) }] },
    ],
  };
};
async function start(directory, options = {}) {
  const server = await createLocalServer({
    dataDirectory: directory,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
async function workspace(t) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "role-lens-v3-test-"));
  t.after(() => fs.rm(d, { recursive: true, force: true }));
  return d;
}
async function json(base, p, method = "GET", body) {
  const r = await fetch(base + p, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

test("file store persists records, filters prefixes and encodes unsafe path components", async (t) => {
  const dir = await workspace(t);
  const s = new FileStore(dir);
  await s.init();
  await s.put("jobs/example.json", { a: 1 });
  await s.put("../outside.json", { a: 2 });
  const reopened = new FileStore(dir);
  assert.deepEqual(await reopened.get("jobs/example.json"), { a: 1 });
  assert.deepEqual(await reopened.list("jobs/"), ["jobs/example.json"]);
  assert.equal((await fs.readdir(dir)).length, 2);
  assert.equal(await reopened.get("missing"), null);
  await reopened.put("jobs/example.json", { a: 3 });
  assert.deepEqual(await s.get("jobs/example.json"), { a: 3 });
  assert.ok(!(await fs.readdir(dir)).some((n) => n.startsWith(".tmp-")));
});
test("empty local workspace needs no key and only exposes application routes", async (t) => {
  const app = await start(await workspace(t), { apiKey: "" });
  t.after(app.close);
  const health = await json(app.base, "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, {
    status: "ok",
    version: 3,
    apiKeyConfigured: false,
  });
  const jobs = await json(app.base, "/api/jobs");
  assert.equal(jobs.data.jobs.length, 0);
  assert.equal((await fetch(app.base + "/")).status, 200);
  assert.equal((await fetch(app.base + "/pdf-worker.mjs")).status, 200);
  assert.equal((await fetch(app.base + "/.env")).status, 404);
  assert.equal((await fetch(app.base + "/src/backend.mjs")).status, 404);
  const missing = await json(app.base, "/api/jobs", "POST", { document });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /OPENAI_API_KEY/);
});
test("uploaded role and CV survive restart; removal and undo persist on disk", async (t) => {
  const dir = await workspace(t);
  let app = await start(dir, { requestOverride: liveMock });
  const role = await json(app.base, "/api/jobs", "POST", { document });
  assert.equal(role.status, 201);
  assert.equal(role.data.candidates.length, 0);
  const id = role.data.id;
  const candidate = await json(app.base, `/api/jobs/${id}/candidates`, "POST", {
    document: { ...document, filename: "CV.md" },
    label: "Local test candidate",
  });
  assert.equal(candidate.status, 201);
  assert.ok(candidate.data.score > 66 && candidate.data.score < 67);
  await json(app.base, `/api/jobs/${id}/settings`, "POST", {
    title: "Saved title",
    company: "Local company",
    department: "Design",
    description: "Saved description",
    status: "draft",
  });
  await json(
    app.base,
    `/api/jobs/${id}/candidates/${candidate.data.id}/notes`,
    "POST",
    { notes: "Saved across restart." },
  );
  await app.close();
  app = await start(dir, { apiKey: "" });
  t.after(() => app.close());
  assert.equal(
    (await json(app.base, "/api/health")).data.apiKeyConfigured,
    false,
  );
  const saved = await json(app.base, `/api/jobs/${id}`);
  assert.equal(saved.data.title, "Saved title");
  assert.equal(saved.data.department, "Design");
  assert.equal(saved.data.status, "draft");
  assert.equal(saved.data.candidates[0].notes, "Saved across restart.");
  assert.deepEqual(saved.data.candidates[0].resume.sections, document.sections);
  assert.equal(saved.data.candidates[0].label, "Local test candidate");
  await json(
    app.base,
    `/api/jobs/${id}/candidates/${candidate.data.id}`,
    "DELETE",
  );
  assert.equal(
    (await json(app.base, `/api/jobs/${id}`)).data.candidates.length,
    0,
  );
  await json(
    app.base,
    `/api/jobs/${id}/candidates/${candidate.data.id}/restore`,
    "POST",
    {},
  );
  assert.equal(
    (await json(app.base, `/api/jobs/${id}`)).data.candidates.length,
    1,
  );
  await json(app.base, `/api/jobs/${id}`, "DELETE");
  assert.equal((await json(app.base, `/api/jobs/${id}`)).status, 404);
  await json(app.base, `/api/jobs/${id}/restore`, "POST", {});
  assert.equal(
    (await json(app.base, `/api/jobs/${id}`)).data.candidates.length,
    1,
  );
});
test("local HTTP rejects foreign origins, hostile Host headers, non-JSON posts and large bodies", async (t) => {
  const app = await start(await workspace(t));
  t.after(app.close);
  assert.equal(
    (
      await fetch(app.base + "/api/jobs", {
        headers: { Origin: "https://foreign.example" },
      })
    ).status,
    403,
  );
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.get(
      app.base + "/api/jobs",
      { headers: { Host: "foreign.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal(
    (await fetch(app.base + "/api/jobs", { method: "POST", body: "not-json" }))
      .status,
    415,
  );
  assert.equal(
    (
      await fetch(app.base + "/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: " ".repeat(2 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  assert.equal(
    (await fetch(app.base + "/api/jobs", { method: "OPTIONS" })).status,
    405,
  );
});
