// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / — THE CORRECTIVE CYCLE IS SCOPED BY THE REVIEWER'S OWN DECLARATION.
//
// THE MEASUREMENT THIS IS BUILT ON, from a delivered run (2026-08-11, 137.6 min elapsed):
//
//   synthesis            trigger=fresh            wallSec=1350.8
//   narrative-refutation trigger=fresh            wallSec= 579.4
//   synthesis            trigger=corrective       wallSec= 683.4
//   narrative-refutation trigger=verdict-recheck  wallSec= 270.4      = 48.1 min, 35% of the run
//
// and `_driver/corrections-applied.json` from that run: 9 flags →
// `{findings-changed: 1, findings-unchanged: 2, not-entity-scoped: 6}`. **683 seconds re-emitting the
// whole narrative and the whole findings.json so that ONE finding moved**, and six of nine flags
// resolved to no finding at all — while the reviewer's own prose opened them "Finding 9 — DELPHIC…",
// "Findings 4, 7, 8." The objections were already per-finding; the driver could not read them, because
// `targetsOf` matches mark and owner NAMES out of a sentence.
//
// So the fix is a declared channel, not a better prose join — the // shape: the model cites
// an identifier the driver validates.
//
// AND THE RECHECK IS NARROWED, NEVER DELETED. Offline over the nine preserved runs, the recheck changed
// the verdict on SIX of them, including every one of the five BLOCKING entries (all lifted to
// CONDITIONAL). Deleting it would ship BLOCKING runs. What it does not need to do is re-derive which
// parts of two long documents moved — the driver holds the pre-corrective snapshot and has compared them.
//
// BREAK MATRIX (each break applied, run, reverted; every one red):
//   B1  parseCorrections drops the `[on:]` token                      → arms 1, 2
//   B2  an undeclared flag is treated as scoped (null read as [])     → arm 3   THE FAIL-SAFE
//   B3  correctionScope returns scoped on a partial set               → arm 3
//   B4  the scope block is emitted unconditionally                    → arm 4
//   B5  the scope block is never emitted                              → arm 5
//   B6  scopeDrift ignores movement outside the declared set          → arm 6
//   B7  the recheck keeps the wide re-read when the scope is declared → arm 7
//   B8  a declared ordinal loses to the prose name match              → arm 8
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCorrections } from "../verify.mjs";
import { correctionScope, scopeDrift, buildCorrectionsApplied, ordinalsOf } from "../corrections-feedforward.mjs";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";

const review = (...flags) => ["CONDITIONAL — the flags below", "", ...flags].join("\n");
const flag = (kind, on, text) => `- [kind: ${kind}]${on == null ? "" : ` [on: ${on}]`} ${text}`;

const doc = (...ords) => ({ findings: ords.map((o) => ({ ordinal: o, mark: `MARK${o}`, band: "Low",
  disposition: "adversarial", owner: { name: `Owner ${o}` }, meters: { goods_proximity: { token: "low" } } })) });
const moveOne = (d, ord, band) => ({ findings: d.findings.map((f) => f.ordinal === ord ? { ...f, band } : f) });

// ── 1/2. the channel ─────────────────────────────────────────────────────────────────────────────────

