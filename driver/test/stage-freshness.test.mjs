// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for P2 stage freshness (stage-freshness.mjs): a changed upstream artifact invalidates its
// consumers, a pure crash-resume stays cheap, and legacy runs never grow a failure.
// Pure/offline: a temp run dir, real files, no gateway and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import {
  fingerprint, diffFingerprint, shaOf,
  writeStamp, readStamp, stageStaleness, restamp, restampStage, clearStamp, staleOnPath, reconcileStamps,
} from "../stage-freshness.mjs";

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "freshness-"));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
}
const write = (p, s) => { writeFileSync(p, s); return p; };

// ── the pure core ──────────────────────────────────────────────────────────
test("fingerprint: dedupes, sorts by path, records absent inputs as sha null", () => {
  const d = runDir();
  const a = write(join(d, "a.md"), "alpha");
  const fp = fingerprint([a, a, join(d, "missing.md")]);
  assert.equal(fp.length, 2, "deduped");
  assert.deepEqual(fp.map((e) => e.name), ["a.md", "missing.md"]);
  assert.equal(fp[1].sha, null, "absent input records null, not a throw");
  rmSync(d, { recursive: true, force: true });
});

test("diffFingerprint: an EMPTY/absent record is never stale (legacy runs behave exactly as today)", () => {
  assert.equal(diffFingerprint(null, []).stale, false);
  assert.equal(diffFingerprint([], []).stale, false);
});

test("diffFingerprint: absent→present is a change (new material is not 'no change')", () => {
  const rec = [{ name: "skeptic-flags.md", path: "/x/skeptic-flags.md", sha: null }];
  const now = [{ name: "skeptic-flags.md", path: "/x/skeptic-flags.md", sha: "abc123abc123" }];
  assert.equal(diffFingerprint(rec, now).stale, true);
});

test("diffFingerprint: an input no longer declared is not this stage's staleness", () => {
  const rec = [{ name: "gone.md", path: "/x/gone.md", sha: "aaa" }];
  assert.deepEqual(diffFingerprint(rec, []), { stale: false, changed: [] });
});

// ── the copper-vault shape ─────────────────────────────────────────────────
test("(copper-vault regression) a recomputed upstream artifact makes its consumer stale", () => {
  const d = runDir();
  const commonLaw = write(join(d, "common-law-findings.md"), "half-a v1");
  // synthesis ran over v1
  writeStamp(d, "synthesis", [commonLaw]);
  assert.equal(stageStaleness(d, "synthesis", [commonLaw]).stale, false, "unchanged input → still fresh");

  // coverage-closure recomputes the common-law layer (the 08:38 event)
  write(commonLaw, "half-a v2 — an enterprise-AI venture named Ion, confirmed");
  const st = stageStaleness(d, "synthesis", [commonLaw]);
  assert.equal(st.stale, true, "the consumer must NOT skip as already-done");
  assert.equal(st.changed.length, 1);
  assert.equal(st.changed[0].name, "common-law-findings.md");

  // recomputing synthesis re-stamps and settles it — one pass, never a loop
  writeStamp(d, "synthesis", [commonLaw]);
  assert.equal(stageStaleness(d, "synthesis", [commonLaw]).stale, false);
  rmSync(d, { recursive: true, force: true });
});

test("(crash-resume) a crash changes no input bytes, so every stage still skips", () => {
  const d = runDir();
  const inputs = [write(join(d, "a.md"), "A"), write(join(d, "b.md"), "B")];
  for (const label of ["synthesis", "report-overview", "client-summary"]) writeStamp(d, label, inputs);
  // simulate a crash + resume: nothing on disk changed
  for (const label of ["synthesis", "report-overview", "client-summary"])
    assert.equal(stageStaleness(d, label, inputs).stale, false, `${label} must stay cheap on a pure crash-resume`);
  rmSync(d, { recursive: true, force: true });
});

test("no stamp at all (first run after this ships, or replay) → never stale", () => {
  const d = runDir();
  const a = write(join(d, "a.md"), "A");
  assert.equal(stageStaleness(d, "synthesis", [a]).stale, false);
  assert.equal(readStamp(d, "synthesis"), null);
  rmSync(d, { recursive: true, force: true });
});

