// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the manuals each model stage declares, read from the tree
//
// THE RULED READING PARAGRAPH REACHES THE OFF-REGISTER SWEEP AND THE WRITE-UP, WORD FOR WORD.
//
// The lawyer's method says, at every step, look at what you have before you work on it, and that it applies "to the
// register's answer, to the list of records, to the placements, to the off-register sweep and to the write-up
// alike". The register's reading steps carried the paragraph; the sweep and the writing stages did not. Each now
// declares a manual that carries it, in the register manual's own words. That each declared manual reaches its
// stage on both engines is the instruction-files check's to prove (every-model-stage-is-handed-the-instruction-files-
// it-declares.test.mjs). The frame, which runs before any register answer exists, is given its own class rule and
// not this paragraph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSkillReads } from "../stages.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(DRIVER, rel), "utf8");
const HEADING = "At every step: look at what you have before you work on it";

/** The paragraph as the register manual ships it: the text between its heading and the next heading. */
function shippedParagraph() {
  const src = read("skills/clearance-register/SKILL.md");
  const at = src.indexOf(`### ${HEADING}`);
  assert.ok(at > 0, "the register manual no longer carries the ruled paragraph under its heading");
  const after = src.slice(at).split("\n").slice(1);
  const end = after.findIndex((l, i) => i > 0 && l.startsWith("#"));
  const body = after.slice(0, end).join("\n").trim();
  assert.match(body, /^Fifty\? Read them all\./, "premise: the paragraph's text was not found under its heading");
  assert.match(body, /to the off-register sweep and to the write-up alike\.$/, "premise: the paragraph's text was cut short");
  return body;
}
const carries = (stage, body) => resolveSkillReads(stage, { profile: null, job: {} })
  .filter((rel) => { const t = read(rel); return t.includes(body) && t.includes(HEADING); });

test("every sweep and writing stage declares a manual that carries the paragraph word for word", () => {
  const body = shippedParagraph();
  for (const stage of ["common-law", "common-law-half", "synthesis", "narrative-refutation", "report-overview", "report-card"])
    assert.ok(carries(stage, body).length > 0, `${stage}: none of its declared manuals carries the ruled paragraph as shipped`);
});

test("the register's own reading steps still carry it, and the frame is given its class rule instead", () => {
  const body = shippedParagraph();
  for (const stage of ["register-unit", "register-digest"]) assert.ok(carries(stage, body).length > 0, `${stage} lost the paragraph`);
  // CONTROL: the check can say no. The frame holds no register answer yet, so it is not told to read one.
  assert.deepEqual(carries("matter-frame", body), [], "the frame was handed the order to read a register answer it does not hold");
  assert.ok(read("skills/matter-frame/SKILL.md").includes("### Which classes to search"), "the frame's own class rule is gone");
});
