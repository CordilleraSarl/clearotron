// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives whole runs end to end — resume, --from, --experiment, telemetry
// WS1a (dispatch cost-neutrality), WS1b (resume / --from / --experiment), WS-T (telemetry + compare)
// — offline, against the mock engine (no billable calls). One shared workspace root + frozen config
// (driver.config reads env at import); each test uses a unique ref → isolated run-dirs.
// WS1c (failover transparency) is GONE with the model-failover chain — it hand-wrote front-matter
// production could not produce, and nothing writes or renders a failover note now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const ROOT = mkdtempSync(join(tmpdir(), "prelim-op-"));
process.env.CLEAROTRON_AI = "anthropic-agent";   // stage compute on claude -p (mocked)
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";   // terminal semantics under test — auto-recovery exercised in pipeline.mock
process.env.CLEAROTRON_AGENT = "clawdi";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// recall probes (P2-A): OFF in this legacy harness — a run that fails at/after verdict now writes the
// recall store, so its RESUME mints recall-probe plan entries and legitimately re-does digest+synthesis
// work (the band grew). That is the product behaviour under test elsewhere; HERE the subjects are the
// resume mechanics themselves (skip telemetry, --from seams, corrective model resumption), which need
// the resume to be minimal. The dedicated recall tests exercise the probes with the store populated.
process.env.CLEAROTRON_RECALL_PROBES ||= "0";

const PL = await import("../pipeline.mjs");
const CMP = await import("../compare.mjs");
const { composeEmailHtml } = await import("../publish/index.mjs");

const KNOBS = ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SOFT_FAIL_STAGE", "MOCK_SOFT_FAIL_STATUS", "MOCK_ESCALATION_NOOP", "MOCK_PLACEMENT_NO_SIBLING"];
function setKnobs(env = {}) { for (const k of KNOBS) delete process.env[k]; for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v); }
const jobFor = (ref) => ({ id: `job-${ref}`, msgId: `<${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com", ref, markName: `MARK ${ref}`, classes: [9, 41], provider: "corsearch" });
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sinceLastStart = (ev) => { let i = ev.map((e) => e.event).lastIndexOf("start"); return ev.slice(i); };
const codenameOf = (runDir) => basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");

// ---- WS1a — dispatch cost-neutrality on a clean run -------------------------------------------------
// Resilience on both shipped engines is same-model retry + lane-wedge re-dispatch + rate-limit postpone
// (covered by warm-retry / lane-wedge / rate-limit-postpone). The model-failover chain that used to sit
// under them is deleted — it never had a second rung on any shipped build.
//
// This test's name always claimed ONE attempt per stage; its body only ever asserted that no failover
// fired, which on a chain of length one was guaranteed and measured nothing. It now asserts the thing the
// name promises, off the run.jsonl `attempts` the retry ladder writes: a clean run must not burn a second
// paid attempt anywhere. That makes it a guard on the ladder, which is what is left.

test("WS1a: a clean run makes ONE attempt per stage — nothing re-dispatches when nothing fails", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const res = await PL.pipeline(jobFor("TMPFO3"));
  assert.equal(res.ok, true);
  const rows = events(res.runDir).filter((e) => e.event === "stage" && e.ok);
  assert.ok(rows.length > 0, "a clean run journals its successful stage rows");
  const retried = rows.filter((e) => (e.attempts ?? 1) > 1).map((e) => `${e.stage}=${e.attempts}`);
  assert.deepEqual(retried, [], "no stage burned a second attempt on a clean run");
});

// ---- WS1b-core — resume from failure -----------------------------------------------------------------

test("WS1b-core: resume reuses the run-dir — upstream stages SKIP, only synthesis→delivery re-run", async () => {
  // Run 1: hard-fail synthesis (non-eligible) so the run fails AFTER the 7 upstream stages are valid on disk.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  const job = jobFor("TMPRES1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "synthesis");
  // — THE RETURN IS A SINK, AND THIS IS THE HOP THAT PROVES IT. The terminal's own `terminalKind`
  // has to survive `pipeline()`'s wrapper to the caller, because runner.mjs stringifies exactly this
  // object into `<base>.failed.result` — the record scripts/e2e.mjs falls back to when it cannot resolve
  // the run dir. A projection added to either wrapper would drop it here, silently, and both lanes'
  // discriminators would die one hop short of the sink.
  assert.ok(r1.terminalKind, "the terminal kind reaches the caller (here: exhausted, CLEAROTRON_RECOVERY_MAX=0)");
  const codename = codenameOf(r1.runDir);
  assert.ok(existsSync(join(r1.runDir, ".failed")), ".failed sentinel written");
  // Handoff mode (the default): the failure event rides the outbox — a run-failed packet lands in the run
  // dir AND as a self-contained outbox copy (the engine has no message tool; no notify-fail-chat turn).
  const failPacket = JSON.parse(readFileSync(driverDir(r1.runDir, "failure.json"), "utf8"));
  assert.equal(failPacket.kind, "run-failed");
  assert.equal(failPacket.failedStage, "synthesis");
  assert.match(failPacket.text, /nothing was delivered/i);
  const outboxCopy = JSON.parse(readFileSync(join(ROOT, "prelim-outbox", `${failPacket.runId}.failed.pending`), "utf8"));
  assert.equal(outboxCopy.failedStage, "synthesis");

  // Run 2: resume (clear knobs so synthesis succeeds). Idempotency skips the valid upstream stages.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ev2 = sinceLastStart(events(r2.runDir));
  const skipped = ev2.filter((e) => e.event === "skip").map((e) => e.stage);
  for (const up of ["matter-frame", "prelim-variants", "common-law", "placement-inquiry", "register-digest", "skeptic"])
    assert.ok(skipped.some((s) => s.startsWith(up)), `${up} SKIPPED on resume`);
  const ran = ev2.filter((e) => e.event === "stage" && e.ok).map((e) => e.stage);
  assert.ok(ran.includes("synthesis"), "synthesis re-ran on resume");
  assert.ok(ran.includes("report-overview"), "delivery re-ran on resume");
  assert.ok(r2.runDir.includes("/archive/"), "resumed run delivered + archived");
});

// ── post-merge audit, N2 — the contract the babysit surface STATES, on a real resume ─────────
// `get_run` folds run.jsonl `stage` and `skip` rows into ONE stages[] list, and mcp-server/server.mjs
// states that surface's contract unqualified: an output that was expected and is not there arrives as
// {present:false}. Two production writers still emitted `fileMeta` — no `present` key at all — and one of
// them is the SKIP row. On a resume (after a recovery park or a rate-limit postpone, i.e. exactly the
// path a babysat run takes overnight) most rows are skips, so most of the surface fell outside its own
// stated contract, and a reader following it read `output.present === undefined` → falsy → "not
// produced" for an artifact that is on disk and passed its validator.
//
// The assertion that would have caught it is universally quantified over a REAL resumed run's rows —
// asserting on one hand-written row only ever proves the row you thought to write.
test("AUDIT #175/N2 — every stage/skip row a RESUMED run writes satisfies the get_run stages[] contract", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  const job = jobFor("TMPCONTRACT1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false, "run 1 fails at synthesis, leaving the upstream stages valid on disk");
  const codename = codenameOf(r1.runDir);

  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));

  const rows = sinceLastStart(events(r2.runDir)).filter((e) => e.event === "stage" || e.event === "skip");
  const skips = rows.filter((e) => e.event === "skip");
  assert.ok(rows.length > 0, "the resume wrote rows onto the surface");
  assert.ok(skips.length * 2 > rows.length,
    `a resume is skip-DOMINATED (${skips.length}/${rows.length}) — which is exactly why the contract had to hold on skip rows`);

  for (const e of rows) {
    const at = `${e.event}:${e.stage}`;
    assert.notEqual(e.output, undefined, `${at}: \`output\` is written unconditionally, never an omitted key`);
    if (e.output !== null) {
      assert.equal(typeof e.output.present, "boolean",
        `${at}: an output that is DECLARED carries the present discriminator — this is the contract server.mjs states`);
      assert.equal(typeof e.output.name, "string", `${at}: absence still has an address`);
      if (e.output.present) assert.equal(typeof e.output.sha, "string", `${at}: present ⇒ the bytes are fingerprinted`);
      else {
        assert.equal(e.output.sha, null, `${at}: absent ⇒ no fingerprint is claimed`);
        assert.equal(e.output.size, null, `${at}: absent ⇒ no byte count is claimed (0 is a real file's size)`);
      }
    }
    for (const i of e.inputs ?? [])
      assert.ok(i && "read" in i, `${at}/${i?.name}: inputs never OMIT \`read\` — an omitted key reads as false`);
    // …and the trio that makes those `read` values self-describing without a join. `warm` is the N1
    // addition and belongs to the same promise: a row whose reads are null must say WHY on the row.
    if (e.event === "stage")
      for (const k of ["followup", "readsTruncated", "warm"])
        assert.ok(k in e, `${at}: \`${k}\` is written unconditionally — it is what explains this row's \`read\` flags`);
    // — the wall boundaries, on EVERY completion row including the skips. A row stamps one instant
    // (`ts`, at append time, i.e. the end); serially the previous row is a usable start proxy, but in a
    // wave the rows interleave by completion order and the proxy names a sibling. That is how a stage's
    // cost became "between 0 and 10 minutes and the journal does not say which". This loop is universally
    // quantified over the rows a REAL resumed mock run actually wrote, which is why it is the arm that
    // catches an omission on the skip return — and a resume is skip-dominated, asserted just above.
    for (const k of ["dispatchedAt", "settledAt", "wallSec"])
      assert.ok(k in e, `${at}: \`${k}\` is written unconditionally — a wave member without one has no readable wall`);
    assert.ok(Date.parse(e.settledAt) >= Date.parse(e.dispatchedAt), `${at}: a stage cannot settle before it dispatched`);
    assert.equal(e.wallSec, (Date.parse(e.settledAt) - Date.parse(e.dispatchedAt)) / 1000,
      `${at}: wallSec is computed at the same site as the pair, so it cannot disagree with it`);
  }

  // The defect in one line: a skip row exists BECAUSE the resume found the artifact and it passed its
  // validator. Not one of them may reach the babysit surface reading as "not produced".
  for (const e of skips)
    assert.equal(e.output?.present, true, `skip:${e.stage}: the artifact this skip inherited is on disk — say so`);

  // — THE BOUNDARIES MUST CONTAIN THE WORK, not merely exist. Every `attempt` row is journalled
  // DURING the stage it belongs to, so its append instant must fall inside that stage's interval. On this
  // harness the stages are sub-millisecond, so this arm cannot by itself catch a start captured too late
  // — the containment-against-an-independent-clock arm in pipeline.mock.test.mjs (A2 report-cards) is
    // what does that. Both are needed: this one is
  // universally quantified over the rows a real run wrote, that one has measurable time in it.
  const all = sinceLastStart(events(r2.runDir));
  let checked = 0;
  for (const s of all.filter((e) => e.event === "stage")) {
    const lo = Date.parse(s.dispatchedAt), hi = Date.parse(s.settledAt);
    for (const a of all.filter((e) => e.event === "attempt" && e.stage === s.stage)) {
      const t = Date.parse(a.ts);
      assert.ok(t >= lo && t <= hi,
        `stage:${s.stage} attempt ${a.attempt} was journalled outside its own stage's interval [${s.dispatchedAt}, ${s.settledAt}]`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no attempt row was covered — an absence, so this arm proved nothing");
});


test("P2 crash-resume: a crash changes no input bytes, so the resume stays as cheap as before (no stage-stale)", async () => {
  // The freshness precondition keys on CONTENT, never mtime — that is what keeps the crash-resume case
  // (the reason the skip exists at all) exactly as cheap as it was. A resume that changed nothing upstream
  // must fire ZERO `stage-stale` events and must still skip its upstream stages. Freshness is
  // unconditional — there is no flag to arm, so this is the production code path.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  const job = jobFor("TMPFRESH1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  const codename = codenameOf(r1.runDir);

  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ev2 = sinceLastStart(events(r2.runDir));
  const stale = ev2.filter((e) => e.event === "stage-stale");
  assert.deepEqual(stale.map((e) => e.stage), [], "a pure crash-resume invalidates nothing");
  assert.equal(ev2.filter((e) => e.event === "delivery-stale-blocked").length, 0, "and never blocks delivery");
  const skipped = ev2.filter((e) => e.event === "skip").map((e) => e.stage);
  for (const up of ["matter-frame", "prelim-variants", "placement-inquiry", "register-digest"])
    assert.ok(skipped.some((x) => x.startsWith(up)), `${up} still SKIPPED — no cost regression`);
});

test("WS1b-core: resume refuses to clobber an already-delivered run", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const job = jobFor("TMPRES2");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, true);
  const codename = codenameOf(r1.runDir);   // archived dir leaf still encodes the codename
  await assert.rejects(() => PL.pipeline(job, { codename }), /no live run-dir|already archived|already delivered/i);
});