// ── restamp: the driver-owned decoration case ──────────────────────────────
test("restamp: accounts for a post-stage mutation so it cannot strand the run", () => {
  const d = runDir();
  const report = write(join(d, "report.md"), "---\nx: 1\n---\nbody");
  writeStamp(d, "client-summary", [report]);
  // the driver injects its own front matter AFTER the client summary was drafted
  write(report, "---\nx: 1\nverdict: CONDITIONAL\n---\nbody");
  assert.equal(stageStaleness(d, "client-summary", [report]).stale, true, "…which would otherwise read as staleness");
  assert.equal(restamp(d, report), 1, "one stamp touched");
  assert.equal(stageStaleness(d, "client-summary", [report]).stale, false, "settled without a pointless re-draft");
  rmSync(d, { recursive: true, force: true });
});

test("restamp: touches only stamps that actually reference the path, and is idempotent", () => {
  const d = runDir();
  const report = write(join(d, "report.md"), "v1");
  const other = write(join(d, "narrative.md"), "n1");
  writeStamp(d, "client-summary", [report]);
  writeStamp(d, "case-law", [other]);
  write(report, "v2");
  assert.equal(restamp(d, report), 1, "case-law's stamp is untouched");
  assert.equal(restamp(d, report), 0, "second call is a no-op — nothing left to account for");
  assert.equal(stageStaleness(d, "case-law", [other]).stale, false);
  rmSync(d, { recursive: true, force: true });
});

test("restamp on a run with no stamps at all is a silent no-op", () => {
  const d = runDir();
  assert.equal(restamp(d, join(d, "nope.md")), 0);
  rmSync(d, { recursive: true, force: true });
});

// ── restampStage: a compensating rewrite that matches NOTHING must be distinguishable ──────────────
// The defect in one sentence: `restampStage(runDir, "frame-diff", P.registerFindings)` kept being
// called after stageInputs["frame-diff"] stopped declaring register-findings.md, and a boolean return
// could not tell "already accounted for" from "aimed at a file this stage does not declare". Three
// facts, so a caller can record the second.
test("restampStage: reports stamped/matched/changed separately — an undeclared path is a MISS, not a no-op", () => {
  const d = runDir();
  const declared = write(join(d, "register-named-band.json"), "band v1");
  const undeclared = write(join(d, "register-findings.md"), "digest v1");
  writeStamp(d, "frame-diff", [declared]);

  // an undeclared path: the stamp EXISTS but names nothing to move — the shape created
  write(undeclared, "digest v2");
  assert.deepEqual(restampStage(d, "frame-diff", undeclared), { stamped: true, matched: false, changed: false },
    "a path the stage does not declare reports matched:false — the caller logs it");

  // a declared path that moved: accounted for, and the stage stops reading stale
  write(declared, "band v2");
  assert.equal(stageStaleness(d, "frame-diff", [declared]).stale, true, "…which would otherwise park the run");
  assert.deepEqual(restampStage(d, "frame-diff", declared), { stamped: true, matched: true, changed: true });
  assert.equal(stageStaleness(d, "frame-diff", [declared]).stale, false, "settled without re-running a one-shot stage");

  // idempotent: declared and already current is matched-but-unchanged, NOT a miss
  assert.deepEqual(restampStage(d, "frame-diff", declared), { stamped: true, matched: true, changed: false },
    "already accounted for is a non-event, and must not read as a miss");

  // no stamp at all (the stage never ran / a legacy run): nothing to say
  assert.deepEqual(restampStage(d, "placement-inquiry", declared), { stamped: false, matched: false, changed: false });
  rmSync(d, { recursive: true, force: true });
});

