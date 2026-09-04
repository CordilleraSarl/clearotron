// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-repair-verdict-reaches-the-log.test.mjs —.
//
// built the five-way repair verdict, tested it 9/9, and it derived the right answer over every real
// ledger row on the box. IT REACHED NO READER. The emission is conditional on the caller naming a ceiling:
//
//   ...(max === undefined ? {} : { verdict: repairVerdict(o[key], { max }).verdict }),
//
// and the reasoning beside it is right — this layer does not know the budget, and guessing one would
// manufacture a `cannot-repair`. The gap was that NO CALL SITE SUPPLIED THE BUDGET IT ALREADY KNEW.
// `driver/pipeline.mjs` called `.record(...)` at seven sites and passed `max` at zero of them.
//
// Measured from the reader's end before this landed: across 131 preserved runs and 11,206 `run.jsonl`
// rows, zero occurrences of `untried`, `in-budget`, `cannot-repair` or `exhausted-unmeasured` as a JSON
// value, anywhere on the box. A correct answer the run declined to write down.
//
// ── WHY THE ARMS BELOW ARE MOSTLY ABOUT THE CALL SITES ───────────────────────────────────────────────
//
// 's own file already proves the ledger emits the verdict when a ceiling is named, and every arm in
// it passed throughout the period in which the field reached nothing. A component test cannot see an
// unwired component. So the load-bearing arms here scan the CONSUMER.
//
// ── THE TRAP, RECORDED BY E2E BEFORE ANYONE VERIFIES THIS ────────────────────────────────────────────
//
// `"repaired"` ALREADY appears on the box, 30 files, under two unrelated keys — `run.jsonl`'s `outcome`
// and `frame-diff.jsonl`'s `repairOutcome`. A grep for it after this change hits those and reads as
// success. The verdict shares one of its five values with an existing field, so the emission has to be
// verified on one of the other four; `in-budget` is what a healthy run produces and it appeared zero
// times. That is the arm that tells a working emission from a broken one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRepairLedger, REPAIR_VERDICTS } from "../repairs.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_CORPUS = skipReason("the-repair-verdict-reaches-the-log (#1495)");
const dir = () => mkdtempSync(join(tmpdir(), "repair-verdict-1495-"));

