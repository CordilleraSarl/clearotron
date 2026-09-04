// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the A/B tooling must RUN WHAT IT LOGS. One section per corruption the audit named.
//
// The bar the issue sets, verbatim: "Per item, a test that reproduces the old corruption and shows it
// now impossible or refused. Reject fixes that only patch the logging — the requirement is that the run
// matches the log, not that the log matches the run." So every test here drives the real code path and
// asserts on BEHAVIOUR (a refusal, a dispatched prompt, a failed turn), never on a log line alone.
//
//   1. A shadow run's dir can be missing files its own prompt NAMES.   — closed by; verified here
//      against the PROMPT rather than the manifest, which is the one angle 's own tests do not take.
//   2. The shadow run is built with a different prompt than the run it is compared against.
//   3. `--model gemini` logs gemini and runs sonnet.
//   4. `off` maps to `low` on one engine and `minimal` on the other; the haiku+adaptive guard passes on
//      the pairing it was written for.
//
// Fully offline ($0): the mock `claude` binary and the mock pipeline, same harness uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "prelim-ab-honesty-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_RECALL_PROBES ||= "0";

const PL = await import("../pipeline.mjs");
const ST = await import("../stages.mjs");
const SC = await import("../stage-context.mjs");
const GW = await import("../gateway.mjs");
const CFG = await import("../driver.config.mjs");

const jobFor = (ref) => ({ id: `job-${ref}`, msgId: `<${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: `MARK ${ref}`, classes: [9, 41], provider: "corsearch" });
const codenameOf = (runDir) => basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");

// The shared canonical run: one real mock pipeline parked at synthesis, so its run dir stays LIVE and
// carries every artefact an arm needs (the same shape experiment-context.test.mjs uses, and the state an
// operator is actually in when they reach for --experiment).
let CANON = null;
async function canonicalRun() {
  if (CANON) return CANON;
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FAIL_STAGE = "joint synthesis narrative";
  const job = jobFor("TMPABHON1");
  const res = await PL.pipeline(job);
  assert.equal(res.ok, false, "the canonical mock run parks at synthesis so its run dir stays live");
  assert.equal(res.failedStage, "synthesis");
  delete process.env.MOCK_FAIL_STAGE;
  CANON = { job, runDir: res.runDir, codename: codenameOf(res.runDir) };
  return CANON;
}

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { for (const s of [k]) saved[s] = process.env[s]; if (v == null) delete process.env[k]; else pinEnv(process.env, k, v); }
  try { return await fn(); }
  finally { for (const [k] of Object.entries(vars)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
};

// ═════ CORRUPTION 1 — CLOSED BY. Verified, not re-fixed. ════════════════════════════════════════
//
// replaced the sandbox's `if (!existsSync(src)) continue` with `sandboxGaps`: the canonical run is
// the arbiter, and an artefact it holds that the sandbox lost REFUSES the dispatch by name.
// experiment-context.test.mjs already drives that from the manifest side.
//
// This test comes at it from the corruption's own wording — "missing files its own PROMPT names" — and
// therefore from the side neither 's tests nor `sandboxGaps` reason about: it takes the message the
// stage would actually be sent, extracts every absolute run-dir path IN IT, and requires each one to be
// on disk in the sandbox. If a prompt could still name a path the manifest does not carry, this fails
// and the residual gap is a finding rather than a silent thinner context.

test("#238 corruption 1 (closed by #236): every run-dir path the SHADOW PROMPT names is on disk in the sandbox", async () => {
  const { job, runDir, codename } = await canonicalRun();
  // Two stages with fat, path-dense prompts and different context shapes: a register funnel that reads
  // driver-computed blocks, and a grid half whose spec sidecar is derived rather than declared.
  for (const [stage, opts] of [["register-digest", {}], ["common-law-half", { axis: "b" }]]) {
    const ex = await PL.runExperiment(job, { codename, experiment: stage, label: "prompt paths", ...opts });
    assert.ok(ex.shadowDir, `${stage}: no shadow dir`);
    const ctx = PL.reconstructCtx(job, { codename });
    const shadowCtx = { ...ctx, paths: ST.paths(ex.shadowDir), axis: opts.axis ?? null };
    const message = ST.STAGES[stage].message(shadowCtx);
    // Every absolute path under the SANDBOX that the prompt names, de-duplicated. Output paths are
    // excluded — a stage is told where to WRITE, and that file does not exist before it runs.
    const outs = new Set(ST.stageOutputs(stage, shadowCtx.paths, { axes: ctx.axes, axis: opts.axis ?? null }).filter(Boolean));
    const named = [...new Set((message.match(new RegExp(`${ex.shadowDir}/[A-Za-z0-9._/:-]+`, "g")) ?? [])
      .map((p) => p.replace(/[.,;:)]+$/, "")))].filter((p) => !outs.has(p));
    assert.ok(named.length > 0, `${stage}: the prompt names no run-dir path at all — the extraction is not testing anything`);
    const missing = named.filter((p) => !existsSync(p));
    assert.deepEqual(missing, [],
      `${stage}: the shadow prompt NAMES ${missing.length} path(s) that are not in the sandbox — the corruption-1 shape. sandboxGaps did not catch them, which makes this a residual gap, not a #236 regression: ${missing.map((p) => p.slice(ex.shadowDir.length + 1)).join(", ")}`);
    console.log(`      ${stage}: ${named.length} prompt-named paths, all present in the sandbox`);
  }
});

