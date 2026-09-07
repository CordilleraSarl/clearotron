// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A Knockout trace survives the client projection (tracker issue 275, the client path).
//
// WHAT WAS WRONG, AND WHY IT READ AS WORKING. `accountTrace` is an allowlist built field by field around
// the CLEARANCE trace: resolvedAs, emittingStage, judgment, finding, searchTerms, record, auditTrail. A
// Knockout trace shares only runId and target with it, so every field carrying the answer — mark, band,
// basis, factors, counterFactors, findings, registerReads — was dropped on the way out. The ops path and
// get_run were unaffected, which is why this survived: only a CLIENT session saw it.
//
// THE FIELD THAT SURVIVED WAS THE PROMISE ABOUT THE ONES THAT DID NOT. `note` is in no pick list and was
// forwarded by its own branch, so a client asking about a mark got, in full: the runId, the target, a
// null findingsSource, and "The band, the one-sentence ground for it, and the observations it rests on."
// Measured before the fix — verdict 303→200, mark 427→142, stage 210→95 bytes.
//
// ONE ARM PER SHAPE, because the shapes have nothing in common but two keys: a single arm over one of
// them would have passed on the day this broke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountTrace } from "../lib/audit-view.mjs";

const verdictTrace = () => ({
  runId: "r1", target: "verdict", kind: "verdict", verdict: "High",
  marks: [{ mark: "IRONWHISK", band: "High", basis: "an identical mark in the same class" }],
  note: "A Knockout verdict is the batch's worst band across its marks.",
});
const markTrace = () => ({
  runId: "r1", target: "IRONWHISK", kind: "mark", mark: "IRONWHISK", band: "High",
  basis: "an identical mark in the same class", factors: ["identical in sound"],
  counterFactors: ["the goods differ"],
  findings: [{ ordinal: 1, name: "IRONWHISK", band: "High", evidence: ["EUIPO 0181"] }],
  registerReads: [{ recordId: "EUIPO 0181", band: "High", read: "live, registered 2019" }],
  note: "The band, the one-sentence ground for it, and the observations it rests on.",
});
const stageTrace = () => ({
  runId: "r1", target: "assess", kind: "stage", stage: "assess",
  events: [{ stage: "assess", ok: true, trigger: "fresh" }],
  produced: [{ name: "findings", file: "knockout-findings.json" }],
  note: "What the assess stage produced.",
});

test("275 client path: a VERDICT trace keeps the verdict and every mark's band", () => {
  const out = accountTrace(verdictTrace());
  assert.equal(out.verdict, "High", "the batch verdict did not survive the client door");
  assert.equal(out.marks?.length, 1, "the per-mark list was dropped — the note promises it");
  assert.equal(out.marks[0].band, "High", "a mark's band was dropped");
  assert.equal(out.marks[0].basis, "an identical mark in the same class", "and its one-sentence ground");
});

test("275 client path: a MARK trace keeps the band, the basis and everything it rests on", () => {
  const out = accountTrace(markTrace());
  assert.equal(out.band, "High", "THE band — the single field the client asked for");
  assert.equal(out.basis, "an identical mark in the same class");
  assert.deepEqual(out.factors, ["identical in sound"]);
  assert.deepEqual(out.counterFactors, ["the goods differ"], "the counter-factors are half the honesty");
  assert.equal(out.findings?.[0]?.name, "IRONWHISK");
  assert.deepEqual(out.findings?.[0]?.evidence, ["EUIPO 0181"]);
  assert.equal(out.registerReads?.[0]?.recordId, "EUIPO 0181", "the register filings the rater read");
});

test("275 client path: a STAGE trace keeps the stage, its events and what it produced", () => {
  const out = accountTrace(stageTrace());
  assert.equal(out.stage, "assess");
  assert.equal(out.events?.length, 1, "the events were dropped");
  assert.equal(out.produced?.[0]?.name, "findings", "what the stage wrote, by presence");
});

test("275 client path: an ERROR trace is unchanged — the one branch that already worked", () => {
  const out = accountTrace({ runId: "r1", target: "nope", error: "Could not resolve target" });
  assert.deepEqual(out, { runId: "r1", target: "nope", error: "Could not resolve target" },
    "the resolver's own guidance carries no run content and must pass through whole");
});

// ── THE DEFECT, NAMED AS A PROPERTY RATHER THAN AS THREE FIELD CHECKS ────────────────────────────────

test("275 client path: the note is never the only thing left — a promise the payload does not keep", () => {
  // This is the shape of the defect, not an example of it. A note survived describing fields that were
  // gone, which is worse than an empty answer: the client is told the band is here and it is not.
  for (const [name, make] of [["verdict", verdictTrace], ["mark", markTrace], ["stage", stageTrace]]) {
    const out = accountTrace(make());
    // A KEY IS NOT CONTENT. The first version of this arm counted keys, and the broken projection
    // emitted `findingsSource: null` — a clearance field, null on a knockout trace — which made the arm
    // pass on the exact defect it was written for. Empty values are filtered, so the arm asks whether
    // anything was ANSWERED rather than whether a key was present.
    const isEmpty = (v) => v == null || (Array.isArray(v) && v.length === 0)
      || (typeof v === "object" && Object.keys(v).length === 0);
    const carried = Object.entries(out)
      .filter(([k, v]) => !["runId", "target", "kind", "note"].includes(k) && !isEmpty(v))
      .map(([k]) => k);
    assert.ok(carried.length > 0,
      `the ${name} trace came back as runId + target + note and nothing else — the note is describing `
      + "content that was dropped on the way out");
  }
});

// ── WHAT A CLIENT MUST STILL NOT SEE ─────────────────────────────────────────────────────────────────

test("275 client path: raw driver events are PROJECTED, never forwarded whole", () => {
  const t = stageTrace();
  t.events = [{ stage: "assess", ok: true, modelUsed: "opus", usage: { in: 900, out: 120 }, wall: 41 }];
  const ev = accountTrace(t).events[0];
  assert.equal(ev.stage, "assess", "the client-safe fields still come through");
  for (const leaked of ["modelUsed", "usage", "wall"])
    assert.ok(!(leaked in ev),
      `"${leaked}" reached a client session. run.jsonl rows carry model names, token counts and timings, `
      + "and this projection is the only thing between them and a client");
});

test("275 client path: model-authored prose goes through the same scrub the clearance side uses", () => {
  const t = markTrace();
  t.basis = "per the skeptic pass this is fine";
  t.findings = [{ ordinal: 1, name: "per the skeptic pass this is fine", band: "High", evidence: [] }];
  const out = accountTrace(t);
  assert.equal(out.basis, "", "a basis naming the internal review reached the client unscrubbed");
  assert.equal(out.findings[0].name, "", "and the same on a finding's name");
});

test("275 client path: a CLEARANCE trace is never routed into the knockout projection", () => {
  // The discriminator requires BOTH no `resolvedAs` and a knockout `kind`. A clearance trace that later
  // grew a top-level `kind` would otherwise start losing its own fields, silently and client-side.
  const clearance = {
    runId: "r1", target: "verdict", kind: "verdict",
    resolvedAs: { kind: "verdict", stage: "narrative-refutation" },
    judgment: { verdict: "CLEAR" }, findingsSource: "findings.json",
  };
  const out = accountTrace(clearance);
  assert.equal(out.judgment?.verdict, "CLEAR",
    "a clearance trace carrying a top-level kind was projected as a knockout and lost its judgment");
  assert.equal(out.resolvedAs?.stage, "narrative-refutation");
});