test("restampStage: touches ONE label's stamp — never the blanket restamp()", () => {
  const d = runDir();
  const band = write(join(d, "register-named-band.json"), "v1");
  writeStamp(d, "frame-diff", [band]);
  writeStamp(d, "placement-inquiry", [band]);
  write(band, "v2");
  assert.equal(restampStage(d, "frame-diff", band).changed, true);
  assert.equal(stageStaleness(d, "placement-inquiry", [band]).stale, true,
    "the other consumer keeps its staleness — its recompute is still the contract");
  rmSync(d, { recursive: true, force: true });
});

// ── the delivery precondition ──────────────────────────────────────────────
test("staleOnPath: reports every stale stage on the delivery path, and nothing when all are fresh", () => {
  const d = runDir();
  const cl = write(join(d, "common-law-findings.md"), "v1");
  const nar = write(join(d, "narrative.md"), "n1");
  const inputsFor = (label) => (label === "client-summary" ? [nar] : [cl]);
  for (const l of ["register-digest", "synthesis", "narrative-refutation", "client-summary"]) writeStamp(d, l, inputsFor(l));
  assert.deepEqual(staleOnPath(d, ["register-digest", "synthesis", "client-summary"], inputsFor), []);

  write(cl, "v2");   // the coverage-closure recompute
  const stale = staleOnPath(d, ["register-digest", "synthesis", "narrative-refutation", "client-summary"], inputsFor);
  assert.deepEqual(stale.map((s) => s.label), ["register-digest", "synthesis", "narrative-refutation"],
    "every consumer of the changed artifact — and only those");
  rmSync(d, { recursive: true, force: true });
});

// ── end-of-pass reconcile ──────────────────────────────────────────────────
test("reconcileStamps: re-fingerprints a driver-mutated input so the NEXT pass stays cheap", () => {
  const d = runDir();
  const band = write(join(d, "register-named-band.json"), "band v1");
  writeStamp(d, "placement-inquiry", [band]);
  write(band, "band v1 — front-matter re-merged in place");   // a deterministic driver re-derivation
  assert.equal(stageStaleness(d, "placement-inquiry", [band]).stale, true, "…which reads as staleness pre-reconcile");
  assert.equal(reconcileStamps(d, () => [band]), 1, "one stamp reconciled");
  assert.equal(stageStaleness(d, "placement-inquiry", [band]).stale, false, "settled — no needless recompute next pass");
  rmSync(d, { recursive: true, force: true });
});

test("(teal-gantry regression) reconcile LEAVES a delivery-blocking stale stamp untouched so the resume recomputes it", () => {
  const d = runDir();
  // placement-inquiry ran over the pre-reopen band; a frame-reopen then regenerated the band (bytes moved)
  // and placement was NOT recomputed — it is delivery-blocking stale.
  const band = write(join(d, "register-named-band.json"), "band pre-reopen");
  const nar = write(join(d, "narrative.md"), "n1");
  writeStamp(d, "placement-inquiry", [band]);
  writeStamp(d, "case-law", [nar]);   // an unrelated, genuinely-fresh stage on the same pass
  write(band, "band post-reopen — enumerated the dominant-element floor");

  // Fail path: reconcile is asked to skip the delivery-blocking label. It must NOT erase placement's block,
  // but MUST still reconcile the unrelated stage (were it driver-mutated) — here case-law is unchanged.
  const touched = reconcileStamps(d, (l) => (l === "case-law" ? [nar] : [band]), new Set(["placement-inquiry"]));
  assert.equal(touched, 0, "case-law is unchanged, placement is excluded → nothing reconciled");
  assert.equal(stageStaleness(d, "placement-inquiry", [band]).stale, true,
    "placement STAYS stale — a plain resume would otherwise skip it and ship the inconsistency");

  // Sanity: WITHOUT the exclude (the old behaviour), reconcile erases the block — the bug this guards.
  const d2 = runDir();
  const band2 = write(join(d2, "register-named-band.json"), "band pre-reopen");
  writeStamp(d2, "placement-inquiry", [band2]);
  write(band2, "band post-reopen");
  reconcileStamps(d2, () => [band2]);   // no exclude
  assert.equal(stageStaleness(d2, "placement-inquiry", [band2]).stale, false,
    "…confirming the erasure the fix prevents");
  rmSync(d, { recursive: true, force: true });
  rmSync(d2, { recursive: true, force: true });
});