// ═════ CORRUPTION 2 — the shadow prompt is composed by the same code as the run's ════════════════════

test("#238 corruption 2: narrative-refutation's driver-computed blocks are REGISTERED, so the arm carries them", async () => {
  const { job, codename, runDir } = await canonicalRun();
  const ctx = PL.reconstructCtx(job, { codename });
  const P = ST.paths(runDir);

  // The corruption, stated as a fact about the tables: `refute()` composed two blocks inline, and
  // DISPATCH_EXTRAS declared NEITHER — so `sandboxManifest("narrative-refutation")` had no driver-side
  // edge at all and the arm's `extra` was undefined while every canonical dispatch carried both.
  const declared = SC.DISPATCH_EXTRAS.filter((x) => x.stage === "narrative-refutation").map((x) => x.id).sort();
  assert.deepEqual(declared, ["plan-audit", "refute-registry-check"],
    "both blocks refute() composes must be declared — an undeclared one is invisible to the sandbox by construction");

  // Each declaration states its own read set, and every path it names reaches the sandbox manifest.
  // (Several of these were already in the manifest for OTHER reasons — plan-execution as a validator
  // sidecar, _records via the band tool group — which is exactly why the missing declaration went
  // unnoticed: the sandbox had the BYTES and the arm still ran without the BLOCKS.)
  const manifest = SC.sandboxManifest("narrative-refutation", P, { axes: ctx.axes });
  const paths = new Set(manifest.map((e) => e.path));
  const reads = SC.DISPATCH_EXTRAS.filter((x) => x.stage === "narrative-refutation")
    .flatMap((x) => x.reads(P, { axes: ctx.axes }).map((r) => ({ id: x.id, ...r })));
  for (const r of reads) {
    assert.ok(r.why && r.why.length > 10, `${r.id}: every declared read must say WHY it is context`);
    assert.ok(paths.has(r.path), `${r.id} declares it reads ${r.path}, and the sandbox manifest does not carry it`);
  }
  const declaredPaths = new Set(reads.map((r) => r.path));
  assert.ok(declaredPaths.has(P.planExecution), "the plan-execution receipt the audit block is derived FROM");
  assert.ok(declaredPaths.has(P.registerPlan), "…the frozen plan, without which planAuditExtra returns an empty string and the block silently vanishes");
  assert.ok(declaredPaths.has(P.narrative), "…the narrative the registry check runs OVER");
  assert.ok([...declaredPaths].some((p) => p.endsWith("/_records")), "…and the fetched records each claimed field is checked against");

  // The behaviour, not the table: ONE composer builds the production prompt and the arm's, so a block
  // cannot exist on one path and not the other.
  const built = PL.composeDispatchExtra("narrative-refutation", ctx);
  assert.ok(built.ids.some((x) => x.id === "plan-audit"), "the plan-execution audit block is built for this run");
  assert.ok(built.text.includes("PLAN-EXECUTION CHECK"), "…and its text is the block the reviewer is required to answer");
});

