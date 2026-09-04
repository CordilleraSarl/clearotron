// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// refused-slice-is-not-a-counted-zero.test.mjs —.
//
// A slice the provider REFUSED and a slice the plan deliberately counted without fetching arrive in
// the same shape: `{state:"incomplete", total_hits:0, fetched:0}`. Only the executor's `error` /
// `deferred` stamps tell them apart, and `named-band.mjs`'s crowd projection dropped both — so every
// consumer downstream of it saw one population where there are three.
//
// MEASURED ON A REAL RUN before the fix (an R1-shaped register round, 2026-08; codename not carried,
// per the repo's de-identification rule): four capability-gap blocks left the band file carrying
// `error:true, deferred:true` and reached `record-carry.json` with both fields gone, under a sentence
// reading "the run has a hit COUNT for this slice" — about slices that were never run at all. All 23
// untraceable rows in that artifact shared ONE reason string.
//
// The blocks below are that real shape, retyped with synthetic marks and queries. The fixture is not
// the point of any arm: every assertion is about whether two DIFFERENT causes stay distinguishable,
// and the sanctioned count-only crowd rides along in every band as the control that fails if the fix
// merely relabelled everything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNamedBand } from "../named-band.mjs";
import { untraceableSlices, traceRecordCarry } from "../record-carry.mjs";
import { buildBandShape } from "../band-shape.mjs";

// A capability gap: the provider cannot express the slice. execute-plan.mjs stamps `deferred` NEXT TO
// `error`, never instead of it — that pairing is asserted directly in arm 2.
const DEFERRED = {
  qid: "primary-sweep:exact:zephyr-cyr+form", state: "incomplete",
  total_hits: 0, fetched: 0, sample: [], error: true, deferred: true,
  query: 'name:"зефир" match_mode:exact',
  reason: 'capability-gap: term "зефир" is not in Latin script, and the active register provider indexes non-Latin filings by their TRANSLITERATION',
};
// A provider error: the slice was answerable and the call failed.
const ERRORED = {
  qid: "supp:transliteration-numeric:exact:q:a1b2c3d4", state: "incomplete",
  total_hits: 0, fetched: 0, sample: [], error: true,
  query: 'name:"ZEPHYR 9" match_mode:exact',
  reason: "provider error during enumeration (page 0): register_search HTTP 504",
};
// THE CONTROL. No stamps: a crowd the plan asked to be counted and not fetched. Its row must come
// through this change byte-identical — if it does not, the fix relabelled the population instead of
// splitting it.
// — ITS `reason` HERE IS ILLUSTRATIVE, NOT THE PRODUCER'S. It is a truncated stand-in for the
// upstream sentence, and a reader once took it for the real one: the producer's version carried a
// further clause claiming the owner "is answered record-by-record", which this copy silently dropped, so
// the claim went unexamined while an arm appeared to cover it. What the producer actually writes is
// asserted in owner-descriptor-claims-only-what-it-observes.test.mjs, against the exported builder the
// producer calls. Nothing in THIS file depends on the wording — `detail` is opaque here by design.
const SANCTIONED = {
  qid: "incumbent-class:owner:verrit-instruments-ltd+watch", state: "incomplete",
  total_hits: 169, fetched: 0, sample: [],
  query: 'owner:"Verrit Instruments Ltd" nice_classes:9',
  reason: "count-only owner-portfolio descriptor (plan-dictated) — CROWD CONTEXT, never coverage",
};
const SANCTIONED_REASON = "count-only crowd descriptor: the run has a hit COUNT for this slice and no record bodies, so no per-record carry can be computed for the unfetched remainder";

const band = (blocks) => parseNamedBand(JSON.stringify(blocks));
const rowFor = (blocks, qid) => untraceableSlices({ crowds: band(blocks).crowds }).find((r) => r.qid === qid);

test("#1424 the stamps survive the crowd projection at all", () => {
  // The whole fix rests on this: before it, `named-band.mjs` listed the fields it carried and these
  // two were not among them, so no consumer could have read them however carefully it tried.
  const { crowds } = band([DEFERRED, ERRORED, SANCTIONED]);
  assert.equal(crowds.length, 3);
  const byQid = Object.fromEntries(crowds.map((c) => [c.qid, c]));
  assert.equal(byQid[DEFERRED.qid].deferred, true, "the capability gap lost its deferred stamp in transit");
  assert.equal(byQid[DEFERRED.qid].error, true);
  assert.equal(byQid[ERRORED.qid].error, true, "the provider error lost its error stamp in transit");
  // Conditional, like every other optional key in that projection: the control gains no new fields.
  assert.equal("error" in byQid[SANCTIONED.qid], false);
  assert.equal("deferred" in byQid[SANCTIONED.qid], false);
});

