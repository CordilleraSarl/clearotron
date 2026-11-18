// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Tests wrote out the register manuals' ruled sentences in many files, so a ruled wording change meant editing each one.
// The sentences of a gathered manual now sit in one fixture per manual, and the tests name them from there. This holds
// both halves: every sentence a fixture holds is still in its manual, word for word, and no other test writes one out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT_SENTENCES } from "./ruled-sentences-unit.mjs";
import { DIGEST_SENTENCES } from "./ruled-sentences-digest.mjs";
import { COMMON_LAW_SENTENCES } from "./ruled-sentences-common-law.mjs";
import { GATHERED, manualPins, heldStrings, namesManual } from "../../scripts/count-manual-pins.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = {
  "driver/skills/clearance-register/unit.md": UNIT_SENTENCES,
  "driver/skills/clearance-register/digest.md": DIGEST_SENTENCES,
  "driver/skills/clearance-common-law/SKILL.md": COMMON_LAW_SENTENCES,
};
// Strings a test that reads a manual uses for its own purpose, which the manual happens to share word for word: here an
// example row label used as a unit name. They hold nothing of the manual.
const COINCIDENT = {
  "driver/skills/clearance-register/digest.md": { "driver/test/coverage-form-seat-axis.test.mjs": 2 },
};
const flat = (s) => String(s).replace(/\s+/g, " ");

test("every sentence a fixture holds is in its manual, word for word", () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(GATHERED).sort(), "a gathered manual has no fixture here, or the reverse");
  for (const [manual, sentences] of Object.entries(FIXTURES)) {
    const text = flat(readFileSync(join(ROOT, manual), "utf8"));
    assert.ok(Object.keys(sentences).length > 5, `${manual}: only ${Object.keys(sentences).length} sentences, so this would pass on nothing`);
    const gone = Object.entries(sentences).filter(([, s]) => !text.includes(flat(s))).map(([k]) => k);
    assert.deepEqual(gone, [], `${manual} no longer says these word for word; reword them here, once`);
  }
});

test("no other test writes out a sentence of a gathered manual", (t) => {
  const pins = manualPins(Object.keys(GATHERED), ROOT);
  if (pins === null) return t.skip(skipReason("count-manual-pins"));
  for (const [manual, { files }] of Object.entries(pins)) {
    const extra = Object.entries(files).filter(([f, n]) => n > (COINCIDENT[manual]?.[f] ?? 0)).map(([f, n]) => `${f}: ${n}`);
    assert.deepEqual(extra, [], `${manual}: name these from ${GATHERED[manual]} instead`);
  }
});

test("the counter sees a string and a chain, and not a comment, a regular expression or a short phrase", () => {
  const S = "An invented sentence of at least twenty-five characters.";
  assert.deepEqual(heldStrings(`assert.ok(m.includes("${S}"));`), [S]);
  assert.deepEqual(heldStrings(`const R = "An invented sentence of at least "\n  + 'twenty-five characters.';`), [S]);
  assert.deepEqual(heldStrings(`// "${S}"`), [], "a comment");
  assert.deepEqual(heldStrings(`assert.match(m, /said "${S}"/);`), [], "inside a regular expression");
  assert.deepEqual(heldStrings(`assert.ok(m.includes("a short phrase"));`), [], "too short to count");
  assert.deepEqual(heldStrings(`const q = "it\\u2019s an invented sentence, escaped";`), ["it’s an invented sentence, escaped"]);
});

test("a test counts against a manual only when it names it: the folder, and the file unless it is SKILL.md", () => {
  assert.equal(namesManual(`read("skills/clearance-register/unit.md")`, "driver/skills/clearance-register/unit.md"), true);
  assert.equal(namesManual(`join(DRIVER, "skills", "clearance-register", "unit.md")`, "driver/skills/clearance-register/unit.md"), true);
  assert.equal(namesManual(`read("skills/clearance-register/digest.md")`, "driver/skills/clearance-register/unit.md"), false, "the folder's other manual");
  assert.equal(namesManual(`read("skills/clearance-common-law/SKILL.md")`, "driver/skills/clearance-common-law/SKILL.md"), true);
  assert.equal(namesManual(`const header = "| Coverage unit | Status | Reason |";`, "driver/skills/clearance-common-law/SKILL.md"), false, "a shared table header");
});
