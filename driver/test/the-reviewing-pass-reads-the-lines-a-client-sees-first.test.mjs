// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// RULE 1 OF THE TWO-REGISTER RULE REACHES A LIVE RUN, THROUGH THE PASS THAT ALREADY REWRITES.
//
// The rule was written into both products' doctrine and into a helper, and nothing called the helper on
// a run. This holds the call: the driver measures the record's default-visible lines and hands what it
// found to the reviewing stage, which quotes the sentence and writes the rewrite in its own voice.
//
// WHY THE ARMS DRIVE `composeDispatchExtra` AND NOT THE BUILDER. The composer is the door both the
// production dispatch and the `--experiment` sandbox go through, and it is what binds a block to a
// stage. An arm on the builder alone would pass with the block bound to no stage at all, or to the
// wrong one — which is the same as not shipping it.
//
// THE EXCLUSION IS DRIVEN IN BOTH DIRECTIONS, and that is the arm that matters. Half these words are
// ordinary English and several are plausible marks. Asserting only that a run clearing PREVAIL sees no
// flag is satisfied by a check that has stopped firing altogether, so the same planted sentence is run
// again under a different mark and must flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeDispatchExtra } from "../pipeline.mjs";

// A REAL DELIVERED RECORD, not an invented one: the shape this reads is the shape a run writes, and a
// fixture of my own would only prove the fixture matches the reader.
const DEMO = new URL("../../demo/global-preliminary-search/run/findings.json", import.meta.url);

const withRecord = (mutate) => {
  const doc = JSON.parse(readFileSync(DEMO, "utf8"));
  mutate(doc);
  const f = join(mkdtempSync(join(tmpdir(), "plain-register-")), "findings.json");
  writeFileSync(f, JSON.stringify(doc));
  return f;
};

// Mutating IN PLACE keeps every ordinal an action references resolvable. Trimming the array instead
// makes the record unparseable, and then every arm below passes over a block that was never built —
// the control and the treatment vacuous together.
const plant = (net) => withRecord((doc) => {
  doc.findings = doc.findings.map((f, i) => (i === 0 ? { ...f, net } : { ...f, net: "A short clean line." }));
});

const compose = (findings, job = { marks: [] }) =>
  composeDispatchExtra("narrative-refutation", { paths: { findings, runDir: "/nonexistent" }, job });

