import test from "node:test";
import assert from "node:assert/strict";
import { sortCandidates, nextComparisonSort } from "../ui/comparison.mjs";
const candidates = [
  {
    id: "c",
    label: "Zoe",
    score: 90,
    decisions: {
      answers: [
        { name: "sql", score: 1 },
        { name: "python", score: 3 },
      ],
    },
  },
  {
    id: "a",
    label: "Alex",
    score: 50,
    decisions: {
      answers: [
        { name: "sql", score: 3 },
        { name: "python", score: 0.4 },
      ],
    },
  },
  {
    id: "b",
    label: "Blair",
    score: 70,
    decisions: {
      answers: [
        { name: "sql", score: 2 },
        { name: "python", score: 1.8 },
      ],
    },
  },
];
test("all comparison columns sort on unrounded values in both directions without changing stored ranks", () => {
  const original = structuredClone(candidates);
  for (const [key, expected] of [
    ["candidate", ["a", "b", "c"]],
    ["overall", ["a", "b", "c"]],
    ["criterion:sql", ["c", "b", "a"]],
    ["criterion:python", ["a", "b", "c"]],
  ]) {
    assert.deepEqual(
      sortCandidates(candidates, { key, direction: "ascending" }).map(
        (c) => c.id,
      ),
      expected,
    );
    assert.deepEqual(
      sortCandidates(candidates, { key, direction: "descending" }).map(
        (c) => c.id,
      ),
      [...expected].reverse(),
    );
  }
  assert.deepEqual(candidates, original);
});
test("new score columns start high first, names start A–Z, and clicks toggle direction", () => {
  let state = nextComparisonSort(
    { key: "overall", direction: "descending" },
    "candidate",
  );
  assert.deepEqual(state, { key: "candidate", direction: "ascending" });
  state = nextComparisonSort(state, "candidate");
  assert.equal(state.direction, "descending");
  state = nextComparisonSort(state, "criterion:sql");
  assert.equal(state.direction, "descending");
  state = nextComparisonSort(state, "criterion:sql");
  assert.equal(state.direction, "ascending");
});
test("score ties have stable name ordering", () => {
  const tied = candidates.map((c) => ({ ...c, score: 70 }));
  assert.deepEqual(
    sortCandidates(tied).map((c) => c.label),
    ["Alex", "Blair", "Zoe"],
  );
});
