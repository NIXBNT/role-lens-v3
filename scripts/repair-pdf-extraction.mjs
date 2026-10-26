// Re-extract an available original PDF and repair whitespace-only quote matches.
// Dry run by default; --apply creates a backup before each record write.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { assemblePdfText, reconcileQuote } from "../ui/pdf-text.mjs";
import { FileStore } from "../src/store.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const original = process.argv[2];
if (!original)
  throw Error(
    "Usage: node scripts/repair-pdf-extraction.mjs /absolute/original.pdf [--apply]",
  );
const filename = path.basename(original),
  apply = process.argv.includes("--apply");
const doc = await getDocument({
  data: new Uint8Array(await fs.readFile(original)),
  isEvalSupported: false,
  disableFontFace: true,
}).promise;
const sections = [];
try {
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    sections.push({
      location: `Page ${page}`,
      text: assemblePdfText(content.items),
    });
  }
} finally {
  await doc.destroy();
}
const text = sections.map((s) => `[${s.location}]\n${s.text}`).join("\n\n");
const resume = { filename, sections, text };
const store = new FileStore(process.env.DATA_DIR || path.join(root, ".data"));
await store.init();
let matched = 0,
  repaired = 0,
  unmatched = 0;
for (const key of await store.list("candidates/")) {
  const candidate = await store.get(key);
  if (candidate.filename !== filename) continue;
  matched++;
  const evidence = candidate.evidence.map((item) => ({
    ...item,
    quotes: item.quotes.map((quote) => {
      const section = sections.find((s) => s.location === quote.location);
      const replacement = section && reconcileQuote(quote.text, section.text);
      if (replacement === null || replacement === undefined) {
        unmatched++;
        return quote;
      }
      if (replacement !== quote.text) repaired++;
      return { ...quote, text: replacement };
    }),
  }));
  // Do not mix repaired source with quotes that could not be re-verified.
  if (
    evidence.some((item) =>
      item.quotes.some(
        (q) =>
          !sections.some(
            (s) =>
              s.location === q.location &&
              s.text.replace(/\s+/g, " ").includes(q.text.replace(/\s+/g, " ")),
          ),
      ),
    )
  )
    throw Error(
      "A quote cannot be verified against the repaired PDF. No update will be written for this candidate.",
    );
  if (apply) {
    const backups = path.join(store.directory, "backups");
    await fs.mkdir(backups, { recursive: true, mode: 0o700 });
    await fs.copyFile(
      store.file(key),
      path.join(backups, `${Date.now()}-${encodeURIComponent(key)}`),
    );
    await store.put(key, {
      ...candidate,
      evidence,
      resume,
      fingerprint: createHash("sha256").update(text).digest("hex"),
      extractionVersion: 2,
    });
  }
}
console.log(
  JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    matchedCandidates: matched,
    repairedQuotes: repaired,
    unmatchedQuotes: unmatched,
    pages: sections.length,
  }),
);
