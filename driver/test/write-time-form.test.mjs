// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — write-time form rejection: a form defect is repaired INSIDE the dispatch that produced it,
// and never reaches the retry ladder.
//
// THE THREE SHAPES UNDER TEST ARE THE THREE THE 2026-08-02 ROUND ACTUALLY PAID FOR (round analysis §2a,
// verbatim tokens). Each fixture below is a real artifact judged by the REAL parser — never a hand-typed
// reason string, which would only prove that the test agrees with itself:
//   framediff_severity_invalid:major                      — a value outside a closed enum
//   coverage_axis_invalid:all axes (not in: …)            — a string outside a closed vocabulary
//   framediff_directive_undispatchable:KIN*               — a wildcard where a dispatchable term was required
//
// AND THEY ARE TESTED IN PRODUCTION'S SHAPE, WHICH IS NOT THE OBVIOUS ONE. For every framediff_/coverage_
// token, warmPatchMessage aims the repair at a SIBLING (frame-diff.json, register-coverage-ledger.json)
// and tells the model NOT to rewrite the stage's own .md. So the stage's expectFile here is a .md whose
// validator reads the sibling off disk — exactly verify.mjs's checkSiblingJson — and the mock writes the
// defect and its fix into the sibling, leaving the .md untouched by every repair turn. A test that put
// the malformed JSON in the expectFile would collapse that relationship and pass while production's
// repair landed on a file nobody was watching.
//
// Every test runs OFFLINE against the mock engine. No paid call is made anywhere in this file.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "form-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage, isFormClassFail, repairTarget } = await import("../gateway.mjs");
const { parseFrameDiff } = await import("../frame-diff-model.mjs");
const { parseCoverageLedgerJson } = await import("../coverage-ledger.mjs");

// ── the fixtures: real artifacts, in the shapes the round produced ───────────────────────────────────
const frameDiff = (severity, item, layer = "variant") => JSON.stringify({
  schema_version: 1, dominant_element: "VENZA",
  directives: [{ layer, item, observation: "the blind frame missed this near-form", severity }],
  dominant_element_gap: false,
});
const BAD_SEVERITY = frameDiff("major", "VENZAL");        // → framediff_severity_invalid:major
const BAD_WILDCARD = frameDiff("material", "KIN*");       // → framediff_directive_undispatchable:KIN*
const CLEAN_DIFF = frameDiff("material", "VENZAL");
// parseFrameDiff is FAIL-FAST — layer, then severity, then the undispatchable collection — so ONE
// artifact carrying all three surfaces them one at a time. This is the 3-deep chain the cap stops at.
const BAD_LAYER = frameDiff("major", "KIN*", "variants");

const ACTIVE_AXES = ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"];
const ledger = (axis) => JSON.stringify([{ axis, scope: "EUIPO / Cl. 9", status: "confirmed-clean", reason: "no hits" }]);
const BAD_AXIS = ledger("all axes");                      // → coverage_axis_invalid:all axes
const CLEAN_LEDGER = ledger("primary-sweep");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "form-repair-"));
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_WARM_MODE = "form";
  delete process.env.MOCK_FORM_STEPS;
  delete process.env.MOCK_FORM_SIBLING;
  delete process.env.CLEAROTRON_FORM_REPAIR;
  delete process.env.CLEAROTRON_WARM_RETRY;
});

// The two sibling-routed stages, wired the way the pipeline wires them: the stage's out is prose, the
// validator reads its structured sibling off disk (checkSiblingJson's shape), and the mock writes the
// sibling. `sib` is what MOCK_FORM_SIBLING points the repair turn at.
const viaSibling = (name, parse, missingToken) => ({
  out: join(dir, name === "frame-diff.json" ? "frame-diff.md" : "register-findings.md"),
  sib: join(dir, name),
  validate: (p) => {
    let raw;
    try { raw = readFileSync(join(dirname(p), name), "utf8"); } catch { return { ok: false, reason: missingToken }; }
    try { parse(raw); return { ok: true }; } catch (e) { return { ok: false, reason: e.message }; }
  },
});
const frameDiffStage = () => viaSibling("frame-diff.json", parseFrameDiff, "framediff_model_missing");
const ledgerStage = () => viaSibling("register-coverage-ledger.json",
  (c) => parseCoverageLedgerJson(c, { allowedAxes: ACTIVE_AXES }), "coverage_mirror_missing");

