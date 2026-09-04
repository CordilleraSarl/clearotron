// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Post-merge audit, problem 1 — what the BABYSIT surface says a stage produced.
//
// AD-4 made the run.jsonl `stage` row's `output` unconditional, which is right: a failed dispatch's
// mid-write artifact used to be invisible. But `get_run` projects `output` and did NOT project the
// `outputWritten` companion that rides the same row — so on the one surface the E2E babysit protocol
// polls, a stage that failed and emitted nothing read as having produced its artifact. Two shapes make
// that concrete, both taken from the 2026-07-29 delivered production run:
//
//   · INHERITED — `register-digest` succeeded at run.jsonl idx 51 emitting register-findings.md @
//     sha 1ba8feb88bef, then failed status_overloaded three times (idx 84/131/159) with that earlier
//     file still on disk. Its rows now carry the real sha/size, correctly — and outputWritten:false.
//   · ABSENT — `placement-inquiry` failed status_overloaded at idx 80 having emitted nothing on that
//     dispatch. Under fileMeta that journalled {sha:null,size:0}: a record where there is no file.
//     driver/log.mjs outputMeta writes {present:false} instead.
//
// Lib/server imported DYNAMICALLY in before(), after _fixture sets CLEAROTRON_WORK_DIR (ESM hoisting).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { buildFixture, RUN_ID } from "./_fixture.mjs";

let tools, runs;

// The rows below are that run's real stage sequence, re-journalled in the post- shape
// this PR ships (the archived run predates it, so its rows carry the pre-AD-4 `output:null`).
const DELIVERED_RUN_ROWS = [
  // idx 51 — the successful pass that put register-findings.md on disk
  { ts: "2026-07-29T19:13:07.133Z", event: "stage", stage: "register-digest", trigger: "fresh", ok: true, attempts: 2,
    fail: null, model: "anthropic/claude-opus-5", inputs: [],
    output: { name: "register-findings.md", sha: "1ba8feb88bef", size: 112422, present: true },
    outputWritten: true, summary: "success" },
  // idx 80 — placement-inquiry failed on the frame-reopen having written NOTHING this dispatch
  { ts: "2026-07-29T20:02:12.472Z", event: "stage", stage: "placement-inquiry", trigger: "frame-reopen", ok: false,
    attempts: 3, fail: "status_overloaded", model: "anthropic/claude-opus-5", inputs: [],
    output: { name: "placement-recommendations.md", sha: null, size: null, present: false },
    outputWritten: false },
  // idx 84 — register-digest failed with idx 51's artifact still sitting there (LANDED, not EMITTED)
  { ts: "2026-07-29T20:05:20.483Z", event: "stage", stage: "register-digest", trigger: "settlement-flush", ok: false,
    attempts: 1, fail: "status_overloaded", model: "anthropic/claude-opus-5", inputs: [],
    output: { name: "register-findings.md", sha: "1ba8feb88bef", size: 112422, present: true },
    outputWritten: false },
];

// ── post-merge audit, N2 — a RESUME's rows, which are mostly SKIPS ────────────────────────────
// The comment above getStages states this surface's contract unqualified, but two production writers
// still used `fileMeta`, which has no `present` key: the `skip` row (driver/pipeline.mjs stageOnce) and
// the code-side register-unit lane. A resume — after a recovery park or a rate-limit postpone, i.e. the
// path a babysat run takes overnight — is skip-DOMINATED, so most rows on this surface fell outside the
// contract, and a reader following it got `output.present === undefined` → falsy → "not produced" for an
// artifact that is on disk and passed its validator.
//
// PROVENANCE — these rows are not hand-authored. They are verbatim writer output, captured from the
// offline mock pipeline's real fail-at-synthesis → resume (19 rows, 13 of them skips) pinned by
// driver/test/operability.test.mjs "AUDIT /N2 — every stage/skip row a RESUMED run writes…", plus
// the code-side failure row from driver/test/satprobe-codeside.test.mjs "AUDIT /N2 — a FAILED
// code-side dispatch…". Only `ts` is elided. Invent a fixture here and it certifies the bug.
// (Stages already spoken for by the two DELIVERED rows above — register-digest, placement-inquiry — are
// left out: getStages keeps the LAST row per label, and those two tests own theirs.)
const RESUMED_RUN_ROWS = [
  { event: "skip", stage: "matter-frame", trigger: "skip", model: "anthropic/claude-opus-5",
    output: { name: "matter-context.md", sha: "b724635aceba", size: 298, present: true } },
  { event: "skip", stage: "prelim-variants", trigger: "skip", model: "anthropic/claude-opus-5",
    output: { name: "variant-manifest.md", sha: "c8a2517e36eb", size: 426, present: true } },
  { event: "skip", stage: "skeptic", trigger: "skip", model: "anthropic/claude-sonnet-5",
    output: { name: "skeptic-flags.md", sha: "cdb221212e9f", size: 18, present: true } },
  { event: "stage", stage: "synthesis", trigger: "fresh", ok: true, attempts: 1, model: "anthropic/claude-opus-5",
    inputs: [{ name: "register-findings.md", sha: "4ef00bb61c65", size: 5582, read: false },
      { name: "skeptic-flags.md", sha: "cdb221212e9f", size: 18, read: false },
      { name: "crowd-context.json", sha: null, size: 0, read: false }],
    followup: false, readsTruncated: false, warm: false,
    output: { name: "narrative.md", sha: "5ad1e42bb3b4", size: 372, present: true },
    outputWritten: true, summary: "success" },
  // the code-side register-unit lane, failed. It DOES declare an output, so the old `null` (which in this
  // vocabulary means "declares none") was the wrong value; and its input carries `read:null` — pure code,
  // no reads gauge — rather than omitting the key.
  { event: "stage", stage: "register-unit:saturation-probe", trigger: "fresh", ok: false, attempts: 1,
    fail: "saturation-probe direct execution failed: provider 502", model: "code:execute-plan",
    inputs: [{ name: "register-plan.json", sha: "fe76447f4888", size: 313, read: null }],
    followup: false, readsTruncated: null, warm: false,
    output: { name: "saturation-probe.md", sha: null, size: null, present: false } },
];
const RESUMED_STAGES = new Set(RESUMED_RUN_ROWS.map((r) => r.stage));

