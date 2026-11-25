// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Tests wrote out the register manuals' ruled sentences in many files, so a ruled wording change meant editing each one.
// The sentences of a gathered manual now sit in one fixture per manual, and the tests name them from there. This holds
// both halves: every sentence a fixture holds is still in its manual, word for word, and no other test writes one out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT_SENTENCES } from "./ruled-sentences-unit.mjs";
import { DIGEST_SENTENCES } from "./ruled-sentences-digest.mjs";
import { COMMON_LAW_SENTENCES } from "./ruled-sentences-common-law.mjs";
import { GRID_SENTENCES } from "./ruled-sentences-common-law-grid.mjs";
import { VARIANTS_SENTENCES } from "./ruled-sentences-variants.mjs";
import { ASSESS_SENTENCES } from "./ruled-sentences-knockout-assess.mjs";
import { INQUIRY_SENTENCES } from "./ruled-sentences-placement-inquiry.mjs";
import { REGISTER_SENTENCES } from "./ruled-sentences-register.mjs";
import { REFUTATION_SENTENCES } from "./ruled-sentences-narrative-refutation.mjs";
import { RECIPES_SENTENCES } from "./ruled-sentences-register-recipes.mjs";
import { PHASE2_SENTENCES } from "./ruled-sentences-phase2-execution.mjs";
import { SKEPTIC_SENTENCES } from "./ruled-sentences-skeptic.mjs";
import { SYNTHESIS_SENTENCES } from "./ruled-sentences-synthesis-rules.mjs";
import { MATTER_FRAME_SENTENCES } from "./ruled-sentences-matter-frame.mjs";
import { BLIND_FRAME_SENTENCES } from "./ruled-sentences-blind-frame.mjs";
import { CORSEARCH_SENTENCES } from "./ruled-sentences-corsearch.mjs";
import { SIGNA_SENTENCES } from "./ruled-sentences-signa.mjs";
import { FIRM_WIDE_SENTENCES } from "./ruled-sentences-firm-wide-reasoning.mjs";
import { KO_FRAME_SENTENCES } from "./ruled-sentences-knockout-frame.mjs";
import { GATHERED, manualPins, heldStrings, namesManual } from "../../scripts/count-manual-pins.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = {
  "driver/skills/clearance-register/unit.md": UNIT_SENTENCES,
  "driver/skills/clearance-register/digest.md": DIGEST_SENTENCES,
  "driver/skills/clearance-common-law/SKILL.md": COMMON_LAW_SENTENCES,
  "driver/skills/clearance-common-law/grid.md": GRID_SENTENCES,
  "driver/skills/clearance-variants/SKILL.md": VARIANTS_SENTENCES,
  "driver/skills/knockout-assess/SKILL.md": ASSESS_SENTENCES,
  "driver/skills/placement-inquiry/SKILL.md": INQUIRY_SENTENCES,
  "driver/skills/clearance-register/SKILL.md": REGISTER_SENTENCES,
  "driver/skills/narrative-refutation/SKILL.md": REFUTATION_SENTENCES,
  "driver/skills/clearance-register/register-recipes.md": RECIPES_SENTENCES,
  "driver/skills/clearance-search/phase2-execution.md": PHASE2_SENTENCES,
  "driver/skills/skeptic/SKILL.md": SKEPTIC_SENTENCES,
  "driver/skills/clearance-search/synthesis-rules.md": SYNTHESIS_SENTENCES,
  "driver/skills/matter-frame/SKILL.md": MATTER_FRAME_SENTENCES,
  "driver/skills/blind-frame/SKILL.md": BLIND_FRAME_SENTENCES,
  "driver/skills/clearance-register/providers/corsearch.md": CORSEARCH_SENTENCES,
  "driver/skills/clearance-register/providers/signa.md": SIGNA_SENTENCES,
  "driver/skills/clearance-search/firm-wide-reasoning.md": FIRM_WIDE_SENTENCES,
  "driver/skills/knockout-frame/SKILL.md": KO_FRAME_SENTENCES,
};
// Strings a test that reads a manual uses for its own purpose, which the manual happens to share word for word: an example
// row label used as a unit name, a stage message's own words, a fixture's input. They hold nothing of the manual.
const COINCIDENT = {
  "driver/skills/clearance-register/digest.md": { "driver/test/coverage-form-seat-axis.test.mjs": 2 },
  "driver/skills/clearance-search/phase2-execution.md": {
    "driver/test/a-search-that-did-not-answer-is-never-recorded-as-one-that-found-nothing.test.mjs": 1,
  },
  "driver/skills/matter-frame/SKILL.md": {
    "driver/test/a-class-the-client-reaches-is-added-and-costs-one-question.test.mjs": 3,
  },
  "driver/skills/blind-frame/SKILL.md": { "driver/test/blind-frame-model.test.mjs": 1 },
  "driver/skills/knockout-assess/SKILL.md": {
    "driver/test/a-knockout-defect-reaches-the-step-that-can-repair-it.test.mjs": 1,
    "driver/test/a-knockout-reads-the-clients-own-request.test.mjs": 1,
    "driver/test/knockout-typed-finding.test.mjs": 1,
  },
};
const flat = (s) => String(s).replace(/\s+/g, " ");

test("every sentence a fixture holds is in its manual, word for word", () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(GATHERED).sort(), "a gathered manual has no fixture here, or the reverse");
  for (const [manual, sentences] of Object.entries(FIXTURES)) {
    const text = flat(readFileSync(join(ROOT, manual), "utf8"));
    assert.ok(Object.keys(sentences).length > 0, `${manual}: its fixture holds no sentence, so this would pass on nothing`);
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

test("a test an overlay lays into the tree, uncommitted, is not the product's and is not counted", () => {
  const root = mkdtempSync(join(tmpdir(), "laid-"));
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "driver", "skills", "invented-manual"), { recursive: true });
  mkdirSync(join(root, "driver", "test"), { recursive: true });
  const S = "An invented sentence the manual says, at least twenty-five characters.";
  writeFileSync(join(root, "driver", "skills", "invented-manual", "SKILL.md"), `# Invented\n\n${S}\n`);
  const holding = `const m = read("skills/invented-manual/SKILL.md");\nassert.ok(m.includes("${S}"));\n`;
  writeFileSync(join(root, "driver", "test", "published.test.mjs"), holding);
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "published");
  writeFileSync(join(root, "driver", "test", "laid.test.mjs"), holding);
  git("add", "-A");   // laid: tracked in the index, not in HEAD
  const files = manualPins(["driver/skills/invented-manual/SKILL.md"], root)["driver/skills/invented-manual/SKILL.md"].files;
  assert.deepEqual(files, { "driver/test/published.test.mjs": 1 });
});
