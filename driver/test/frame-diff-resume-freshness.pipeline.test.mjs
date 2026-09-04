// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline run, parks it, and resumes it
// follow-up — frame-diff must not park a RESUME it cannot be re-dispatched to fix.
//
// moved frame-diff above placement-inquiry and re-aimed its declared inputs at the register's
// primary evidence (the merged named band + the per-axis unit notes + common-law). Three arms that run
// AFTER the new seam rewrite exactly those artifacts — the escalation-recheck band re-merge, the skeptic
// escalation's forced register-unit re-runs, and the envelope close's forced register-unit re-runs — and
// none of them accounted for the rewrite in frame-diff's stamp. frame-diff is ONE-SHOT by contract (no
// in-process re-diff) and has no UPSTREAM_STALE_REPAIR entry, so on a resume where it SKIPS (⇒ joins
// ctx.skippedStages ⇒ joins deliveryPathStages) the delivery precondition read it stale and the run
// PARKED with failClass "stale" — paying a park plus a full re-drive to re-run a stage whose every
// consumer had already run.
//
// Own file = own process + own workspace root (the repo convention for mock-pipeline scenarios).
// SAFETY GUARD: driver.config freezes workspaceRoot at FIRST import with a PRODUCTION default
// . Pin it to a throwaway root BEFORE any driver module loads — a static driver import
// above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
// provider-usage.DEFAULT_LEDGER_PATH freezes at FIRST import (module const) — pin the call ledger to a
// throwaway file BEFORE any pipeline import so the screen-gate's fetched-universe reads OUR ledger.
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "prelim-fdfresh-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";   // hermetic mock runs never dial the provider
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-fdfresh", msgId: "<fdfresh@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8907", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// The skeptic escalates transliteration-numeric — the escalation arm then re-runs that axis's
// register-unit FORCED, which byte-changes register-units/transliteration-numeric.md. That file is a
// DECLARED frame-diff input under, and the rewrite happens after frame-diff's seam.
const ESCALATE_SKEPTIC = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

// `reuse` re-enters an EXISTING run (same workspace root + codename) — the resume path this defect lives on.
async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "prelim-fdfresh-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP",
    "MOCK_FRAME_DIFF", "MOCK_ESCALATION_NOOP", "MOCK_LEDGER_LIMITED", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

// The artifacts a sanctioned pre-synthesis arm is ALLOWED to move under a settled frame. Anything else
// turning up in the seam's `changed` list means the grant has quietly widened past what was reasoned
// about, and this test is where that gets noticed rather than at a delivery gate on a live run.
const SANCTIONED = (p) => /(^|\/)register-named-band\.json$/.test(p) || /(^|\/)register-units\/[^/]+\.md$/.test(p) || /(^|\/)common-law\.md$/.test(p);

test("a resume whose frame-diff SKIPS is not parked by the escalation rewriting the band/units it declares", async () => {
  // ── pass 1: park at placement-inquiry ────────────────────────────────────────────────────────────
  // The window the defect lives in: frame-diff has RUN (its seam is above placement since) and
  // narrative.md is absent, so the resume is NOT digest-locked and the escalation/envelope arms fire.
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "placement-inquiry/SKILL" }, {});
  assert.equal(p1.res.ok, false, "pass 1 parks");
  assert.equal(p1.res.failedStage, "placement-inquiry",
    `pass 1 must park AT placement-inquiry (substring match caught a different turn: ${p1.res.failedStage})`);
  assert.ok(existsSync(join(p1.res.runDir, "frame-diff.md")), "frame-diff RAN in pass 1 — its stamp is what pass 2 inherits");
  assert.ok(!existsSync(join(p1.res.runDir, "narrative.md")), "narrative absent ⇒ the resume is NOT digest-locked");
  assert.ok(p1.events.some((e) => e.event === "stage" && e.stage === "frame-diff"), "frame-diff dispatched in pass 1");

  // ── pass 2: resume; the skeptic escalates and the arms rewrite frame-diff's declared inputs ──────
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({ MOCK_SKEPTIC: ESCALATE_SKEPTIC }, {}, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes

  // the window really opened: frame-diff skipped (⇒ on the delivery path) and an arm moved its inputs
  assert.ok(ev2.some((e) => e.event === "skip" && e.stage === "frame-diff"),
    "frame-diff skipped on the resume — this is what puts it on the delivery path via ctx.skippedStages");
  assert.ok(ev2.some((e) => e.event === "skeptic-escalation"),
    "the escalation arm re-ran a register unit after the frame-diff seam (the rewrite that used to strand it)");

  // THE DEFECT: before the fix this parks with failClass "stale", naming frame-diff.
  const blocked = ev2.filter((e) => e.event === "delivery-stale-blocked");
  assert.equal(blocked.filter((e) => (e.stages ?? []).some((s) => s.label === "frame-diff")).length, 0,
    `frame-diff must not stale-block delivery: ${JSON.stringify(blocked)}`);
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "the resume delivers");

  // the seam accounted for the rewrite, and RECORDED which files it moved — the grant is auditable
  const settle = ev2.filter((e) => e.event === "one-shot-stamp-settled" && e.stage === "frame-diff");
  assert.ok(settle.length >= 1, "the settle seam ran and left a receipt");
  const moved = [...new Set(settle.flatMap((e) => e.changed ?? []))];
  assert.ok(moved.length >= 1, `the seam moved at least one input (the escalation's unit rewrite): ${JSON.stringify(settle)}`);
  for (const f of moved) assert.ok(SANCTIONED(f), `the seam blessed an UNREASONED artifact: ${f}`);

  // ZERO SEMANTICS: a restamp aimed at a path its stage does not declare is never silent. A healthy run
  // emits none — the row exists so the next input-list move cannot be a no-op nobody sees.
  assert.deepEqual(p2.events.filter((e) => e.event === "restamp-miss"), [],
    "a restamp that matched nothing would be recorded here — none on a healthy run");
});