const calls = () => readFileSync(process.env.MOCK_CLAUDE_CALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const resumed = (c) => (c.argv ?? c).includes("--resume");
const steps = (...contents) => { process.env.MOCK_FORM_STEPS = JSON.stringify(contents); };
// Arms a sibling-routed stage: the mock writes the prose once and the steps into the sibling.
const arm = (s, ...contents) => {
  process.env.MOCK_OUT_FILE = s.out;
  process.env.MOCK_FORM_SIBLING = s.sib;
  steps(...contents);
  return { expectFile: s.out, validate: s.validate };
};
const stage = (over = {}) => runStage("test-stage", {
  agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-test-base",
  timeoutSec: 30, maxRetries: 2, runDir: dir, ...over,
});
const stageRows = () => readFileSync(driverDir(dir, "test-stage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const spine = () => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ── the routing itself: the file a repair is aimed at is the file the message names ──────────────────

test("repairTarget names the SIBLING for every sibling-routed token, and the expectFile otherwise", () => {
  const md = "/r/prelim-search/x/frame-diff.md";
  assert.equal(repairTarget("invalid_file:x/frame-diff.md:framediff_severity_invalid:major", [md]),
    "/r/prelim-search/x/frame-diff.json", "a framediff_ repair writes frame-diff.json, never the .md");
  const dg = "/r/prelim-search/x/register-findings.md";
  assert.equal(repairTarget("invalid_file:x/register-findings.md:coverage_axis_invalid:all axes", [dg]),
    "/r/prelim-search/x/register-coverage-ledger.json");
  // the one admitted token that is NOT sibling-routed: a prose cell in the digest itself
  assert.equal(repairTarget("invalid_file:x/register-findings.md:coverage_status_offenum:N/A", [dg]), dg);
  assert.equal(repairTarget("missing_file:x/frame-diff.md", [md]), md);
  assert.equal(repairTarget("anything", []), null);
});

// ── shape 1: a value outside a closed enum ───────────────────────────────────────────────────────────

test("OLD BEHAVIOUR — framediff_severity_invalid costs a paid ladder attempt", async () => {
  process.env.CLEAROTRON_FORM_REPAIR = "off";                  // envGateOn honours off/false/no as well as 0
  const r = await stage(arm(frameDiffStage(), BAD_SEVERITY, CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2, "the defect was discovered only by burning a second dispatch");
  assert.match(r.attemptFails[0], /framediff_severity_invalid:major \(not in: dominant-element, material, minor\)/);
  assert.equal(r.formRepairs, 0);
});

test("shape 1 (bad enum) is repaired IN-DISPATCH and never reaches the ladder", async () => {
  const s = frameDiffStage();
  const r = await stage(arm(s, BAD_SEVERITY, CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1, "the ladder was never charged");
  assert.deepEqual(r.attemptFails, [], "no failed dispatch was recorded");
  assert.equal(r.formRepairs, 1);
  const c = calls();
  assert.equal(c.length, 2, "one dispatch + one in-dispatch repair turn");
  assert.equal(resumed(c[0]), false);
  assert.equal(resumed(c[1]), true, "the repair RESUMES the session that wrote the defect");
  assert.match(c[1].prompt, /RESUMING your own session/);
  assert.match(c[1].prompt, /framediff_severity_invalid/, "the repair carries the validator's own reason");
  assert.doesNotMatch(c[1].prompt, /BASE TASK/, "it is a patch turn, not a re-run of the stage");
  assert.match(c[1].prompt, /frame-diff\.json/, "and it aims at the SIBLING");
  assert.equal(readFileSync(s.sib, "utf8"), CLEAN_DIFF);
});

// ── shape 2: a string outside a closed vocabulary ────────────────────────────────────────────────────

test("OLD BEHAVIOUR — coverage_axis_invalid costs a paid ladder attempt", async () => {
  process.env.CLEAROTRON_FORM_REPAIR = "0";
  const r = await stage(arm(ledgerStage(), BAD_AXIS, CLEAN_LEDGER));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.match(r.attemptFails[0], /coverage_axis_invalid:all axes \(not in: saturation-probe, primary-sweep, transliteration-numeric, incumbent-class\)/);
});

test("shape 2 (closed-vocabulary string) is repaired IN-DISPATCH and never reaches the ladder", async () => {
  const s = ledgerStage();
  const r = await stage(arm(s, BAD_AXIS, CLEAN_LEDGER));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.attemptFails, []);
  assert.equal(r.formRepairs, 1);
  assert.equal(calls().length, 2);
  assert.match(calls()[1].prompt, /coverage_axis_invalid/);
  assert.match(calls()[1].prompt, /register-coverage-ledger\.json/);
  assert.equal(readFileSync(s.sib, "utf8"), CLEAN_LEDGER);
});

// ── shape 3: an undispatchable wildcard where a dispatchable term was required ────────────────────────

test("OLD BEHAVIOUR — framediff_directive_undispatchable costs a paid ladder attempt", async () => {
  process.env.CLEAROTRON_FORM_REPAIR = "0";
  const r = await stage(arm(frameDiffStage(), BAD_WILDCARD, CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.match(r.attemptFails[0], /framediff_directive_undispatchable:KIN\*/);
});

test("shape 3 (undispatchable wildcard) is repaired IN-DISPATCH and never reaches the ladder", async () => {
  const r = await stage(arm(frameDiffStage(), BAD_WILDCARD, CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.attemptFails, []);
  assert.equal(r.formRepairs, 1);
  assert.equal(calls().length, 2);
  assert.match(calls()[1].prompt, /framediff_directive_undispatchable/);
});

// ── the non-sibling admitted token: a prose cell in the stage's own output ────────────────────────────

test("coverage_status_offenum repairs the DIGEST ITSELF, not a sibling — and still never reaches the ladder", async () => {
  process.env.MOCK_OUT_FILE = join(dir, "register-findings.md");
  steps("| primary-sweep | EUIPO | N/A |\n", "| primary-sweep | EUIPO | confirmed-clean |\n");
  const validate = (_p, c) => (/confirmed-clean/.test(c) ? { ok: true }
    : { ok: false, reason: "coverage_status_offenum:N/A (axis primary-sweep — the Status cell is EXACTLY one bare token of: confirmed-clean / coverage-limited / deferred; qualifiers move into reason)" });
  const r = await stage({ expectFile: process.env.MOCK_OUT_FILE, validate });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(r.formRepairs, 1);
  assert.equal(basename(stageRows().find((x) => x.repair === 1).repairTarget), "register-findings.md",
    "the repair was aimed at the digest itself — the one admitted token with no sibling route");
});

// ── the observed CHAIN: one artifact, two form defects, surfaced sequentially by a fail-fast parser ───

test("the 08-02 frame-diff chain (severity → undispatchable) is repaired in ONE dispatch", async () => {
  // The round paid for both: attempt 1 hit the severity enum, attempt 2 (warm) fixed it and then failed
  // a DIFFERENT gate, leaving one attempt for everything else. Both are form; both close in-dispatch now.
  const r = await stage(arm(frameDiffStage(), frameDiff("major", "KIN*"), BAD_WILDCARD, CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.attemptFails, []);
  assert.equal(r.formRepairs, 2);
  const c = calls();
  assert.equal(c.length, 3);
  assert.match(c[1].prompt, /framediff_severity_invalid/);
  assert.match(c[2].prompt, /framediff_directive_undispatchable/, "the second repair answers the defect the first one revealed");
  assert.ok(resumed(c[1]) && resumed(c[2]), "both repairs stay in the same session");
});

test("a form chain DEEPER than the cap falls through to the ladder, visibly", async () => {
  // Three ADMITTED defects in one artifact, surfaced one per parse: layer → severity → undispatchable.
  // The cap is 2, so the third is not swallowed — it becomes an ordinary failed dispatch with its own
  // name, exactly as it would today. An absence of budget is a finding, not a pass.
  const r = await stage({ ...arm(frameDiffStage(), BAD_LAYER, frameDiff("major", "KIN*"), BAD_WILDCARD, CLEAN_DIFF), maxRetries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.formRepairs, 2, "the budget stopped at the cap");
  assert.match(r.fail, /framediff_directive_undispatchable:KIN\*/, "the third defect reached the ladder under its own name");
  assert.equal(r.attemptFails.length, 1, "and it was recorded as a failed dispatch");
  assert.equal(isFormClassFail(r.fail), true, "it IS form class — the cap, not the classifier, is what let it through");
});

// ── ZERO SEMANTICS 1: a repair turn that writes nothing has NOT repaired anything ────────────────────

test("a repair turn that writes NOTHING is not read as a fix — the original defect reaches the ladder", async () => {
  // Issue 's shape: the repair turn ends clean and writes nothing at all. Re-judging the same bytes
  // must not be allowed to say "repaired", and the harness's silence must not be reported as the model's
  // answer. The ORIGINAL token is what the ladder gets.
  process.env.MOCK_WARM_MODE = "form_noop";
  const s = frameDiffStage();
  const r = await stage({ ...arm(s, BAD_SEVERITY), maxRetries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.formRepairs, 1);
  assert.match(r.fail, /framediff_severity_invalid:major/, "the ORIGINAL defect, unchanged");
  assert.equal(readFileSync(s.sib, "utf8"), BAD_SEVERITY,
    "the target file is byte-identical — nothing was written, so nothing was repaired");
  const repairRow = stageRows().find((r2) => r2.repair === 1);
  assert.equal(repairRow.repairOutcome, "no-write");
  assert.equal(repairRow.repairLanded, false);
  assert.equal(basename(repairRow.repairTarget), "frame-diff.json");
  assert.equal(calls().length, 2, "and no SECOND repair is bought once a repair turn writes nothing");
});

test("a repair turn that rewrites the SAME defect byte-for-byte stops the repair loop", async () => {
  const r = await stage({ ...arm(frameDiffStage(), BAD_SEVERITY, BAD_SEVERITY, CLEAN_DIFF), maxRetries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.formRepairs, 1, "one repair reproduced its own failure — a second cannot converge");
  assert.match(r.fail, /framediff_severity_invalid:major/);
  assert.equal(stageRows().find((x) => x.repair === 1).repairOutcome, "unchanged");
});

// ── ZERO SEMANTICS 2: a KILLED repair turn's bytes are never stage truth ─────────────────────────────

test("a repair turn that is KILLED after writing is refused, even though the bytes now validate", async () => {
  // The strongest form of the rule. The mock writes a PERFECTLY VALID artifact and then dies at 137. A
  // shape validator would pass it; a killed turn's write may be torn and nothing here can prove it whole
  // (the exit-1 rescue's doctrine, gateway.mjs). So it is not re-judged, and the original defect stands.
  process.env.MOCK_WARM_MODE = "form_kill";
  const s = frameDiffStage();
  const r = await stage({ ...arm(s, BAD_SEVERITY, CLEAN_DIFF), maxRetries: 0 });
  assert.equal(r.ok, false);
  assert.match(r.fail, /framediff_severity_invalid:major/, "the ORIGINAL defect, not the killed turn's answer");
  assert.equal(readFileSync(s.sib, "utf8"), CLEAN_DIFF, "…even though the bytes on disk would now pass");
  const repairRow = stageRows().find((x) => x.repair === 1);
  assert.equal(repairRow.repairOutcome, "killed");
  assert.equal(repairRow.repairLanded, false);
});

// ── ZERO SEMANTICS 3: an unrecognised shape reaches the ladder, visibly ──────────────────────────────

test("a form failure this check does not recognise is never swallowed — it reaches the ladder", async () => {
  // framediff_unparseable is deliberately OUT of the allowlist (a file that will not parse is usually
  // truncated — capacity, not vocabulary). It must behave exactly as it does today.
  const r = await stage(arm(frameDiffStage(), "{ not json at all", CLEAN_DIFF));
  assert.equal(r.ok, true);
  assert.equal(r.formRepairs, 0, "no in-dispatch repair was attempted");
  assert.equal(r.attempts, 2, "it cost a ladder attempt, visibly, as an unclassified failure must");
  assert.match(r.attemptFails[0], /framediff_unparseable/);
});

test("a WORK-class failure behaves exactly as before — the warm attempt is still there for it", async () => {
  // the connotation tokens are work class and warm-eligible by an explicit 2026-08-01 ruling. A
  // form fix must not consume the warm attempt it is entitled to, so formRepairsUsed is tracked apart
  // from warmUsed. Attempt 2 must still be a WARM resume.
  process.env.MOCK_WARM_MODE = "draft";
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  const validate = (_p, c) => (/PATCHED/.test(c) ? { ok: true } : { ok: false, reason: "connotation_no_ruling:no_ruling=2;Q-ABCDEFGH [a gang]" });
  const r = await stage({ validate, expectFile: process.env.MOCK_OUT_FILE });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2, "the ladder ran, as it does today");
  assert.equal(r.formRepairs, 0, "a work failure never enters the in-dispatch repair");
  assert.equal(resumed(calls()[1]), true, "attempt 2 is still the WARM patch");
});

// ── the census: a repair row must not read as a form-class dispatch retry ────────────────────────────

test("a repair is journalled as a repair, never as an attempt", async () => {
  await stage({ ...arm(frameDiffStage(), BAD_SEVERITY, CLEAN_DIFF), model: "haiku" });
  const rows = stageRows();
  assert.equal(rows.length, 2);
  const repair = rows[0], settled = rows[1];
  assert.equal(repair.repair, 1, "the repair row is written first, so the attempt row stays the last line");
  assert.equal(repair.repairOutcome, "repaired");
  assert.equal(repair.repairLanded, true);
  assert.equal(basename(repair.repairTarget), "frame-diff.json");
  assert.match(repair.fail, /framediff_severity_invalid/, "it names the defect it was dispatched to fix");
  // run-economics.mjs and tokens.mjs both select dispatch rows with `typeof rec.model === "string"` and
  // sum `usage` — so the repair turn's spend is counted as its own dispatch, never hidden inside the
  // attempt it belongs to. A cheaper turn is the point; an uncounted one would be a lie.
  assert.equal(typeof repair.model, "string", "the repair row is a dispatch row to run-economics and tokens.mjs");
  assert.ok(repair.usage && Number.isFinite(repair.usage.output), "and it carries the turn's own token usage");
  assert.ok(repair.modelUsed, "with the engine-resolved model id, like every other dispatch row");

  assert.equal(settled.repair, undefined, "the settled attempt row is not a repair row");
  assert.equal(settled.fail, null, "the attempt succeeded — no form-class retry exists to census");
  assert.equal(settled.formRepairs, 1, "and it says how many repairs it bought");

  // run.jsonl: the spine carries the repair under its OWN event, so a census counting `attempt` events
  // with a fail sees zero form-class retries.
  const evs = spine();
  assert.equal(evs.filter((e) => e.event === "attempt" && e.fail).length, 0);
  const fr = evs.find((e) => e.event === "form-repair");
  assert.equal(fr.outcome, "repaired");
  assert.equal(fr.of, 2);
  assert.match(fr.fail, /framediff_severity_invalid/);
});

// ── the allowlist itself ─────────────────────────────────────────────────────────────────────────────

test("isFormClassFail admits the three observed tokens and refuses the work-class ones", () => {
  for (const r of [
    "framediff_severity_invalid:major (not in: dominant-element, material, minor)",
    "coverage_axis_invalid:all axes (not in: saturation-probe, primary-sweep)",
    "framediff_directive_undispatchable:KIN* — 1 FIRING directive(s)",
    "framediff_layer_invalid:variants (not in: variant, field, source)",
    "coverage_status_invalid:complete (EXACTLY one bare token of: …)",
    "coverage_status_offenum:N/A (axis primary-sweep …)",
    "coverage_key_unknown:notes (keys are EXACTLY: axis, scope, status, reason …)",
  ]) assert.equal(isFormClassFail(`invalid_file:run/frame-diff.md:${r}`), true, r);

  for (const r of [
    "connotation_undisposed:VENZ gang,VENZI urban dictionary",
    "finding_manageable_on_unmanageable:7",
    "coverage_axis_missing:incumbent-class",
    "coverage_ledger_unparseable: Unexpected end of JSON input",
    "framediff_unparseable: Unexpected token",
    "blindframe_direction_invalid:sideways",
    "use_check_missing:F1",
  ]) assert.equal(isFormClassFail(`invalid_file:run/frame-diff.md:${r}`), false, r);

  assert.equal(isFormClassFail("missing_file:run/frame-diff.md"), false, "an absent file is not a form defect");
  assert.equal(isFormClassFail("timeout"), false);
  assert.equal(isFormClassFail(null), false);
  assert.equal(isFormClassFail("max_tokens_no_output:invalid_file:run/frame-diff.md:framediff_severity_invalid:major"), false,
    "an output-ceiling fault keeps its own named policy");
});

test("CLEAROTRON_FORM_REPAIR honours 0 / off / false / no, and nothing else disables it", async () => {
  for (const off of ["0", "off", "false", "no"]) {
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "form-repair-"));
    process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
    process.env.MOCK_COUNT_FILE = join(dir, "count");
    process.env.CLEAROTRON_FORM_REPAIR = off;
    const r = await stage(arm(frameDiffStage(), BAD_WILDCARD, CLEAN_DIFF));
    assert.equal(r.formRepairs, 0, `CLEAROTRON_FORM_REPAIR=${off} must disable the repair`);
    assert.equal(r.attempts, 2);
    assert.equal(spine().some((e) => e.event === "form-repair"), false);
  }
});