test("arm 1 — a flag declares the findings it is about, and the token leaves the text", () => {
  const rows = parseCorrections(review(
    flag("fact", "9", "Finding 9 — the registered scope stated is not the one granted."),
    flag("rating", "6, 12", "two findings share one over-read."),
  ));
  assert.deepEqual(rows.map((r) => r.ordinals), [[9], [6, 12]]);
  assert.ok(!rows.some((r) => /\[on:/.test(r.text)), "the channel is not repeated back as instruction text");
  assert.match(rows[0].text, /the registered scope stated is not the one granted/, "…and the reviewer's sentence survives");
});

test("arm 2 — `[on: -]` is a DECLARATION of no finding, and it is not the same fact as saying nothing", () => {
  const rows = parseCorrections(review(
    flag("narrative", "-", "the ordering buries the material read."),
    flag("fact", null, "a flag written before this token was taught."),
  ));
  assert.deepEqual(rows[0].ordinals, [], "an explicit 'about the document' is an empty list");
  assert.equal(rows[1].ordinals, null, "an ABSENT token is null — the fail-safe, and a different fact");
});

// ── 3. the fail-safe ─────────────────────────────────────────────────────────────────────────────────

test("arm 3 — ONE undeclared flag turns the whole review unscoped, and that direction is deliberate", () => {
  const complete = parseCorrections(review(flag("fact", "9", "a"), flag("rating", "-", "b")));
  assert.deepEqual(correctionScope(complete), { scoped: true, ordinals: [9] });

  const partial = parseCorrections(review(flag("fact", "9", "a"), flag("rating", null, "b")));
  assert.deepEqual(correctionScope(partial), { scoped: false, ordinals: [] },
    "THE DANGEROUS SHAPE: a partial scope reads as a narrow instruction while one flag's subject is unknown, "
    + "so the pass would be told not to touch the finding that flag is about. Under-correcting a client "
    + "deliverable is worse than paying for a wide pass.");
  assert.deepEqual(correctionScope([]), { scoped: false, ordinals: [] }, "no flags ⇒ nothing to scope");
  assert.deepEqual(correctionScope(null), { scoped: false, ordinals: [] });
});

// ── 4/5. the dispatch ────────────────────────────────────────────────────────────────────────────────

async function correctiveExtraFor(reviewMd, { narrative = "/r/narrative.md", findings = "/r/findings.json" } = {}) {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { correctionsExtra } = await import("../pipeline.mjs");
  const dir = mkdtempSync(join(tmpdir(), "scope-extra-"));
  const p = join(dir, "senior-eye-review.md");
  writeFileSync(p, reviewMd);
  return correctionsExtra({ seniorEyeReview: p, narrative, findings, placement: join(dir, "nope.md") });
}

test("arm 4 — a DECLARED scope names the findings and forbids the rest", async () => {
  const extra = await correctiveExtraFor(review(
    flag("fact", "9", "Finding 9 — wrong scope."), flag("rating", "6", "Finding 6 — over-read.")));
  assert.match(extra, /SCOPE — THE REVIEWER DECLARED/);
  assert.match(extra, /#6, #9/, "the complete list, in order");
  assert.match(extra, /MUST COME BACK BYTE-IDENTICAL/);
  assert.match(extra, /knock-on the reviewer did not see/,
    "a reasoned edit outside the scope is allowed and must be declared — only a SILENT one is forbidden");
});

test("arm 5 — an UNDECLARED scope emits no block at all: the dispatch is what it was", async () => {
  const extra = await correctiveExtraFor(review(
    flag("fact", "9", "Finding 9 — wrong scope."), flag("rating", null, "an untyped-scope flag.")));
  assert.ok(!/SCOPE — THE REVIEWER DECLARED/.test(extra),
    "the narrowing is bought by the reviewer's declaration, never assumed on its behalf");
  assert.match(extra, /You are RESUMING your own synthesis session/, "…and the rest of the dispatch is unchanged");
});

// ── 6. what the driver checks ────────────────────────────────────────────────────────────────────────

test("arm 6 — movement OUTSIDE the declared scope is recorded, per finding", () => {
  const rows = parseCorrections(review(flag("fact", "9", "Finding 9.")));
  const pre = doc(6, 9, 12);
  const post = moveOne(moveOne(pre, 9, "Moderate"), 12, "High");   // 9 was named; 12 was not
  const d = scopeDrift(rows, pre, post);
  assert.equal(d.scoped, true);
  assert.deepEqual(d.named, [9]);
  assert.deepEqual(d.moved, [12], "a finding no flag named moved, and the reviewer is told which");
  assert.deepEqual(d.unbound, [], "every declared ordinal exists on the run");
  // …and a pass that held to the scope reports nothing
  assert.deepEqual(scopeDrift(rows, pre, moveOne(pre, 9, "Moderate")).moved, []);
  // an ordinal the run does not have is NAMED rather than silently dropped
  assert.deepEqual(scopeDrift(parseCorrections(review(flag("fact", "77", "x"))), pre, pre).unbound, [77]);
  // an unscoped review reports no drift, because everything was in scope
  assert.deepEqual(scopeDrift(parseCorrections(review(flag("fact", null, "x"))), pre, post).moved, []);
  assert.deepEqual([...ordinalsOf(pre)].sort((a, b) => a - b), [6, 9, 12]);
});

// ── 7. the recheck ───────────────────────────────────────────────────────────────────────────────────

test("arm 7 — the recheck's re-read is narrowed by the scope, and says what the driver already checked", () => {
  // RE-POINTED: the followup is a registered composer now, so both branches are COMPOSED rather
  // than sliced out of pipeline.mjs between two string anchors.
  const e = REPAIR_COMPOSERS.find((c) => c.key === "narrative-refutation:verdict-recheck");
  assert.ok(e, "the recheck composer is registered");
  const narrow = e.compose(e.samples[1].args);
  const wide = e.compose(e.samples[0].args);
  assert.match(narrow, /YOU DECLARED WHICH FINDINGS YOUR FLAGS WERE ABOUT/);
  assert.match(narrow, /THE DRIVER COMPARED EVERY OTHER FINDING OBJECT/);
  assert.match(narrow, /moved anyway/, "a pass that drifted is handed the list rather than trusted");
  // the saving is the re-read it does NOT ask for — present only when nothing moved outside the scope
  const nothingMoved = e.compose({ ...e.samples[1].args, correctionsScope: { scoped: true, named: [1], moved: [] } });
  assert.match(nothingMoved, /you do not need to re-read them/);
  assert.match(wide, /Re-read BOTH updated files/, "the undeclared branch is intact — no scope, no narrowing");
});

test("arm 8 — a DECLARED ordinal beats the prose name match that missed six of nine", () => {
  const pre = doc(6, 9);
  // The prose names MARK6 while the reviewer declares #9. The declaration wins: it is the reviewer's own
  // answer to the same question, and the name match is what put `targets: []` on six delivered flags.
  const rows = parseCorrections(review(flag("fact", "9", "the MARK6 comparison misreads finding 9's scope")));
  const applied = buildCorrectionsApplied(rows, pre, moveOne(pre, 9, "Moderate"));
  assert.deepEqual(applied[0].targets, ["MARK9"]);
  assert.equal(applied[0].outcome, "findings-changed");
  // …and with no declaration the prose join still runs, unchanged
  const legacy = buildCorrectionsApplied(parseCorrections(review(flag("fact", null, "MARK6 is wrong"))), pre, pre);
  assert.deepEqual(legacy[0].targets, ["MARK6"]);
  assert.equal(legacy[0].outcome, "findings-unchanged");
});

function readSrc() {
  const { readFileSync } = require("node:fs");
  return readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
}
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
