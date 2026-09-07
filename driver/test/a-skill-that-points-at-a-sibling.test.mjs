// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A SKILL.md THAT POINTS AT A SIBLING IS POINTING THE SEAT AT INSTRUCTION LOAD.
//
// `skillReads` names what a dispatch is told to read and follow exactly. Several of those SKILL.md files
// then hand the seat a companion — a "Companion files" list, or an outright "Also **read** X before
// writing section Y" — and none of it was measured. The finding that opened this: 345 B came out of
// matter-frame's watchlist-reference.md and the instruction-load ratchet did not move.
//
// `SKILL_COMPANIONS` in stages.mjs closes the measurement. THIS closes the population, which is the half
// that decides whether it stays closed: the original gap was not a wrong list, it was a list nobody was
// required to keep. Every markdown link out of a SKILL.md a stage reads must now be accounted for — as a
// declared read, as a declared companion, or as one of the two kinds of link that are deliberately NOT
// this stage's load, each named with its reason.
//
// ── THE TWO EXCLUSIONS, AND WHY THEY ARE NOT A LOOPHOLE ─────────────────────────────────────────────
//
// CROSS-SKILL — a link into ANOTHER skill's document. prelim-variants cites a step of
// prelim-register/SKILL.md; prelim-register's own two dispatches already measure that file. Counting it
// here as well would inflate the ratchet by 28,535 B nobody dispatched twice, and a ratchet that moves
// for reasons no dispatch can be traced to is worse than one that under-counts.
//
// NOT INSTRUCTION LOAD — a document the SKILL.md names for a reader rather than for the seat. One
// today: case-law-citation's evals.md, "the three scenarios this skill is verified against". Each is
// named individually below with its sentence, so adding one is a decision somebody writes down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, resolveSkillReads, resolveAlsoReads, SKILL_COMPANIONS } from "../stages.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

/** Documents a SKILL.md names for a READER, never for the seat. Each carries the reason it is not load. */
const NOT_INSTRUCTION_LOAD = Object.freeze({
  "case-law-citation/evals.md":
    "the three scenarios this skill is verified against — a test artifact for whoever changes the skill, "
    + "not a document the seat is told to open",
});

/** Every path any dispatch declares, measured or companion. */
function declared() {
  const out = new Set();
  for (const name of Object.keys(STAGES)) {
    for (const p of resolveSkillReads(name, {}) ?? []) out.add(p);
    for (const p of STAGES[name].skillReads ?? []) out.add(p);
    for (const p of resolveAlsoReads(name, {})) out.add(p);
  }
  return out;
}

/** `skills/<dir>/<link>` with `..` resolved, so a cross-skill link is comparable to a declaration. */
const normalise = (dir, link) => `skills/${join(dir, link).split("/")
  .reduce((a, p) => (p === ".." ? a.slice(0, -1) : p === "." ? a : [...a, p]), []).join("/")}`;

/** Markdown links out of the SKILL.md files some dispatch actually reads. */
function links() {
  const out = [];
  for (const p of [...declared()].filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x))) {
    const dir = p.slice("skills/".length, -"/SKILL.md".length);
    const text = readFileSync(join(SKILLS, dir, "SKILL.md"), "utf8");
    for (const l of new Set([...text.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]))) {
      if (l.startsWith("http") || l.startsWith("#")) continue;
      const abs = join(SKILLS, dir, l);
      // A DEAD LINK IS A DIFFERENT DEFECT and is not this file's to police — skill-contract-enumerations
      // already refuses a dispatch naming a file that is not there. Counting it here as a gap would
      // report one fault as another.
      if (!existsSync(abs)) continue;
      out.push({ skill: dir, link: l, path: normalise(dir, l), bytes: statSync(abs).size, cross: l.startsWith("../") });
    }
  }
  return out;
}

test("#1457 every sibling a read SKILL.md points at is measured, or named as not-load", () => {
  const known = declared();
  const gaps = links().filter((r) => !r.cross && !known.has(r.path) && !NOT_INSTRUCTION_LOAD[`${r.skill}/${r.link}`]);
  assert.deepEqual(gaps.map((r) => `${r.skill}/${r.link} (${r.bytes} B)`), [],
    "these documents are handed to a seat by a SKILL.md it reads, and no dispatch's instruction load "
    + "counts a byte of them. Add each to SKILL_COMPANIONS in stages.mjs — or, if it is written for a "
    + "reader rather than for the seat, to NOT_INSTRUCTION_LOAD here WITH the sentence that makes that "
    + "true. What must not happen is the third thing: leaving it out because nobody was looking, which "
    + "is how 101,077 B went unmeasured until #1457.");
});

test("#1457 a CROSS-SKILL link is excluded because the other stage measures it — checked, not assumed", () => {
  const known = declared();
  const cross = links().filter((r) => r.cross);
  assert.ok(cross.length > 0, "no cross-skill link left — this arm is measuring nothing, so re-read the exclusion");
  for (const r of cross)
    assert.ok(known.has(r.path),
      `${r.skill} points at ${r.link}, and it is excluded here on the grounds that the skill it belongs `
      + "to measures it. It does not. That makes the exclusion a hole rather than a de-duplication — "
      + "either the owning stage should declare it, or this one should.");
});

test("#1457 the companion list names real files, and no companion is also a declared read", () => {
  for (const [skill, companions] of Object.entries(SKILL_COMPANIONS)) {
    assert.ok(existsSync(join(SKILLS, skill, "SKILL.md")), `SKILL_COMPANIONS names ${skill}, which ships no SKILL.md`);
    for (const c of companions)
      assert.ok(existsSync(join(SKILLS, skill, c)),
        `${skill} declares the companion ${c}, which is not on disk — a dead declaration measures 0 B and reads as a saving`);
  }
  // A file in BOTH lists would be counted once (the ratchet de-dupes) and would leave a reader of either
  // list believing that list governs it. They are different instructions to the seat: one is
  // read-and-follow-exactly, the other is not emitted at all.
  for (const name of Object.keys(STAGES)) {
    const reads = new Set(resolveSkillReads(name, {}) ?? []);
    const both = resolveAlsoReads(name, {}).filter((p) => reads.has(p));
    assert.deepEqual(both, [], `${name} declares ${both.join(", ")} as BOTH a read and a companion`);
  }
});

test("#1457 THE COMPANIONS REACH NO PROMPT — they are measured and never emitted", () => {
  // The whole reason for a second list. `reads()` composes "First, read and follow exactly: …" from
  // skillReads and `composeFollowup` composes "this stage is held to …" from resolveSkillReads; a
  // companion appearing in either would be the doctrine change this design exists to avoid.
  let checked = 0;
  for (const name of Object.keys(STAGES)) {
    const companions = resolveAlsoReads(name, {});
    if (!companions.length) continue;
    checked += 1;
    const emitted = resolveSkillReads(name, {}) ?? [];
    for (const c of companions)
      assert.ok(!emitted.includes(c),
        `${name} would now tell its seat to read and follow ${c} exactly. That is option 1 — the reading `
        + "this issue rejected, because SKILL.md framed it as enrichment on purpose.");
  }
  assert.ok(checked >= 4, `only ${checked} dispatches carry companions — the arm is thinner than the population`);
});