test("reconcileStamps: a success-pass exclude is empty/null → reconciles everything, exactly as before", () => {
  const d = runDir();
  const a = write(join(d, "a.md"), "A");
  writeStamp(d, "synthesis", [a]);
  write(a, "A2");
  assert.equal(reconcileStamps(d, () => [a], null), 1, "null exclude reconciles");
  assert.equal(stageStaleness(d, "synthesis", [a]).stale, false);
  rmSync(d, { recursive: true, force: true });
});

test("clearStamp drops a stage's record; shaOf returns null for an unreadable path", () => {
  const d = runDir();
  const a = write(join(d, "a.md"), "A");
  writeStamp(d, "synthesis", [a]);
  assert.ok(readStamp(d, "synthesis"));
  clearStamp(d, "synthesis");
  assert.equal(readStamp(d, "synthesis"), null);
  assert.equal(shaOf(join(d, "nope.md")), null);
  rmSync(d, { recursive: true, force: true });
});

test("axis labels with a colon are safe as filenames (register-unit:primary-sweep)", () => {
  const d = runDir();
  const a = write(join(d, "a.md"), "A");
  writeStamp(d, "register-unit:primary-sweep", [a]);
  assert.equal(stageStaleness(d, "register-unit:primary-sweep", [a]).stale, false);
  write(a, "A2");
  assert.equal(stageStaleness(d, "register-unit:primary-sweep", [a]).stale, true);
  rmSync(d, { recursive: true, force: true });
});

// PR-11 — a BARE stage name in the exclude set covers every axis-qualified stamp of that stage.
// The pipeline excludes "register-digest" when the digest queue still holds pending items (a band
// mutation whose re-digest never flushed), and the digest's stamps are written per axis
// ("register-digest:primary-sweep"). Matching only the full label would have excluded nothing at all —
// the stamps would be re-fingerprinted against the mutated band and the next resume would SKIP the
// recompute the queue still owes.
test("reconcileStamps: a bare stage name in the exclude covers its axis-qualified stamps", () => {
  const d = runDir();
  const band = write(join(d, "register-named-band.json"), "band pre-mutation");
  writeStamp(d, "register-digest:primary-sweep", [band]);
  writeStamp(d, "register-digest:transliteration-numeric", [band]);
  writeStamp(d, "synthesis", [band]);
  write(band, "band post-mutation — the late flush never ran");

  const touched = reconcileStamps(d, () => [band], new Set(["register-digest"]));
  assert.equal(touched, 1, "only the unrelated stage reconciles");
  for (const axis of ["primary-sweep", "transliteration-numeric"]) {
    assert.equal(stageStaleness(d, `register-digest:${axis}`, [band]).stale, true,
      `register-digest:${axis} STAYS stale — the pending re-digest is still owed`);
  }
  assert.equal(stageStaleness(d, "synthesis", [band]).stale, false, "an unrelated stage is unaffected");
  rmSync(d, { recursive: true, force: true });
});

// ── — a stage may compare a PROJECTION of its input rather than the whole file ──────────────────
// A report-card declares the whole of findings.json and reads none of it — its finding arrives inline on
// the message — so a corrective pass that edited ONE finding made all 26 cards read stale and the tail
// repair re-derived them: 496,327 output tokens, 43 dispatches of which 33 were repeats, 1h29m. Both
// shas stay recorded; the projection decides only where BOTH sides carry one.
const findingsDoc = (findings) => JSON.stringify({ findings });
const cardProject = (label, path) => {
  if (typeof label !== "string" || !label.startsWith("card:")) return null;
  if (!String(path).endsWith("findings.json")) return null;
  const ord = Number(label.slice("card:".length));
  try {
    const f = JSON.parse(readFileSync(path, "utf8")).findings.find((x) => x.ordinal === ord);
    return f ? createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 12) : null;
  } catch { return null; }
};

