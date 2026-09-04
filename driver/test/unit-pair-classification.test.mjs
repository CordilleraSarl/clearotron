// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE UNIT SUB-SHAPE, CLASSIFIED COMPLETELY OVER A STATED POPULATION.
//
// The class: a demand computed against one unit or snapshot, satisfaction enforced against another, with
// no guard asserting the two agree. The snapshot sub-shape has been ruled and ratcheted since
// `45084770` (see snapshot-pair-classification.test.mjs). The unit sub-shape had a discovered population
// — `scripts/travelling-predicates.mjs`, 98 travelling candidates — and no ruling at all. Seven comments
// on the issue said "stays open" for that reason.
//
// It stayed open because ninety-odd sites read as ninety-odd essays. They are not ninety-odd questions.
// They collapse on one further mechanical question — WHERE THE BOOLEAN COMES TO REST — and the sweep now
// answers it. Measured on the commit this landed on, `node scripts/travelling-predicates.mjs`:
//
//   contained  27  bound to a local, read inside the same function, and nowhere else.
//   value      51  leaves as a VALUE — returned, or the body of a named predicate a caller invokes.
//   structure  20  written where it OUTLIVES the expression that computed it. (21 when this was
//                  classified; the one cure that landed removed its site rather than fixing it in place.)
//
// THOSE COUNTS ARE A READING, NOT THE RULING. This population moved three times on 's own thread
// (241 lines, then 248, then 251 sites) and quoting a comment's number instead of a run's is the mistake
// that thread kept making. What ratchets below is the set of FILES, re-derived every run; the counts are
// here so a reader knows what the ruling was written against, and they are expected to drift.
//
// ── THE TWO CLASS RULINGS, AND WHY THEY ARE RULINGS AND NOT A SHORTCUT ───────────────────────────────
//
// CONTAINED — OUT OF CLASS BY MECHANISM. The class needs a demand SET in one place and satisfaction
// ENFORCED in another. When both are the same three lines of one function there is one end, and one end
// is not a pair. This is COMPUTED, not asserted: the sweep follows the bound name through its own frame
// and only calls a site contained when the name reaches no return, no call and no structure.
//
// VALUE — AGREE WHERE ONE COLLECTION IS SUPPLIED, AND THAT IS NOT THE WHOLE BUCKET. A predicate over a
// single supplied collection re-derives on every call and stores nothing for later data to contradict:
// `isQueueSidecar(name)`, `isFallbackEligible(fail)`, `termAppearsIn(term, hay)`. That is most of these
// 51 and it is a safe ruling for them.
//
// IT IS NOT A BLANKET RULING, AND THE MEMBER THAT PROVES IT IS THIS ISSUE'S OWN. `disposition-call.mjs`'s
// `evidenceSatisfiable(canonicalRow, formRow)` returns a value, is imported by `disposition-tool.mjs`,
// and JOINS TWO INDEPENDENTLY SUPPLIED STRUCTURES: the demand rides `formRow` (`evidence_owed`, copied
// forward from form-build) and the enforcement runs against `canonicalRow`'s candidates AS THEY ARE NOW.
// Candidates regenerate between the two. That is the class exactly — it is why `a7628d3f` exists — and
// it lands in `value`, not in `structure`.
//
// So the rule for this bucket is: A PREDICATE OVER ONE COLLECTION CANNOT HOLD THE DEFECT; A PREDICATE
// JOINING TWO INDEPENDENTLY SUPPLIED STRUCTURES CAN. The join is not mechanically separable and this file
// does not pretend it is: `evidenceSatisfiable` derives `pool` from one argument and `rid` from the other
// into LOCALS before the `.some()` runs, so a parameter-adjacency test finds three sites and misses the
// one that matters. What is stated here is where to look, and the one member found there is named with
// its guard, which an arm below pins.
//
// STRUCTURE — THE ADJUDICATION SET, RULED ONE BY ONE. A boolean at rest is the only kind fresh data can
// arrive and contradict. 's `quote_required` was exactly this: a flag on a form, met later by
// candidates that had been rebuilt textless.
//
// ── THE RULING, ALL TWENTY-ONE AS CLASSIFIED — TWENTY IN THE SWEEP TODAY, SEE THE CURE BELOW ─────────
//
//  AGREE (19) — the flag and the data it summarises are written into ONE structure in ONE expression, or
//  consumed inside the pass that computed them, so a reader cannot get one without the other:
//   · band-shape.mjs:494        `live` is minted in the same object literal as `records`, off the same
//                               `rs`. A reader holding the position holds both.
//   · commonlaw-carry.mjs:386   `completed` folds ALL THREE stage labels from one `outcomes` read and is
//                               handed to `classifyCandidate` for every candidate in the same call.
//   · findings-model.mjs:475    `boundLost` and `names` both come off the one `index` argument.
//   · form-neighbourhood.mjs:286,287,288  one `familyDispatched` feeds BOTH the returned
//                               `phoneticFamilyDispatched` and the `complete` verdict beside it — the
//                               good shape: two ends, one computation, no second derivation to drift.
//   · gateway.mjs:1293,1501     the two `wrote` producers — see the disagreement below; both now guard
//                               the empty case, and each reads its own per-turn stat snapshot, which the
//                               site states.
//   · grounds-grammar.mjs:89    `limits` is spent inside `classifyGroundsNote`'s own precedence ladder.
//   · pipeline.mjs:2021         `repairable` rides a runLog event. A journal line has no enforcement
//                               counterpart — nothing reads it back and acts.
//   · pipeline.mjs `seniorGap` is read by the coverage floor in the same block, off the
//                               `ctx.seniorRights` it was computed from. (CITED BY SYMBOL AND NO LINE,
//                               deliberately: the line number here was :11252, which was already
//                               pointing at the crowd-context adapter and not at `seniorGap` at all —
//                               the citation gate only noticed when an edit above shifted it one line
//                               onto a lone brace. CONTRIBUTING.md's rule is the fix: cite the symbol,
//                               which is both correct and the thing that makes a citation checkable.)
//   · publish/render.mjs:372    `hasOnField` sits in the same object as `findings: g` — the group and
//                               its summary travel together. (:1952 in the same file is the UNGUARDED
//                               one below; the two sites are unrelated.)
//   · publish/xlsx.mjs:319,587  `anyHit` and `commonLawUnlogged` are derived from the exact rows the
//                               sheet then writes, in the same builder.
//   · reasoning-tripwires.mjs:465  `material` is written onto the row it describes.
//   · reference-score.mjs:430,861,1538  all three only select WORDING — an excluded-reason string, a
//                               receipt `detail`, a `missingArtifact` note. A flag that chooses a
//                               sentence has no satisfaction side to disagree with.
//   · claimsLive declared in registry-fidelity.mjs, with claimsDead beside it, is built on `scoped`
//                               and read twice against the same `rec`, inside one loop iteration.
//
//  DISAGREE (1), fixed here:
//   · gateway.mjs:1293   TWO PRODUCERS OF ONE FIELD, TWO UNITS FOR THE EMPTY CASE. The attempt row
//                        answers `files.length ? files.some(…) : null`; the repair row answered
//                        `files.some(…)`, and `[].some()` is `false`. A stage declaring no expected
//                        artifact leaves `files` empty, so the same situation was "wrote nothing" on one
//                        row and "nothing to write" on the other. The reader is not hypothetical:
//                        run-economics.mjs:490 bills `wrote === false` to
//                        `emittedOnDispatchesThatWroteNothing`, so every repair turn on such a stage
//                        charged its whole output to a waste counter. The `output:` field on the SAME
//                        row already guarded the same emptiness.
//
//  UNGUARDED (1), CURED — `706646eb`, and the site has left this population:
//   · publish/render.mjs:1952   A SECOND COPY OF A SHARED PREDICATE. findings-model exports
//                        `inDispositionMode` and its comment called it "the mode switch both sort sites
//                        use". render.mjs imported it, never called it, and answered the same question
//                        inline to set `DISPOSITION_MODE` — which every prominence helper in that file
//                        reads. The two agreed only because the bodies were identical. pipeline.mjs
//                        sorted with the imported one; the surface that PRINTS the report used its own.
//
//                        It shipped as its own PR because render.mjs is under a content freeze
//                        (render-frozen.test.mjs) whose protocol makes any edit a declared break with a
//                        lineage note and two hashes advanced — a freeze exists to make edits visible,
//                        and bundling one into a classification would have put a contested break in
//                        front of an uncontested ratchet. The one-definition guard lives beside that
//                        freeze, where the rest of render.mjs's single-definition rules already are.
//
//                        THE SITE IS GONE FROM THE SWEEP, NOT MERELY FIXED. Calling the predicate
//                        instead of re-typing it removes the `.some()` from render.mjs:1952 altogether,
//                        so the adjudication set is 20 today and this ruling is the record of the
//                        twenty-first. `publish/render.mjs` stays in RULED on :372, which is why nothing
//                        red when the cure landed — a file leaving one ruling and keeping another is not
//                        a state the two-directional arm can see, and this paragraph is what a reader
//                        gets instead.
//
// ── WHAT THIS DOES NOT COVER, so a green run is not misread ──────────────────────────────────────────
//
// · THE POPULATION IS WHAT THE SWEEP CAN SEE. It walks `driver/**/*.mjs`, tests excluded, and hunts
//   `.some(`/`.every(`. A member whose demand is computed some other way is invisible to it, and members
//   outside that walk are real: the `github.event.pull_request.base.sha` staleness registered on
//   from PR  lives in `.github/workflows/ci.yml`. 20 is the adjudication set of what the walker
//   sees, never the size of the class.
// · CONTAINED AND VALUE ARE RULED AS CLASSES, NOT READ ONE BY ONE. The rulings above say why each class
//   cannot hold the defect, and the `value` one is already narrower than it started because a member
//   refuted the first version of it. If either rule is wrong now, it is wrong for seventy-odd sites at
//   once — which is the honest way to be wrong, and the reason both are stated where they can be argued
//   with rather than left implicit in a sampling decision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sweep } from "../../scripts/travelling-predicates.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { runEconomics } from "../run-economics.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(join(DRIVER, f), "utf8");