// Upstream (gateway-bin era) the two "review fix" cases below pinned cross-provider chain provenance
// across a resume. That chain is deleted, but the seam the fixes guarded is engine-agnostic and
// still live: on an idempotency SKIP — and for the verdict-gated corrective re-synthesis — the driver
// recovers the WINNING attempt's served model + session from the persisted per-stage telemetry
// (recoverWinningAttempt over _driver/<stage>.jsonl), never from the stage config. Simulate a served model
// that differs from the configured one by rewriting the winning attempt's modelUsed in that telemetry, and
// assert the resume echoes the TELEMETRY, not the stage's declared model.
// A full provider/model form → resolveModel passes it through, and DIFFERENT from synthesis' configured
// primary (opus), which is the whole point of the fixture. It names a real claude id since: the
// engine no longer substitutes sonnet for an alias it does not recognise, it refuses — so an invented
// model here would fail at dispatch rather than exercise the winner-recovery this test is about.
const WINNER_MODEL = "anthropic/claude-sonnet-4-6";
function tamperWinningSynthesisModel(runDir) {
  const aPath = driverDir(runDir, "synthesis.jsonl");
  const rows = readFileSync(aPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const win = rows.filter((a) => !a.fail && a.key).pop();
  assert.ok(win, "run 1 persisted a winning synthesis attempt");
  win.modelUsed = WINNER_MODEL;
  writeFileSync(aPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

test("WS1b (review fix, adapted): a stage that SKIPS on resume reports the model that PRODUCED it (attempt telemetry), not the configured primary", async () => {
  // Run 1: synthesis succeeds, then report-synthesis hard-fails → live run-dir; narrative.md valid on disk.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPWIN1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "report-overview");
  const codename = codenameOf(r1.runDir);
  tamperWinningSynthesisModel(r1.runDir);

  // Run 2: resume (clear knobs). synthesis SKIPS — its skip event must report the recorded winner, not the
  // primary the stage config would resolve to.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ev2 = sinceLastStart(events(r2.runDir));
  const synthSkip = ev2.find((e) => e.event === "skip" && e.stage === "synthesis");
  assert.ok(synthSkip, "synthesis skipped on resume");
  assert.equal(synthSkip.model, WINNER_MODEL, "skip reports the model that actually produced the output (from _driver telemetry), not the configured primary");
});

test("WS1b (review fix, adapted): corrective re-synthesis on resume RESUMES the winning attempt's model, not the configured primary", async () => {
  // Run 1: synthesis succeeds, then refutation hard-fails → live run-dir; narrative.md valid on disk,
  // senior-eye-review.md absent (so refute re-runs on resume rather than skipping a stale CLEAR verdict).
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "narrative-refutation/SKILL" });
  const job = jobFor("TMPWIN2");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "narrative-refutation");
  const codename = codenameOf(r1.runDir);
  tamperWinningSynthesisModel(r1.runDir);

  // Run 2: resume with a BLOCKING verdict → synthesis SKIPS (winner recovered from telemetry), refute re-runs
  // BLOCKING → a corrective re-synthesis fires. It must resume on the RECORDED winning model, not the
  // configured primary (the clobber bug the upstream review fix closed: resuming the base key on the primary
  // would cold-cache + model-mismatch the session that actually wrote narrative.md).
  // T3a (owner ruling 2026-08-26, reversing T3): a persistent BLOCKING now DELIVERS with the
  // reviewer's open points printed, instead of failing after the corrective ladder. The subject of THIS
  // test — that the corrective re-synthesis resumes the WINNING attempt rather than cold-caching the
  // configured primary — is unchanged by that and is still what the assertions below are about.
  // ✕ THE BLOCKING MUST CITE SOMETHING, since conversion 9. `record_narrative_refutation` refuses a
  // BLOCKING with an empty `flags` array in the turn it is typed, so a flagless one is no longer a shape
  // a seat can produce — the stage exhausts instead of delivering, which would fail this test for a
  // reason that has nothing to do with its subject. The subject is unchanged: a corrective re-synthesis
  // resuming the WINNING attempt's model rather than cold-caching the configured primary. A cited
  // BLOCKING drives that ladder exactly as a bare one did.
  setKnobs({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_VERDICT_DEFECTS: "- the narrative's registration date contradicts the fetched record" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.failedStage, undefined, "a persistent BLOCKING is no longer terminal — it delivers with open points");
  const ev2 = sinceLastStart(events(r2.runDir));
  const corrective = ev2.find((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective");
  assert.ok(corrective, "a corrective re-synthesis fired on the BLOCKING verdict (the fix arm ran before the fail arm)");
  // — THE INTENT IS UNCHANGED; only the field this reads moved. `model` now answers "what ran" in the
  // provider's own vocabulary, and `modelSelector` answers "what re-spawns the writer" in the catalog's.
  // This test has always been about the SECOND question — that the corrective resumes the winning attempt
  // rather than cold-caching the configured primary — so it reads the selector.
  assert.equal(corrective.modelSelector, WINNER_MODEL, "corrective re-synthesis ran on the recorded winning model, not the configured primary");
  // This detects DELETION of the truthful field, and only that. It cannot detect the two fields
  // collapsing back into one, because on this fixture they legitimately COINCIDE — the winner is what
  // ran. Collapse is detectable only where the vocabularies differ, i.e. off-Anthropic: that assertion
  // lives in stage-event-names-what-ran.test.mjs ("the codex shape"), not here.
  assert.ok("model" in corrective, "the stage event lost its truthful model field");
});

// ---- WS1b-ext — --from / --experiment ----------------------------------------------------------------

// A deleted flag must REFUSE, not disappear. parseArgv ignores every argument not in its table, so without
// the retired-flags guard `--resume <c> --rerun <stage>` parses as a bare resume: many stages, real spend,
// a mutated live run dir, no error. Driven through the real CLI — exit code included — because the argument
// parser IS the surface that breaks, and an in-process call to the guard would not prove the wiring.
test("retired flags: the CLI refuses --rerun with a non-zero exit and names both replacements", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "pipeline.mjs"),
    "--job", join(ROOT, "no-such-job.json"), "--resume", "somecodename", "--rerun", "synthesis"], { encoding: "utf8" });
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} — stderr: ${r.stderr}`);
  assert.match(r.stderr, /--rerun was deleted/, "the refusal names the retired flag");
  assert.match(r.stderr, /--from <stage>/, "…and points at --from");
  assert.match(r.stderr, /--experiment <stage>/, "…and at --experiment");
  assert.ok(!/ENOENT|no such file/i.test(r.stderr), "refused before reading the job file — the flag, not the arguments around it, is the subject");
});

// — the same failure the table above covers, for every flag it does NOT cover. RETIRED_FLAGS only knows
// what this CLI deliberately deleted; a TYPO degraded silently, and so would any flag renamed rather than
// retired. The expensive case is `--experiement` (for `--experiment`): the sandbox flag is dropped, and the
// operator who asked for a run that touches nothing gets one that mutates the canonical run instead.
// Driven through the real CLI for the same reason as the test above — the parser IS the surface.
const cli = (...args) => spawnSync(process.execPath, [join(HERE, "..", "pipeline.mjs"), ...args], { encoding: "utf8" });

test("#289: a misspelt flag is refused by name, not silently dropped into a different operation", () => {
  const r = cli("--job", join(ROOT, "no-such-job.json"), "--resume", "somecodename", "--experiement", "placement-inquiry");
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} — stderr: ${r.stderr}`);
  assert.match(r.stderr, /unknown flag --experiement/, "the refusal names the offending token");
  assert.match(r.stderr, /usage: node pipeline\.mjs/, "…and prints USAGE, so the operator can see what they meant");
  assert.ok(!/ENOENT|no such file/i.test(r.stderr), "refused before reading the job file");
});