test("#238 corruption 2: an --experiment narrative-refutation arm dispatches WITH the plan-audit block", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const log = join(ROOT, "refute-arm-calls.jsonl");
  rmSync(log, { force: true });
  const ex = await withEnv({ MOCK_CLAUDE_CALL_LOG: log }, () =>
    PL.runExperiment(job, { codename, experiment: "narrative-refutation", label: "prompt parity" }));
  assert.ok(ex.shadowDir, "the arm ran");
  const prompts = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt);
  assert.ok(prompts.length, "the arm dispatched at least one turn");
  const armPrompt = prompts[prompts.length - 1];
  // THE REPRODUCTION: before this change the arm's `extra` was undefined, so this string — which every
  // canonical narrative-refutation dispatch carries — was absent from the shadow prompt and the A/B diff
  // measured its absence rather than the variable under test.
  assert.match(armPrompt, /PLAN-EXECUTION CHECK/,
    "the arm's prompt must carry the driver-computed plan-execution audit the production dispatch carries — without it the diff measures prompt drift");
  // …and the receipt NAMES which blocks it carried, so the composition is on the record rather than
  // inferred. `extraChars: 0` alone could never distinguish "this stage has no blocks" from "its blocks
  // vanished".
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.ok(Array.isArray(receipt.extras), "the context receipt records the dispatch extras it built");
  assert.ok(receipt.extras.some((x) => x.id === "plan-audit" && x.chars > 0), `the receipt names the plan-audit block and its size: ${JSON.stringify(receipt.extras)}`);
});

