// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 273 — no run codename reaches a tracked file.
//
// THE DETECTOR ALREADY EXISTED AND NOTHING CALLED IT. `shared/identifier-classes.mjs` has carried
// `codenameRegex` and `codenameHits` since this repository began, reading the two vocabularies out of
// `driver/phase0.mjs` rather than transcribing them. Its own header names the caller that refuses these
// over tracked blobs — and that caller was not brought across when this tree was split out. The
// definition arrived; the thing that runs it did not.
//
// So this file is the caller, not a second definition. That distinction is the module's own instruction:
// it records that three copies of the customer-name rules once drifted apart, and a fourth was a gate
// that has since been retired. A guard that re-derives the vocabulary here would be the fifth.
//
// WHAT IT COSTS TO NOT HAVE THIS. Between the split and 2026-09-07, a comment naming a delivered run
// reached three shipped source files and was published to the registry. Nothing on this tree was capable
// of noticing.
//
// WHY IT KEYS ON THE VOCABULARY AND NOT ON "R<n> <codename>". The compound is strictly narrower than the
// codename alone, so guarding the vocabulary already covers it. A rule keyed on the run-number prefix
// would fire on the ~837 places `R0`–`R12` name a test scenario, which is what those identifiers ARE
// here — and a guard that reds on hundreds of innocent lines is one people learn to route around.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";   // a sweep over an empty set is a clean report about nothing
import { codenameRegex, codenameHits, matterHits, norefHits } from "../../shared/identifier-classes.mjs";

const GUARD = "no-run-codenames";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// DECLARED, WITH A REASON EACH, because an exemption nobody can read is how a guard is hollowed out one
// entry at a time. Each of these NAMES codenames as its subject rather than carrying one by accident.
const LEGIT = new Map([
  ["driver/phase0.mjs", "defines the ADJ/NOUN vocabulary the pattern is built from"],
  ["driver/test/codename-freshness.test.mjs", "generates codenames from a fixed seed as its own fixtures"],
  ["driver/test/no-run-codenames-in-tracked-files.test.mjs", "this guard: its plant carries a real-shaped one"],
]);

const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };

test("273 no run codename drawn from the generator's vocabulary reaches a tracked file", (ctx) => {
  const corpus = trackedFiles(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(skipReason(GUARD));

  const { adj, noun, rx } = codenameRegex(ROOT);
  // THESE TWO SAY THE READ FOUND SOMETHING. A silently-empty vocabulary builds a pattern that matches
  // nothing, and the sweep below then passes over a tree full of codenames while reporting clean — which
  // is the same failure as having no guard, wearing a green tick.
  assert.ok(adj.length >= 10 && noun.length >= 10,
    `the vocabulary read out of driver/phase0.mjs looks truncated: ${adj.length} adjective(s), ${noun.length} noun(s)`);
  assert.ok(rx.source.includes("|"), "the codename pattern collapsed to a single alternative");

  // A SWEEP OVER AN EMPTY SET REPORTS CLEAN. `trackedFiles` returns null when it could not look — handled
  // above — but an empty ARRAY is a different failure with the same green tick, and this guard's whole job
  // is to not be that.
  const hits = [];
  for (const f of nonEmpty(corpus, "corpus")) {
    if (LEGIT.has(f)) continue;
    const t = read(f);
    if (!t) continue;                                  // binary or unreadable — nothing to match
    for (const m of codenameHits(t, rx)) hits.push(`${f}: ${m}`);
  }
  assert.deepEqual(hits, [],
    `${hits.length} run codename(s) in tracked files. A codename names a delivered run, and these files `
    + `ship — the association is what leaves with them, not the words.\n  ` + hits.slice(0, 25).join("\n  "));
});

test("273 the sweep fires on a planted codename — it is not reporting clean on a pattern that matches nothing", () => {
  // Runs the SAME matcher over a synthetic corpus rather than the tree, so what this proves is that the
  // matcher fires. A guard whose only evidence is a clean tree cannot tell working from blind.
  const { adj, noun, rx } = codenameRegex(ROOT);
  const planted = `a line naming ${adj[0]}-${noun[0]} in the clear\nand a second line that does not`;
  const found = codenameHits(planted, rx);
  assert.deepEqual(found, [`${adj[0]}-${noun[0]}`],
    `planted one real-shaped codename and the matcher found ${JSON.stringify(found)}`);
  assert.deepEqual(codenameHits("nothing to find here", rx), [],
    "the matcher reports a hit on text carrying no codename, so its zero above proves nothing");
});

test("273 every exemption still names something that exists, and says why", (ctx) => {
  // An exemption for a deleted file is an exemption nobody notices is doing nothing — and the next file
  // to take that path inherits a hole with a plausible reason attached to it.
  const corpus = trackedFiles(GUARD, { root: ROOT });
  // SKIPPED WITH THE REASON, not returned silently. A bare `return` here passes — an arm that bailed on an
  // unmeetable precondition and reported success, which is the shape this whole file is about.
  if (!corpus) return ctx.skip(skipReason(GUARD));
  for (const [f, why] of nonEmpty([...LEGIT], "exemptions")) {
    assert.ok(corpus.includes(f), `${f} is exempt from this guard and is not a tracked file`);
    assert.ok(why && why.length > 10, `${f} is exempt with no readable reason`);
  }
});

// ── THE OTHER TWO CLASSES THE SAME MODULE DEFINES, WHICH ALSO HAD NO CALLER ───────────────────────────
//
// `shared/identifier-classes.mjs` states THREE structural classes: matter numbers, run codenames and
// noref run ids. Wiring only the codename caller would have left two detectors in exactly the state that
// let a codename ship — present, correct, and reached by nothing.
//
// Both are clean on this tree today, so these arms cost nothing now. That is the point of adding them
// now rather than the day one is not: a guard written in response to a leak is a guard written late.

test("273 no real matter number reaches a tracked file", (ctx) => {
  const corpus = trackedFiles(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(skipReason(GUARD));
  const hits = [];
  for (const f of nonEmpty(corpus, "corpus")) {
    if (LEGIT.has(f)) continue;
    const t = read(f);
    if (!t) continue;
    for (const m of matterHits(t)) hits.push(`${f}: ${m}`);
  }
  assert.deepEqual(hits, [],
    `${hits.length} real-shaped matter number(s) in tracked files. The reserved test bands are allowed; `
    + `these are not.\n  ` + hits.slice(0, 25).join("\n  "));
});

test("273 no real noref run id reaches a tracked file", (ctx) => {
  const corpus = trackedFiles(GUARD, { root: ROOT });
  if (!corpus) return ctx.skip(skipReason(GUARD));
  const hits = [];
  for (const f of nonEmpty(corpus, "corpus")) {
    if (LEGIT.has(f)) continue;
    const t = read(f);
    if (!t) continue;
    for (const m of norefHits(t)) hits.push(`${f}: ${m}`);
  }
  assert.deepEqual(hits, [],
    `${hits.length} real-shaped noref run id(s) in tracked files. Only the zero-padded synthetic form is `
    + `allowed.\n  ` + hits.slice(0, 25).join("\n  "));
});

test("273 both of those sweeps fire on a plant — a clean tree is not evidence they work", () => {
  // These two pass on today's tree, so without a plant they are indistinguishable from two sweeps that
  // match nothing at all. That is the state the codename detector was in for weeks.
  assert.deepEqual(matterHits("a line naming tmp3456 in the clear"), ["tmp3456"],
    "the matter-number matcher did not fire on a real-shaped matter number");
  assert.deepEqual(matterHits("the reserved band tmp0001 is allowed"), [],
    "the matter-number matcher fired on a reserved test band, which would red every fixture");
  assert.deepEqual(norefHits("a line naming noref4d5e6f in the clear"), ["noref4d5e6f"],
    "the noref matcher did not fire on a real-shaped noref id");
  assert.deepEqual(norefHits("the synthetic form noref000abc is allowed"), [],
    "the noref matcher fired on the zero-padded synthetic form");
});