test("#289: a bare positional is refused too — every flag takes a value, so a stray token is a typo", () => {
  const r = cli("--job", join(ROOT, "no-such-job.json"), "extra-token");
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} — stderr: ${r.stderr}`);
  assert.match(r.stderr, /unexpected argument "extra-token"/);
});

test("#289: a flag given no value is refused, rather than binding undefined", () => {
  const r = cli("--job", join(ROOT, "no-such-job.json"), "--resume", "somecodename", "--from");
  assert.equal(r.status, 2, `expected exit 2, got ${r.status} — stderr: ${r.stderr}`);
  assert.match(r.stderr, /--from needs a value/);
});

test("#289: RETIRED_FLAGS still wins — a deleted flag keeps its own message instead of a generic refusal", () => {
  const r = cli("--job", join(ROOT, "no-such-job.json"), "--resume", "somecodename", "--rerun", "synthesis");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--rerun was deleted/, "the specific message, not 'unknown flag --rerun'");
  assert.ok(!/unknown flag/.test(r.stderr), "the generic refusal must not fire ahead of the specific one");
});

test("#289: every documented flag still parses — the refusal did not narrow the CLI", () => {
  // Reaches the composition guards, which is proof the flags themselves were accepted: the run only stops
  // because --model/--instructions need --experiment, a check that sits AFTER parsing.
  const r = cli("--job", join(ROOT, "no-such-job.json"), "--agent", "a", "--resume", "c", "--from", "s",
    "--model", "m", "--instructions", "i", "--label", "l", "--axis", "x", "--dispatch-trigger", "fresh");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /apply only to --experiment/, "parsed all ten flags, then failed on composition");
  assert.ok(!/unknown flag|unexpected argument|needs a value/.test(r.stderr), "no flag was refused");
});

test("WS1b-ext --from: re-runs the stage and downstream (incl. the refutation seam); earlier stages skip", async () => {
  // Run 1: fail report-synthesis (fatal) so synthesis + refutation are VALID on disk but the run-dir stays live.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPFROM1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "report-overview");
  const codename = codenameOf(r1.runDir);

  // Run 2: --from synthesis → synthesis..end re-run even though their outputs are valid; matter-frame..skeptic skip.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const r2 = await PL.pipeline(job, { codename, fromStage: "synthesis" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ev2 = sinceLastStart(events(r2.runDir));
  const skipped = ev2.filter((e) => e.event === "skip").map((e) => e.stage);
  const ran = ev2.filter((e) => e.event === "stage" && e.ok).map((e) => e.stage);
  assert.ok(skipped.some((s) => s.startsWith("matter-frame")), "matter-frame skipped (before --from)");
  assert.ok(skipped.some((s) => s.startsWith("skeptic")), "skeptic skipped (before --from)");
  assert.ok(ran.includes("synthesis"), "synthesis forced re-run");
  assert.ok(ran.includes("narrative-refutation"), "refutation re-ran — the --from seam (no stale verdict)");
  assert.ok(ran.includes("report-overview"), "report-overview re-ran");
});

// PR-4 — the snapshot-before-overwrite CHOKE POINT and its growth tripwire, from the outside. Both are
// stage-level, not flag-level: every forced or stale re-dispatch (corrective, lint-repair, escalation,
// frame-reopen, stale-repair, --from) rides the same call site. `--from skeptic` is used here purely as
// the cheapest way to force one stage to re-emit over a canonical that already exists.
test("PR-4: a forced re-dispatch snapshots the prior output to _history, overwrites the canonical, and trips on growth", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPRR1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  const codename = codenameOf(r1.runDir);
  const skepticPath = join(r1.runDir, "skeptic-flags.md");
  const before = readFileSync(skepticPath, "utf8");

  // MOCK_FAIL_STAGE stays armed on every pass: the run must stay LIVE (an archived run has no codename
  // to resolve) so the second forced re-dispatch below can run against the same run-dir.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "delivery-contract", MOCK_SKEPTIC: "DIFFERENT flags v2\n\n## Escalation decisions\nESCALATE: none" });
  const rr = await PL.pipeline(job, { codename, fromStage: "skeptic" });
  assert.equal(rr.failedStage, "report-overview", "the re-dispatch reached the armed delivery failure — skeptic itself re-ran");
  const after = readFileSync(skepticPath, "utf8");
  assert.notEqual(after, before, "canonical output was overwritten by the re-run");
  assert.match(after, /DIFFERENT flags v2/);
  const snapEv = events(r1.runDir).find((e) => e.event === "output-snapshot" && e.stage === "skeptic");
  assert.ok(snapEv, "output-snapshot event logged from the choke point");
  const snapDir = join(r1.runDir, "_history", snapEv.snapshot);
  assert.ok(existsSync(snapDir), "the event names a real _history dir");
  assert.equal(readFileSync(join(snapDir, "skeptic-flags.md"), "utf8"), before, "snapshot holds the PRIOR output");

  // PR-4 document-growth tripwire: a REPAIR-shaped re-emit that GROWS the output beyond 35%/20KB trips —
  // flag-only (the stage still succeeds, the file is still overwritten; never withheld). The tripwire
  // deliberately ignores trigger "fresh" (a fresh recompute legitimately re-authors), so this half rides
  // repairStale — the stale-repair entry point, which is the production in-place forced re-dispatch.
  // Its `_driver/delivery-stale.json` is written for real by the blocked delivery pass (pipeline.mjs
  // ~8162); the shape here is that writer's, so the entry point is driven exactly as production drives it.
  const bloat = `BLOATED flags v3 ${"lorem ipsum dolor sit amet ".repeat(1200)}\n\n## Escalation decisions\nESCALATE: none`;
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "delivery-contract", MOCK_SKEPTIC: bloat });
  writeFileSync(driverDir(r1.runDir, "delivery-stale.json"), JSON.stringify({
    ts: new Date().toISOString(), labels: ["skeptic"], changed: { skeptic: ["register-findings.md"] },
  }, null, 2));
  const rep = await PL.repairStale(job, { codename });
  assert.deepEqual(rep, { ok: true, repaired: ["skeptic"], failed: [] }, "the stale-repair entry point recomputed exactly the recorded stage");
  const trips = events(r1.runDir).filter((e) => e.event === "document-growth-trip" && e.stage === "skeptic");
  const trip = trips[trips.length - 1];
  assert.ok(trip, "growth beyond the tripwire logs document-growth-trip");
  assert.equal(trip.trigger, "stale-repair", "the trip is keyed on the TRIGGER (gate-metrics aggregates by it)");
  assert.ok(trip.growthBytes > 20 * 1024, `growthBytes recorded (${trip.growthBytes})`);
  assert.match(readFileSync(skepticPath, "utf8"), /BLOATED flags v3/, "delivery of the overwrite is NEVER withheld by a trip");
});