test("a word of the profession's on a default-visible line reaches the reviewer as a rewrite", () => {
  const out = compose(plant("The proprietor holds a subsisting right."), { marks: [{ name: "NORTHWIND" }] });
  assert.deepEqual(out.failed, [], "the builder must not throw on a well-formed record");
  assert.ok(out.ids.some((x) => x.id === "refute-plain-register"), "the block was not built");
  assert.match(out.text, /"proprietor"/, "the term is named");
  assert.match(out.text, /owner/, "and so is the word the reader needs — a flag naming a word teaches nothing");
  assert.match(out.text, /conflict 1's one sentence/, "the line to rewrite is named, not a score");
  assert.match(out.text, /EVIDENCE, NOT A VERDICT/, "the seat is handed evidence, never a ruling");
});

test("the mark being cleared is never flagged — and the check has not simply stopped firing", () => {
  // The defect this guards is one level in from the render-time substitution that turned "AXIS Bank
  // filed in class 36" into "group Bank filed in class 36" on a report clearing AXIS.
  const findings = plant("PREVAIL is registered for the same goods and its owner would prevail.");
  assert.doesNotMatch(compose(findings, { marks: [{ name: "PREVAIL" }] }).text, /"prevail"/,
    "the run's own mark was flagged as the lawyer's vocabulary");
  assert.match(compose(findings, { marks: [{ name: "NORTHWIND" }] }).text, /"prevail"/,
    "the same sentence under a different mark must still flag — otherwise the arm above proves nothing");
});

test("an over-long visible sentence is flagged with its length, so the writer knows what to split", () => {
  const long = `The owner of the earlier registration trades in the same field and has enforced it before, `
    + `which means the risk here is real and the client should be told about it plainly today.`;
  const out = compose(plant(long), { marks: [{ name: "NORTHWIND" }] });
  assert.match(out.text, /\d+ words in one sentence/);
  assert.match(out.text, /Do not shorten it by dropping the reason/, "the cheap wrong fix is refused in the same breath");
});

test("a record nobody can read lands on the receipt as a failure, not as a clean run", () => {
  // The direction that fails silently. Returning "" here would put the id in neither `ids` nor
  // `failed`, and a run whose record could not be opened would read exactly like a run with nothing
  // to say.
  const f = join(mkdtempSync(join(tmpdir(), "plain-register-bad-")), "findings.json");
  writeFileSync(f, "{ not json");
  const out = compose(f);
  assert.ok(out.failed.some((x) => x.id === "refute-plain-register"), "an unreadable record must be recorded as failed");
  assert.ok(!out.ids.some((x) => x.id === "refute-plain-register"), "and must not be counted as built");
});

test("an absent record builds nothing and fails nothing — absent is not corrupt", () => {
  const out = compose(join(tmpdir(), "no-such-findings-file.json"));
  assert.ok(!out.ids.some((x) => x.id === "refute-plain-register"));
  assert.deepEqual(out.failed, [], "a run that has not written its record yet is not a defect");
});

// EVERY visible surface, not just the finding's one sentence. Written this way because the first
// version of the arm below cleaned `net` alone and failed: the record's coverage notes, actions and
// mark assessment carried the profession's words and were correctly flagged. The arm was wrong and the
// code was right — and the two arms it became are worth more than the one it was.
const clean = (net) => withRecord((doc) => {
  doc.findings = doc.findings.map((f) => ({ ...f, net }));
  doc.coverage = (doc.coverage ?? []).map((c) => ({ ...c, note: "We searched this and found nothing live." }));
  doc.actions = (doc.actions ?? []).map((a) => ({ ...a, text: "Tell us what you sell under the name." }));
  delete doc.mark_assessment;
});

test("a clean set of visible lines produces no block at all", () => {
  const out = compose(clean("Same name, same goods, and they were first."), { marks: [{ name: "NORTHWIND" }] });
  assert.deepEqual(out.failed, [], "the record must still parse");
  assert.ok(!out.ids.some((x) => x.id === "refute-plain-register"),
    "a clean run must not spend a prompt block saying nothing is wrong");
});

test("the read is not confined to the finding's one sentence — the other visible surfaces count too", () => {
  // With every `net` clean, anything still flagged came from a coverage note, an action or the mark
  // assessment. Without this, the three of them could be dropped from the reader and no arm would know.
  const out = compose(plant("Same name, same goods, and they were first."), { marks: [{ name: "NORTHWIND" }] });
  assert.ok(out.ids.some((x) => x.id === "refute-plain-register"),
    "every finding's sentence was clean, so a block here must have come from another visible surface");
  assert.doesNotMatch(out.text, /conflict \d+'s one sentence/,
    "and it must not be attributed to the sentences that were clean");
});

test("the block is bound to the reviewing stage and to no other", () => {
  // A block bound to the wrong stage is the same as not shipping it, and nothing else would say so.
  const findings = plant("The proprietor holds a subsisting right.");
  for (const stage of ["synthesis", "register-digest", "skeptic", "report-overview"]) {
    const out = composeDispatchExtra(stage, { paths: { findings, runDir: "/nonexistent" }, job: { marks: [] } });
    assert.ok(!out.ids.some((x) => x.id === "refute-plain-register"), `it reached ${stage}`);
  }
});

// ── THE BLOCK MAY NOT CLAIM AN EXCLUSION IT DID NOT MAKE ────────────────────────────────────────────
//
// The closing sentence used to be an absolute: every mark and owner was removed before reading, so no
// flag is a hit inside the name being cleared. `about` is built from three optional job keys and from
// owners found in the record, and nothing guarantees any of them is present — so on a run that named
// none, the block asserted the guarantee in exactly the state where it fails, and the seat is told to
// trust it on the one report where a hit inside the cleared mark costs most.
//
// BOTH STATES ARE ASSERTED, because the repair has two ways to be wrong: the claim surviving into the
// empty state, and the warning surviving into the state where the exclusion really did happen.
// ── THE MARK IS WHAT THE REASSURANCE IS ABOUT, AND OWNERS DO NOT STAND IN FOR IT ────────────────────
//
// Two exclusions feed this block and they come from different places: marks from the JOB, owners from
// the RECORD. Keying the reassurance on the union was the first repair, and it moved the defect: a
// record carrying owners with a job naming no mark made the set non-empty, so the block told the seat
// no flag was the mark under clearance — over a flag that was exactly that.
//
// THAT MIXED STATE IS THE ONE TO DRIVE, and the arm that missed it stripped the owners, so it tested
// the all-empty case correctly and never entered this one. A fixture built to reach one failing state
// is not evidence about a neighbouring one.
test("the reassurance is about the MARK, and owners in the record do not buy it", () => {
  // The likely production shape: the record carries its owners, the job names no mark.
  const withOwners = plant("PREVAIL has a strong reputation in class 9.");
  const out = compose(withOwners, { marks: [] });
  assert.ok(out.ids.some((x) => x.id === "refute-plain-register"), "the line must flag for this arm to mean anything");
  assert.match(out.text, /NAMED NO MARK TO EXCLUDE/,
    "owners in the record bought a reassurance about the mark, which they do not protect");
  assert.doesNotMatch(out.text, /none of these is a hit inside the name being cleared/,
    "the reassurance survived into the state where no mark was excluded");
  // AND the owner exclusion is still reported, because it did happen and it is a different fact.
  assert.match(out.text, /owner name\(s\) from the record were also removed/,
    "the owners were excluded and the block no longer says so");
});

test("the block claims an exclusion only when it made one, and says so plainly when it did not", () => {
  const findings = plant("PREVAIL has a strong reputation in class 9.");

  const withMark = compose(findings, { marks: [{ name: "NORTHWIND" }] });
  assert.match(withMark.text, /were removed before reading/,
    "a run that named a mark must say the exclusion happened");
  assert.doesNotMatch(withMark.text, /NAMED NO MARK OR OWNER/,
    "and must not carry the warning for the empty state");

  // THE EMPTY STATE NEEDS BOTH HALVES, which the first version of this arm missed: `about.owners` is
  // built from the RECORD, so a job naming no marks still excludes every owner the findings carry —
  // thirteen of them on this one — and the claim was true. The arm passed for the wrong reason until
  // the owners were stripped too. An empty exclusion means the job named nothing AND the record
  // carries no owner.
  const noNames = withRecord((doc) => {
    doc.findings = doc.findings.map((f, i) => ({
      ...f,
      owner: undefined, owner_name: undefined,
      net: i === 0 ? "PREVAIL has a strong reputation in class 9." : "A short clean line.",
    }));
  });

  for (const job of [{ marks: [] }, {}, undefined]) {
    const out = compose(noNames, job);
    if (!out.ids.some((x) => x.id === "refute-plain-register")) continue;   // nothing flagged, nothing to claim
    assert.match(out.text, /NAMED NO MARK OR OWNER TO EXCLUDE/,
      `a run with no mark to exclude claimed an exclusion it did not make (job ${JSON.stringify(job)})`);
    assert.doesNotMatch(out.text, /none of these is a hit inside a name being cleared/,
      "the absolute claim survived into the state where it is false");
  }
});