test("#393: editing ONE finding stales only that finding's card — the other cards stay fresh", () => {
  const dir = runDir();
  const fp = join(dir, "findings.json");
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA" }, { ordinal: 2, mark: "BETA" }, { ordinal: 3, mark: "GAMMA" }]));
  for (const ord of [1, 2, 3]) writeStamp(dir, `card:${ord}`, [fp], { project: cardProject });
  // a sanctioned late arm rewrites findings.json, touching finding 2 only
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA" }, { ordinal: 2, mark: "BETA LTD" }, { ordinal: 3, mark: "GAMMA" }]));
  const stale = staleOnPath(dir, ["card:1", "card:2", "card:3"], () => [fp], { project: cardProject });
  assert.deepEqual(stale.map((s) => s.label), ["card:2"], "only the card whose own finding moved is stale");
  assert.equal(stale[0].changed[0].via, "projection", "and the record says which question decided it");
  // WITHOUT the projection this is the measured defect: the whole-file sha moved, so all three are stale
  const naive = staleOnPath(dir, ["card:1", "card:2", "card:3"], () => [fp]);
  assert.equal(naive.length, 3, "the whole-file compare stales every consumer — this is the 26-card re-run");
});

test("#393: a null projection FALLS BACK to the whole file and stays stale — two absent projections never compare equal", () => {
  const dir = runDir();
  const fp = join(dir, "findings.json");
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA" }, { ordinal: 9, mark: "OMEGA" }]));
  writeStamp(dir, "card:9", [fp], { project: cardProject });
  // finding 9 is dropped (a withdrawal, a renumber) — the card can no longer project its own input
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA" }]));
  const stale = staleOnPath(dir, ["card:9"], () => [fp], { project: cardProject });
  assert.equal(stale.length, 1, "no projection ⇒ whole-file compare ⇒ STALE, never a silent pass");
  assert.notEqual(stale[0].changed[0].via, "projection");
  // an unreadable findings.json is the same answer, not an exception and not a pass
  writeFileSync(fp, "{ not json");
  assert.equal(staleOnPath(dir, ["card:9"], () => [fp], { project: cardProject }).length, 1);
});

test("#393: a stage with no projector writes and compares exactly as before — byte-identical stamps", () => {
  const dir = runDir(), dir2 = runDir();
  const fp = join(dir, "a.md"), fp2 = join(dir2, "a.md");
  writeFileSync(fp, "x"); writeFileSync(fp2, "x");
  writeStamp(dir, "synthesis", [fp]);
  writeStamp(dir2, "synthesis", [fp2], { project: cardProject });
  const strip = (d, p) => JSON.stringify(readStamp(d, "synthesis").inputs).replaceAll(p, "P");
  assert.equal(strip(dir, fp), strip(dir2, fp2), "no projection ⇒ no `proj` key ⇒ reconcileStamps' equality still holds");
  assert.ok(!JSON.stringify(readStamp(dir2, "synthesis")).includes("proj"));
});

test("#393: a post-stage mutator accounts for the projection too, not only the whole-file sha", () => {
  const dir = runDir();
  const fp = join(dir, "findings.json");
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA" }]));
  writeStamp(dir, "card:1", [fp], { project: cardProject });
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA RENAMED" }]));
  // restamp is how a mutator says "this change is accounted for" — it must move BOTH shas, or it leaves
  // a stale projection no recompute could ever settle: the mirror of the defect restamp exists for.
  restamp(dir, fp, { project: cardProject });
  assert.deepEqual(staleOnPath(dir, ["card:1"], () => [fp], { project: cardProject }), []);
  restampStage(dir, "card:1", fp, { project: cardProject });
  assert.deepEqual(staleOnPath(dir, ["card:1"], () => [fp], { project: cardProject }), []);
  // and reconcile keeps the projection current rather than dropping it
  writeFileSync(fp, findingsDoc([{ ordinal: 1, mark: "ALPHA AGAIN" }]));
  reconcileStamps(dir, () => [fp], null, { project: cardProject });
  assert.ok(readStamp(dir, "card:1").inputs[0].proj, "the reconciled stamp still carries a projection");
  assert.deepEqual(staleOnPath(dir, ["card:1"], () => [fp], { project: cardProject }), []);
});