test("WS1b-ext --experiment: sandboxed — canonical run is byte-identical, output lands only in _experiments", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPEXP1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  const codename = codenameOf(r1.runDir);
  const skepticPath = join(r1.runDir, "skeptic-flags.md");
  const canonicalBefore = readFileSync(skepticPath, "utf8");
  const driverBefore = readdirSync(driverDir(r1.runDir)).filter((f) => f.startsWith("skeptic")).length;

  setKnobs({ MOCK_SKEPTIC: "EXPERIMENTAL skeptic output on opus\n\n## Escalation decisions\nESCALATE: none" });
  const ex = await PL.runExperiment(job, { codename, experiment: "skeptic", model: "opus", label: "try opus" });
  assert.equal(ex.ok, true, JSON.stringify(ex));
  // canonical untouched
  assert.equal(readFileSync(skepticPath, "utf8"), canonicalBefore, "canonical skeptic-flags.md unchanged");
  assert.equal(readdirSync(driverDir(r1.runDir)).filter((f) => f.startsWith("skeptic")).length, driverBefore, "no new canonical attempt log");
  // output isolated to the shadow dir, with the experimental content
  assert.ok(ex.shadowDir.includes("/_experiments/"), "shadow dir under _experiments");
  assert.match(readFileSync(ex.output, "utf8"), /EXPERIMENTAL skeptic output/);
  // the canonical run.jsonl carries an experiment breadcrumb
  assert.ok(events(r1.runDir).some((e) => e.event === "experiment" && e.stage === "skeptic"), "experiment breadcrumb logged");
});

test("WS1b-ext (review fix): --experiment register-unit without --axis is refused (no null.md corruption)", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPAXIS1");
  const r1 = await PL.pipeline(job);
  const codename = codenameOf(r1.runDir);
  setKnobs({});
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "register-unit" }), /requires --axis/);
  assert.ok(!existsSync(join(r1.runDir, "register-units", "null.md")), "no spurious null.md written into the run-dir");
});

// The guard used to be a TRUTHINESS test that interpolated REGISTER_AXES into its own error message and
// then accepted anything: `--axis primary-swep` passed, wrote register-units/primary-swep.md into the
// shadow dir, and silently took axisTier's sonnet/adaptive else-arm — an experiment at a tier nobody
// chose. It is now a MEMBERSHIP test, and it runs BEFORE reconstructCtx so it costs no run dir: the
// bogus codename below would fail loudly if anything touched the run first, and the axis is what refuses.
test("WS1b-ext: --experiment --axis rejects a value outside REGISTER_AXES, before the run dir is touched", async () => {
  const job = jobFor("TMPAXIS2");
  const bogus = "no-such-codename";
  for (const bad of ["primary-swep", "", "SATURATION-PROBE", "register-unit"]) {
    await assert.rejects(
      () => PL.runExperiment(job, { codename: bogus, experiment: "register-unit", axis: bad }),
      /is not a register axis|requires --axis/,
      `--axis "${bad}" must be refused`);
  }
  // …and a mistyped axis is refused on a stage that does not even use one, because it still names the
  // shadow dir and the session key.
  await assert.rejects(
    () => PL.runExperiment(job, { codename: bogus, experiment: "skeptic", axis: "primary-swep" }),
    /is not a register axis/, "a stray --axis on a non-register stage is refused too");
  // every REGISTER_AXES member gets PAST the axis guard (it fails later, on the bogus codename) — the
  // guard must not have narrowed the valid set while making it real.
  const { REGISTER_AXES } = await import("../coverage-ledger.mjs");
  for (const good of REGISTER_AXES) {
    await assert.rejects(
      () => PL.runExperiment(job, { codename: bogus, experiment: "register-unit", axis: good }),
      (e) => !/is not a register axis/.test(String(e?.message ?? e)),
      `--axis "${good}" is valid and must pass the axis guard`);
  }
});