// ZERO SEMANTICS, the FIRING direction. The test above asserts a healthy run logs no `restamp-miss`,
// which on its own would pass just as well if the detector never fired at all. This drives the miss
// directly: point a restamp at a file the stage does not declare — the exact shape left behind at
// the settlement flush — and assert the row lands. Without this, the thing built to catch the next
// input-list move is itself untested.
test("a restamp aimed at a file the stage does NOT declare lands a restamp-miss row — it is never silent", async () => {
  const { settleOneShotStamp } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { writeStamp } = await import("../stage-freshness.mjs");
  const { mkdirSync, writeFileSync } = await import("node:fs");

  const d = mkdtempSync(join(tmpdir(), "prelim-fdmiss-"));
  mkdirSync(driverDir(d), { recursive: true });
  const declared = join(d, "register-named-band.json");
  const undeclared = join(d, "register-findings.md");
  writeFileSync(declared, "band v1");
  writeFileSync(undeclared, "digest v1");
  writeStamp(d, "frame-diff", [declared]);

  writeFileSync(declared, "band v2");         // sanctioned: accounted for, no row
  writeFileSync(undeclared, "digest v2");     // aimed at nothing: a row
  const r = settleOneShotStamp(d, "frame-diff", [declared, undeclared], "unit-probe");
  assert.deepEqual(r.changed, [declared], "only the declared file was accounted for");
  assert.deepEqual(r.missed, [undeclared], "the undeclared file is reported as a miss, not swallowed");

  const rows = readFileSync(driverDir(d, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const miss = rows.filter((e) => e.event === "restamp-miss");
  assert.equal(miss.length, 1, JSON.stringify(rows));
  assert.equal(miss[0].stage, "frame-diff");
  assert.equal(miss[0].path, undeclared);
  assert.equal(miss[0].why, "unit-probe", "the row says which arm's compensating rewrite is aimed at nothing");
  const settled = rows.filter((e) => e.event === "one-shot-stamp-settled");
  assert.deepEqual(settled.map((e) => e.changed), [[declared]], "…and the grant it DID make is recorded beside it");
});

test("frame-diff still recomputes when a NON-sanctioned input moves (the freshness contract is not blanket-disabled)", async () => {
  // The seam blesses only what the pre-synthesis register arms rewrite. A blind-frame model that moves
  // between passes is new material and must still force the diff — the copper-vault catch, intact.
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "placement-inquiry/SKILL" }, {});
  assert.equal(p1.res.ok, false, "pass 1 parks");
  assert.equal(p1.res.failedStage, "placement-inquiry");

  // Re-serialise the blind model COMPACTLY: same content, different bytes. It has to stay valid — an
  // invalid model just makes blind-frame re-run and rewrite the canonical bytes back, which is not the
  // question this test asks.
  const { writeFileSync } = await import("node:fs");
  const bfm = join(p1.res.runDir, "blind-frame-model.json");
  writeFileSync(bfm, JSON.stringify(JSON.parse(readFileSync(bfm, "utf8"))) + "\n");

  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({}, {}, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);
  assert.ok(ev2.some((e) => e.event === "stage-stale" && e.stage === "frame-diff"),
    "a moved blind-frame model still stales frame-diff");
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "frame-diff"),
    "…and it RE-RAN rather than being blessed at the seam");
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
});
