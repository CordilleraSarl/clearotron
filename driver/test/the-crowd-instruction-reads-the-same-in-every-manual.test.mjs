// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CROWD INSTRUCTION READS THE SAME IN EVERY MANUAL THAT CARRIES IT. "At every step: look at what you have before
// you work on it" tells each stage how to handle a crowded answer, and the same paragraph is copied into each manual
// a stage reads, so that every stage is told the same thing. A copy edited on its own would tell one stage something
// the others are not told, and nothing would notice. The search instructions beside it differ on purpose, per product,
// so only the paragraph under its heading is compared (design, 2026-11-19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKILLS = join(import.meta.dirname, "..", "skills");
const HEADING = /^#{2,3} At every step: look at what you have before you work on it$/m;

/** The paragraph under the heading: every line until the next heading, without the blank lines around it. */
function paragraph(text) {
  const at = text.search(HEADING);
  if (at < 0) return null;
  const after = text.slice(at).split("\n").slice(1);
  const end = after.findIndex((line) => /^#/.test(line));
  return (end < 0 ? after : after.slice(0, end)).join("\n").trim();
}

function manuals(dir = SKILLS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? manuals(join(dir, e.name))
    : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
}

/** The copies that do not match the first, by file. */
const drifted = (copies) => copies.filter((c) => c.text !== copies[0].text).map((c) => c.file);

const copies = manuals()
  .map((file) => ({ file: relative(SKILLS, file).split(sep).join("/"), text: paragraph(readFileSync(file, "utf8")) }))
  .filter((c) => c.text !== null)
  .sort((a, b) => a.file.localeCompare(b.file));

test("every manual that carries the crowd instruction carries it byte for byte", () => {
  assert.deepEqual(copies.map((c) => c.file), [
    "clearance-common-law/SKILL.md",
    "clearance-register/SKILL.md",
    "clearance-search/report-prose.md",
    "knockout-register-read/SKILL.md",
  ], "the manuals that carry the paragraph changed: read the new or missing one before changing this list");
  assert.equal(copies.length, 4);
  for (const c of copies) assert.ok(c.text.length > 200, `${c.file}: the paragraph read as empty or cut short`);
  assert.deepEqual(drifted(copies), [], "a copy of the crowd instruction no longer reads as the others do");
});

test("one character changed in any one copy is caught", () => {
  assert.equal(copies.length, 4);
  for (let i = 0; i < copies.length; i++) {
    const planted = copies.map((c, j) => (j === i ? { ...c, text: c.text.replace("crowded", "crowdeD") } : c));
    assert.notEqual(planted[i].text, copies[i].text, `${copies[i].file}: the planted change did not land`);
    assert.ok(drifted(planted).length > 0, `${copies[i].file}: a one-character drift in this copy went unseen`);
  }
});