test("WS1b (Drop 1.1 fix): skeptic escalation does NOT re-fire on a resume past synthesis (audit-safe, no re-spend)", async () => {
  // Run 1: escalate primary-sweep, reach synthesis (narrative.md written), then hard-fail report-synthesis → live.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "flag\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPESC1");
  const r1 = await PL.pipeline(job);
  assert.equal(r1.ok, false);
  assert.ok(events(r1.runDir).some((e) => e.event === "skeptic-escalation"), "run 1 DID escalate (pre-synthesis)");
  const codename = codenameOf(r1.runDir);

  // Run 2: resume (clear the report-synthesis failure). narrative.md exists → escalation must be skipped.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "flag\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run" });
  const r2 = await PL.pipeline(job, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ev2 = sinceLastStart(events(r2.runDir));
  assert.ok(!ev2.some((e) => e.event === "skeptic-escalation"), "escalation did NOT re-fire on the resume (narrative present)");
  assert.ok(!ev2.some((e) => e.event === "stage" && e.stage.startsWith("register-unit") && e.ok), "no register-unit re-run on resume");
  assert.ok(r2.runDir.includes("/archive/"), "resume delivered");
});

test("WS4: escalation skips the Opus re-digest when the unit is defended in place (unchanged), fires when it changes", async () => {
  // NOOP: escalate primary-sweep but force the warm re-run to re-emit a BYTE-IDENTICAL unit. The driver must
  // detect no change and SKIP the (provably wasted) Opus re-digest — logging escalation-noop, no skeptic-escalation.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "flag\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run", MOCK_ESCALATION_NOOP: "1" });
  const rNoop = await PL.pipeline(jobFor("TMPWS4N"));
  assert.equal(rNoop.ok, true, JSON.stringify(rNoop));
  const evN = events(rNoop.runDir);
  assert.ok(evN.some((e) => e.event === "escalation-noop" && e.axis === "primary-sweep"), "logged escalation-noop for the unchanged axis");
  assert.ok(!evN.some((e) => e.event === "skeptic-escalation"), "re-digest SKIPPED (no skeptic-escalation event)");
  assert.ok(!evN.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "escalation"), "no Opus register-digest re-run");

  // Control: same escalation, default mock → the re-run CHANGES the unit → the re-digest DOES fire (floor preserved).
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "flag\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run" });
  const rFire = await PL.pipeline(jobFor("TMPWS4F"));
  assert.equal(rFire.ok, true, JSON.stringify(rFire));
  const evF = events(rFire.runDir);
  assert.ok(evF.some((e) => e.event === "skeptic-escalation"), "control: re-digest FIRES when the unit changes");
  // funnel: the changed unit mints a durable receipt and the ONE settlement flush pays it down.
  assert.ok(evF.some((e) => e.event === "digest-queued" && e.trigger === "escalation"), "control: escalation minted a digest receipt");
  assert.ok(evF.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"), "control: the settlement flush re-digested");
});

// ---- WS-T — telemetry + compare ----------------------------------------------------------------------

test("WS-T: stage events carry the linkage telemetry (trigger, model, inputs[], output)", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const res = await PL.pipeline(jobFor("TMPTEL1"));
  assert.equal(res.ok, true);
  const synth = events(res.runDir).find((e) => e.event === "stage" && e.stage === "synthesis");
  assert.equal(synth.trigger, "fresh");
  assert.match(synth.model, /opus/);
  assert.ok(Array.isArray(synth.inputs) && synth.inputs.length >= 3, "synthesis records its input files");
  assert.ok(synth.inputs.every((i) => i.name && "sha" in i && "size" in i), "input fingerprints present");
  assert.ok(synth.output && synth.output.name === "narrative.md" && synth.output.sha, "output fingerprint present");
  // Drop 1.1: per-stage token usage is now captured (extracted from result.meta.agentMeta.usage)
  const sj = readFileSync(driverDir(res.runDir, "synthesis.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const lastOk = sj.reverse().find((a) => !a.fail);
  assert.ok(lastOk?.usage && typeof lastOk.usage.output === "number", "synthesis attempt log captured token usage (not null)");
});

test("WS-T compare: diffStageOutputs + telemetryDelta render; compareCmd diffs canonical vs _history", async () => {
  // pure-fn units
  assert.match(CMP.diffStageOutputs("a\nb\nc", "a\nX\nc"), /-\s*b[\s\S]*\+\s*X/);
  assert.match(CMP.telemetryDelta({ modelUsed: "opus", wall: 100, output: { sha: "aaa", size: 1 } }, { modelUsed: "gpt", wall: 50, output: { sha: "bbb", size: 2 } }), /model[\s\S]*opus[\s\S]*gpt/);
  // end-to-end: force skeptic to re-emit over its canonical, then compare canonical vs the snapshot
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPCMP1");
  const r1 = await PL.pipeline(job);
  const codename = codenameOf(r1.runDir);
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "delivery-contract", MOCK_SKEPTIC: "v2 skeptic output\n\n## Escalation decisions\nESCALATE: none" });
  await PL.pipeline(job, { codename, fromStage: "skeptic" });
  const out = CMP.compareCmd({ runDir: r1.runDir, stage: "skeptic" });
  assert.ok(out.diff && out.diff.length > 0, "non-empty diff between canonical and the snapshot");
  assert.match(out.table, /model/);
});

// — the second live instance of the lenient parser fixed in pipeline.mjs.
//
// Milder than 's: the body is a pure read, nothing is written and nothing is spent, and
// --run-dir/--stage already refuse when absent — so a dropped flag only ever meant --axis/--a/--b
// silently reverting to their defaults. Mild is not harmless. The one job of this tool is to say whether
// two versions of a stage differ, and comparing the wrong pair answers that with confidence.
//
// Driven through the real CLI, for the same reason as the two above: the parser IS the surface that
// breaks. The programmatic callers (the diff_artifact MCP tool, whatif.mjs, the test above) pass an
// object to compareCmd and never enter it.
test("#378: compare.mjs refuses an unknown flag and a flag with no value, and prints its usage", () => {
  const run = (...args) => spawnSync(process.execPath, [join(HERE, "..", "compare.mjs"), ...args], { encoding: "utf8" });

  const typo = run("--run-dir", "/x", "--stage", "skeptic", "--axsi", "primary-sweep");
  assert.equal(typo.status, 2, `expected exit 2, got ${typo.status} — stderr: ${typo.stderr}`);
  assert.match(typo.stderr, /unknown flag --axsi/, "the refusal names what was actually typed");
  assert.match(typo.stderr, /usage: node compare\.mjs/, "…and shows the form, so the reader is not left guessing the spelling");

  // The missing-value hole the same loop carried: a trailing flag bound `undefined` and read as absent.
  const trailing = run("--run-dir", "/x", "--stage", "skeptic", "--b");
  assert.equal(trailing.status, 2, `expected exit 2, got ${trailing.status} — stderr: ${trailing.stderr}`);
  assert.match(trailing.stderr, /--b needs a value/);

  // And every LISTED flag still works: this refuses on the run dir, not on the arguments.
  const ok = run("--run-dir", join(ROOT, "no-such-run"), "--stage", "skeptic", "--a", "canonical", "--b", "canonical");
  assert.doesNotMatch(ok.stderr, /unknown flag|needs a value/, `no listed flag became an error: ${ok.stderr}`);
});