before(async () => {
  buildFixture();
  runs = await import("../lib/runs.mjs");
  ({ tools } = await import("../server.mjs"));
  const runDir = runs.resolveRun(RUN_ID).runDir;
  appendFileSync(driverDir(runDir, "run.jsonl"),
    [...DELIVERED_RUN_ROWS, ...RESUMED_RUN_ROWS].map((e) => JSON.stringify({ ts: "2026-07-30T02:14:00.000Z", ...e })).join("\n") + "\n");
});

test("AUDIT #172/1 — get_run projects outputWritten, so a failed stage's INHERITED artifact cannot read as its own", () => {
  const { stages } = tools.get_run({ runId: RUN_ID });
  const digest = stages.find((s) => s.stage === "register-digest");
  assert.equal(digest.ok, false, "the last register-digest dispatch failed");
  assert.equal(digest.output.name, "register-findings.md");
  assert.equal(digest.output.sha, "1ba8feb88bef", "the file IS there — recording it is the point of the unconditional field");
  assert.equal(digest.outputWritten, false,
    "…and the surface now says THIS dispatch did not emit it — without this the babysit read is 'produced its artifact'");
});

test("AUDIT #172/1 — an absent output reaches the babysit surface as present:false, not a zero-size record", () => {
  const { stages } = tools.get_run({ runId: RUN_ID });
  const inquiry = stages.find((s) => s.stage === "placement-inquiry");
  assert.equal(inquiry.ok, false);
  assert.equal(inquiry.output.present, false, "unmistakably absent");
  assert.equal(inquiry.output.sha, null);
  assert.equal(inquiry.output.size, null, "not 0 — nobody measured a byte count");
  assert.equal(inquiry.output.name, "placement-recommendations.md", "what was expected is still named");
  assert.equal(inquiry.outputWritten, false);
});

test("AUDIT #172/1 — outputWritten is projected as null, never dropped, on rows that predate the field", () => {
  const { stages } = tools.get_run({ runId: RUN_ID });
  // every fixture stage row predates AD-4 and carries no outputWritten (the resumed-run rows below are
  // post-AD-4 by construction, so they are not part of this subject)
  const legacy = stages.filter((s) => !["register-digest", "placement-inquiry"].includes(s.stage) && !RESUMED_STAGES.has(s.stage));
  assert.ok(legacy.length > 0, "the fixture has pre-AD-4 stage rows");
  for (const s of legacy)
    assert.equal(s.outputWritten, null, `${s.stage}: 'not recorded' is explicit, never an omitted key`);
});

test("AUDIT #175/N2 — EVERY row a resumed run puts on get_run stages[] satisfies the contract this surface states", () => {
  const { stages } = tools.get_run({ runId: RUN_ID });
  const resumed = stages.filter((s) => RESUMED_STAGES.has(s.stage));
  assert.equal(resumed.length, RESUMED_STAGES.size, "every resumed row reached the surface");

  // The one assertion that would have caught this: universally quantified, not one row someone thought
  // to write. `output.present` is what a reader holding the stated contract asks — and on a skip row
  // written through fileMeta it was `undefined`, i.e. falsy, i.e. "not produced".
  for (const s of resumed) {
    assert.notEqual(s.output, undefined, `${s.stage}: output is projected, never an omitted key`);
    if (s.output !== null) {
      assert.equal(typeof s.output.present, "boolean",
        `${s.stage}: a declared output carries \`present\` — this is what server.mjs promises unqualified`);
      assert.equal(typeof s.output.name, "string", `${s.stage}: absence still has an address`);
      if (!s.output.present) {
        assert.equal(s.output.sha, null, `${s.stage}: absent ⇒ no fingerprint claimed`);
        assert.equal(s.output.size, null, `${s.stage}: absent ⇒ no byte count claimed (0 is a real size)`);
      }
    }
    assert.ok([true, false, null].includes(s.outputWritten),
      `${s.stage}: outputWritten is three-valued and always projected`);
  }

  // A resume is skip-DOMINATED, and every skip is an artifact the resume FOUND and re-validated.
  const skipped = resumed.filter((s) => s.trigger === "skip");
  assert.ok(skipped.length * 2 > resumed.length, "the resumed set is skip-dominated, as a real resume is");
  for (const s of skipped)
    assert.equal(s.output.present, true,
      `${s.stage}: this row exists BECAUSE the artifact is on disk and passed its validator — it must never read as 'not produced'`);
});
