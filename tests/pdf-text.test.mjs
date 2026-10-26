import test from "node:test";
import assert from "node:assert/strict";
import { assemblePdfText, reconcileQuote } from "../ui/pdf-text.mjs";
const run = (str, x, width, extra = {}) => ({
  str,
  width,
  transform: [10, 0, 0, 10, x, 100],
  dir: "ltr",
  ...extra,
});
test("PDF fragments within a word stay joined; geometric word gaps become spaces", () => {
  assert.equal(
    assemblePdfText([
      run("Py", 0, 10),
      run("th", 10, 10),
      run("on", 20, 10),
      run("data", 33, 20),
      run("pipe", 56, 20),
      run("lines", 76, 25),
    ]),
    "Python data pipelines",
  );
});
test("PDF explicit whitespace, punctuation, font changes and line breaks are preserved", () => {
  assert.equal(
    assemblePdfText([
      run("SQL", 0, 15),
      run(" ", 15, 3),
      run("and", 18, 15),
      run(" ", 33, 3),
      run("Dune", 36, 20),
      run("SQL", 56, 15, { transform: [12, 0, 0, 12, 56, 100] }),
      run("/", 71, 3),
      run("Trino", 74, 25, { hasEOL: true }),
      run("API", 0, 15, { transform: [10, 0, 0, 10, 0, 85] }),
    ]),
    "SQL and DuneSQL/Trino\nAPI",
  );
});
test("PDF line changes work without hasEOL; marked content entries do not add gaps", () => {
  assert.equal(
    assemblePdfText([
      run("First", 0, 20),
      { type: "beginMarkedContent" },
      run("line", 23, 20),
      run("Second", 0, 30, { transform: [10, 0, 0, 10, 0, 85] }),
      run("line", 33, 20, { transform: [10, 0, 0, 10, 33, 85] }),
    ]),
    "First line\nSecond line",
  );
});
test("quote reconciliation changes only whitespace and rejects different content", () => {
  assert.equal(
    reconcileQuote(
      "Py th on pipe li nes",
      "Built Python pipelines for analytics.",
    ),
    "Python pipelines",
  );
  assert.equal(
    reconcileQuote(
      "Built Python pipelines",
      "Built Python\npipelines for analytics.",
    ),
    "Built Python\npipelines",
  );
  assert.equal(
    reconcileQuote("Invented experience", "Built Python pipelines."),
    null,
  );
  assert.equal(reconcileQuote("  ", "Text"), null);
});
