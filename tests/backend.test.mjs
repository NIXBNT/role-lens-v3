import test from "node:test";
import assert from "node:assert/strict";
import { createBackend, validateDocument } from "../src/backend.mjs";
import { criteria, fixtureJobs, fixtureCandidates } from "./fixtures.mjs";
class Store {
  map = new Map();
  async get(k) {
    return this.map.get(k) ?? null;
  }
  async put(k, s) {
    this.map.set(k, structuredClone(s));
  }
  async list(prefix) {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}
const req = (path, method = "GET", body) =>
  new Request("https://test.example/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
const document = {
  filename: "new.md",
  sections: [
    {
      location: "Markdown",
      text: "Production engineering and Python SQL data pipelines, API integration and mentoring experienced teams.",
    },
  ],
};
test("fresh application has no positions or candidates", async () => {
  const env = { store: new Store() },
    api = createBackend();
  assert.deepEqual(await (await api(req("/jobs"), env)).json(), { jobs: [] });
  assert.equal(env.store.map.size, 0);
});
test("candidate and position removals persist with undo, and are isolated by position", async () => {
  const env = { store: new Store() },
    api = createBackend();
  for (const j of fixtureJobs) {
    await env.store.put(`jobs/${j.id}.json`, j);
    for (const c of fixtureCandidates)
      await env.store.put(`candidates/${j.id}/${c.id}.json`, c);
  }
  let r = await api(req("/jobs/alpha/candidates/two", "DELETE"), env);
  assert.equal(r.status, 200);
  let fly = await (await api(req("/jobs/alpha"), env)).json();
  assert.equal(fly.candidates.length, 1);
  let beta = await (await api(req("/jobs/beta"), env)).json();
  assert.equal(beta.candidates.length, 2);
  await api(req("/jobs/alpha/candidates/two/restore", "POST"), env);
  fly = await (await api(req("/jobs/alpha"), env)).json();
  assert.equal(fly.candidates.length, 2);
  await api(req("/jobs/beta", "DELETE"), env);
  const fresh = createBackend();
  assert.equal((await (await fresh(req("/jobs"), env)).json()).jobs.length, 1);
  await fresh(req("/jobs/beta/restore", "POST"), env);
  assert.equal(
    (await (await fresh(req("/jobs/beta"), env)).json()).candidates.length,
    2,
  );
});
test("new job generates rubric only, then new CV triggers Decisions and evidence", async () => {
  const env = { store: new Store() },
    calls = [];
  const api = createBackend({
    requestOverride: async (endpoint, body) => {
      calls.push([endpoint, body]);
      if (endpoint === "decisions")
        return {
          answers: criteria.map((c) => ({
            name: c.id,
            type: "score",
            score: 2,
          })),
          model: "gpt-6-luna",
        };
      const v =
        body.text.format.name === "role_questions"
          ? { title: "Uploaded role", criteria }
          : {
              items: criteria.map((c) => ({
                id: c.id,
                quotes: [],
                gap: "Verify in interview",
                followup: "Describe a production example.",
              })),
            };
      return {
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(v) }] },
        ],
      };
    },
  });
  const added = await (
    await api(req("/jobs", "POST", { document }), env)
  ).json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "responses");
  assert.equal(added.candidates.length, 0);
  const c = await (
    await api(
      req(`/jobs/${added.id}/candidates`, "POST", {
        document: { ...document, filename: "CV.md" },
        label: "Test Candidate",
      }),
      env,
    )
  ).json();
  assert.equal(c.label, "Test Candidate");
  assert.ok(Math.abs(c.score - 66.6666667) < 0.0001);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["responses", "decisions", "responses"],
  );
  const duplicate = await api(
    req(`/jobs/${added.id}/candidates`, "POST", {
      document: { ...document, filename: "CV.md" },
    }),
    env,
  );
  assert.equal(duplicate.status, 409);
  assert.equal(calls.length, 3);
});
test("failed API call does not create a partial job", async () => {
  const env = { store: new Store() },
    api = createBackend({
      requestOverride: async () => {
        throw Error("OpenAI unavailable");
      },
    });
  const r = await api(req("/jobs", "POST", { document }), env);
  assert.equal(r.status, 400);
  assert.equal(env.store.map.size, 0);
});
test("bad upload and cross-origin mutation are rejected", async () => {
  assert.throws(() => validateDocument({ ...document, filename: "bad.exe" }));
  assert.throws(() =>
    validateDocument({
      ...document,
      sections: [{ location: "x", text: "x".repeat(120001) }],
    }),
  );
  const api = createBackend();
  const r = await api(
    new Request("https://test.example/api/jobs/alpha", {
      method: "DELETE",
      headers: { Origin: "https://other.example" },
    }),
    { store: new Store() },
  );
  assert.equal(r.status, 403);
});
test("position organization and candidate notes persist without changing scores", async () => {
  const env = { store: new Store() },
    api = createBackend();
  const j = { ...fixtureJobs[0], role: document };
  await env.store.put("jobs/alpha.json", j);
  await env.store.put("candidates/alpha/one.json", fixtureCandidates[0]);
  const updated = await (
    await api(
      req("/jobs/alpha/settings", "POST", {
        title: "Design Lead",
        company: "Acme",
        department: "Design",
        description: "Lead design systems.",
        status: "archived",
      }),
      env,
    )
  ).json();
  assert.equal(updated.status, "archived");
  assert.equal(updated.criteria[0].id, criteria[0].id);
  assert.equal(updated.candidates[0].score, rankScore());
  const invalid = await api(
    req("/jobs/alpha/settings", "POST", { title: "", status: "wrong" }),
    env,
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (
      await api(
        req("/jobs/alpha/candidates/one/notes", "POST", {
          notes: "Verify delivery examples.",
        }),
        env,
      )
    ).status,
    200,
  );
  const fresh = createBackend();
  const reopened = await (await fresh(req("/jobs/alpha"), env)).json();
  assert.equal(reopened.candidates[0].notes, "Verify delivery examples.");
  assert.equal(reopened.candidates[0].score, rankScore());
  const listing = await (await fresh(req("/jobs"), env)).json();
  assert.equal(listing.jobs[0].department, "Design");
  assert.equal(listing.jobs[0].status, "archived");
  assert.equal(
    (
      await fresh(
        req("/jobs/alpha/candidates/one/notes", "POST", {
          notes: "x".repeat(20001),
        }),
        env,
      )
    ).status,
    400,
  );
  function rankScore() {
    return (100 * 2) / 3;
  }
});
test("rubric templates copy the original rubric without copying candidates or calling inference", async () => {
  const env = { store: new Store() };
  await env.store.put("jobs/alpha.json", {
    ...fixtureJobs[0],
    role: document,
    department: "Engineering",
  });
  await env.store.put("candidates/alpha/one.json", fixtureCandidates[0]);
  const api = createBackend({
    requestOverride: async () => {
      throw Error("Inference must not be called");
    },
  });
  const r = await api(
    req("/jobs", "POST", {
      templateId: "alpha",
      title: "New role",
      company: "Example",
    }),
    env,
  );
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.notEqual(j.id, "alpha");
  assert.equal(j.title, "New role");
  assert.equal(j.department, "Engineering");
  assert.deepEqual(j.criteria, criteria);
  assert.deepEqual(j.candidates, []);
  assert.deepEqual(j.role, document);
  await api(req("/jobs/alpha", "DELETE"), env);
  assert.equal(
    (await api(req("/jobs", "POST", { templateId: "alpha" }), env)).status,
    400,
  );
});
test("candidate bank excludes removed records and reuse evaluates saved source against target rubric", async () => {
  const env = { store: new Store() },
    calls = [];
  for (const j of fixtureJobs)
    await env.store.put(`jobs/${j.id}.json`, { ...j, role: document });
  await env.store.put("candidates/alpha/one.json", {
    ...fixtureCandidates[0],
    resume: document,
  });
  await env.store.put("candidates/alpha/two.json", {
    ...fixtureCandidates[1],
    deleted: true,
  });
  const api = createBackend({
    requestOverride: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return endpoint === "decisions"
        ? {
            answers: criteria.map((q) => ({
              name: q.id,
              type: "score",
              score: 1,
            })),
          }
        : {
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      items: criteria.map((q) => ({
                        id: q.id,
                        quotes: [],
                        gap: "Verify",
                        followup: "Give an example.",
                      })),
                    }),
                  },
                ],
              },
            ],
          };
    },
  });
  let bank = await (await api(req("/candidates"), env)).json();
  assert.equal(bank.candidates.length, 1);
  assert.equal(bank.candidates[0].jobId, "alpha");
  assert.equal(bank.candidates[0].hasSource, true);
  assert.equal(bank.candidates[0].resume, undefined);
  const r = await api(
    req("/jobs/beta/candidates", "POST", {
      sourceJobId: "alpha",
      sourceCandidateId: "one",
    }),
    env,
  );
  assert.equal(r.status, 201);
  const c = await r.json();
  assert.notEqual(c.id, "one");
  assert.equal(c.label, fixtureCandidates[0].label);
  assert.equal(c.decisions.answers[0].score, 1);
  assert.deepEqual(c.resume.sections, document.sections);
  assert.deepEqual(
    calls.map((c) => c.endpoint),
    ["decisions", "responses"],
  );
  assert.equal(calls[0].body.questions[0].name, criteria[0].id);
  assert.equal(
    (
      await api(
        req("/jobs/beta/candidates", "POST", {
          sourceJobId: "alpha",
          sourceCandidateId: "one",
        }),
        env,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        req("/jobs/beta/candidates", "POST", {
          sourceJobId: "alpha",
          sourceCandidateId: "two",
        }),
        env,
      )
    ).status,
    400,
  );
  await api(req("/jobs/alpha", "DELETE"), env);
  bank = await (await api(req("/candidates"), env)).json();
  assert.equal(bank.candidates.length, 1);
  assert.equal(bank.candidates[0].jobId, "beta");
});
test("supporting links persist separately from scores and reject executable URLs", async () => {
  const env = { store: new Store() },
    api = createBackend();
  await env.store.put("jobs/alpha.json", fixtureJobs[0]);
  await env.store.put("candidates/alpha/one.json", fixtureCandidates[0]);
  const sources = [
    {
      title: "Portfolio",
      url: "https://example.com/portfolio",
      description: "Reviewer-added work sample.",
    },
  ];
  const saved = await api(
    req("/jobs/alpha/candidates/one/sources", "POST", { sources }),
    env,
  );
  assert.equal(saved.status, 200);
  const reopened = await (
    await createBackend()(req("/jobs/alpha"), env)
  ).json();
  assert.deepEqual(reopened.candidates[0].sources, sources);
  assert.deepEqual(
    reopened.candidates[0].decisions,
    fixtureCandidates[0].decisions,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,example",
    "file:///etc/passwd",
  ])
    assert.equal(
      (
        await api(
          req("/jobs/alpha/candidates/one/sources", "POST", {
            sources: [{ ...sources[0], url }],
          }),
          env,
        )
      ).status,
      400,
    );
  await api(req("/jobs/alpha/candidates/one", "DELETE"), env);
  assert.equal(
    (
      await api(
        req("/jobs/alpha/candidates/one/notes", "POST", {
          notes: "Should not save",
        }),
        env,
      )
    ).status,
    404,
  );
});