test("#238 corruption 2 drift guard: no production dispatch may pass an `extra` for an UNDECLARED stage", () => {
  // The import-time guard in pipeline.mjs walks declared → buildable. That direction structurally cannot
  // catch this corruption, which is the other one: a dispatch site that composes a block the registry
  // never heard of. Walking the source is how the codebase already guards verify.mjs's sidecars
  // (experiment-context.test.mjs " drift guard"), for the same reason — the call sites are the fact.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  // `stage("<name>", …` / `await stage("<name>", …` call sites whose options object carries `extra:`.
  const sites = [];
  const re = /\bstage\(\s*"([a-z-]+)"\s*,/g;
  for (let m; (m = re.exec(src));) {
    const tail = src.slice(m.index, m.index + 1400);
    // the options object of THIS call — up to the next `await stage(`/`stage(` so a later site's
    // `extra:` can never be attributed here.
    const nextCall = tail.slice(1).search(/\bstage\(\s*"/);
    const scope = nextCall >= 0 ? tail.slice(0, nextCall + 1) : tail;
    if (/\bextra:/.test(scope)) sites.push({ stage: m[1], at: src.slice(0, m.index).split("\n").length });
  }
  assert.ok(sites.length >= 3, `the scan found only ${sites.length} extra-carrying dispatch sites — it has stopped matching the code`);

  // Stages whose extras are TRIGGER-SCOPED repairs, not part of the stage's ordinary prompt. Each is a
  // correction handed to one re-dispatch after a deterministic check failed on the previous output; an
  // --experiment arm reproduces the FRESH pass (or a named --dispatch-trigger), never a repair of an
  // output that no longer exists. Listed with the reason rather than filtered silently.
  const REPAIR_ONLY = {
    "report-card": "lint-repair: the failing pre-delivery checks for ONE card's previous rendering — there is no previous rendering in a sandbox",
    "narrative-refutation": "degenerate-reask: the one forced re-ask after a BLOCKING with zero cited defects (its ordinary blocks ARE declared)",
  };
  const undeclared = sites
    .filter((s) => !SC.DISPATCH_EXTRAS.some((x) => x.stage === s.stage))
    .filter((s) => !(s.stage in REPAIR_ONLY));
  assert.deepEqual(undeclared, [],
    `these dispatch sites hand a stage a driver-computed block that DISPATCH_EXTRAS does not declare, so an --experiment arm on that stage runs a shorter prompt than the run it is compared against (#238 corruption 2). Declare the block with its read set, or add it to REPAIR_ONLY with the reason: ${JSON.stringify(undeclared)}`);
});

// ═════ CORRUPTION 3 — the run must match the log about WHICH MODEL RAN ═══════════════════════════════

test("#238 corruption 3: modelFamily is three-valued — an unknown id is UNKNOWN, never a guess", () => {
  assert.equal(CFG.modelFamily("haiku"), "haiku");
  assert.equal(CFG.modelFamily("claude-haiku-4-5-20251001"), "haiku", "a dated wire id is the same family as the alias that asked for it");
  assert.equal(CFG.modelFamily("anthropic/claude-sonnet-4-6"), "sonnet");
  assert.equal(CFG.modelFamily("claude-opus-5"), "opus");
  // — gpt ids are PLACEABLE now, and this assertion is the reversal of the one that stood here.
  // It read `modelFamily("gpt-5.6-sol") === null`, on the rationale that a model this build cannot place
  // must be unknown. That rationale lapsed when the codex adapter learned to read the served id out of
  // codex's session rollout: before, the only id on that path was the one we asked for and placing it
  // would have compared a request against itself; now there are two independently-sourced ids and a null
  // here would keep the substitution guard inert on that engine forever.
  assert.equal(CFG.modelFamily("gpt-5.6-sol"), "gpt-5.6-sol", "the id IS the family on the openai side — codex returns what it was given");
  assert.equal(CFG.modelFamily("openai/gpt-5.4"), "gpt-5.4", "the provider prefix is normalised away, as it is for anthropic ids");
  assert.equal(CFG.modelFamily("o3"), "o3");
  assert.equal(CFG.modelFamily("gpt-5.6-sol-20260811"), "gpt-5.6-sol", "a dated wire id is the same family as the undated one that asked for it");
  assert.notEqual(CFG.modelFamily("gpt-5.6-sol"), CFG.modelFamily("gpt-5.6-mini"),
    "and the coarseness stops short of collapsing tiers — a full-to-mini substitution must not read as agreement");

  // The three-valued contract is UNCHANGED for everything this build still cannot place. No fallback,
  // and a null makes the comparison unknown rather than agreeing.
  assert.equal(CFG.modelFamily("google/gemini-3.1-pro-preview"), null);
  assert.equal(CFG.modelFamily("fable"), null, "fable's wire id is unprobed — unknown, so it can never manufacture a mismatch");
  assert.equal(CFG.modelFamily(null), null);
});

// The runStage harness: one stage turn against the mock claude, returning the journalled attempt rows.
async function oneTurn({ model, wire, env = {} } = {}) {
  const runDir = mkdtempSync(join(ROOT, "wire-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "out.md");
  const r = await withEnv({ MOCK_CLAUDE_WIRE_MODEL: wire ?? null, MOCK_CLAUDE_FILE: "ok\n", ...env }, () =>
    GW.runStage("wire-stage", {
      agent: "clawdi", message: `Write your output to the ABSOLUTE path: ${out}`, model,
      sessionKey: "prelim-wire-test", timeoutSec: 30, expectFile: out, runDir,
      // A REAL retry budget, overriding this file's CLEAROTRON_MAX_RETRIES=0: the ladder break is the
      // thing under test in the mismatch case, and with no budget "it did not retry" would be
      // trivially true and would prove nothing.
      maxRetries: 2,
    }));
  const rows = readFileSync(driverDir(runDir, "wire-stage.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  return { r, rows, runDir };
}

test("#238 corruption 3: a turn that runs a DIFFERENT model than it was told to FAILS — no substitution", async () => {
  // THE REPRODUCTION. The mock reports sonnet on the wire while the driver asked for haiku — the exact
  // shape `--model gemini` had (claudeModel mapped it to sonnet, the row logged the gemini catalog id,
  // and the turn succeeded). Before this change the run finished and every number it produced was
  // attributed to a model that never served it.
  const { r, rows } = await oneTurn({ model: "haiku", wire: "claude-sonnet-5" });
  assert.equal(r.ok, false, "a turn served by the wrong model must not be accepted");
  assert.match(r.fail, /^model_mismatch:haiku->sonnet$/, `the failure NAMES both sides: ${r.fail}`);
  const row = rows[rows.length - 1];
  assert.equal(row.modelUsed, "anthropic/claude-haiku-4-5", "modelUsed keeps its meaning: the requested resolution (run-economics.mjs and tokens.mjs read it)");
  assert.equal(row.modelActual, "claude-sonnet-5", "…and modelActual is the WIRE's answer, beside it");
  assert.equal(row.modelBasis, "actual");
  assert.equal(row.modelMismatch, true);
  // Deterministic: retrying re-buys the same wrong model, so the ladder must stop rather than pay for
  // it three times. The turn ran with maxRetries:2 — without the break this would be 3.
  assert.equal(rows.length, 1, `a mismatch must break the ladder on the first attempt, not retry it (${rows.length} attempts)`);
});

test("#238 corruption 3, THE HEADLINE: `--experiment --model gemini` refuses instead of running sonnet", async () => {
  // The sentence the issue is named after. `claudeModel` mapped gemini → sonnet and the telemetry
  // stamped `resolveModel("gemini")` = google/gemini-3.1-pro-preview, so the arm ran, produced numbers,
  // and every one of them named a model that had not served a single token. Driven through
  // runExperiment — the surface an operator actually uses — because that is where the refusal has to
  // land: a config error that parks as an unclassified failure is not "an error, not a substitution".
  const { job, codename } = await canonicalRun();
  for (const dead of ["gemini", "deepseek-v4-pro"]) {
    await assert.rejects(
      () => PL.runExperiment(job, { codename, experiment: "register-digest", model: dead, label: "substitution" }),
      /no claude model mapped/,
      `--model ${dead} must refuse by name at the CLI, not substitute an anthropic model and report the alias`);
  }
});

test("#238 corruption 3: an honoured request records modelBasis 'actual' and is NOT failed", async () => {
  const { r, rows } = await oneTurn({ model: "haiku" });   // the mock echoes what --model asked for
  assert.equal(r.ok, true, `a matching turn must pass: ${r.fail}`);
  const row = rows[rows.length - 1];
  assert.equal(row.modelActual, "claude-haiku-4-5-20251001", "the wire's dated id, verbatim — not normalised away");
  assert.equal(row.modelBasis, "actual", "#240's cost reconstruction can key on this per record");
  assert.equal(row.modelMismatch, false, "false, not absent: 'checked and agreed' is a different fact from 'not checked'");
});

test("#238 corruption 3 zero semantics: a wire that reports NO model records `unknown`, never the alias", async () => {
  // An engine that does not emit a model (codex) and a turn killed before any event both land here. The
  // record must say unknown. It must NOT quietly restate the requested alias and call it actual — that
  // is the absence-read-as-a-pass shape, and it would make `modelBasis: "actual"` meaningless.
  const silent = { name: "silent-engine",
    async runTurn() { return { code: 0, killed: false, wall: 0.1, stdout: "", stderr: "", laneWaitMs: 0,
      json: { status: "ok", result: { payloads: [{ text: "ok" }] } }, usage: null, sessionRef: null }; } };
  GW.registerEngine(silent);
  const runDir = mkdtempSync(join(ROOT, "wire-silent-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "out.md");
  writeFileSync(out, "ok\n");
  const r = await withEnv({ CLEAROTRON_AI: "silent-engine" }, () =>
    GW.runStage("silent-stage", { agent: "clawdi", message: "go", model: "haiku",
      sessionKey: "prelim-silent", timeoutSec: 30, expectFile: out, runDir }));
  assert.equal(r.ok, true, "an engine that cannot report a model must not have its turns failed for it");
  const row = JSON.parse(readFileSync(driverDir(runDir, "silent-stage.jsonl"), "utf8").trim().split("\n").pop());
  assert.equal(row.modelActual, null, "no wire answer ⇒ null, NEVER the requested alias wearing the word actual");
  assert.equal(row.modelBasis, "unknown", "two states, never one");
  assert.equal(row.modelMismatch, null, "an unknown comparison is null — it is not a match");
  assert.equal(row.modelUsed, "anthropic/claude-haiku-4-5", "the requested resolution is still recorded, honestly labelled");
});

test("#238 corruption 3: the refusal is a default-ON gate; disarming it silences the REFUSAL, never the record", async () => {
  // envGateOn, not `!== "0"`: `CLEAROTRON_MODEL_WIRE_CHECK=off` must DISARM the check, not arm it.
  for (const off of ["0", "off", "false", "no"]) {
    const { r, rows } = await oneTurn({ model: "haiku", wire: "claude-sonnet-5", env: { CLEAROTRON_MODEL_WIRE_CHECK: off } });
    assert.equal(r.ok, true, `CLEAROTRON_MODEL_WIRE_CHECK=${off} must disarm the refusal (envGateOn semantics), got ${r.fail}`);
    const row = rows[rows.length - 1];
    assert.equal(row.modelMismatch, true, `…and the mismatch is STILL on the record with the gate off (${off}) — disarming a refusal must never erase the observation`);
    assert.equal(row.modelActual, "claude-sonnet-5");
  }
});

test("#238 corruption 3: the run.jsonl spine and the per-stage log agree about what ran", async () => {
  const { runDir } = await oneTurn({ model: "haiku" });
  const spine = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n")
    .map((l) => JSON.parse(l)).filter((e) => e.event === "attempt");
  assert.ok(spine.length, "the spine carries the attempt row");
  const stageRow = JSON.parse(readFileSync(driverDir(runDir, "wire-stage.jsonl"), "utf8").trim().split("\n").pop());
  assert.equal(spine[spine.length - 1].modelActual, stageRow.modelActual,
    "the two journals must not disagree about the served model — a reader that joins them would have to pick a winner");
  assert.equal(spine[spine.length - 1].modelBasis, stageRow.modelBasis);
});

// ═════ CORRUPTION 4 — `off` means one thing, and the tier guard sees the tier that DISPATCHES ════════
//
// (The cross-engine `off` table is pinned in engine.anthropic.test.mjs, beside the tables themselves.)

test("#238 corruption 4b: assertTierSanity SEES a runtime thinking override — it used to read the static table", async () => {
  // The pairing the guard was written for: Haiku 4.5 rejects adaptive thinking and BOUNCES TO SONNET, so
  // an effort arm on a haiku-tier stage silently measures sonnet. `saturation-probe` is haiku/off.
  assert.deepEqual(ST.axisTier("saturation-probe"), { model: "haiku", thinking: "off" });
  assert.equal(ST.assertTierSanity(), true, "the static table is clean, and always was — that is why the guard looked green");
  // THE REPRODUCTION: the override never touches the stage definition, so the old guard — which read
  // `s.thinking` — passed while the run dispatched haiku+adaptive.
  await withEnv({ CLEAROTRON_STAGE_THINKING: "register-unit=adaptive" }, () => {
    assert.throws(() => ST.assertTierSanity(), /haiku\+adaptive forbidden/,
      "CLEAROTRON_STAGE_THINKING pinning the haiku saturation-probe to adaptive must be refused at run start, before anything is spent");
  });
  assert.equal(ST.assertTierSanity(), true, "…and the guard is clean again once the override is gone");
});

test("#238 corruption 4b: the guard also fires at DISPATCH, where a --model override assembles the pairing", () => {
  // The second way in, which no start-of-run scan can see: the operator supplies the model and the
  // thinking tier still comes from the axis. `--experiment register-unit --axis primary-sweep --model
  // haiku` is haiku + adaptive, assembled at the dispatch site out of two sources that are each fine.
  assert.deepEqual(ST.axisTier("primary-sweep"), { model: "sonnet", thinking: "adaptive" });
  assert.throws(() => ST.assertEffectiveTier("register-unit:primary-sweep", { model: "haiku", thinking: "adaptive" }),
    /haiku\+adaptive forbidden/, "the effective pair this dispatch is about to send must be refused");
  assert.match(
    (() => { try { ST.assertEffectiveTier("register-unit:primary-sweep", { model: "haiku", thinking: "adaptive" }); } catch (e) { return e.message; } })(),
    /BOUNCES TO SONNET/, "the refusal says WHY, so the operator does not have to find out by reading a manifest that lies");
  // Everything else still dispatches.
  assert.equal(ST.assertEffectiveTier("register-unit:primary-sweep", { model: "sonnet", thinking: "adaptive" }), true);
  assert.equal(ST.assertEffectiveTier("register-unit:saturation-probe", { model: "haiku", thinking: "off" }), true);
  assert.equal(ST.assertEffectiveTier("synthesis", { model: "opus", thinking: "high" }), true);
});

test("#238 corruption 4b end-to-end: --experiment --model haiku over an adaptive axis REFUSES", async () => {
  const { job, codename } = await canonicalRun();
  await assert.rejects(
    () => PL.runExperiment(job, { codename, experiment: "register-unit", axis: "primary-sweep", model: "haiku", label: "bounce" }),
    /haiku\+adaptive forbidden/,
    "the arm that would have measured a sonnet bounce and labelled it haiku must not dispatch at all");
});

test("#238 corruption 4a: `off` reaches the CLI as one effort on the live engine", async () => {
  // Behaviour, not the table: the argv `claude` is actually invoked with. `off` and `low` are the same
  // rung on this engine, which is the fact the codex table now matches.
  const { buildClaudeArgs } = await import("../engine/anthropic-agent.mjs");
  const effortOf = (thinking) => { const { args } = buildClaudeArgs({ message: "m", model: "haiku", thinking }); return args[args.indexOf("--effort") + 1]; };
  assert.equal(effortOf("off"), "low");
  assert.equal(effortOf("low"), "low");
  const { buildCodexArgs } = await import("../engine/openai-agent.mjs");
  const codexEffort = (thinking) => {
    const { args } = buildCodexArgs({ model: "haiku", thinking });
    return (args[args.indexOf("-c") + 1] ?? "").split("=")[1];
  };
  assert.equal(codexEffort("off"), "low", "codex used to send `minimal` here — a rung the anthropic engine has no way to express");
  assert.equal(codexEffort("low"), "low");
});

process.on("exit", () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });
