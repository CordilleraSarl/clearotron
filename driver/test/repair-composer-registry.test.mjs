// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-composer-registry.test.mjs —. EVERY REPAIR COMPOSER IS REGISTERED, AND AN UNREGISTERED
// ONE FAILS ON THE COMMIT THAT ADDS IT.
//
// ── WHY A DISCOVERY CENSUS AND NOT A LIST ───────────────────────────────────────────────────────────
//
// The issue was filed against seven composers, found by `grep 'followup: lines('` over pipeline.mjs. The
// tree carried TWENTY-SEVEN. Sixteen were written as `const followup = lines(…)` and passed by shorthand;
// four were already-named builders living in three other modules; one was the second arm of a ternary
// whose first arm any scan stops at. The gap was not carelessness — it was that the population was
// defined by a SOURCE SHAPE, and a source shape only ever finds the shapes somebody thought of.
//
// So the population here is defined by WHAT REACHES A SEAT. `pipeline.mjs` has exactly one site that
// composes a followup — it says so itself — and three routes reach it:
//
//     const patch = opts.followup ?? opts.freshMessage ?? carry?.message ?? null;
//
// A composer is anything that produces one of those three values. The census below asserts that every
// one of them is a `repairFollowup(…)` call naming a registered key, and it carries a FLOOR, because a
// scan that quietly stopped finding sites would report zero unregistered composers and read as a pass —
// an absence wearing a green tick, in the check whose whole job is to refuse exactly that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolWrittenArtifact } from "../gateway.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REPAIR_COMPOSERS, REGISTERED_KEYS, composerFor, repairFollowup } from "../repair-composers.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineSrc = () => readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");

/**
 * Every composing site in a source text, and how each one supplies its value. PURE — the source is
 * injected, so the planted controls below can exercise it on an invented corpus rather than on the tree.
 *
 * `kind: "registered"` carries the key it names. `kind: "bespoke"` is composition at the dispatch site,
 * which is what this issue makes illegal.
 */
export function discoverComposingSites(src) {
  const out = [];
  const lineOf = (i) => String(src).slice(0, i).split("\n").length;
  // Comments are history, never dispatched — the scope rule E3 learned twice and E12 declares.
  const code = String(src).split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  // `message` is matched ONLY as an assignment (`const message = lines(`), which is the plan-draft carry's
  // form. As a PROPERTY it was not a repair route either: `message: lines(…)` used to appear in the
  // argv builder for the bind-ack one-shot — a notification to an operator channel, composing no repair
  // tail and reaching no clearance seat. That call site left the product with the delivery mode at
  //, so the exclusion now costs nothing; it is kept because the PROPERTY form could return, and
  // an unexplained exclusion in a census is indistinguishable from a hole in one.
  for (const m of code.matchAll(/(?:followup|freshMsg|retryMsg)\s*[:=]\s*lines\(|(?:const|let)\s+message\s*=\s*lines\(/g))
    out.push({ line: lineOf(m.index), kind: "bespoke", detail: m[0].trim() });
  for (const m of code.matchAll(/\?\s*lines\(|:\s*lines\(/g)) {
    // a ternary arm feeding a followup — the shape that hid the 27th composer
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    if (/(?:followup|freshMsg|retryMsg)\s*=\s*[^;]*$/.test(before)) out.push({ line: lineOf(m.index), kind: "bespoke", detail: "ternary arm" });
  }
  for (const m of code.matchAll(/repairFollowup\(\s*"([^"]+)"/g)) out.push({ line: lineOf(m.index), kind: "registered", key: m[1] });
  return out;
}

// ── THE CENSUS ───────────────────────────────────────────────────────────────────────────────────────

test("#1183: no repair instruction is composed at its dispatch site — every one goes through the registry", () => {
  const sites = discoverComposingSites(pipelineSrc());
  const registered = sites.filter((s) => s.kind === "registered");
  const bespoke = sites.filter((s) => s.kind === "bespoke");

  // FLOOR FIRST. Without it every assertion below is satisfied by a scan that found nothing.
  assert.ok(registered.length >= 25,
    `only ${registered.length} registered composing site(s) found in pipeline.mjs — the scan has gone stale, `
    + "and a scan that finds nothing reports no unregistered composers and reads as a pass");

  assert.deepEqual(bespoke.map((b) => `pipeline.mjs:${b.line} ${b.detail}`), [],
    "a repair instruction is composed INLINE at its dispatch site.\n"
    + "  Register it in driver/repair-composers.mjs and call repairFollowup(\"<stage>:<trigger>\", {…}) instead.\n"
    + "  An unregistered composer is invisible to the #865 agreement guard — it walks the registry, and\n"
    + "  a composer it cannot walk is one that can order a hand-write on a stage whose grant refuses it\n"
    + "  while the guard reports that stage clean in all three directions. That happened, on matter-frame.");
});

test("#1183: the shared repair tail is composed ONLY where composers live", () => {
  // The strongest single invariant available, and it needs no list: `editRepairTail` is the file-edit
  // order. If it appears at a dispatch site, a repair instruction is being composed there whatever shape
  // it is written in — which is how the sixteen this issue's own grep could not see were found.
  const code = pipelineSrc().split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  const hits = [...code.matchAll(/\beditRepairTail\(/g)];
  assert.equal(hits.length, 0,
    `pipeline.mjs composes the shared repair tail at ${hits.length} site(s). It belongs in `
    + "driver/repair-composers.mjs, where the #865 guard can walk it.");
});

test("#1183: every named key is registered, and every registered key is reached — no phantoms", () => {
  const used = [...new Set(discoverComposingSites(pipelineSrc()).filter((s) => s.kind === "registered").map((s) => s.key))].sort();
  const known = [...REGISTERED_KEYS].sort();

  const unregistered = used.filter((k) => !known.includes(k));
  assert.deepEqual(unregistered, [], "a dispatch names a composer key the registry does not carry");

  // AND THE OTHER DIRECTION. A registered composer no site reaches is a PHANTOM: the guard walks it, the
  // suite counts it, and it describes text no seat can be handed. Same defect the arm-2 baseline carried
  // for two days — a recorded row outliving its subject.
  const phantom = known.filter((k) => !used.includes(k));
  assert.deepEqual(phantom, [],
    "a registered composer is reached by no dispatch site. Delete it, or point a site at it — a registry "
    + "row that describes nothing makes the census overstate what is covered.");
});

test("#1183: repairFollowup REFUSES an unregistered key at runtime, not only in CI", () => {
  // "Registered or it does not reach a seat" is a runtime fact too. The census makes an unregistered
  // composer a build failure; this makes composing one impossible.
  assert.throws(() => repairFollowup("synthesis:invented", {}), /no registered composer/);
  assert.ok(composerFor("matter-frame:intake-asks-followup"), "…and a registered one resolves");
});

// ── THE SAMPLES, WHICH ARE WHAT THE GUARD WALKS ────────────────────────────────────────────────

test("#1183: every composer composes, and every branch that can emit a tail has a sample that does", () => {
  assert.ok(REPAIR_COMPOSERS.length >= 25, `only ${REPAIR_COMPOSERS.length} composers registered`);
  for (const c of REPAIR_COMPOSERS) {
    assert.ok(c.samples?.length >= 1, `${c.key} — no sample; the guard has nothing to walk it with`);
    for (const s of c.samples) {
      const text = c.compose(s.args);
      assert.ok(typeof text === "string" && text.trim().length > 0, `${c.key} / ${s.name} composed nothing`);
      assert.ok(["edit", "tool", "none", "declared-by-the-composer"].includes(s.tail), `${c.key} / ${s.name} — tail "${s.tail}" is off-enum`);
    }
    // BRANCH COVERAGE, DERIVED FROM THE COMPOSER'S OWN SOURCE. A composer that can hand a seat either a
    // tool order or a file-edit order — `lint-repair` is exactly that — must exercise both, or the
    // unexercised branch is as unwalked as the twenty-seven were before this file existed.
    const body = String(c.compose);
    if (/editRepairTail\(/.test(body) && /\?[\s\S]{0,400}editRepairTail\(/.test(body)) {
      const tails = new Set(c.samples.map((s) => s.tail));
      assert.ok(tails.size >= 2,
        `${c.key} — its source branches on the tail it emits, but every sample declares "${[...tails][0]}". `
        + "Add a sample for the other branch.");
    }
  }
});

test("#1896: a sample cannot declare an artifact hand-written when the driver is its only writer", () => {
  // THE FIX FOR A SAMPLE-WALKING GUARD MUST NOT HAND THE SAMPLES A WAY TO LIE. Before `*:draft-carry`
  // took a `toolWritten` parameter, a sample naming `frame-diff.md` redded the agreement guard on
  // sight, because the composer could only emit the edit order. With the parameter, the same sample plus
  // `toolWritten: null` composes that same banned order and every sample-walking guard goes green — the
  // sample now DECLARES the artifact hand-written and is believed. That is the hazard declared away, and
  // it would have been introduced by the change that closed it.
  //
  // So the declaration is checked against the table rather than trusted: an artifact the driver writes
  // must be passed its row. This also keeps `*:lint-repair`'s edit-branch sample honest as conversions
  // continue — the day `narrative.md` gains a row, its sample stops being true and says so here.
  const named = (a) => [a?.out, a?.file].filter((v) => typeof v === "string" && v.length);
  const lying = [];
  let checked = 0;
  for (const c of REPAIR_COMPOSERS) {
    if (!/\btoolWritten\b/.test(String(c.compose))) continue;
    for (const s of c.samples ?? []) {
      for (const path of named(s.args)) {
        const row = toolWrittenArtifact(path);
        if (!row) continue;
        checked++;
        if (!s.args.toolWritten)
          lying.push(`${c.key} / ${s.name} — names ${path}, whose only writer is ${row.tool}, and declares toolWritten null`);
        else if (s.args.toolWritten.tool !== row.tool)
          lying.push(`${c.key} / ${s.name} — names ${path} (${row.tool}) but declares ${s.args.toolWritten.tool}`);
      }
    }
  }
  // THE FLOOR. Every sample naming an unconverted artifact is skipped by design, so a walk that stopped
  // finding converted ones would check nothing and report a pass — the absence that reads as a result.
  assert.ok(checked >= 1,
    "no sample names a tool-written artifact, so this check walked nothing — either the samples stopped "
    + "covering the converted branch, or the table lookup has gone quiet");
  assert.deepEqual(lying, [],
    "these samples declare an artifact hand-written that TOOL_WRITTEN_ARTIFACTS says the driver alone writes");
});

test("#1896: a composer that branches on `toolWritten` is PASSED it at every dispatch site", () => {
  // THE SAMPLES ARE NOT THE CALL SITE, AND THAT GAP IS WHAT WAS. `*:draft-carry` shipped six
  // conversions with an unconditional `editRepairTail`, and the agreement guard read 19/19 clean the
  // whole time — because it walks the composers' SAMPLES, and both of that composer's named an artifact
  // the driver does not write. Adding the branch fixes the text; nothing yet stops the gathering site
  // from dropping the argument again, and a dropped argument takes the edit branch SILENTLY, with every
  // sample-walking guard still green. Same shape as the write helper whose clearing half nobody wrote.
  //
  // So this arm reads the CALL, not the composer: every `repairFollowup("<key>", { … })` in pipeline.mjs
  // whose composer destructures `toolWritten` must name it in the object it passes.
  const withParam = REPAIR_COMPOSERS.filter((c) => /\btoolWritten\b/.test(String(c.compose)));
  // THE FLOOR. A selector that stopped matching would report "no composer branches on it" and read as a
  // pass — the absence this repo has counted often enough to write down. Two branch on it today.
  assert.ok(withParam.length >= 2,
    `only ${withParam.length} composer(s) branch on \`toolWritten\` — this check has stopped describing the tree`);
  const src = pipelineSrc();
  const missing = [];
  let sitesSeen = 0;
  for (const c of withParam) {
    const re = new RegExp(`repairFollowup\\(\\s*"${c.key.replace(/[*]/g, "\\*")}"\\s*,\\s*\\{([\\s\\S]{0,400}?)\\}`, "g");
    let m, found = 0;
    while ((m = re.exec(src))) {
      found++; sitesSeen++;
      if (!/\btoolWritten\b/.test(m[1])) missing.push(`${c.key} @ line ${src.slice(0, m.index).split("\n").length}`);
    }
    assert.ok(found >= 1,
      `${c.key} branches on \`toolWritten\` but no dispatch site for it was found in pipeline.mjs — `
      + "either the site moved, or this walk stopped finding sites and would report a pass either way");
  }
  assert.ok(sitesSeen >= 2, `only ${sitesSeen} dispatch site(s) walked — the walk has gone quiet`);
  assert.deepEqual(missing, [],
    "these dispatch sites compose a `toolWritten`-branching composer without passing it, so the seat is "
    + "handed a hand-write order for an artifact whose only writer is the driver");
});

test("#1183: a stage with exactly ONE composer says so, and the census reds when it gains a second", () => {
  // Overwatch's addition to this issue's scope: a guard proven at n=1 has proven nothing about ordering,
  // dedup, or interaction between two composers on one stage. Every single-member stage carries an
  // explicit note, so growth is a decision somebody read rather than an absorption.
  const byStage = {};
  for (const c of REPAIR_COMPOSERS) (byStage[c.stage] ??= []).push(c);
  const singles = Object.entries(byStage).filter(([, v]) => v.length === 1);
  assert.ok(singles.length > 0, "no single-member stage found — this check has stopped describing the tree");
  for (const [stage, [c]] of singles) {
    assert.ok(typeof c.singleMember === "string" && c.singleMember.length > 60,
      `${stage} has exactly one registered composer (${c.key}) and no \`singleMember\` note saying so. `
      + "An enum member or population of one is a population nothing has tested for ordering or interaction.");
  }
  // …and the converse: a note on a stage that has since GROWN is a stale claim, so it must go.
  for (const [stage, list] of Object.entries(byStage)) {
    if (list.length < 2) continue;
    const stale = list.filter((c) => c.singleMember);
    assert.deepEqual(stale.map((c) => c.key), [],
      `${stage} carries ${list.length} composers, so a \`singleMember\` note on it is false — remove it and `
      + "say in the PR what the second member changed about the guard's reach.");
  }
});

// ── PLANTED CONTROLS: the census must be able to FAIL ───────────────────────────────────────────────

test("KNOWN POSITIVE (planted): a bespoke composer in any of the four shapes is reported", () => {
  // Invented source, so the plants cannot drift with the tree — and all four shapes, because the four
  // are exactly what the issue's own grep did and did not see.
  const shapes = [
    ['      followup: lines(\n        `Fix it.`,\n      ),', "inline at the dispatch"],
    ['      const followup = lines(\n        `Fix it.`,\n      );', "a local, passed by shorthand"],
    ['      const freshMsg = lines(\n        `Fix it.`,\n      );', "a freshMessage local"],
    ['      const followup = cond\n        ? lines(`a`)\n        : lines(`b`);', "a ternary arm"],
  ];
  for (const [src, label] of shapes) {
    const found = discoverComposingSites(src).filter((s) => s.kind === "bespoke");
    assert.ok(found.length >= 1, `a bespoke composer written as ${label} was NOT reported`);
  }
  // …and the registered form is NOT reported as bespoke, so the control is not firing on shape alone.
  const clean = discoverComposingSites('      followup: repairFollowup("synthesis:corrective", { P }),');
  assert.deepEqual(clean.filter((s) => s.kind === "bespoke"), []);
  assert.deepEqual(clean.filter((s) => s.kind === "registered").map((s) => s.key), ["synthesis:corrective"]);
});

test("NEGATIVE CONTROL (planted): a comment is not a dispatch", () => {
  // E3 counted its own explanatory comments as the violations they described, twice. A composer named in
  // a comment is history; reporting it would make this census unreadable and then unread.
  assert.deepEqual(discoverComposingSites('  // it used to read `const followup = lines(…)` before the conversion'), []);
});