// WS-T + — the stage-context drift guard, made able to SEE.
//
// It matched `/RUN/….md` and nothing else, so an entire artifact class was outside its vision: every
// `.json` the run writes. Chief among them findings.json — authored by synthesis, then rewritten by four
// deterministic mutators, read by every downstream surface, and declared by nobody. That undeclared
// movement is how copper-vault shipped a report built over a findings set that had moved underneath it.
// A guard that cannot see the file cannot report its absence, and an absence read as a pass is the shape
// this codebase has shipped seven times.
//
// The matcher is now DERIVED from paths(): every extension the run-dir path map declares joins the guard
// the day it is declared, not the day someone remembers this regex. Four further holes are closed:
//   · it asks stageContext, not stageInputs alone. Since  a stage's context has TWO
//     declarers — the freshness list, and stage-context's classified view for artifacts that are context
//     but deliberately not freshness inputs (the dictated grid spec is exactly that: "the fix is a second
//     view, not a wider freshness list"). Checking stageInputs alone would now report a file that IS
//     declared, and pressure the next reader into widening the freshness map, which  forbids;
//   · the stage's whole AUTHORED surface (stageOutputs, not just out()) is what gets filtered out, so a
//     stage that writes a sibling — synthesis→findings.json, prelim-variants→scope-ledger.json — is not
//     accused of failing to declare its own output as an input;
//   · prompts that branch on a ctx FIELD rather than on paths() are swept in BOTH shapes, so fixing the
//     split sweep lane does not leave the unsplit lane blind;
//   · the sweep is COUNTED. The old `catch { continue; }` meant a guard that built no messages at all
//     passed in silence.
test("WS-T/#249: stage context covers every DECLARED-ARTIFACT file each stage message() names (drift guard)", async () => {
  const ST = await import("../stages.mjs");
  const SC = await import("../stage-context.mjs");
  const { GRID_HALVES } = await import("../common-law-receipts.mjs");
  const RUN = "/RUN";
  const P = ST.paths(RUN);

  // The artifact extensions this engine declares — md, txt, json, jsonl today, whatever paths() says
  // tomorrow. Path FACTORIES (registerUnit(axis), gridSpecSupp(half, tag)) are called with dummy args.
  const exts = new Set();
  for (const v of Object.values(P)) {
    let s = v;
    if (typeof v === "function") { try { s = v("a", "b"); } catch { s = null; } }
    const m = typeof s === "string" ? s.match(/\.([A-Za-z0-9]+)$/) : null;
    if (m) exts.add(m[1]);
  }
  for (const must of ["md", "json"])
    assert.ok(exts.has(must), `the matcher must be DERIVED from paths() — "${must}" is missing from ${[...exts]}, so the derivation broke`);
  const artifactRe = new RegExp("/RUN/[^\\s`'\";)]+\\.(?:" + [...exts].sort().join("|") + ")", "g");

  // Stages parameterized by an axis/half/ordinal say so by taking a second `out(P, axis)` argument. The
  // three vocabularies differ (register axes, grid halves, finding ordinals), so the value comes from a
  // map — and the map is CLOSED against that arity check, so a NEW parameterized stage with no entry
  // fails HERE rather than being swept with axis=null, which builds nonsense paths (`…half-null.json`,
  // `report-cards/null.md`) and hides the reference the guard exists to check. The old guard special-cased
  // register-unit alone and swept the other two parameterized stages with a null they do not accept.
  const axes = ST.REGISTER_AXES;
  const PARAM_FOR = { "register-unit": axes[0], "common-law-half": GRID_HALVES[0], "report-card": 1 };
  for (const name of ST.STAGE_ORDER)
    if ((ST.STAGES[name].out?.length ?? 0) > 1)
      assert.ok(name in PARAM_FOR, `stage "${name}" is axis-parameterized (its out() takes a second argument) but this guard has no value for it — add one, else it sweeps with null and sees nothing real`);

  const job = { marks: [{ name: "X", classes: [9] }], markName: "X", classes: [9], upfrontInstructions: "x", forwarder: "jordan", msgId: "<m>", ref: "TMP1" };
  const seen = new Set();
  let built = 0;
  for (const name of ST.STAGE_ORDER) {
    const def = ST.STAGES[name];
    const axis = PARAM_FOR[name] ?? null;
    const base = { paths: P, job, axes, axis, agent: "clawdi", run: { slug: "s", codename: "c" } };
    // The second shape: common-law names the canonical grid spec only when the driver wrote one
    // (ctx.gridSpecPath), so under the minimal ctx that whole branch — and its file reference — is
    // invisible. Both shapes are swept and their references unioned.
    const rich = { ...base, gridSpecPath: P.gridSpec, gridVariants: ["X"], profile: { platforms: ["shop.example.com"], batchSize: 14 } };
    // The complete declared context: the freshness list PLUS stage-context's classified edges (which
    // carry the tool-mediated / driver-side / conditional artifacts keeps out of the freshness map).
    // A file in neither is declared NOWHERE — which is the only thing this guard should call a defect.
    const declared = new Set([
      ...ST.stageInputs(name, P, { axes, axis }),
      ...SC.stageContext(name, P, { axes, axis }).map((e) => e.path),
    ]);
    const authored = new Set(ST.stageOutputs(name, P, { axes, axis }));
    let anyBuilt = false;
    for (const ctx of [base, rich]) {
      let msg;
      try { msg = def.message(ctx); } catch { continue; }
      anyBuilt = true;
      for (const ref of new Set(msg.match(artifactRe) || [])) {
        seen.add(ref);
        if (authored.has(ref)) continue;   // the stage's own declared output, not an input
        assert.ok(declared.has(ref), `stage "${name}" names ${ref} in its prompt and NOTHING declares it — not stageInputs, not stage-context. Declare it: stageInputs if it is a freshness input, stage-context (#236) if it is context the freshness map must not carry. Undeclared, the --experiment sandbox omits it and no view of the run knows the stage reads it.`);
      }
    }
    if (anyBuilt) built++;
  }

  // ── the guard's own zero-semantics: prove it swept something ────────────────────────────────────────
  assert.equal(built, ST.STAGE_ORDER.length,
    `only ${built}/${ST.STAGE_ORDER.length} stage messages built — a stage whose message() throws is swept by NOTHING, and a guard that sweeps nothing passes vacuously`);
  assert.ok(seen.size >= 20, `the guard matched only ${seen.size} artifact references across ${built} stages — the matcher is broken, not the map`);
  // The file this guard could not see, named. Once the map is correct, a regression of the matcher back
  // to `.md`-only passes every assertion above — this is the one that catches it.
  assert.ok(seen.has(P.findings),
    "the guard must SEE findings.json — an `.md`-only matcher is exactly how its undeclared movement shipped a report over a findings set that had moved");
  assert.ok([...seen].some((f) => f.startsWith(`${RUN}/_driver/`)),
    "the guard must see the _driver/ sidecars too — they are all JSON, so an `.md`-only matcher was blind to every one of them");
});

