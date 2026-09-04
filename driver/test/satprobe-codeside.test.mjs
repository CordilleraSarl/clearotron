// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR A (2026-07-14): saturation-probe runs CODE-SIDE — the driver executes the frozen plan's dictated
// entries through the provider executor lane itself (no agent turn) and templates the audit note.
// Root cause: the provider call-log proved the haiku unit silently skipped its one register_execute_plan
// call ~1/3 of runs since and hand-fabricated the band instead (ashen-causeway, teal-lattice,
// teal-foundry delivered; copper-keystone died at fan-in). These tests pin: (1) the unit-level contract of
// runSaturationProbeCodeSide (execute / vacuous / skip / failure), and (2) the pipeline integration —
// with an injected planExecutor the saturation-probe member NEVER takes an agent turn, and without one
// (CLEAROTRON_PLAN_DISPATCH=off) the agent stage remains the verbatim fallback.
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH; with the mock pinned here, an early driver import
// can never reach production even by accident.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";   // hermetic: never dial the live provider from a test
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";

// ── unit level: runSaturationProbeCodeSide ───────────────────────────────────────────────────────────

function mkCtx({ entries }) {
  const runDir = mkdtempSync(join(tmpdir(), "satprobe-code-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const planPath = driverDir(runDir, "register-plan.json");
  writeFileSync(planPath, JSON.stringify({ schema_version: 1, plan_version: 1, entries }, null, 2));
  return {
    runDir,
    ctx: {
      paths: null,   // filled by the caller after importing paths()
      run: { slug: "tmptest-probe", codename: "unit-test", studioRoot: runDir },
      agent: "clawdi",
      job: { markName: "PROBE TEST" },
      registerPlan: { plan_version: 1, entries },
    },
  };
}

const SAT_ENTRY = { qid: "saturation-probe:default:project", axis: "saturation-probe", predicate: "default", term: "PROJECT", nice_classes: ["9"], regions: [], expected_kind: "count" };

// the mock executor behaves like the real tool: writes the band itself, qid-stamped, from the plan file
const mockExecutor = (calls) => async ({ planPath, axis, outputPath }, { sessionKey }) => {
  calls.push({ planPath, axis, outputPath, sessionKey });
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 4321, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

test("code-side unit: executes the plan via the executor, writes band + templated audit note", async () => {
  const { pipeline, runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  assert.ok(pipeline, "pipeline import sanity");
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { runDir, ctx } = mkCtx({ entries: [SAT_ENTRY] });
  ctx.paths = paths(runDir);
  const calls = [];
  const r = await runSaturationProbeCodeSide(ctx, mockExecutor(calls));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sessionKey, null, "code-side unit carries NO warm session key");
  assert.equal(calls.length, 1, "executor called exactly once");
  assert.match(calls[0].sessionKey, /register-unit-saturation-probe$/, "telemetry attribution key is the unit lane key");
  const band = JSON.parse(readFileSync(ctx.paths.registerBand("saturation-probe"), "utf8"));
  assert.equal(band.length, 1);
  assert.equal(band[0].qid, SAT_ENTRY.qid, "band is executor-written and qid-stamped");
  const md = readFileSync(ctx.paths.registerUnit("saturation-probe"), "utf8");
  assert.match(md, /deterministic code execution/i, "audit note declares the code-side mode");
  assert.match(md, /saturation-probe:default:project/, "audit table carries the executed qid");
  assert.doesNotMatch(md, /not executed|not bound/i, "note never trips the declared_not_executed validator");
  // stage record + run.jsonl event mirror the agent path's telemetry shape
  const rec = JSON.parse(readFileSync(driverDir(runDir, "register-unit:saturation-probe.jsonl"), "utf8").trim().split("\n").pop());
  assert.equal(rec.modelUsed, "code:execute-plan");
  assert.equal(rec.status, "ok");
  const events = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = events.find((e) => e.event === "stage" && e.stage === "register-unit:saturation-probe");
  assert.ok(ev?.ok, "run.jsonl stage event present + ok");
  assert.equal(ev.model, "code:execute-plan");
});

test("code-side unit: vacuous axis (zero dictated entries) writes an honest empty band, never calls the executor", async () => {
  const { runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { ctx } = mkCtx({ entries: [{ ...SAT_ENTRY, axis: "primary-sweep", qid: "primary-sweep:exact:x" }] });
  ctx.paths = paths(ctx.run.studioRoot);
  const calls = [];
  const r = await runSaturationProbeCodeSide(ctx, mockExecutor(calls));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(calls.length, 0, "executor never called for a vacuous axis (it refuses empty axes)");
  const band = JSON.parse(readFileSync(ctx.paths.registerBand("saturation-probe"), "utf8"));
  assert.deepEqual(band, [], "band is an honest empty array");
  const md = readFileSync(ctx.paths.registerUnit("saturation-probe"), "utf8");
  assert.match(md, /vacuous/i, "audit note states the axis is vacuous this run");
});

test("code-side unit: second call skips on existing valid output (crash-resume idempotency)", async () => {
  const { runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { ctx } = mkCtx({ entries: [SAT_ENTRY] });
  ctx.paths = paths(ctx.run.studioRoot);
  const calls = [];
  const exec = mockExecutor(calls);
  const r1 = await runSaturationProbeCodeSide(ctx, exec);
  assert.equal(r1.ok, true);
  const r2 = await runSaturationProbeCodeSide(ctx, exec);
  assert.equal(r2.ok, true);
  assert.equal(r2.skipped, true, "resume skips — output present and valid");
  assert.equal(r2.sessionKey, null);
  assert.equal(calls.length, 1, "executor not re-run on skip");
});

test("code-side unit: executor failure retries once in-driver, then fails the member (recovery ladder territory)", async () => {
  const { runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { ctx } = mkCtx({ entries: [SAT_ENTRY] });
  ctx.paths = paths(ctx.run.studioRoot);
  let n = 0;
  const r = await runSaturationProbeCodeSide(ctx, async () => { n++; return { ok: false, cause: "provider 502" }; });
  assert.equal(r.ok, false);
  assert.equal(n, 2, "one in-driver retry (two attempts total)");
  assert.match(r.fail, /direct execution failed/, "failure text names the code lane");
  assert.equal(existsSync(ctx.paths.registerUnit("saturation-probe")), false, "no audit note on failure — nothing pretends to have run");
});

// ── post-merge audit, N2 — this lane writes onto the get_run stages surface too ─────────────
// `get_run` folds run.jsonl `stage` and `skip` rows into ONE stages[] list and states one contract over
// it (mcp-server/server.mjs): an output that was expected and is not there arrives as {present:false}.
// This lane was writing a shape of its own — a fileMeta skip row with no `present` key at all, and, on
// failure, `output:null`, which under AD-4's vocabulary means "this stage declares NO output" when it
// plainly declares one. Its inputs carried no `read` key either: an OMITTED key, the absent-means-false
// shape the package exists to retire (and which mcp-server/test/babysit-output-honesty.test.mjs forbids
// outright). These two tests read the rows the REAL writer emitted; the mcp-server contract walk that
// consumes them names this file as their provenance.
const surfaceRows = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n")
  .map((l) => JSON.parse(l)).filter((e) => e.event === "stage" || e.event === "skip");

test("AUDIT #175/N2 — the code-side SKIP row (the resume shape) carries {present:true}, not a key-less fileMeta", async () => {
  const { runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { runDir, ctx } = mkCtx({ entries: [SAT_ENTRY] });
  ctx.paths = paths(ctx.run.studioRoot);
  const exec = mockExecutor([]);
  await runSaturationProbeCodeSide(ctx, exec);
  const r2 = await runSaturationProbeCodeSide(ctx, exec);   // the resume: output present + valid ⇒ skip
  assert.equal(r2.skipped, true);

  const skip = surfaceRows(runDir).find((e) => e.event === "skip");
  assert.ok(skip, "the resume journalled a skip row");
  assert.equal(skip.output.present, true,
    "the artifact IS on disk and passed its validator — that is why this branch ran; the surface must say so");
  assert.ok(skip.output.sha && skip.output.size > 0, "…with the real fingerprint of what was inherited");
  // The defect in one line: a reader holding the STATED contract asks `output.present`. Under fileMeta it
  // was undefined → falsy → "not produced", for the artifact the skip exists because it found.
  assert.notEqual(skip.output.present, undefined, "`present` is never an absent key on this surface");
});

test("AUDIT #175/N2 — a FAILED code-side dispatch declares {present:false} and inputs that carry `read`", async () => {
  const { runSaturationProbeCodeSide } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { paths } = await import(`../stages.mjs?bust=${Math.random()}`);
  const { runDir, ctx } = mkCtx({ entries: [SAT_ENTRY] });
  ctx.paths = paths(ctx.run.studioRoot);
  const r = await runSaturationProbeCodeSide(ctx, async () => ({ ok: false, cause: "provider 502" }));
  assert.equal(r.ok, false);

  const row = surfaceRows(runDir).find((e) => e.event === "stage");
  assert.ok(row && row.ok === false, "the failure journalled a stage row");
  assert.notEqual(row.output, null,
    "null means 'this stage declares NO output' — this stage declares one and did not produce it");
  assert.equal(row.output.present, false, "the honest value: expected, and not on disk");
  assert.equal(row.output.sha, null);
  assert.equal(row.output.size, null, "not 0 — nobody measured a byte count");
  assert.equal(row.output.name, "saturation-probe.md", "what was expected is still named — absence with an address");

  // inputs: an OMITTED `read` is the one thing babysit-output-honesty.test.mjs says must never happen
  assert.ok(row.inputs.length > 0, "the lane declares the frozen plan as its input");
  for (const i of row.inputs) {
    assert.ok("read" in i, `${i.name}: \`read\` is present as a key, never omitted`);
    assert.equal(i.read, null, "pure code, no reads gauge — null is the honest answer, not false");
  }
  // and the explainer trio that makes those nulls self-describing without a join
  assert.equal(row.followup, false);
  assert.equal(row.readsTruncated, null, "no gauge ⇒ nothing to truncate ⇒ no claim");
  assert.equal(row.warm, false, "this lane has no warm concept — false is a fact here, not a default");
});