test("#1424 a refused slice does not claim the run has a count", () => {
  const deferred = rowFor([DEFERRED, ERRORED, SANCTIONED], DEFERRED.qid);
  const errored = rowFor([DEFERRED, ERRORED, SANCTIONED], ERRORED.qid);

  // The precise false claim, quoted from the string that was on all 23 rows of the real artifact.
  for (const r of [deferred, errored]) {
    assert.equal(r.reason.includes("has a hit COUNT"), false,
      `a slice that was never answered still claims a count: ${r.reason}`);
    assert.match(r.reason, /NOT A COUNT/);
    assert.match(r.reason, /placeholder/, "the 0 must be named as a placeholder, not left to read as a measurement");
  }
  // The two causes are named apart — a capability gap is permanent and a 504 is not, and the reader
  // acts differently on each.
  assert.match(deferred.reason, /capability gap/i);
  assert.match(errored.reason, /provider errored/i);
  assert.notEqual(deferred.reason, errored.reason);

  // `deferred` is checked FIRST because execute-plan.mjs writes it alongside `error`. If that order
  // ever inverts, a capability gap silently reports as a transient the repair ladder would retry.
  assert.equal(DEFERRED.error, true, "premise: the executor stamps error beside deferred");
  assert.match(deferred.reason, /capability gap/i);
});

test("#1424 the sanctioned count-only crowd is untouched — the control", () => {
  const row = rowFor([DEFERRED, ERRORED, SANCTIONED], SANCTIONED.qid);
  assert.equal(row.reason, SANCTIONED_REASON, "the plan-dictated descriptor's row changed; the split relabelled instead of discriminating");
  // Its arithmetic is a real measurement and must stay one.
  assert.equal(row.total_hits, 169);
  assert.equal(row.untraced, 169);
});

test("#1424 the upstream sentence rides verbatim in detail, and is never parsed", () => {
  // The producer's own words stay available and unbucketed. Deriving the classification from the
  // stamps rather than from this text is what keeps a provider's rewording from re-breaking it: the
  // reason below says neither "capability" nor "error" in the words the classifier would need.
  const errored = rowFor([ERRORED, SANCTIONED], ERRORED.qid);
  assert.match(errored.detail, /HTTP 504/);
  const reworded = { ...ERRORED, reason: "upstream gateway did not respond in time" };
  const row = rowFor([reworded, SANCTIONED], ERRORED.qid);
  assert.match(row.reason, /provider errored/i, "the classification followed the prose instead of the stamp");
});

test("#1424 a refused slice becomes its own blind spot, and never the unenumerated one", () => {
  const shape = buildBandShape(band([DEFERRED, ERRORED, SANCTIONED]), { targets: ["ZEPHYR"] }).shape;
  const kinds = Object.fromEntries(shape.blind_spots.map((b) => [b.kind, b]));

  assert.ok(kinds["refused-slice"], "no refused-slice blind spot");
  assert.equal(kinds["refused-slice"].count, 2);
  assert.deepEqual([...kinds["refused-slice"].zones.map((z) => z.kind)].sort(), ["capability-gap", "provider-error"]);

  // THE ARITHMETIC THAT HID THEM. A refused block is total_hits:0, fetched:0, so the unenumerated
  // detector's `total_hits > fetched` is `0 > 0` — false. It was never going to see one.
  assert.equal(0 > 0, false);
  const unenum = kinds["unenumerated-crowd"];
  if (unenum) for (const z of unenum.zones) {
    assert.notEqual(z.query, DEFERRED.query, "a refused slice was reported as an unenumerated crowd");
    assert.notEqual(z.query, ERRORED.query);
  }
});

test("#1424 a run whose provider refused everything still reports a blind spot", () => {
  // The seeded fault, and the one that made this silent: with only refused slices in the band, the
  // unenumerated detector matches nothing and pushes nothing, so before this change the shape came
  // back with NO crowd blind spot at all — a total register failure rendering as a clean shape.
  const shape = buildBandShape(band([DEFERRED, ERRORED]), { targets: ["ZEPHYR"] }).shape;
  const kinds = shape.blind_spots.map((b) => b.kind);
  assert.equal(kinds.includes("unenumerated-crowd"), false, "premise: the old detector cannot fire here");
  assert.ok(kinds.includes("refused-slice"), "a band of nothing but refusals reported no blind spot");
});