/** The adjudication set, re-derived. Never a list — the population moved twice on 's own thread. */
const structureSites = () => nonEmpty(sweep(), "travelling-predicates sweep()")
  .filter((r) => r.holds === "structure");

// Ruled as FILES, not line numbers: a line number is stale the moment anything above it moves,
// and what has to stay true is that no site joins the adjudication set unruled.
//
// A COUNT PER FILE, BECAUSE A FILE-LEVEL SET CANNOT SEE A RULED FILE GAINING A SITE. The first version of
// this was a bare Set, and the hole showed up the moment the render cure landed: `publish/render.mjs` was
// ruled on two sites, lost one, and nothing moved — which is fine in that direction, but the same
// blindness runs the other way. A ruled file that grows a NEW boolean at rest is exactly the unruled join
// this file exists to catch, and a Set says "already ruled" and passes it.
//
// THE NUMBER IS A CEILING, NOT AN EQUALITY. Growth reds, because growth means there is a site to read and
// rule. A file that SHRINKS does not red: a cure that deletes the pair, or a refactor that merges two
// sites, is not a finding, and a census that fails on an honest refactor gets deleted (the same
// calibration `shared/suite-census.mjs` states for its own counts). The classified figure lives in the
// header; this is what the tree may not exceed without a re-read.
const RULED = new Map([
  ["band-shape.mjs", 1], ["commonlaw-carry.mjs", 1], ["findings-model.mjs", 1],
  ["form-neighbourhood.mjs", 3], ["gateway.mjs", 2], ["grounds-grammar.mjs", 1],
  ["pipeline.mjs", 2], ["publish/render.mjs", 1], ["publish/xlsx.mjs", 2],
  ["reasoning-tripwires.mjs", 1], ["reference-score.mjs", 3], ["registry-fidelity.mjs", 2],
]);