/** Every `.record(` call in the pipeline, with the argument text that follows it. */
function recordSites() {
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");
  const out = [];
  for (const m of src.matchAll(/\.record\(\s*("([^"]+)"|[A-Za-z_$][\w$]*)([\s\S]{0,400}?)\);/g))
    out.push({ id: m[2] ?? m[1], args: m[3], line: src.slice(0, m.index).split("\n").length });
  return out;
}

// ── CRITERION 1: EVERY SITE NAMES THE CEILING IT ENFORCES ────────────────────────────────────────────

test("#1495 every repair record() site in the pipeline names a ceiling", () => {
  // This is the whole defect. Seven sites, zero ceilings, and every unit test green.
  const sites = recordSites();
  assert.ok(sites.length >= 7,
    `found ${sites.length} record() sites — the scanner has stopped matching them, so an empty offender `
    + "list below would mean nothing");
  const silent = sites.filter((s) => !/\bmax\b/.test(s.args));
  assert.deepEqual(silent.map((s) => `${s.id}@${s.line}`), [],
    "these repair sites record without naming their ceiling, so their rows carry no verdict and the "
    + "five-way answer reaches no reader");
});

test("#1495 no site restates its ceiling as a literal — the two ends read ONE name", () => {
  // `canAttempt` enforces the budget and `record` reports against it. A literal at the record site is a
  // second statement of the same rule, and 's whole class is two ends of one contract measuring
  // different things with nothing asserting they agree. Passing the same identifier both ends makes the
  // drift impossible rather than merely unlikely — a wrong ceiling does not fail, it MISREPORTS: a stale
  // `max: 1` beside a real budget of 3 turns an in-budget repair into `cannot-repair`, which is the
  // accusatory verdict exists to keep honest.
  const literal = recordSites().filter((s) => /\bmax:\s*\d/.test(s.args));
  assert.deepEqual(literal.map((s) => `${s.id}@${s.line}`), [],
    "these sites hard-code a ceiling at the record call instead of reading the one canAttempt enforces");
});

test("#1495 each repair's two ends read the SAME ceiling expression", () => {
  // Pairs them by repair id rather than trusting that a nearby `max` is the right one. The sites with a
  // literal id are checkable this way; the one whose id is a variable (`dispatchPlanQids`) takes the
  // ceiling from its own parameter, so both ends already read one name by construction.
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");
  const ceilings = new Map();
  for (const m of src.matchAll(/\.canAttempt\(\s*"([^"]+)"[\s\S]{0,200}?\bmax:\s*([A-Za-z_$][\w$]*|\d+)/g))
    ceilings.set(m[1], m[2]);
  assert.ok(ceilings.size >= 6, `only ${ceilings.size} canAttempt ceilings found — the pairing scan is broken`);
  const disagree = [];
  for (const s of recordSites()) {
    if (!ceilings.has(s.id)) continue;                       // variable-id site, handled above
    const m = /\bmax:\s*([A-Za-z_$][\w$]*|\d+)/.exec(s.args);
    if (!m || m[1] !== ceilings.get(s.id)) disagree.push(`${s.id}: enforces ${ceilings.get(s.id)}, reports ${m?.[1] ?? "nothing"}`);
  }
  assert.deepEqual(disagree, [], "a repair enforces one ceiling and reports against another");
});

// ── CRITERION 3: THE THREE DIRECTIONS, ON THE ROW THAT REACHES run.jsonl ─────────────────────────────

/** Drive the real ledger and hand back the emitted `repair-attempted` rows. */
function emitted(fn) {
  const events = [];
  fn(createRepairLedger(dir(), { log: (o) => events.push(o) }));
  return events.filter((e) => e.event === "repair-attempted");
}

test("#1495 a repair that closes something logs `repaired`", () => {
  const [row] = emitted((l) => l.record("r", "t", "ok", { effect: { asked: 2, closed: 1 }, max: 1 }));
  assert.equal(row.verdict, "repaired");
  assert.ok(REPAIR_VERDICTS.includes(row.verdict));
});

test("#1495 budget spent, every attempt measured, nothing closed — logs `cannot-repair`", () => {
  const rows = emitted((l) => {
    l.record("r", "t", "ok", { effect: { asked: 2, closed: 0 }, max: 2 });
    l.record("r", "t", "ok", { effect: { asked: 2, closed: 0 }, max: 2 });
  });
  assert.equal(rows[0].verdict, "in-budget", "the first attempt is still inside the budget");
  assert.equal(rows[1].verdict, "cannot-repair");
});

test("#1495 an UNMEASURED attempt logs `exhausted-unmeasured` and NEVER `cannot-repair`", () => {
  // THE LOAD-BEARING ARM. An unmeasured attempt is not a failed one, and laundering silence into the
  // accusatory verdict is the disease exists to catch — now on the surface a reader actually sees.
  const [row] = emitted((l) => l.record("r", "t", "ok", { max: 1 }));   // no effect = nothing measured
  assert.equal(row.verdict, "exhausted-unmeasured");
  assert.notEqual(row.verdict, "cannot-repair",
    "silence was reported as a repair that has no move — the accusation the ledger cannot support");
  assert.equal(row.effect, "unmeasured", "and the row must say so in the field a reader joins on");
});

test("#1495 `in-budget` is emitted — the ONE value that can tell a live emission from a dead one", () => {
  // e2e's trap, as an arm. `repaired` already appears on the box under `outcome` and `repairOutcome`, so
  // a grep for it after this change reads as success whether or not the verdict ever emitted. Four of the
  // five values are unambiguous; this is the one a healthy run produces.
  const [row] = emitted((l) => l.record("r", "t", "ok", { effect: { asked: 3, closed: 0 }, max: 3 }));
  assert.equal(row.verdict, "in-budget");
  assert.equal(row.outcome, "ok",
    "`outcome` moved or changed meaning — every archived run.jsonl joins on it and criterion 4 keeps it");
});

test("#1495 the verdict is ADDED, never substituted — old readers keep their fields", () => {
  // Criterion 4. A reader joining archived rows to new ones must not have to know which side it is on.
  const [row] = emitted((l) => l.record("r", "t", "failed: x", { effect: { asked: 1, closed: 0 }, max: 1 }));
  for (const k of ["event", "repair", "target", "dispatch", "attempts", "effect", "measuredAttempts", "closedTotal", "outcome"])
    assert.ok(k in row, `${k} left the row — an archived reader breaks on the rows written after this fix`);
  assert.equal(row.dispatch, "failed: x");
  assert.equal(row.outcome, "failed: x");
});

test("#1495 a caller that names NO ceiling still emits no verdict — the guess stays forbidden", () => {
  // The direction this must not fix. Wiring the call sites is the cure; making the ledger assume a
  // budget would manufacture `cannot-repair` for every caller that legitimately has no ceiling.
  const [row] = emitted((l) => l.record("r", "t", "ok", { effect: { asked: 1, closed: 0 } }));
  assert.equal("verdict" in row, false);
});

// ── THE PIPELINE IS THE FILE THIS IS ABOUT, SO IT IS NAMED RATHER THAN ASSUMED ───────────────────────

test("#1495 pipeline.mjs is in the tracked corpus, or the scans above read a file nobody ships", (ctx) => {
  const tracked = trackedFiles("the-repair-verdict-reaches-the-log", { root: ROOT, pathspec: ["*.mjs"] });
  // A DECLARED skip, not a bare return: off a checkout this cannot be measured, and node:test
  // counts a bare `return;` as a pass — reporting the corpus reconciled having reconciled nothing.
  if (!tracked) return ctx.skip(NO_CORPUS);
  assert.ok(tracked.includes("driver/pipeline.mjs"),
    "driver/pipeline.mjs is not tracked, so the call-site arms above are reading a file this repo does not ship");
});