test("#1424 the shape's prose does not print a hit count for a slice that has none", () => {
  const { md } = buildBandShape(band([DEFERRED, ERRORED, SANCTIONED]), { targets: ["ZEPHYR"] });
  const refusedLines = md.split("\n").filter((l) => l.includes(DEFERRED.query) || l.includes(ERRORED.query));
  assert.equal(refusedLines.length > 0, true, "the refused slices are absent from the mirror entirely");
  for (const l of refusedLines) {
    assert.equal(/\bhit\(s\)/.test(l), false, `a slice that was never answered is rendered with a hit count: ${l}`);
    assert.match(l, /never answered/i, "the line must say the slice was never answered, in either renderer");
  }
  // fmtN(undefined) is "0", which is exactly how this would have failed: silently, as "0 hit(s)".
  assert.equal(Number(undefined ?? 0).toLocaleString("en-US"), "0");
});

test("#1424 the unenumerated blind spot states what was actually read", () => {
  // The coverage-statement half of the issue: how many terms exceeded the read limit, and how deep
  // the register was read. Reported as OBSERVED per slice — the enumerate ceiling is a per-provider
  // ceilingDefault in four capabilities files, so a constant quoted here could be wrong for the run.
  const CEILINGED = { qid: "primary-sweep:contains:zephyr", state: "incomplete",
    total_hits: 4821, fetched: 600, sample: [], query: 'name:"ZEPHYR" match_mode:contains',
    reason: "crowd descriptor — above the enumerate ceiling" };
  const shape = buildBandShape(band([CEILINGED, DEFERRED, SANCTIONED]), { targets: ["ZEPHYR"] }).shape;
  const unenum = shape.blind_spots.find((b) => b.kind === "unenumerated-crowd");
  assert.ok(unenum, "no unenumerated-crowd blind spot for a slice over the ceiling");
  assert.equal(unenum.count, 2, "the ceilinged slice and the counted owner crowd both exceeded what was read");
  assert.deepEqual(unenum.read_depth, [0, 600]);
});

test("#1424 PREMISE: refusals carry no untraced hits, so a hit-sum gate cannot see them", () => {
  // A PREMISE PIN, not a test of the fix: it passes before and after, because it asserts the
  // arithmetic that made the old gate wrong rather than the gate itself. The gate lives in
  // pipeline.mjs's `note()`, which is stderr-only and reaches no artifact, so it has no direct arm —
  // stated here rather than left for a reader to assume this arm covers it.
  //
  // The state the operator note used to miss. Its gate was `if (t.untraced_hits)`, and a refused
  // slice contributes ZERO of those — so a register round whose provider refused every slice had
  // untraced_hits 0 and printed nothing at all, which reads exactly like a run with nothing to say.
  // The gate is now the slice count, and this arm pins the arithmetic that made the old one wrong.
  const t = traceRecordCarry({ crowds: band([DEFERRED, ERRORED]).crowds }).totals;
  assert.equal(t.untraced_hits, 0, "premise: refusals carry no untraced hits, so a hit-sum gate cannot fire");
  assert.equal(t.untraceable_slices, 2, "the slices themselves must still be countable, or nothing can report them");
});

test("#1424 every row carries a machine class, and it agrees with its own sentence", () => {
  const rows = untraceableSlices({ crowds: band([DEFERRED, ERRORED, SANCTIONED]).crowds });
  assert.equal(rows.length, 3);
  // AD-4: on EVERY row, by value. A reader counting refusals never has to interpret an absence.
  // The vocabulary is written out here rather than imported, so this pins WHAT the classes are
  // instead of agreeing with whatever the module currently exports.
  const CLASSES = ["counted-not-fetched", "capability-gap", "provider-error"];
  for (const r of rows) assert.ok(CLASSES.includes(r.slice_class), `unclassified row: ${r.qid} (${r.slice_class})`);
  const by = Object.fromEntries(rows.map((r) => [r.qid, r.slice_class]));
  assert.equal(by[DEFERRED.qid], "capability-gap");
  assert.equal(by[ERRORED.qid], "provider-error");
  assert.equal(by[SANCTIONED.qid], "counted-not-fetched");
  // The two fields are one fact in two forms, so they cannot drift apart on a row.
  for (const r of rows) {
    const refused = r.slice_class !== "counted-not-fetched";
    assert.equal(/^NOT A COUNT/.test(r.reason), refused,
      `slice_class and reason disagree on ${r.qid}: ${r.slice_class} vs "${r.reason.slice(0, 40)}…"`);
  }
});