const shortName = (f) => f.replace(/^driver\//, "");

test("#1100 every site in the unit sub-shape's adjudication set has been ruled on", () => {
  const found = structureSites();
  assert.ok(found.length >= 16,
    `the sweep found ${found.length} structure sites — it is measuring less than it did when this was `
    + "classified, so either the hold analysis narrowed or the corpus did, and the ruling below now "
    + "covers a population nobody re-derived");
  const perFile = new Map();
  for (const r of found) perFile.set(shortName(r.file), (perFile.get(shortName(r.file)) ?? 0) + 1);

  const unruled = [...perFile.keys()].filter((f) => !RULED.has(f)).sort();
  assert.deepEqual(unruled, [],
    `these files put a predicate's boolean at REST and nobody ruled on it: ${unruled.join(", ")}. This is `
    + "not a passing test with an exception — read each site and rule it agree / disagree / unguarded in "
    + "this file's header, the way the twenty above are ruled.");

  // The hole a file-level set leaves: a file already ruled, now carrying MORE than was read.
  const grew = [...perFile].filter(([f, n]) => RULED.has(f) && n > RULED.get(f))
    .map(([f, n]) => `${f} (${RULED.get(f)} ruled, ${n} now)`).sort();
  assert.deepEqual(grew, [],
    `${grew.join(", ")} — a RULED file grew a boolean at rest that nobody has read. Being ruled once does `
    + "not cover a site added later: read the new one, rule it in the header, and raise the count here.");

  const vanished = [...RULED.keys()].filter((f) => !perFile.has(f)).sort();
  assert.deepEqual(vanished, [],
    `the classification rules on ${vanished.join(", ")}, which no longer holds a boolean at rest. Re-read `
    + "it: either the pair went (delete the ruling) or the site changed shape and this census is now "
    + "blind to a member it used to see.");
});

test("#1100 THE POSITIVE CONTROL — the collapse is computed, and all three holds are populated", () => {
  // Without this the ruling above could be passing because the hold analysis answers "contained" to
  // everything, which would empty the adjudication set and read as a complete classification.
  const rows = nonEmpty(sweep(), "travelling-predicates sweep()").filter((r) => r.holds);
  const tally = rows.reduce((a, r) => { a[r.holds] = (a[r.holds] ?? 0) + 1; return a; }, {});
  for (const hold of ["contained", "value", "structure"])
    assert.ok(tally[hold] > 0,
      `no site was classified ${hold} — the collapse has stopped discriminating, so the two class rulings `
      + "in this header cover nothing and the adjudication set is not what it says it is");
  assert.equal(rows.length, (tally.contained ?? 0) + (tally.value ?? 0) + (tally.structure ?? 0),
    "a travelling site landed outside the three holds — an unnamed bucket is a hole in the population");
  // And the three are ruled ONLY over travelling sites: a decided one was spent where it stood.
  assert.equal(nonEmpty(sweep(), "sweep()").filter((r) => r.bucket === "decided" && r.holds).length, 0,
    "a decided site was given a hold — it has no boolean at rest to rule on and would inflate the set");
});

// ── THE DISAGREEMENT: TWO PRODUCERS OF `wrote`, TWO UNITS FOR THE EMPTY CASE ─────────────────────────

test("#1100 the reader's two units are genuinely different — false is billed as waste, null is not", () => {
  // The call-site arm. This is what makes the producer mismatch a defect rather than a tidiness point:
  // run-economics reads `wrote === false` as "this dispatch emitted tokens and moved nothing".
  const dir = mkdtempSync(join(tmpdir(), "unit-pair-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const row = (wrote) => JSON.stringify({
    ts: "2026-08-22T10:00:00.000Z", attempt: 1, key: "k", agent: "test", model: "sonnet",
    modelUsed: "anthropic/claude-sonnet-5", engine: "anthropic-agent", authMode: "subscription",
    code: 0, wall: 10, status: "ok", fail: null, usage: { input: 1, output: 1000 }, wrote,
  });
  writeFileSync(driverDir(dir, "declared-no-output.jsonl"), `${row(null)}\n`);
  assert.equal(runEconomics(dir).emittedVsLanded.emittedOnDispatchesThatWroteNothing, 0,
    "a dispatch with nothing to write was billed to the waste counter — then `null` and `false` are the "
    + "same unit to this reader and the producer mismatch below costs nothing");
  writeFileSync(driverDir(dir, "declared-no-output.jsonl"), `${row(false)}\n`);
  assert.equal(runEconomics(dir).emittedVsLanded.emittedOnDispatchesThatWroteNothing, 1000,
    "`wrote:false` stopped counting as waste — the two units this test is about have collapsed into one");
});

test("#1100 BOTH producers of `wrote` answer the same unit when nothing is expected", () => {
  // The source arm. Driving a real repair turn needs a live stage; what has to hold is that neither
  // producer can answer `false` on an empty expectation, and the shape of that is one guard each.
  const gw = src("gateway.mjs");
  const producers = [...gw.matchAll(/wrote:?\s*=?\s*([^\n]*statOf\(f\)[^\n]*)/g)].map(([, expr]) => expr);
  assert.equal(producers.length, 2,
    `expected two \`wrote\` producers in gateway.mjs, found ${producers.length} — a third would need its `
    + "own ruling, and a missing one means this arm is watching something that moved");
  for (const expr of producers)
    assert.match(expr, /files\.length\s*\?/,
      `a \`wrote\` producer answers without guarding the empty expectation: ${expr.trim()}. \`[].some()\` `
      + "is false, so this row says a turn wrote nothing where the other says there was nothing to write, "
      + "and run-economics bills the difference.");
});

// ── THE `value` BUCKET'S ONE NAMED MEMBER KEEPS ITS GUARD ───────────────────────────────────────────

test("#1100 the join-shaped `value` member named in the header still carries its guard", () => {
  // The header rules the whole `value` bucket as a class and names the one that escapes the rule. That naming is worth
  // nothing if the guard it points at can be deleted silently — the ruling would then describe a member
  // as covered while it is not, which is this issue's own defect committed by its own bookkeeping.
  const guard = readFileSync(join(DRIVER, "test", "an-evidence-demand-that-cannot-be-met.test.mjs"), "utf8");
  // THE IMPORT AND THE CALLS, not the token. A bare /evidenceSatisfiable/ still matches after the symbol
  // has been renamed out from under the guard, which is a green arm over a test that exercises nothing.
  assert.match(guard, /import \{[^}]*\bevidenceSatisfiable\b[^}]*\} from "\.\.\/disposition-call\.mjs"/,
    "the guard no longer imports `evidenceSatisfiable` from disposition-call — this file's `value` ruling "
    + "still says the one member that joins two independently supplied structures is covered");
  assert.ok((guard.match(/\bevidenceSatisfiable\(/g) ?? []).length >= 3,
    "the guard imports `evidenceSatisfiable` and barely calls it. The ruling above rests on arms that "
    + "actually drive both structures — restore them or re-rule the site.");
  assert.match(src("disposition-call.mjs"), /export function evidenceSatisfiable\(canonicalRow, formRow\)/,
    "`evidenceSatisfiable` no longer takes the two structures the header rules on — re-read the site: "
    + "either the join went, or it moved somewhere this classification is not looking");
});