// — report-overview: DECLARED == CITED, exactly, both directions.
//
// The stage declared NINE inputs and opened TWO (the 08-02 R2 dependency graph: `narrative.md` +
// `findings.json` read, the other seven never touched), while its prompt told the model it held register
// findings, common-law findings, both placement artifacts, the senior-eye review, the matter frame and
// case-law findings. A client-facing summary asserting grounding in material it never consulted is the
// defect this guards.
//
// The drift guard above CANNOT catch a regression here, for two reasons, which is why this exists:
//   1. it is ONE-WAY (declared ⊇ cited) — a phantom declaration nothing cites passes it silently, and
//      seven of them did;
//   2. its reference regex is `.md` ONLY — `findings.json` and `placements.json` are invisible to it, so
//      a re-added `placements.json` would fail neither side of it.
//
// SCOPED TO report-overview ON PURPOSE. The general reverse form cannot hold and must not be written:
// `report-card` legitimately declares findings.json + case-law-findings.md and reads NEITHER — its
// finding arrives inline as `ctx.finding` (B1) and the declaration is there for STALENESS, not reading.
// "declared-only" is not the same as "dead"; it is only a defect where the PROMPT also claims the read.
test("#252: report-overview declares EXACTLY the two files it reads, and its prompt cites exactly those two", async () => {
  const ST = await import("../stages.mjs");
  const P = ST.paths("/RUN");
  const axes = ST.REGISTER_AXES;
  const job = { marks: [{ name: "X", classes: [9] }], markName: "X", name: "PROJECT X", classes: [9], ref: "TMP1", customer: "ACME", goods: "games", upfrontInstructions: "x", forwarder: "jordan", msgId: "<m>" };
  const EXPECTED = [P.narrative, P.findings];
  const sorted = (a) => [...new Set(a)].sort();

  // The retired seven, named so a re-add fails by NAME rather than by a count mismatch.
  const RETIRED = { registerFindings: P.registerFindings, commonLaw: P.commonLaw, placement: P.placement, placementModel: P.placementModel, seniorEyeReview: P.seniorEyeReview, matterContext: P.matterContext, caseLaw: P.caseLaw };

  for (const registerOnly of [false, true]) {
    const declared = ST.stageInputs("report-overview", P, { axes, registerOnly });
    assert.deepEqual(sorted(declared), sorted(EXPECTED),
      `stageInputs[report-overview] (registerOnly=${registerOnly}) must be exactly narrative.md + findings.json — it is the staleness graph AND what --experiment copies, so a phantom entry parks runs and over-copies while proving nothing`);
    for (const [key, path] of Object.entries(RETIRED))
      assert.ok(!declared.includes(path), `report-overview re-declared ${key} (${path}) — if the stage now genuinely READS it, cite it in message() too and update this guard; a declaration alone is the #252 defect`);

    // Both `.md` and `.json`, unlike the drift guard above — placements.json/findings.json must be visible.
    const msg = ST.STAGES["report-overview"].message({ paths: P, job, axes, registerOnly, agent: "clawdi", run: { slug: "s", codename: "c" } });
    const cited = [...new Set(msg.match(/\/RUN\/[^\s`'";)]+\.(?:md|json)/g) || [])].filter((p) => p !== ST.STAGES["report-overview"].out(P));
    assert.deepEqual(sorted(cited), sorted(EXPECTED),
      `report-overview's prompt (registerOnly=${registerOnly}) must cite exactly the files it declares — cited [${sorted(cited).join(", ")}] vs declared [${sorted(EXPECTED).join(", ")}]`);
  }
});

// — the front-matter identity fields are HANDED to the shell, never fished for.
//
// `matter:` and `title:` are model-authored and render.mjs binds both (fm.title is the report's <h1>,
// fm.matter the masthead reference); nothing in the driver stamps them the way it stamps classes,
// overall_* and rated_under. Their declared carrier used to be matter-context.md, which the stage never
// opened — and which could not have answered anyway: matter-frame is never handed `job.ref`. So the
// facts now ride inline, and the block must survive a run that knows none of them without emitting a
// header the model would fill by invention.
test("#252: frontMatterIdentity hands the shell the intake facts, names no file, and stays silent when it knows nothing", async () => {
  const ST = await import("../stages.mjs");
  const full = ST.frontMatterIdentity({ job: { ref: "TMP-2201", name: "PROJECT NOVAPULSE", customer: "ACME Interactive", goods: "video games" } });
  for (const v of ["TMP-2201", "PROJECT NOVAPULSE", "ACME Interactive", "video games"]) assert.match(full, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(!/\.md\b|\.json\b/.test(full), "the identity block must name no artifact — it is inline facts, and a path here would break the declared==cited contract");

  // falsy-omitted per field: a refless run gets no `matter:` row rather than the string "undefined".
  const partial = ST.frontMatterIdentity({ job: { markName: "NOVAPULSE" } });
  assert.ok(!/matter:/.test(partial) && /NOVAPULSE/.test(partial) && !/undefined/.test(partial), `a refless run must omit the matter row, not print undefined: ${partial}`);
  // profile name is the client fallback when intake named no customer
  assert.match(ST.frontMatterIdentity({ job: { ref: "T1" }, profile: { name: "Aurora" } }), /- client: Aurora/);
  // knows nothing ⇒ emits NOTHING (an absence must not arrive as a header inviting invention)
  assert.equal(ST.frontMatterIdentity({ job: {}, profile: {} }), "");
  assert.equal(ST.frontMatterIdentity(), "");
});

// A4 (frame-omission): the blind pass MUST stay information-starved — fed ONLY the raw inbound request,
// never the matter frame (matterContext / variantManifest / any prior analysis). Its independence is the
// whole value: re-deriving the threat model cold catches the framing the rest of the run inherited. The
// --experiment sandbox copies exactly stageInputs(), so any leak here would also hand the frame to the
// blind pass under --experiment. Lock the set to a single input so a future "just add matterContext" edit
// to stages.mjs fails loudly here instead of silently neutering the blind pass.
test("A4: blind-frame stageInputs is STARVED — only the raw inbound request, never the matter frame", async () => {
  const ST = await import("../stages.mjs");
  const P = ST.paths("/RUN");
  const ins = ST.stageInputs("blind-frame", P, { axes: ST.REGISTER_AXES });
  assert.deepEqual(ins, [P.inboundRequest], "blind-frame must read ONLY inbound-request.txt");
  for (const leaked of [P.matterContext, P.variantManifest, P.registerFindings, P.commonLaw, P.narrative, P.scopeLedger])
    assert.ok(!ins.includes(leaked), `blind-frame stageInputs leaks the frame: ${leaked} — the blind pass must never see prior analysis`);
});

// — blind-frame's ONE output is the structured model, and THAT is what makes an absence loud.
// runStage's file-truth gate reads `out`: point it at prose the stage no longer writes and every turn
// fails; point it at nothing (`out: undefined`) and `files` is empty, so a turn that wrote NO model
// reports ok — the absence-reads-as-a-pass shape this codebase has shipped seven times. The validator
// test in verify.test.mjs proves the content check; this proves the file check exists to reach it.
test("#254: blind-frame's out() IS blind-frame-model.json, and blind-frame.md is gone from the paths, prompts and inputs", async () => {
  const ST = await import("../stages.mjs");
  const P = ST.paths("/RUN");
  assert.equal(ST.STAGES["blind-frame"].out(P), P.blindFrameModel,
    "blind-frame must gate on the model itself — an `out` that is undefined or a prose path makes a model-less turn pass");
  assert.equal(P.blindFrameModel, "/RUN/blind-frame-model.json");
  assert.ok(ST.STAGES["blind-frame"].validate, "the gated output must still be strict-parsed");
  assert.ok(!("blindFrame" in P), "the retired prose path constant must not come back as a dead key");
  // no stage prompt may name a file the engine no longer writes — a prompt pointing at blind-frame.md is
  // a live defect (the model is told to read or write something that will never exist), not a doc nit.
  const axes = ST.REGISTER_AXES;
  const job = { marks: [{ name: "X", classes: [9] }], markName: "X", classes: [9], upfrontInstructions: "x", forwarder: "jordan", msgId: "<m>", ref: "TMP1" };
  const built = new Set();
  for (const name of ST.STAGE_ORDER) {
    const def = ST.STAGES[name];
    const axis = name === "register-unit" ? "primary-sweep" : null;
    let msg;
    try { msg = def.message({ paths: P, job, axes, axis, agent: "clawdi", run: { slug: "s", codename: "c" } }); }
    catch { continue; }   // a message needing richer ctx — same skip as the stageInputs drift guard above
    built.add(name);
    assert.ok(!/blind-frame\.md/.test(String(msg)), `stage ${name}'s prompt still names blind-frame.md, which nothing writes`);
  }
  // the skip above must not be what makes this pass: the two stages that ever named the file must be swept
  for (const name of ["blind-frame", "frame-diff"]) assert.ok(built.has(name), `${name}'s message() did not build — this guard swept nothing`);
  assert.ok(!ST.stageInputs("frame-diff", P, { axes }).some((f) => /blind-frame\.md$/.test(String(f))),
    "frame-diff must not declare the retired prose file — --experiment copies exactly stageInputs()");
  assert.ok(ST.stageInputs("frame-diff", P, { axes }).includes(P.blindFrameModel),
    "frame-diff still consumes the model");
  assert.ok(ST.stageOutputs("blind-frame", P, { axes }).includes(P.blindFrameModel),
    "the dependency graph must still know blind-frame authors the model");
});

// ---- WS1c — DELETED with the model-failover chain --------------------------------------------
// It asserted that composeEmailHtml renders a "Model failover:" line from `failover_note` front-matter,
// by hand-writing front-matter no production run could produce: the chain had one rung, so nothing ever
// set the field. A passing test of a fiction. The renderer block is gone; the pin that it stays gone is
// a source assertion in audit-grid-log.test.mjs, not a fixture here.

// ── — THE STALE-SIBLING HOLE IS CLOSED BY AUTHORSHIP, NOT BY DELETION ──────────────────────────
//
// The hole: placements.json is the AUTHORITATIVE per-candidate tier record and the digest is told not to
// re-read the md on a corrective pass, so a forced re-dispatch that rewrote the md but not the JSON left
// the previous pass's tiers on disk, joined against a re-enumerated crowd band. The answer used to be
// the destructive snapshot step — take the sibling with the md and DELETE it, so a pass that failed to
// re-emit it failed loudly. That is also what discarded 31 minutes of finished work on R1: the file was
// deleted at dispatch, the seat wrote its prose, the wall landed in the gap, and the rescue refused
// because the JSON was missing.
//
// The seat no longer writes that file at all. The driver renders it from a form regenerated against the
// current fold on every pass, so a stale-tier file is UNREACHABLE rather than deleted — and a pass that
// hands back nothing loses nothing, because the accumulator still holds every tier already placed.
test("#562: a forced placement re-run cannot present a prior pass's tiers, and a silent pass loses none", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPSIB1");
  const r1 = await PL.pipeline(job);
  const codename = codenameOf(r1.runDir);
  const sibPath = join(r1.runDir, "placements.json");
  const before = JSON.parse(readFileSync(sibPath, "utf8"));
  assert.equal(before.placements.length, 1, "the driver rendered the seat's placement");
  assert.match(before.placements[0].tier, /headline-candidate/);

  // The re-dispatch hands back NOTHING — the shape that used to destroy the record.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract", MOCK_PLACEMENT_NO_SIBLING: "1" });
  const rr = await PL.pipeline(job, { codename, fromStage: "placement-inquiry" });
  assert.notEqual(rr.failedStage, "placement-inquiry",
    "a silent pass is no longer a failed pass — the seat does not owe a file the driver writes");
  const after = JSON.parse(readFileSync(sibPath, "utf8"));
  assert.deepEqual(after.placements, before.placements,
    "and the tier the FIRST pass placed is still in the deliverable, rendered from the accumulator");

  // The ordinary path is unaffected: a re-run that DOES answer re-renders over it.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const rr2 = await PL.pipeline(job, { codename, fromStage: "placement-inquiry" });
  assert.equal(rr2.failedStage, "report-overview", "placement re-ran clean — the run reached the armed delivery failure");
  assert.ok(existsSync(sibPath), "the deliverable is there, and it is the driver's");
});

// ── AD-2 A9 (E2E-R2) + the P5 review — the digest's corrective pass GETS the rulings tail ───────────
// The digest is told not to re-read the whole placement file on a corrective/repair pass (its tiers are
// in placements.json), but the rulings tail (band reconciliation, disagreements, coverage rulings, open
// questions) lives ONLY in the md. Leaving it to model discretion is the loss A9 names, and the named
// backstop does not cover it: findUnresolvedDisagreements only flags disagreement rows that EXIST, so a
// table that vanished entirely yields zero flags. The tail therefore rides the corrective dispatch as
// DATA ('s extractRulingsTail, the same extraction the synthesis corrective pass uses).
//
// A-2 widened it: the gate used to read `trigger !== "fresh" && !opts.followup`, so a FOLLOWUP digest —
// the settlement flush, the largest re-digest surface in a run — was the one dispatch denied the tail,
// on the reasoning that "a warm followup carries its own message and is untouched". A followup is not
// warm (A-1: attempt 1 of a fresh session), and its message now COMPOSES with `extra` rather than
// replacing it. So the dispatch least able to reconstruct the tail is no longer the one refused it.
test("AD-2 A9 + A-2: every non-fresh digest dispatch carries placement's rulings tail as data — the FLUSH included; a fresh pass does not", async () => {
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "delivery-contract" });
  const job = jobFor("TMPTAIL1");
  const r1 = await PL.pipeline(job);
  const codename = codenameOf(r1.runDir);
  const inRun = events(r1.runDir).filter((e) => e.event === "digest-rulings-tail");
  assert.ok(!inRun.some((e) => e.trigger === "fresh"), "a FRESH digest reads the md itself — no injection");
  // …and the run's own followup digest DOES get it now. Asserted positively rather than left as an
  // absence: this is the behaviour A-2 exists to produce, and an absence would read as success if the
  // whole block were deleted.
  assert.deepEqual(inRun.map((e) => e.trigger), ["settlement-flush"],
    "the settlement flush is a followup dispatch and now carries the tail");
  assert.ok(inRun[0].chars > 0);
  assert.ok(existsSync(driverDir(r1.runDir, "mock-rulings-tail.flag")),
    "…and it reached the dispatched MESSAGE, not just the log — under the old guard this flag was absent for the whole run");

  // …and so does a stale-repair re-digest — the production in-place forced re-dispatch. Its
  // `_driver/delivery-stale.json` is written for real by the blocked delivery pass (pipeline.mjs ~8162);
  // the shape here is that writer's, so the entry point is driven exactly as production drives it.
  setKnobs({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  writeFileSync(driverDir(r1.runDir, "delivery-stale.json"), JSON.stringify({
    ts: new Date().toISOString(), labels: ["register-digest"], changed: { "register-digest": ["primary-sweep.md"] },
  }, null, 2));
  const rep = await PL.repairStale(job, { codename });
  assert.deepEqual(rep, { ok: true, repaired: ["register-digest"], failed: [] }, "the stale-repair entry point re-digested");
  const ev = events(r1.runDir).filter((e) => e.event === "digest-rulings-tail");
  assert.deepEqual(ev.map((e) => e.trigger), ["settlement-flush", "stale-repair"],
    "the run's own flush and the stale-repair re-digest BOTH log the injection");
  assert.ok(ev[0].chars > 0);
  assert.ok(existsSync(driverDir(r1.runDir, "mock-rulings-tail.flag")),
    "and the tail actually reached the dispatched message, not just the log");
});
