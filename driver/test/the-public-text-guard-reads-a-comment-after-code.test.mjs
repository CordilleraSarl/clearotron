// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PUBLIC-TEXT GUARD READS A COMMENT AFTER CODE, AND THE CENSUS COUNTS STRINGS IN A COLUMN OF THEIR OWN. A script line
// was read only when it started as a comment, so a citation after code on the same line, or in a string, was never seen.
// The scanner that finds a line's comment and string text is checked here against a real parser, and the census and the
// diff guard are checked on planted lines. Every reference below is planted in a string literal, which neither refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { sourceSpans } = await import("../../shared/source-spans.mjs");
const { offendingInFile, censusOf, CENSUS_COLUMNS, STRING_COLUMN } = await import("../../shared/reference-guard-classes.mjs");
const { addedLines, addedHits } = await import("../../scripts/added-reference-check.mjs");

const CITE = ["tracker", "issue", "4321"].join(" ");   // assembled, so this file's own text carries no citation

test("the scanner tells a comment from a string, a template and a regular expression", () => {
  const src = [
    "#!/usr/bin/env node",
    `const url = "https://example.test/a//b"; // after code`,
    "const re = /\\/\\/not-a-comment/g, half = 4 / 2; /* block */ const t = `in ${half / 2} // template`;",
    "/* a block",
    "   that spans */ code(); // tail",
    "const s = 'it\\'s // fine';",
  ].join("\n");
  const s = sourceSpans(src);
  assert.equal(s[0].comment, "/usr/bin/env node");
  assert.equal(s[1].comment, " after code");
  assert.equal(s[1].strings, "https://example.test/a//b");
  assert.equal(s[2].comment, " block ");
  assert.equal(s[2].strings, "in  // template");
  assert.equal(s[3].comment, " a block");
  assert.equal(s[4].comment, "   that spans  tail");
  assert.equal(s[5].strings, "it's // fine");
  assert.equal(s[5].comment, "");
});

test("the scanner agrees with a real parser on every comment and string line of the shared and script folders", () => {
  const acorn = createRequire(join(ROOT, "package.json"))("acorn");
  const files = execFileSync("git", ["ls-files", "shared/*.mjs", "scripts/*.mjs"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  assert.ok(files.length > 50, "the slice is too small to say anything");
  const off = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    const starts = [0]; for (let k = 0; k < src.length; k++) if (src[k] === "\n") starts.push(k + 1);
    const lineOf = (pos) => { let a = 0, b = starts.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (starts[m] <= pos) a = m; else b = m - 1; } return a; };
    const want = starts.map(() => ({ comment: "", strings: false }));
    for (const t of acorn.tokenizer(src, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true,
      onComment: (block, _text, s, e) => { let l = lineOf(s + 2); for (const part of src.slice(s + 2, block ? e - 2 : e).split("\n")) want[l++].comment += part; } })) {
      if (!((t.type.label === "string" || t.type.label === "template") && String(t.value ?? "").length)) continue;
      // A template's text can start on a later line than its token: a line holds string text only where the token's own
      // text falls on it.
      for (let l = lineOf(t.start); l <= lineOf(t.end); l++) {
        if (src.slice(Math.max(t.start, starts[l]), Math.min(t.end, (starts[l + 1] ?? src.length + 1) - 1)).length) want[l].strings = true;
      }
    }
    const got = sourceSpans(src);
    want.forEach((w, l) => {
      if (w.comment !== got[l].comment) off.push(`${f}:${l + 1} comment`);
      if (w.strings && !got[l].strings) off.push(`${f}:${l + 1} string`);
    });
  }
  assert.deepEqual(off.slice(0, 10), [], `${off.length} line(s) read differently from the parser`);
});

test("the census counts a citation after code under its class, and one in a string in the string column", () => {
  const src = `export const a = 1; // ${CITE}\nexport const b = "${CITE}";\n// ${CITE}\n`;
  const rows = offendingInFile("driver/planted.mjs", src);
  assert.deepEqual(rows.map((r) => [r.prose.map((h) => h.id), r.strings.map((h) => h.id)]),
    [[["spelled-citation"], []], [[], ["spelled-citation"]], [["spelled-citation"], []], [[], []]]);
  const c = censusOf(["driver/planted.mjs"], () => src);
  const counts = c.files["driver/planted.mjs"];
  assert.equal(counts[CENSUS_COLUMNS.indexOf("spelled-citation")], 2, "the comment after code was not counted");
  assert.equal(counts[CENSUS_COLUMNS.indexOf(STRING_COLUMN)], 1, "the string was not counted in its column");
  assert.equal(c.total, 3);
});

test("the diff guard refuses a citation in a comment after code on an added line, and not one in a string", () => {
  const after = `const a = 1;\nconst b = 2; // ${CITE}\nconst c = "${CITE}";\nconst d = "x // ${CITE}";\n`;
  const diff = ["+++ b/driver/planted.mjs", "@@ -1,0 +2,3 @@", `+const b = 2; // ${CITE}`, `+const c = "${CITE}";`, `+const d = "x // ${CITE}";`].join("\n");
  const added = addedLines(diff);
  assert.deepEqual(added.map((a) => a.n), [2, 3, 4], "the added lines are not placed in the file");
  const hits = addedHits(added, () => after);
  assert.deepEqual(hits.map((h) => [h.id, h.line.slice(0, 12)]), [["spelled-citation", "const b = 2;"]]);
  assert.deepEqual(addedHits(added, () => { throw new Error("unreadable"); }), [], "an unreadable file is read by the line rule alone");
});
