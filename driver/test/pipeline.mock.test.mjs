// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet
// Offline driver dry-run: runs the WHOLE pipeline against a mock engine (no billable calls).
// Asserts stage sequence, the fan-in barrier, skeptic escalation, the verdict gate, and sentinels.
import { test } from "node:test";
import { refusalsFor } from "../synthesis-record.mjs";   // tracker issue 1893 — the run's record that a defect was refused and restated
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // Refs tracker issue 1838 — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir, driverRel } from "../../shared/driver-dir.mjs";   // #1336
import { fileURLToPath } from "node:url";
import { MEANING_SEAT } from "../common-law-receipts.mjs";

// The pool's public base URL is deployment config with NO placeholder default — unset ⇒ publishReport
// omits the link and status.url is null. These tests assert a delivered run carries a report link, so they
// stand on a configured deployment.
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");

const HERE = dirname(fileURLToPath(import.meta.url));
import { acceptRegisterDigest, emptyFacts } from "../register-digest-record.mjs";   // conversion 11 — the refusal that removed the live unnamed-drop shape
// recursively find the first file named `name` under `root` (best-effort — null if none / unreadable)
function findFile(root, name) {
  try { const hit = readdirSync(root, { recursive: true }).find((p) => String(p).endsWith(`/${name}`) || String(p) === name); return hit ? join(root, hit) : null; }
  catch { return null; }
}
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// repair-first: the fan-in plan-direct-execute repair would otherwise call the REAL provider adapter
// (network) when a mock run drops a dictated qid — off by default here; tests that exercise the repair
// inject opts.planExecutor, which takes precedence over this gate.
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
// copper-lattice enforcement knobs are OFF in THIS legacy harness: (a) config.workspaceRoot freezes at
// first import, so every scenario shares one slug dir — a delivery's _known-conflicts.json upsert would
// read as the NEXT scenario's "recall regression"; (b) several fixtures deliberately ship an unclosed
// deferred row (pre-clamp shapes) and assert non-verdict behaviour. The dedicated
// pipeline.mock.registergap.test.mjs file (own process, own root) exercises both clamps ON.
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// spec 62 (per-project config): the shipped profiles/ carries the demo customers but no project overlays.
// Seed a CLEAROTRON_CUSTOMERS_DIR copy of the real profiles/ dir plus a projects/aurora/console-ecosystem.json
// overlay so the project path runs end-to-end. Set BEFORE the first pipeline import — profiles.mjs freezes
// its PROFILE_DIR when the module first loads (the same first-import freeze the workspaceRoot notes below
// describe), and this file only imports the pipeline lazily inside runPipeline.
const PROFILES_SEED = mkdtempSync(join(tmpdir(), "prelim-profiles-"));
cpSync(join(HERE, "..", "profiles"), PROFILES_SEED, { recursive: true });
mkdirSync(join(PROFILES_SEED, "projects", "aurora"), { recursive: true });
writeFileSync(join(PROFILES_SEED, "projects", "aurora", "console-ecosystem.json"), JSON.stringify({
  projectName: "Console ecosystem",
  platforms: ["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com",
    "gog.com", "itch.io", "mobygames.com", "humblebundle.com", "gamejolt.com"],
}, null, 2) + "\n");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES_SEED);

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// Fresh module graph + env per run (driver.config reads env at import time).
async function runPipeline(env, jobPatch = {}, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-mock-"));
  // hermetic: clear the mock knobs so one test's MOCK_* never bleeds into the next (env is process-global).
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  await opts.seed?.(root);   // config is all getters now (access-time env) — seed INSIDE this run's root
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, root, events };
}
const stageOrder = (events) => events.filter((e) => e.event === "stage").map((e) => e.stage);

// ── The retired `client-summary` stage (2026-08-01) ─────────────────────────────────────────────────
// The stage is gone, and this is the test that says so from the OUTSIDE: a full live pipeline run must
// produce no client-summary.md, dispatch no such stage, write no scope sidecar for it — and still
// deliver. Written as a live-run assertion rather than a code grep because the failure mode being
// guarded is a resurrection through any path (a stage table entry, a stale-repair arm, a re-emit
// ladder), not a particular line of source.
//
// Its counterpart lives in the REPLAY contract and must stay green independently: verify.mjs's
// validators.clientSummary / checkClientSummaryJoin and the client-summary-capable checks in
// predelivery-lint.mjs are all still exercised over archived runs by replay-archive.mjs.
test("retired stage: a live run writes NO client-summary.md, dispatches no client-summary stage, and still delivers", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  // It DELIVERED — the point of the retirement is that nothing downstream needed the stage.
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the run still delivers with the stage gone");
  // No artifact, and no scope sidecar that only that stage consumed.
  assert.ok(!existsSync(join(res.runDir, "client-summary.md")), "no client-summary.md is written");
  assert.ok(!existsSync(driverDir(res.runDir, "client-summary-scope.json")), "no client-summary scope sidecar");
  // No dispatch, under ANY trigger — the fresh call, the boundary re-emit, the stale repair, a lint redo.
  assert.ok(!events.some((e) => e.event === "stage" && String(e.stage).split(":")[0] === "client-summary"),
    `no client-summary dispatch: ${JSON.stringify(events.filter((e) => String(e.stage ?? "").includes("client-summary")))}`);
  assert.ok(!events.some((e) => e.event === "client-summary-degenerate" || e.event === "client-tier-auto-correct"),
    "neither the boundary ladder nor the tier auto-correct can fire");
  // The report — the one delivered document — is still there and still the lint's surface.
  assert.ok(existsSync(join(res.runDir, "report.md")), "the one report is delivered");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  assert.equal(receipt.artifactSet.surfaces.length, 1, "the receipt evaluates ONE delivered surface");
  assert.equal(receipt.artifactSet.surfaces[0].name, "report.md", "and that surface is the report");
  // The `:email` reference check did NOT leave with the stage — it was gated on the client summary and
  // is now gated on the report-derived cover text. A check that stops running is not a check that passes.
  assert.ok(receipt.checks.some((c) => String(c.id).endsWith(":email")),
    `the email surface is still linted: ${JSON.stringify(receipt.checks.map((c) => c.id).filter((i) => i.includes("email")))}`);
  // …and no check reports itself against the retired surface.
  assert.ok(!receipt.checks.some((c) => c.surface === "client-summary"),
    `no check judges the absent surface: ${JSON.stringify(receipt.checks.filter((c) => c.surface === "client-summary").map((c) => c.id))}`);
});

test("happy path: CLEAR verdict → full sequence, delivered + archived", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CLEAR");
  assert.ok(existsSync(join(res.runDir, ".delivered")), ".delivered sentinel present");
  assert.ok(res.runDir.includes("/archive/"), "run-dir archived");

  // #1092 — THE TRANSPORT WAS THE WRITER, asserted on the CALL CAPTURE and never on the artifact. The
  // artifact is void as evidence in either direction: `recordBlindFrame` writes blind-frame-model.json AND
  // the capture, so a surface with two writers discriminates nothing (e2e's ruling, from having to answer
  // this question off 2e203b75's tree). The capture is written BEFORE validation, so it exists even for a
  // refused call — which is what makes its ABSENCE mean "the seat took the deleted path" rather than "the
  // call failed". Before this PR, this run left no capture at all.
  assert.ok(existsSync(driverDir(res.runDir, "blind-frame-calls", "call-001.json")),
    "no record_blind_frame call capture — the model reached disk by some other writer");
  assert.ok(existsSync(join(res.runDir, "blind-frame-model.json")), "…and the driver rendered the artifact from it");
  // #1092, second conversion — same keying for skeptic. Both recording stages are now proven by their
  // capture in every run of this test, which is the state e2e could not find on 2e203b75: capture absent,
  // artifact present, hand-written.
  assert.ok(existsSync(driverDir(res.runDir, "skeptic-calls", "call-001.json")),
    "no record_skeptic call capture — skeptic-flags.md reached disk by some other writer");
  assert.ok(existsSync(join(res.runDir, "skeptic-flags.md")), "…and the driver rendered the flags from it");
  // #1092, third conversion — frame-diff, and the first whose ONE call owns TWO artifacts. Both are
  // asserted, because the pair is the property: the JSON is what every consumer reads and the prose is
  // rendered from the same parsed model, so a run carrying one without the other means the render and the
  // serialize came apart. The capture is still the discriminator — the artifacts have had two writers in
  // living memory and prove nothing on their own.
  assert.ok(existsSync(driverDir(res.runDir, "frame-diff-calls", "call-001.json")),
    "no record_frame_diff call capture — the diff reached disk by some other writer");
  assert.ok(existsSync(join(res.runDir, "frame-diff.json")), "…and the driver serialized the structured diff from it");
  assert.ok(existsSync(join(res.runDir, "frame-diff.md")), "…and rendered the prose from the same model");

  const order = stageOrder(events);
  // key ordering invariants
  const idx = (s) => order.findIndex((x) => x.startsWith(s));
  assert.ok(idx("matter-frame") < idx("prelim-variants"), "matter-frame before variants");
  assert.ok(idx("prelim-variants") < idx("common-law"), "variants before gather");
  assert.ok(idx("register-digest") > idx("placement-inquiry"), "digest after placement");
  assert.ok(idx("placement-inquiry") > idx("register-unit:primary-sweep"), "placement after units");
  assert.ok(idx("skeptic") < idx("synthesis"), "skeptic before synthesis");
  assert.ok(idx("synthesis") < idx("narrative-refutation"), "synthesis before refutation");
  // delivery (B1): report-overview (LLM shell) + report-card (LLM, one per finding) → assemble/audit/publish
  // (all CODE). On the anthropic-agent engine the driver runs in HANDOFF mode: it writes a self-contained
  // _driver/delivery.json packet + leaves .delivered{sendPending} for clawdi's comms watch, and does NOT run
  // the notify/notify-chat gateway stages (they live on clawdi's comms plane; see pipeline.anthropic.test.mjs).
  assert.ok(idx("narrative-refutation") < idx("report-overview"), "report-overview after refutation");
  assert.ok(order.some((s) => s.startsWith("report-card")), "B1 per-card render ran (≥1 full-prose finding)");
  assert.ok(!order.includes("notify") && !order.includes("notify-chat"), "handoff mode: no notify gateway stages");
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.equal(packet.verdict, "CLEAR", "delivery packet carries the verdict for clawdi's send");
  assert.equal(JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8")).sendPending, true, ".delivered marks sendPending");
  assert.ok(!order.includes("audit-emit"), "audit-emit is no longer an LLM stage");
  assert.ok(existsSync(join(res.runDir, ".published")) || res.runDir.includes("/archive/"), "published");
  // fan-out breadth: the manifest markers select all 4 axes
  for (const ax of ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"])
    assert.ok(order.includes(`register-unit:${ax}`), `axis ${ax} ran`);
  // #519 — the narrative mentions "watchlist", and this job's product is NOT the Full country search, so
  // the reading is RECORDED and NOT RUN. REWRITTEN, not deleted: the old assertion here
  // (`order.includes("case-law")`) is the defect at integration level — a case-law pass starting mid-run
  // on a product that does not carry it, past no door and with no scope guard.
  assert.ok(!order.includes("case-law"),
    "case-law must not run on a product that does not carry the reading — this is #519's whole subject");
  const clDecision = events.find((e) => e.event === "case-law-decision");
  assert.ok(clDecision, "the decision is journalled UNCONDITIONALLY — its absence is what made this invisible");
  assert.equal(clDecision.detected, true, "the run's own reading still noticed the watchlist mention");
  assert.equal(clDecision.run, false);
  assert.equal(clDecision.declined, true, "and the state has a name a round can grep for");
  assert.equal(clDecision.trigger, "watchlist", "which word triggered it, or the observation cannot be acted on");
  assert.ok(!events.some((e) => e.event === "case-law-trigger"), "nothing claims the pass was triggered");
  // verdict event recorded
  assert.ok(events.some((e) => e.event === "verdict" && e.verdict === "CLEAR"));
  // Spec A3 — the mock ledger carries a deferred NZ row and the job has no deadline ⇒ the envelope rule
  // closes it in-loop: decision logged, the owning unit re-run warm, and (spec-66 funnel) the re-digest
  // rides the ONE pre-synthesis settlement flush instead of firing its own pass.
  assert.ok(events.some((e) => e.event === "envelope-decision" && e.close === true), "envelope decision logged");
  assert.ok(events.some((e) => e.event === "envelope-closed" && e.axes.includes("primary-sweep")), "deferred floor closed in-loop");
  assert.ok(events.some((e) => e.event === "digest-queued" && e.trigger === "envelope"), "envelope minted a durable digest receipt");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"), "the settlement flush paid the receipt down");
  // Spec A2 — the pre-delivery lint receipt is ALWAYS written (here: all checks pass, no flags).
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  assert.ok(Array.isArray(receipt.checks) && receipt.checks.length > 0, "lint receipt carries named checks");
  assert.equal(receipt.failures.length, 0, `mock run must lint clean: ${JSON.stringify(receipt.failures)}`);
  assert.ok(receipt.checks.some((c) => c.id === "scope-numbers-in-prose"), "the counting flip runs on the live path");
  // PR-4 compute-don't-author: the masthead scope line is DRIVER-owned — _driver/scope-facts.json is the
  // join (instructed × frozen plan × band states × ledger) and the report front-matter is stamped from it.
  const scopeFacts = JSON.parse(readFileSync(driverDir(res.runDir, "scope-facts.json"), "utf8"));
  assert.equal(scopeFacts.classes_line, "9, 41", "instructed classes verbatim (the job said 9 + 41)");
  assert.ok(scopeFacts.per_class["9"] && scopeFacts.per_class["41"], "per-class join present");
  const reportFm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n([\s\S]*?)\n---\n/)[1];
  assert.match(reportFm, /^classes: 9, 41$/m, "classes: line stamped from scope-facts (not the model's)");
  if (scopeFacts.coverage_line) assert.ok(reportFm.includes(`coverage_line: ${scopeFacts.coverage_line}`), "coverage_line injected verbatim");
  assert.ok(events.some((e) => e.event === "scope-facts"), "scope-facts event logged");
  // Frame-omission design: the blind pass runs parallel with the gather; the frame-diff runs on the
  // gathered evidence with a CLEAN diff (no directives) on the happy path — no reopen, no clamp, CLEAR.
  assert.ok(order.includes("blind-frame"), "blind-frame ran (sibling of the gather)");
  assert.ok(idx("prelim-variants") < idx("blind-frame"), "blind-frame after variants");
  // #250 — the frame settles BEFORE placement dispatches, so placement runs once on the settled frame.
  assert.ok(idx("frame-diff") < idx("placement-inquiry"), "frame-diff settles the frame before placement");
  assert.ok(idx("placement-inquiry") < idx("register-digest") && idx("register-digest") < idx("synthesis"),
    "placement → digest → synthesis order is unchanged below the frame seam");
  assert.ok(events.some((e) => e.event === "frame-diff" && e.firing === 0), "clean frame-diff: zero firing directives");
  assert.ok(!events.some((e) => e.event === "frame-reopen"), "no reopen on a clean diff");
  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "frame-reopen"), "no frame-reopen re-digest on a clean diff");
});

// B5 (atomic-writes): the CANONICAL _driver/grid-spec.json — the file the fail-closed validator/receipts
// join keys on — is written through the temp+rename helper exactly like the HALF specs, so a reader ever
// sees the OLD complete file or the NEW complete file, never a torn/truncated write. Assert the run leaves
// a complete, parseable canonical spec (never a partial) and no stranded sibling .tmp debris in _driver.
test("B5: the canonical grid-spec.json lands complete (atomic temp+rename) with no torn/tmp debris", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const dDir = driverDir(res.runDir);
  const specPath = join(dDir, "grid-spec.json");
  assert.ok(existsSync(specPath), "canonical grid-spec.json present");
  const raw = readFileSync(specPath, "utf8");
  const spec = JSON.parse(raw);   // a torn write would fail to parse — the fail-closed reader rejects it
  assert.ok(Array.isArray(spec.terms) && spec.terms.length > 0, "complete spec: terms[] present");
  assert.ok(Array.isArray(spec.platforms) && spec.platforms.includes("web"), "complete spec: platforms carry the general-web cell");
  assert.equal(spec.ledger_required, true, "complete spec: the D1 fail-closed stamp is present (last field written)");
  assert.deepEqual(JSON.parse(readFileSync(specPath, "utf8")), spec, "re-read is identical (new-complete, stable)");
  const debris = readdirSync(dDir).filter((f) => f.startsWith("grid-spec.json.") && f.endsWith(".tmp"));
  assert.deepEqual(debris, [], "the sibling tmp was renamed away, not left behind");
});

// P2-C (Round-2 §8b): the frame's authored per-matter meaning angles append VERBATIM to the dictated
// connotation sweep BESIDE the fixed shape floor — floor-equal citizens end-to-end: dictated in the spec,
// executed and receipted into extras.pr_risk (the identity gate's join surface), and count-ASSERTED in the
// grid-spec event (a 0 is a recorded zero, never an absence).
test("P2-C: derived meaning angles ride the dictated sweep beside the floor — spec, receipts, asserted count", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MEANING_ANGLES: "novapulse gaming backlash; novapulse political meaning" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const spec = JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8"));
  const q = spec.connotation.queries;
  assert.equal(spec.connotation.disposition_required, true,
    "every fresh spec carries the receipts-disposition stamp (leg 2's receipt-presence key — archived specs lack it)");
  assert.ok(q.some((x) => new RegExp(`\\s(${["meaning slang", "gang", "offensive", "urban dictionary", "wikipedia"].join("|")})$`).test(x)),
    "the fixed shape floor still rides (derivation adds, never replaces)");
  assert.deepEqual(q.slice(-2), ["novapulse gaming backlash", "novapulse political meaning"],
    "the frame's angles append verbatim after the floor buckets");
  // the plugin's ledger records each dictated query — derived ones included (the per-query identity join surface)
  const grid = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  const recorded = new Set((grid.extras?.pr_risk ?? []).map((e) => e.query));
  for (const a of ["novapulse gaming backlash", "novapulse political meaning"])
    assert.ok(recorded.has(a), `derived angle receipted: ${a}`);
  const gs = events.find((e) => e.event === "grid-spec");
  assert.equal(gs.connotation_derived, 2, "the derived count is asserted in the grid-spec event");
  assert.equal(gs.connotation, q.length, "the total dictated count includes the derived pair");
  // review round 2026-07-31: the meaning-angles line requirement is gated on the matter-frame
  // STAGE-CONTRACT marker (recordStageContract at dispatch), NEVER the instructed-scope sentinel —
  // assert the dispatch actually wrote it, so the validator's arm and the pipeline can't drift apart.
  const contracts = JSON.parse(readFileSync(driverDir(res.runDir, "stage-contracts.json"), "utf8"));
  assert.equal(contracts["matter-frame"]?.meaningAngles, 1, "the matter-frame contract marker is recorded at dispatch");
  // and the default harness path asserts its ZERO: the mock frame's "Meaning angles: none" run records 0
  const { events: noneEvents } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(noneEvents.find((e) => e.event === "grid-spec").connotation_derived, 0,
    "'Meaning angles: none' is an asserted zero, never an absence");
});

// #254 — blind-frame's prose twin is retired and the structured model is the stage's ONLY output. The
// question that change has to answer is what happens when the model does NOT land: the stage used to gate
// on a prose file, and a gate that no longer exists is how an absence starts reading as a pass. It must
// fail by NAME. MOCK_NO_BLIND_MODEL is a turn that completes and writes nothing at all — the exact shape.
test("#254: a blind-frame turn that writes no model FAILS by name (missing_file) — the run degrades, it never passes silently", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_NO_BLIND_MODEL: "1" });
  const runDir = res.runDir;
  assert.ok(!existsSync(join(runDir, "blind-frame-model.json")), "the knob really did suppress the model");
  // 1. the stage did not quietly succeed
  const bf = events.filter((e) => e.event === "stage" && e.stage === "blind-frame");
  assert.ok(bf.length > 0, "blind-frame was dispatched");
  assert.ok(bf.every((e) => e.ok !== true), `blind-frame must not report ok with no model on disk: ${JSON.stringify(bf)}`);
  // 2. and the failure NAMES the missing artifact — a token the corrective ladder and a human can both read
  const skipped = events.find((e) => e.event === "blind-frame-skipped");
  assert.ok(skipped, "the pipeline recorded the non-fatal blind-frame failure");
  assert.match(String(skipped.reason), /missing_file:.*blind-frame-model\.json/,
    `the reason must name the absent model, not a generic failure: ${skipped.reason}`);
  // 3. the downstream consumer is gated OFF rather than run against nothing
  assert.ok(!stageOrder(events).includes("frame-diff"), "frame-diff must not run without a blind model");
  assert.ok(!events.some((e) => e.event === "frame-diff"), "no frame-diff verdict event on a model-less run");
  // 4. and the run still delivers — blind-frame is NON-FATAL, which is unchanged by this issue
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(runDir, "report.md")), "delivery is unaffected: the blind pass is a non-fatal sibling");
});

test("frame-omission: a firing frame-diff fires a supplemental sweep BEFORE placement — ONE placement dispatch, no re-digest; an unclosed dominant-element gap clamps CLEAR→CONDITIONAL", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "reopen" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const order = stageOrder(events);
  assert.ok(order.includes("blind-frame") && order.includes("frame-diff"), "blind-frame + frame-diff ran");
  assert.ok(events.some((e) => e.event === "frame-diff" && e.firing >= 1 && e.dominant_element_gap === true), "frame-diff flagged a firing directive + a dominant-element gap");
  assert.ok(events.some((e) => e.event === "frame-reopen" && e.swept >= 1), "frame-reopen swept a directive");
  // ── #250, THE WHOLE POINT: ONE placement dispatch ────────────────────────────────────────────────
  // Before this issue the reopen regenerated the register band AFTER placement had already run on the
  // pre-enumeration band, and had to dispatch placement a SECOND time or the delivery-freshness gate
  // would refuse the report. That second dispatch was 204K output tokens / ~46 min of wall-clock across
  // two passes on the 2026-08-02 R2 run. The frame now settles first, so placement dispatches once.
  const placementDispatches = events.filter((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.ok !== false);
  assert.equal(placementDispatches.length, 1,
    `placement-inquiry dispatches exactly once on a REOPENING run: ${JSON.stringify(placementDispatches.map((e) => e.trigger ?? null))}`);
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "frame-reopen"),
    "the frame-reopen placement refresh is gone");
  assert.ok(!events.some((e) => e.event === "frame-reopen-placement-refresh"), "…and so is its receipt event");
  // the sweep lands BEFORE placement, which is what makes the second dispatch unnecessary rather than
  // merely deleted — placement reads the enumerated band on its one and only pass.
  const reopenIdx = events.findIndex((e) => e.event === "frame-reopen");
  const placementIdx = events.findIndex((e) => e.event === "stage" && e.stage === "placement-inquiry");
  assert.ok(reopenIdx >= 0 && reopenIdx < placementIdx, "the reopen's sweeps land before placement dispatches");
  // and the reopen buys NO digest pass of its own on a fresh run. The queue is not settled at the frame
  // seam, because there are no prior findings to reconcile against — the digest has not run yet — and
  // settling it there would strand escalation's and envelope's later mints and park the run. Whatever
  // digest passes this run does spend belong to the mechanisms that own them (here: the envelope's
  // settlement flush at the standalone seam, unchanged by #250).
  assert.ok(events.some((e) => e.event === "frame-reopen-reconcile-not-needed"),
    "the un-needed reconcile is RECORDED, not silently skipped");
  assert.ok(!events.some((e) => e.event === "digest-queued" && e.trigger === "frame-reopen"),
    "no meaningless reconcile segment is minted on a fresh run");
  for (const f of events.filter((e) => e.event === "digest-flush"))
    assert.ok(!(f.triggers ?? []).includes("frame-reopen"), `no flush carries a frame-reopen section: ${JSON.stringify(f)}`);
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "frame-reopen"),
    "the legacy inline frame-reopen re-digest is gone");
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "delivery is not stale-blocked — placement is fresh vs the enumerated band");
  // the dominant-element gap was not closed (no dominant-element-severity directive) → clamp CLEAR→CONDITIONAL
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.frameGap === true), "the unclosed dominant-element gap clamped the verdict");
  assert.equal(res.verdict, "CONDITIONAL", "clamped verdict delivered (never withheld)");
  // the idempotency receipt is written; spec-49 T4: the fm caveat note is DEAD — the substance rides
  // the clamp reason (asserted above) + the injected coverage rows, never a front-matter caveat.
  assert.ok(existsSync(driverDir(res.runDir, "frame-reopen.json")), "frame-reopen receipt written");
  assert.doesNotMatch(readFileSync(join(res.runDir, "report.md"), "utf8"), /frame_reopen_note/, "no fm caveat note post-spec-49");
});

// ── #250 ZERO SEMANTICS ──────────────────────────────────────────────────────────────────────────────
// Seven bugs have shipped at this seam where an absence was read as a pass, so moving the block earns
// the question directly: after the move, does "the reopen produced no directives" read differently from
// "the reopen never ran"? Both are an absence of frame-reopen rows, so the discriminator cannot be an
// absence — it has to be positive evidence, and every ending now writes one. This test is the guard on
// that: three runs, three distinct endings, none of them inferrable from silence.
test("#250 zero semantics: a settled frame, a frame nobody asked about, and a swept reopen are three DISTINCT endings in run.jsonl", async () => {
  const clean = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const noModel = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_NO_BLIND_MODEL: "1" });
  const reopened = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "reopen" });
  const ending = (events) => ({
    asked: events.some((e) => e.event === "frame-diff"),
    notAskedReasons: events.filter((e) => e.event === "frame-diff-skipped").map((e) => e.reason),
    firing: (events.find((e) => e.event === "frame-diff") ?? {}).firing,
    reopen: events.find((e) => e.event === "frame-reopen") ?? events.find((e) => e.event === "frame-reopen-skipped") ?? null,
  });

  // 1. ASKED, AND THE FRAME IS SETTLED — the stage ran, the diff came back clean, no reopen followed.
  // firing:0 is an ASSERTED zero on a row that exists, not the absence of a row.
  const a = ending(clean.events);
  assert.equal(a.asked, true, "clean run: the frame question WAS asked");
  assert.equal(a.firing, 0, "…and came back with zero firing directives — a recorded zero");
  assert.equal(a.reopen, null, "…so no reopen ran, and nothing pretends one did");
  assert.deepEqual(a.notAskedReasons, [], "…and nothing claims the question was skipped");

  // 2. NEVER ASKED — no blind model, so there is no cold view to diff against. The absence of
  // frame-diff rows now travels WITH a row naming the reason; it can never be read as a clean diff.
  const b = ending(noModel.events);
  assert.equal(b.asked, false, "no-blind-model run: the frame question was never asked");
  assert.deepEqual(b.notAskedReasons, ["no-blind-model"], "…and the run says so by name");
  assert.equal(b.reopen, null);

  // 3. ASKED, ANSWERED, SWEPT — directives fired and the reopen's ending states domClosed explicitly.
  const c = ending(reopened.events);
  assert.equal(c.asked, true);
  assert.ok(c.firing >= 1, "reopening run: directives fired");
  assert.ok(c.reopen && typeof c.reopen.domClosed === "boolean",
    `the reopen states domClosed explicitly — never left to be inferred: ${JSON.stringify(c.reopen)}`);
  assert.ok(c.reopen.swept >= 1, "…and states how many directives it actually swept");

  // the three are mutually distinguishable on the same predicate a reader would apply
  const shape = (x) => [x.asked, x.firing ?? null, x.reopen ? "reopened" : "none", x.notAskedReasons.join("|")];
  assert.notDeepEqual(shape(a), shape(b), "settled ≠ never-asked");
  assert.notDeepEqual(shape(a), shape(c), "settled ≠ swept");
  assert.notDeepEqual(shape(b), shape(c), "never-asked ≠ swept");

  // …and wherever the question IS asked, it is answered BEFORE the one placement dispatch (#250)
  for (const { events } of [clean, reopened]) {
    const fdIdx = events.findIndex((e) => e.event === "frame-diff");
    const plIdx = events.findIndex((e) => e.event === "stage" && e.stage === "placement-inquiry");
    assert.ok(fdIdx >= 0 && plIdx > fdIdx, "the frame settles before placement dispatches");
    assert.equal(events.filter((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.ok !== false).length, 1,
      "exactly one placement dispatch");
  }
});

test("deliver-conditional: a material coverage gap (coverage_judgment.sufficient:false) clamps CLEAR→CONDITIONAL and STILL delivers — never a halt", async () => {
  // judgment-relocation (revised 2026-06-24): the lawyer judged a material register slice not fully cleared.
  // The run does NOT re-search and does NOT halt — it ships a CONDITIONAL carrying the honest reason. This is
  // the "no shit output, but a lawyer always gets a report" guarantee: a material gap can never ship as a silent
  // clean, and it can never become a no-deliver stop.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_COVERAGE_INSUFFICIENT: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));               // the run DELIVERED (no halt, no fail)
  assert.equal(res.verdict, "CONDITIONAL", "a material coverage gap clamps CLEAR→CONDITIONAL, never silent clean");
  assert.ok(events.some((e) => e.event === "coverage-judgment" && e.sufficient === false), "the sufficiency signal was read");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.coverageInsufficient === true), "the coverage-insufficient clamp fired");
  // the run delivered (sentinel / archive) — a material gap is a conditional, never an incomplete-needs-human stop
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "delivered, not halted");
  assert.ok(!existsSync(join(res.runDir, ".incomplete-needs-human")), "no halt state exists any more");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.verdict, "CONDITIONAL", "delivered status carries the clamp");
});

test("skeptic escalation: a flagged axis resumes (defend/adjust, same tier) + re-digest", async () => {
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    // structured token drives escalation now — NOT prose. Mention an axis in prose without an ESCALATE line
    // and it must NOT re-run; only the ESCALATE: line escalates.
    MOCK_SKEPTIC: "- primary-sweep under-paged the NZ sub-query (incumbent-class looks fine)\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run the NZ sub-query",
  });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && e.escalated.includes("primary-sweep")), "escalation recorded");
  assert.ok(!events.some((e) => e.event === "skeptic-escalation" && e.escalated.includes("incumbent-class")), "prose-only mention must NOT escalate");
  // register-digest should appear twice (original + re-digest)
  const digests = stageOrder(events).filter((s) => s.startsWith("register-digest"));
  assert.ok(digests.length >= 2, `expected re-digest, got ${digests.length}`);
});

// spec-48 D3 — the escalation-risk SHADOW apparatus is deleted; ESCALATE lines still re-run their axes.
test("escalation (post-D3): ESCALATE lines re-run their axes; no shadow risk telemetry is emitted", async () => {
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_SKEPTIC: "- two concerns\n\n## Escalation decisions\n" +
      "ESCALATE: primary-sweep — re-run the NZ sub-query\n" +
      "ESCALATE: incumbent-class — ledger wording could be tidier",
  });
  assert.equal(res.ok, true);
  const esc = events.find((e) => e.event === "skeptic-escalation");
  assert.ok(esc.escalated.includes("primary-sweep") && esc.escalated.includes("incumbent-class"), "both axes re-run");
  assert.ok(!events.some((e) => e.event === "escalation-risk" || e.event === "escalation-risk-malformed"),
    "the shadow telemetry is gone with the apparatus");
});

test("escalation skipped: an axis whose ledger gap is a documented coverage-limit is NOT re-run (Lever 4)", async () => {
  // transliteration-numeric gets a `coverage-limited`-ONLY ledger row (MOCK_LEDGER_LIMITED). The skeptic
  // escalates it — but the gate recognises a documented/accepted limit and skips the warm re-run + re-digest.
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_LEDGER_LIMITED: "transliteration-numeric",
    MOCK_SKEPTIC: "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — re-run the extra script group",
  });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.event === "escalation-skipped" && e.axis === "transliteration-numeric"), "escalation-skipped recorded");
  assert.ok(!events.some((e) => e.event === "skeptic-escalation"), "no axis actually escalated (the only flagged one was skipped)");
  // no SKEPTIC re-digest fired — the only extra digest is the A3 envelope's deferred-NZ close (trigger
  // "envelope", standing mock fixture), never an escalation one.
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "escalation"),
    "no escalation re-digest");
  const digests = events.filter((e) => e.event === "stage" && e.stage === "register-digest");
  assert.equal(digests.length, 2, `expected fresh + envelope digests only, got ${digests.length}`);
});

test("escalation NOT skipped: an axis with a `deferred` gap still re-runs even alongside the skip path (floor guard)", async () => {
  // primary-sweep keeps its `deferred` NZ row (a real closeable gap) while transliteration-numeric is a
  // documented coverage-limit. Escalating BOTH: only the documented limit is skipped; the deferred axis fires.
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_LEDGER_LIMITED: "transliteration-numeric",
    MOCK_SKEPTIC: "- two gaps\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run the NZ sub-query\nESCALATE: transliteration-numeric — extra script group",
  });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.event === "escalation-skipped" && e.axis === "transliteration-numeric"), "documented limit skipped");
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && e.escalated.includes("primary-sweep")), "deferred axis still escalates");
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && !e.escalated.includes("transliteration-numeric")), "skipped axis is not in the escalated set");
});

test("#1273 THE HOLD — a designated floor axis excused as coverage-limited is NOT skipped, and IS disclosed", async () => {
  // BOTH knobs on the SAME axis, and that is the whole design of this arm rather than belt-and-braces.
  //
  // The first version designated `primary-sweep`, and it passed while asserting nothing. primary-sweep
  // carries a `confirmed-clean` row in the standing fixture, so `owned.every(coverage-limited)` is false
  // AND `openNonDeferred` is true — NEITHER skip branch can fire on that axis whatever the floor term
  // says. The not-skipped and escalated assertions were inert; only the disclosure half was live, which
  // is why the readFloorAxes plant still redded it and the vacuity survived one round of plants.
  //
  // `MOCK_LEDGER_LIMITED` is the fixture shape that actually reaches a skip — the CONTROL below proves
  // it. Pointing both knobs at `transliteration-numeric` makes every row on that axis coverage-limited,
  // so branch 1 WOULD skip it, and the only thing stopping it is the designation. That is also the
  // branch this PR extends the term onto, so it is the line most in need of a live arm.
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_LEDGER_LIMITED: "transliteration-numeric",
    MOCK_SEARCH_FLOOR: "transliteration-numeric",
    MOCK_SKEPTIC: "- the extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — re-run the extra script group",
  });
  assert.equal(res.ok, true);
  assert.ok(!events.some((e) => e.event === "escalation-skipped" && e.axis === "transliteration-numeric"),
    "a designated floor axis was skipped — it could not be fully checked and was quietly closed");
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && e.escalated.includes("transliteration-numeric")),
    "the floor axis was not pursued: `flagged and pursued` is two behaviours and only one happened");
  // …and the other behaviour: FLAGGED. The delivered report has to say the floor is open, in words a
  // client can act on — the disclosure half of the ruling, and the half a reader actually sees.
  const report = readFileSync(join(res.runDir, "report.md"), "utf8");
  assert.match(report, /envelope_note:/, "the run shipped with no open-floor note at all");
  assert.match(report, /search-floor work on a designated axis/,
    "the breach reached delivery as a bare unit name, or not at all — a client reading it learns nothing");
});

test("#1273 THE CONTROL — the SAME ledger with no designation still skips, so the arm above is not vacuous", async () => {
  // Identical run, one difference: no `search_floor`. If this also refused to skip, the arm above would
  // be measuring the ledger rather than the designation, and the mechanism would be defaulting to ON —
  // the failure the build was explicitly conditioned against.
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_LEDGER_LIMITED: "transliteration-numeric",
    MOCK_SKEPTIC: "- thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — re-run the extra script group",
  });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.event === "escalation-skipped" && e.axis === "transliteration-numeric"),
    "an UNdesignated coverage-limited axis stopped being skippable — the floor is defaulting to on");
});

// The C-2 acceptance arm and Fix2 #7 are RETIRED with the ⭐ search floor (#1203, owner ruling). They
// drove `MOCK_STAR_FLOOR` through a full mock run and asserted the breach reached the delivery
// disclosure. Both were real end-to-end coverage of a mechanism that is now deleted: after #1092
// conversion 3 no typed field can designate a ⭐, and the owner ruled the capability removed rather than
// regrown. Git history holds them if mandatory-sweep compliance is ever refiled.

// ── WS-A machine coverage ledger e2e (design of record PRELIM-VNEXT-THREE-WORKSTREAM-DESIGN) ─────────

test("WS-A happy path: driver DERIVES the JSON from prose; gates read it; no delivery flag", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, "register-coverage-ledger.json")), "JSON derived beside the findings");
  // Map #3 — the driver code-derives the JSON post-validate (the digest turn wrote only the prose).
  assert.ok(events.some((e) => e.event === "coverage-ledger-derived"), "driver derived the JSON from the prose");
  assert.ok(!events.some((e) => e.event === "coverage-ledger-fallback" || e.event === "coverage-ledger-quarantined"),
    "machine path clean — no fallback/quarantine");
  // the derive populates the JSON inline, so the never-kill save-followup never fires.
  assert.ok(!events.some((e) => e.event === "coverage-ledger-missing"), "no save-followup needed — the driver derived it");
  const report = readFileSync(join(res.runDir, "report.md"), "utf8");
  assert.doesNotMatch(report, /machine_ledger_note/);
  // the envelope close reconciled the machine ledger (NZ deferred → confirmed-clean), so delivery
  // states no open floor — pins the machine-path delivery surface.
  assert.doesNotMatch(report, /envelope_note:/);
});

test("WS-A (Map #3): the derived JSON validates as machine-ledger and round-trips the prose rows", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const { parseCoverageLedgerJson } = await import("../coverage-ledger.mjs");
  const raw = readFileSync(join(res.runDir, "register-coverage-ledger.json"), "utf8");
  const rows = parseCoverageLedgerJson(raw);              // throws if the derived JSON is malformed
  assert.ok(rows.length >= 1, "derived JSON carries the prose rows");
  // it agrees with the validator's machine path (registerFindings → ok("machine-ledger") when present)
  const { validators } = await import("../verify.mjs");
  const v = validators.registerFindings(join(res.runDir, "register-findings.md"), readFileSync(join(res.runDir, "register-findings.md"), "utf8"));
  assert.deepEqual(v, { ok: true, reason: "machine-ledger" }, "validator accepts the code-derived JSON, no mirror cross-check");
});

test("spec-49 T3 (H3): a digest that settles NO coverage row → the run FAILS (the D1 ship-as-CONDITIONAL clamp is retired)", async () => {
  // The doctrine is unchanged: machinery that leaves the coverage-honesty floor unable to run FAILS the
  // run, and never ships a finished-looking CONDITIONAL (the retired spec-48 D1 behaviour).
  //
  // #476 MOVED WHERE IT IS CAUGHT, AND EARLIER IS BETTER. Before the form, "no readable coverage" meant a
  // findings file whose Coverage-ledger section carried no parseable table — a shape that passed the
  // digest's own validator and only died at the pre-verdict floor, after the whole run had been spent.
  // The seat no longer writes that table: it fills in a form the driver wrote, and a form with no status
  // on any row is refused BY THE DIGEST'S OWN VALIDATOR (coverage_no_status) through the whole corrective
  // ladder. The run still fails and still delivers nothing; it fails at the stage that produced the
  // defect, naming it.
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_UNPARSEABLE_LEDGER: "1" });
  assert.equal(res.ok, false, "no settled coverage judgment ⇒ no verdict can ship");
  assert.equal(res.failedStage, "register-digest");
  assert.match(String(res.reason), /coverage_no_status/, "the failure NAMES the rows that carry no status");
  assert.ok(!existsSync(join(res.runDir, ".delivered")), "nothing delivered");
  assert.ok(existsSync(join(res.runDir, ".failed")), "the failure record is written");
});

test("WS-A: a forced re-digest DROPS the stale JSON first and the driver re-derives it (escalation)", async () => {
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_SKEPTIC: "- gap\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run the NZ sub-query",
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "digest-queued" && e.trigger === "escalation"), "escalation minted a durable digest receipt");
  assert.ok(events.some((e) => e.event === "coverage-ledger-dropped" && e.trigger === "settlement-flush"),
    "stale JSON dropped ahead of the settlement-flush re-digest");
  assert.ok(existsSync(join(res.runDir, "register-coverage-ledger.json")), "fresh JSON re-derived by the re-digest");
  assert.ok(events.some((e) => e.event === "coverage-ledger-derived" && e.trigger === "settlement-flush"),
    "the flush pass re-derived the JSON from the re-emitted prose");
  assert.ok(!events.some((e) => e.event === "coverage-ledger-fallback"), "no fallback — the derive populated it");
  assert.ok(!events.some((e) => e.event === "coverage-ledger-missing" && e.trigger === "settlement-flush"),
    "no save-followup on the flush pass — the driver derives it");
});

test("WS-A: --from register-digest re-run drops the stale JSON, then the driver RE-DERIVES it (non-followup forced re-runs)", async () => {
  // run 1 dies at synthesis (the first FATAL post-digest stage — the skeptic is non-fatal),
  // leaving a live run dir with a derived JSON beside the findings.
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "synthesis");
  const ledgerPath = join(r1.runDir, "register-coverage-ledger.json");
  assert.ok(existsSync(ledgerPath), "run 1 derived the JSON before failing");
  // plant a recognizable STALE-but-valid JSON, as if the prose were about to be rewritten under it
  const { writeFileSync: wf } = await import("node:fs");
  wf(ledgerPath, JSON.stringify([{ axis: "primary-sweep", scope: "STALE-MARKER", status: "deferred", reason: "stale" }]));
  // run 2: resume --from register-digest; the drop must still fire (forceFromActive, no followup) and the
  // driver must RE-DERIVE a fresh JSON from the re-emitted prose (Map #3 — no model save, no save-followup).
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename, fromStage: "register-digest" });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const events = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "coverage-ledger-dropped" && e.trigger === "fresh"),
    "stale JSON dropped on the forced non-followup re-run");
  assert.ok(events.some((e) => e.event === "coverage-ledger-derived" && e.trigger === "fresh"), "driver re-derived the fresh JSON");
  const finalLedger = readFileSync(join(r2.runDir, "register-coverage-ledger.json"), "utf8");
  assert.doesNotMatch(finalLedger, /STALE-MARKER/, "the gates never see the stale rows");
  assert.doesNotMatch(readFileSync(join(r2.runDir, "report.md"), "utf8"), /machine_ledger_note/,
    "re-derived run carries no false prose-fallback flag");
});

test("Map A e2e: a finding citing a fetched record renders its registry IDs FROM the record body (report.html)", async () => {
  // The mock emits a fetched record for the cited uri via the PRODUCTION record log — which since #743 is
  // the RUN's own `_driver/register-record-bodies.jsonl`, not a box-global file, so `MOCK_WRITE_RECORD`
  // alone is the whole setup. The driver's lint-pass assembleRunRecords materializes
  // _records/us-90000001.json from it, and the publish render must source the registry IDs from that body.
  const root = mkdtempSync(join(tmpdir(), "prelim-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_WRITE_RECORD: "1",
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  // a no-op fetcher: the record is already in the ledger, so the closure pass never needs the real provider.
  const res = await pipeline({ ...JOB, id: "mapa-job" }, { recordFetcher: async () => ({ ok: false, cause: "noop" }) });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, "_records", "us-90000001.json")), "record materialized into _records from the ledger");
  // driver.config.mjs caches its env-resolved roots at FIRST import (shared across the file's ?bust pipeline
  // re-imports), so the run publishes under the FIRST test's workspace root — which is res.runDir's ancestor.
  // Derive the pool from res.runDir (stable + returned), NOT from a re-read of the now-different env.
  const poolRoot = join(res.runDir.split("/workspace-")[0], "pool");
  // the pool dir name is the runId `${slug}-${date}-${codename}`; res.runDir basename is `${date}-${codename}`.
  // Match THIS run's pool dir by that suffix (the shared pool may hold other tests' novapulse runs).
  const suffix = res.runDir.split("/").pop();   // <date>-<codename>
  const poolDir = readdirSync(poolRoot, { withFileTypes: true }).find((d) => d.isDirectory() && d.name.endsWith(suffix));
  assert.ok(poolDir, `published run dir for ${suffix} present in the pool`);
  const html = readFileSync(join(poolRoot, poolDir.name, "report.html"), "utf8");
  assert.match(html, /reg\. 7100200/, "registration number rendered FROM the fetched record body");
  assert.match(html, /registered 2023/, "registration year rendered FROM the record (not model prose)");
});

// ── screen-gate REPAIR-OR-DISCLOSE, NEVER BLOCK e2e (2026-06-18) ──────────────────────────────────────
// The gate no longer hard-halts. An in-scope-live goods drop that was never record_fetched triggers a
// DRIVER code-fetch of THAT URI (deterministic, no model-compliance dependency); the digest re-decides on
// the now-fetched goods; whatever STILL can't be retrieved is DISCLOSED + clamps the verdict + DELIVERS.
// (live, 2026-06-17: 3 in-scope marks were genuinely never fetched, the generic re-digest
// re-ran byte-identical, and the old gate hard-halted a production run twice. A report must always ship.)

test("screen-gate REPAIRS: an in-scope-live goods drop without a record_fetch → DRIVER targeted code-fetch + re-decide on real goods → run PROCEEDS clean", async () => {
  // The first register-digest drops a live, in-scope (Class 42) mark off-field on a name-inferred goods guess
  // WITHOUT record_fetching it — a Finding-1 violation (its URI is in no ledger/_records). The driver fetches
  // THAT URI in code, then the digest re-decides on the REAL goods (the corrected drop:off-field-confirmed
  // row); the gate clears and the run delivers.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "mock no-op (re-decide path)" }; };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify(res));
  // the violation was detected and the DRIVER code-fetch chosen (not an immediate hard-halt), targeting the URI
  assert.ok(events.some((e) => e.event === "screen-gate-violation" && e.action === "driver-refetch"
    && e.uris.includes("/mark/cn/88001-42")), "first violation → driver-refetch logged for the flagged URI");
  assert.ok(fetched.includes("/mark/cn/88001-42"), "the driver fetched the EXACT flagged URI (targeted, not a generic re-digest)");
  // spec-66: the re-decide queues for the settlement flush (durable receipt) instead of firing its own
  // pass; the mechanism discloses TRANSIENTLY (at gate time the drop is still unexamined) and the
  // post-flush recheck heals it — sidecar cleared, clamp lifted. A healed gap must not keep clamping.
  assert.ok(events.some((e) => e.event === "digest-queued" && e.trigger === "screen-gate"), "screen-gate minted a durable digest receipt");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"),
    "the settlement flush carried the re-decide");
  assert.ok(events.some((e) => e.event === "screen-gate-clean" && e.recovered === true), "post-flush gate clean (recovered)");
  assert.ok(!existsSync(driverDir(res.runDir, "screen-gate-unresolved.json")), "sidecar cleared once the flush healed the gap");
  assert.ok(!events.some((e) => String(e.action || "").startsWith("hard-halt")), "no hard-halt ever");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "run delivered, not killed");
});

test("screen-gate DISCLOSE-AND-CONTINUE (owner decision 2026-07-22): an in-scope drop whose record is UNRETRIEVABLE ships as an unexamined disclosure + CONDITIONAL — never a dead run", async () => {
  // MOCK_SCREEN_DROP=persist — the digest re-emits the SAME surface drop after the re-fetch (the model won't
  // self-correct) AND the driver code-fetch fails (record 404 / provider error). The gate can neither verify
  // nor repair the drop. Owner decision 2026-07-22 (reversing doc-41 fix-or-fail, which killed an ION run
  // over provider 404s that morning): the mark is marked UNEXAMINED — couldn't fetch — NOT failed. The run
  // continues, the report carries a per-mark coverage row, and the coverage floor clamps CLEAR→CONDITIONAL
  // so nobody relies on that mark as clean.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "record 404 (mock — unretrievable)" }; };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "persist" }, {}, { recordFetcher });

  // the run DELIVERS — disclose-and-continue, never a dead run
  assert.equal(res.ok, true, `an unretrievable in-scope drop must no longer kill the run: ${JSON.stringify(res)}`);
  assert.ok(!existsSync(join(res.runDir, ".failed")), "no .failed sentinel");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "delivered");

  // the driver STILL attempts the TARGETED code-fetch FIRST (repair before disclosing)
  assert.ok(fetched.includes("/mark/cn/88001-42"), "driver code-fetched the flagged URI before disclosing");
  assert.ok(events.some((e) => e.event === "screen-gate-violation" && e.action === "driver-refetch"), "driver-refetch attempted first");

  // the irreducible gap is disclosed (action disclose-clamp), naming the unverifiable URI + cause
  const unresolved = events.find((e) => e.event === "screen-gate-unresolved" && e.action === "disclose-clamp");
  assert.ok(unresolved && unresolved.uris.includes("/mark/cn/88001-42"), "screen-gate-unresolved → disclose-clamp for the URI");
  assert.ok(unresolved.failures.some((f) => f.uri === "/mark/cn/88001-42" && /404/.test(f.cause)), "the fetch failure cause rides the event");
  assert.ok(!events.some((e) => e.event === "screen-gate-unresolved" && e.action === "fail-loud"), "the fail-loud arm is gone");

  // the durable sidecar carries the disclosure (a crash before delivery must not lose it)
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-unresolved.json"), "utf8"));
  assert.equal(sidecar.unresolved.length, 1);
  assert.equal(sidecar.unresolved[0].mark, "KINETIC");
  assert.equal(sidecar.unresolved[0].uri, "/mark/cn/88001-42");
  assert.match(sidecar.unresolved[0].cause, /404/);

  // the coverage floor clamped CLEAR→CONDITIONAL off the disclosure, naming the mark
  assert.equal(res.verdict, "CONDITIONAL", "verdict clamped — the unexamined mark cannot ship as clean");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.screenGate === 1), "screenGate floor arm fired");
  const verdictSidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.ok(verdictSidecar.reasons.some((r) => r.includes("KINETIC")), "the clamp reason names the mark");

  // the reader-visible disclosure: one coverage-limited row naming the mark, never a silent pass
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  const row = (findings.coverage ?? []).find((c) => String(c.area).includes("KINETIC"));
  assert.ok(row, "unexamined-drop coverage row injected");
  assert.equal(row.state, "coverage-limited", "coverage-limited (a disclosed limit — the clamp came from the floor, not this row)");
  assert.match(row.note, /could not be retrieved/);
  assert.match(row.note, /verify this record before relying/);
});

// ── CONVERSION 11 MADE THE UNNAMED DROP UNREACHABLE ON A LIVE RUN ──────────────────────────────────
//
// These two arms used to drive observe and enforce mode end to end through MOCK_SCREEN_DROP=unnamed —
// a goods-drop row naming no record, the ION/copper-foundry shape. That row cannot be produced any
// more: every `negative_rows` entry resolves a uri against the band or the call refuses
// `registerdigest_uri_missing`, so a typed digest CANNOT emit one. That is the conversion closing the
// hole on purpose — an unnamed bulk row is fourteen dismissals wearing one rationale — and it is why
// these are re-aimed rather than deleted.
//
// WHAT STILL PROTECTS THE ION INCIDENT, since none of it may be lost with the driving path:
//   · the refusal itself, pinned below — if it were ever relaxed, the live shape returns and these
//     arms should come back with it. Without this pin the unreachability is an accident.
//   · the mode filter's STRUCTURE, pinned below: one filter, one helper, both call sites. The ION bug
//     was precisely that the post-repair re-check called the raw helper, so observe mode held at the
//     first gate and not the second.
//   · detection of both unnamed classes, in screen-gate.test.mjs, driven over prose documents — which
//     is also the reachable population now: an ARCHIVED run written under the old dictation, whose
//     document the validator still parses.
//   · the disclose-clamp consequence, end to end, in the DISCLOSE-AND-CONTINUE arm above — it drives
//     the same unresolved path with a named-but-unretrievable record.
test("screen-gate: a typed digest CANNOT emit an unnamed goods-drop, and the run delivers", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "mock no-op (re-decide path)" });
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SCREEN_DROP: "unnamed" }, {}, { recordFetcher });

  // The shape never arises, so the observe-mode ledger has nothing to log. Asserted as an ABSENCE with
  // its reason stated, never left implicit: a missing event and a rule that stopped running look the
  // same from here, and the refusal arm below is what tells them apart.
  assert.equal(events.find((e) => e.event === "screen-gate-unnamed-observed"), undefined,
    "no unnamed row can reach the gate on a typed run — the transport refuses it at the call");
  assert.equal(res.ok, true, `the run still delivers: ${JSON.stringify(res)}`);
  assert.notEqual(res.failedStage, "screen-gate");
});

test("screen-gate: the transport REFUSES an unnamed drop row by name — the reason the arms above changed", () => {
  // The pin that makes the unreachability deliberate instead of incidental. Driven, not asserted from
  // the schema: a row with a drop_reason and a ground but no uri.
  const v = acceptRegisterDigest(
    { findings_rows: [], incumbent_rows: [], negative_rows: [{ drop_reason: "bulk slice — off-field", ground: "off-field" }] },
    emptyFacts());
  assert.equal(v.ok, false);
  assert.match(v.reason, /registerdigest_uri_missing:negative_rows/,
    "a drop row that names no record is refused AT THE CALL — this is what removed the live unnamed shape");
});

test("screen-gate: one mode filter, one helper, BOTH gate checks — the ION property, pinned at the source", () => {
  // ION died because observe mode was applied to the FIRST checkScreenGate() and the post-repair
  // re-check called the helper raw. The cure was structural — every gate read goes through
  // `enforcedViolations`, which owns the filter — so this asserts the structure rather than a run,
  // WITH a control that fails if it is reading the wrong text.
  const SRC = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const from = SRC.indexOf("const checkScreenGate = ()");
  const to = SRC.indexOf("// spec-66: AFTER any settlement/late flush", from);
  assert.ok(from > 0 && to > from && to - from < 8000,
    `the screen-gate block was not isolated (${to - from} chars) — every arm here would pass or fail on the wrong text`);
  const block = SRC.slice(from, to);
  assert.match(block, /const enforcedViolations = \(\) => \{[\s\S]{0,200}?unnamedArmed \? v : v\.filter\(\(x\) => x\.uri\)/,
    "the mode filter lives in ONE wrapper, so it cannot be applied at one call site and not the other");
  // and the raw helper is reached only by the OBSERVATION site, which is not a gate.
  //
  // COMMENTS ARE STRIPPED BEFORE COUNTING, and the first cut of this arm was not: the paragraph above
  // the filter QUOTES `checkScreenGate()` raw while explaining the ION bug, so the count read 3 and the
  // arm failed on prose. A count over a corpus that includes its own commentary measures the commentary.
  const code = block.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  const rawUses = [...code.matchAll(/checkScreenGate\(\)/g)].length;
  assert.equal(rawUses, 2, `expected exactly two raw uses in CODE — the observation ledger and the one `
    + `inside enforcedViolations; found ${rawUses}, so a third gate read may be bypassing the mode filter`);
});

// ── WS-B per-customer profiles e2e ───────────────────────────────────────────────────────────────────

test("WS-B sidecar: every run freezes _driver/profile.json (generic for example.com — neutral floor 4, dense batch 4)", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar.profileKey, "generic");
  assert.equal(sidecar.minCellsPerVariant, 4);   // neutral generic: 3 cross-vertical platforms + web
  assert.equal(sidecar.batchSize, 4);            // dense budget (16) / floor 4
  assert.equal(sidecar.platforms.length, 3);
  assert.ok(events.some((e) => e.event === "profile" && e.key === "generic"), "profile freeze logged");
});

test("spec 62 sidecar: a project-bearing job freezes the PROJECT's marketplaces + floor (the grid dictation reads the overlay, not the customer)", async () => {
  // customer aurora (6 gaming storefronts, its own framework) + the seeded console-ecosystem overlay
  // (9 marketplaces) — see the CLEAROTRON_CUSTOMERS_DIR seed at the top of this file.
  const { res, root, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { profileKey: "aurora", projectKey: "console-ecosystem" },
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar.profileKey, "aurora", "profileKey stays the CUSTOMER");
  assert.equal(sidecar.projectKey, "console-ecosystem");
  assert.equal(sidecar.projectName, "Console ecosystem");
  // platforms UNION (2026-07-18): the customer's marketplaces are CLIENT-MANDATED and a project adds
  // to them rather than replacing them. Asserted as the SET relation against this harness's seeded
  // config (CLEAROTRON_CUSTOMERS_DIR), not a magic count — the count depends on how much the seeded
  // overlay overlaps its customer, and hardcoding it hid that the env var was being ignored.
  const seededCustomer = JSON.parse(readFileSync(join(PROFILES_SEED, "aurora.json"), "utf8")).platforms;
  const seededProject = JSON.parse(readFileSync(join(PROFILES_SEED, "projects", "aurora", "console-ecosystem.json"), "utf8")).platforms;
  for (const p of seededCustomer) assert.ok(sidecar.platforms.includes(p), `client-mandated ${p} survives the project overlay`);
  for (const p of seededProject) assert.ok(sidecar.platforms.includes(p), `project-added ${p} is searched`);
  assert.equal(sidecar.platforms.length, new Set([...seededCustomer, ...seededProject]).size, "the UNION, deduped — never one list replacing the other");
  assert.equal(sidecar.minCellsPerVariant, sidecar.platforms.length + 1, "floor derived from the RESOLVED union (+ web)");
  assert.equal(sidecar.origins.platforms, "customer+project");
  assert.equal(sidecar.frameworkPath, "skills/prelim-search/risk-framework-aurora.md", "the customer's framework still rates the matter");
  assert.ok(events.some((e) => e.event === "profile" && e.key === "aurora" && e.project === "console-ecosystem"), "the project is logged on the freeze event");

  // END-TO-END report surface: the injectFrontMatter(run_under_project/origins_json) → parseReport →
  // scopeSection/footer seam (the one path the hand-built render.test.mjs front-matter never exercises).
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const internal = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.match(internal, /Run under project:\s*<span class="mono">Console ecosystem \(Aurora Interactive\)<\/span>/, "the internal report footer discloses the project");
  assert.match(internal, /Configuration provenance \(internal\)/, "the internal report renders the origin table (front-matter round-trip intact)");
  // ONE report (spec 2026-07-30 §5): no client twin is ever written — the portal/client-access serve
  // the same report.html through readReport's serve-time preparation.
  assert.equal(findFile(root, "report.client.html"), null, "no report.client.html twin is published");
});

test("WS-B sidecar is authoritative on resume: a planted sidecar wins (write-if-absent) and logs profile-mismatch", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  // simulate "profiles/ changed between run and resume": the sidecar carries a different key (same
  // floor/platforms so the validators behave identically — this pins WHICH source wins, not the floor)
  const sidecarPath = driverDir(r1.runDir, "profile.json");
  const planted = { ...JSON.parse(readFileSync(sidecarPath, "utf8")), profileKey: "custom-anchor" };
  const { writeFileSync: wf } = await import("node:fs");
  wf(sidecarPath, JSON.stringify(planted, null, 2));
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const events = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "profile-mismatch" && e.sidecar === "custom-anchor" && e.resolved === "generic"),
    "resume reads the FROZEN sidecar and logs the divergence from the current profiles/");
  assert.equal(events.filter((e) => e.event === "profile").length, 1, "write-if-absent: the freeze happened exactly once");
  // r2 delivered → the run dir was archived; the sidecar rode along, still the planted one
  assert.equal(JSON.parse(readFileSync(driverDir(r2.runDir, "profile.json"), "utf8")).profileKey, "custom-anchor",
    "sidecar never overwritten");
});

test("WS-B corrupt sidecar: resume fails LOUDLY and never silently re-derives the frozen profile", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  const sidecarPath = driverDir(r1.runDir, "profile.json");
  const { writeFileSync: wf } = await import("node:fs");
  wf(sidecarPath, "{corrupt");
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  await assert.rejects(() => pipeline(JOB, { codename }), /profile\.json is corrupt/);
  assert.equal(readFileSync(sidecarPath, "utf8"), "{corrupt", "the corrupt sidecar is evidence — never overwritten");
});

test("WS-B pre-WS-B resume: a sidecar-less run resumes LEGACY end to end — no retro-mint, no identity join", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  // simulate a run created before this deploy: strip the sidecar the cold start minted
  const { rmSync } = await import("node:fs");
  rmSync(driverDir(r1.runDir, "profile.json"));
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.ok(!existsSync(driverDir(r2.runDir, "profile.json")), "no sidecar retro-minted into a legacy run");
  const events = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "profile").length, 1, "only the original cold-start freeze event (run 1)");
});

// ── Hotfix 2026-07-06: a legacy slug store must never brick the matter ────────────────────────────────
test("a prior run's plan store is IGNORED — every run mints fresh, so a fixed defect cannot ride along", async () => {
  // The Drivers Haven 2026-07-18 failure, pinned. A stale plan for the same matter used to be
  // REUSED or append-only EXTENDED, and `extendRegisterPlan` never removed an entry. So the run
  // compiled a clean form band, then dispatched the previous run's poisoned OR-stack anyway
  // (`source:"extended", added:11`) and died on the identical gate, five identical diacritic terms,
  // identical 424 hits. Any defect that ever reached a plan was immortal for that matter — which
  // meant a shipped fix could never be verified on the matters we re-run to verify fixes.
  //
  // The store is seeded here with entries a fresh compile would NEVER produce. None may appear.
  const seed = (root) => {
    // One binding for the fixture's customer slug, and the reason is not tidiness: written inline beside
    // `job_key`, the secret scanner reads a keyword next to a high-entropy literal and calls it a
    // credential. The inline gitleaks:allow held only while the file was short enough for the scanner's
    // window to keep the comment and the match together; adding tests moved that boundary and the
    // suppression stopped being seen. Naming the value once puts the literal nowhere near the keyword.
    const fixtureSlug = "tmp9077-novapulse";
    const plansDir = join(root, "workspace-clawdi", "studio", "prelim-search", fixtureSlug, "_plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "register-plan.v1.json"), JSON.stringify({
      schema_version: 1, plan_version: 1,
      derived_from: { job_key: fixtureSlug, variants_fingerprint: "fnv1a:legacy:0", skill_version: "pre-split" },
      nice_classes: ["9", "41"], regions: [],
      entries: [{ qid: "primary-sweep:exact:poisoned+form", axis: "primary-sweep", predicate: "exact",
        terms: ["novapulsè", "novapulsé", "novapulsê", ...Array.from({ length: 674 }, (_, i) => `LEGACY${i}`)],
        expected_kind: "enumerate", nice_classes: ["9"], regions: [] }],
    }, null, 2) + "\n");
  };
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" }, { ref: "TMP9077", id: "plan-store-ignored-job" }, { seed });
  assert.equal(res.ok, true, JSON.stringify(res));

  const planEvt = events.find((e) => e.event === "register-plan");
  assert.equal(planEvt?.source, "minted", "a fresh run MINTS — it never reuses or extends a prior run's plan");

  // the decisive assertion: not one stale term reaches the dispatched plan
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  const allTerms = plan.entries.flatMap((e) => e.terms ?? [e.term]).filter(Boolean);
  assert.ok(!allTerms.some((t) => String(t).startsWith("LEGACY")), "no seeded legacy term survives into the run's plan");
  assert.ok(!allTerms.some((t) => /[^\x00-\x7F]/.test(String(t)) && String(t).startsWith("novapuls")),
    "no seeded diacritic duplicate survives — the exact Racers shape");
  assert.ok(!plan.entries.some((e) => e.qid.includes("poisoned")), "the seeded qid is absent entirely");
  assert.ok(!events.some((e) => e.event === "failed"), "the run completed");
});

// ── WP-receipts W3/W4: the senior-right closure ("verify the right that matters") ─────────────────────
test("senior-right closure: the SENIOR leg of a multi-leg family gets the ONE redirect fetch — verified, no open item", async () => {
  // The VENZY shape: the finding's fetched basis is the junior US 2020 leg; the family also holds a
  // senior TR 2009 live registration (screen-dated on the register index, never fetched by any stage).
  // The closure ranks in code, fetches EXACTLY the senior leg once, and the card carries no open item.
  const fetched = [];
  // #743 — the fetcher writes where the DRIVER told it to (`recordLog`, this run's `_driver/`), which is
  // what the real plugin chokepoint does now. Pinning a path here would test a wiring nothing uses.
  const recordFetcher = async (uri, { sessionKey, recordLog }) => {
    fetched.push(uri);
    mkdirSync(dirname(recordLog), { recursive: true });
    writeFileSync(recordLog, JSON.stringify({ ts: "2026-07-06T00:00:00Z", sessionKey, target: uri,
      body: { applicationDate: "2009-10-14", registrationDate: "2011-11-30", statusText: "Valid", jurisdiction: "TR", classList: ["9"] } }) + "\n");
    return { ok: true };
  };
  const { res, root, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MULTI_LEG: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(fetched, ["/mark/tr/2009-53984"], "exactly ONE fetch, redirected to the senior leg");
  const sr = JSON.parse(readFileSync(driverDir(res.runDir, "senior-rights.json"), "utf8"));
  assert.equal(sr.rows.length, 1);
  assert.equal(sr.rows[0].seniorUri, "/mark/tr/2009-53984");
  assert.equal(sr.rows[0].verified, true);
  assert.ok(events.some((e) => e.event === "senior-rights" && e.verified === 1 && e.open === 0));
  // poolRoot is frozen at the process's FIRST driver.config import — resolve it via the cached module
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const html = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.doesNotMatch(html, /Open item:/, "a verified senior right carries no open item");
});

test("senior-right closure: an UNREACHABLE senior right → plain-English open item on the card; run still delivers (open-item policy)", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "register gateway unreachable (mock)" });
  const { res, root, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MULTI_LEG: "1" }, {}, { recordFetcher });
  assert.equal(res.ok, true, "the open-item policy never withholds the report");
  const sr = JSON.parse(readFileSync(driverDir(res.runDir, "senior-rights.json"), "utf8"));
  assert.equal(sr.rows[0].verified, false);
  assert.match(sr.rows[0].fetchFailureCause, /register gateway unreachable/);
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const html = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.match(html, /Open item:.*could not pull the official record for the oldest registration in this family/,
    "the qualification is stated plainly, where the finding lives");
  assert.match(html, /verified this conflict from a later registration of the same mark by the same owner/);
  assert.ok(events.some((e) => e.event === "predelivery-lint-failed" && e.failures.includes("senior-right-coverage")),
    "the review-bar/audit receipt names the same fact");
});

// ── Repair-first A4: single-artifact findings re-emit at quarantineSynth ──────────────────────────────
test("repair-first A4: one malformed finding object is REFUSED AT THE CALL and restated — the run delivers", async () => {
  // MOCK_BAD_FINDING plants an invented key in finding #1 (finding_key_unknown).
  //
  // RE-AIMED, NOT RELAXED (tracker issue 1893). This asserted a driver-orchestrated repair: the bad
  // object reached disk, a validator named it, and the driver re-dispatched synthesis with a composer
  // that NAMED the object — `finding-reemit`. The writer's conversion moves the catch EARLIER: the
  // record is validated at the call, so the malformed object is refused before anything is written and
  // the seat restates in the same turn. No file to repair, no re-dispatch, and therefore no
  // `finding-reemit` event — the route this arm was watching is superseded, not broken.
  //
  // What has NOT changed is everything the arm is actually FOR, and all of it is still asserted below:
  // the run delivers, no quarantine terminal, and the file that lands is strict-clean. What replaces
  // the event is the refusal log — the run's own record that the defect happened and was corrected,
  // which is what stops "no defect occurred" and "a defect occurred and was fixed" looking identical.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_BAD_FINDING: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const refusals = refusalsFor(res.runDir);
  assert.ok(refusals.some((r) => /finding_key_unknown/.test(r.reason)),
    `the defect was refused at the call, naming the parser's own token — refusals were ${JSON.stringify(refusals)}`);
  assert.ok(!events.some((e) => e.event === "quarantine"), "no quarantine terminal — nothing invalid ever reached disk");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.ok(!("invented_key_from_mock" in findings.findings[0]), "the delivered file is strict-clean");
});

// ── Repair-first A5: the degenerate-reviewer repair at the verdict gate ────────────────────────────────
test("repair-first A5: a BLOCKING with ZERO cited defects is refused AT THE CALL — the seat corrects in-turn and delivers", async () => {
  // ✕ THE MECHANISM MOVED IN CONVERSION 9, AND THE OUTCOME DID NOT. Recorded rather than deleted,
  // because the two doctrines are a pair and a reader who finds only one concludes the code drifted.
  //
  // BEFORE: the seat wrote a BLOCKING citing nothing (the copper-spire degenerate shape), the artifact
  // reached the GATE, the gate named it `reviewer-degenerate`, and one forced re-ask of the WHOLE STAGE
  // healed it to a reasoned CONDITIONAL.
  //
  // NOW: `record_narrative_refutation` refuses an empty `flags` array on a BLOCKING in the turn it is
  // typed. The seat is told what is wrong immediately and answers with a second call — the repair moved
  // from the gate to the call and got cheaper by one whole stage dispatch. The tool's own description
  // says this in as many words: refused here "rather than at the gate, where its only repair is one
  // forced re-ask of this whole stage".
  //
  // THE CLIENT OUTCOME IS UNCHANGED, which is why this is a re-aim and not a withdrawal: a degenerate
  // refusal still becomes a delivered, reasoned CONDITIONAL. The assertions on that are untouched below.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced", MOCK_DEGENERATE_HEALS: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the corrected reviewer's reasoned verdict is the delivered one");

  // TWO CALLS, ONE TURN — the refusal and the correction. This is what "repaired at the call" looks like
  // in the record, and counting them is what distinguishes it from a seat that simply answered once.
  const settled = readFileSync(driverDir(res.runDir, "tool-calls.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.tool === "record_narrative_refutation" && r.event === "settled");
  assert.equal(settled.length, 2,
    `expected two record_narrative_refutation calls — the refused degenerate one and the correction — `
    + `got ${settled.length}. One call means the tool accepted a BLOCKING citing nothing, which is the `
    + "shape it exists to refuse; more than two means the seat is not correcting on the first refusal");

  // AND THE GATE'S REPAIR IS PRE-EMPTED, NOT MERELY UNUSED. Asserting its absence is the half that keeps
  // this honest: if any of these fire again, a degenerate artifact reached the gate, which means the call
  // stopped refusing and the cheap repair silently reverted to the expensive one.
  for (const dead of ["reviewer-degenerate", "verdict-3", "repair-attempted"]) {
    const hit = events.find((e) => e.event === dead && /degener/.test(JSON.stringify(e)));
    assert.equal(hit, undefined,
      `${dead} fired for a degenerate review. The call refuses that shape now, so nothing degenerate can `
      + "reach the gate — this event firing means the refusal stopped working");
  }

  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "CONDITIONAL", "the single label authority reflects the corrected verdict");
});

test("repair-first A5: a REASONED BLOCKING (cited defects) is never re-asked — its grounds are printed, not re-rolled", async () => {
  // THE SUBJECT OF THIS ARM IS UNCHANGED BY T3a. A reviewer who refuses to sign AND says why has given a
  // human answer, and the degenerate re-ask — which exists to repair a refusal that names nothing — must
  // never fire on it. Re-rolling a reasoned refusal is overruling the reviewer, which no repair may do.
  //
  // What T3a changes is only what happens NEXT. The old doctrine ended the run here and filed the grounds
  // in a failure record nobody outside this box reads; the ruling of 2026-08-26 delivers the report with
  // those same grounds printed at the top of its body. The reviewer is heard either way — the difference
  // is whether the client receives anything.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_VERDICT_DEFECTS: "- overclaimed CLEAR on the narrative §2 (file-anchored defect)", MOCK_DEGENERATE_HEALS: "1" });
  assert.ok(!events.some((e) => e.event === "reviewer-degenerate"),
    "a reasoned refusal is never treated as machinery — this is the assertion this arm exists for");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(!existsSync(join(res.runDir, ".failed")), "a reasoned BLOCKING no longer ends the run");

  // AND THE REVIEWER'S OWN GROUND REACHES THE CLIENT DOCUMENT. Delivering while dropping the cited defect
  // would satisfy every assertion above and be precisely the failure the old doctrine was protecting
  // against, so the text itself is asserted rather than the section's presence.
  const report = readFileSync(res.runDir + "/report.md", "utf8");
  assert.match(report, /^###\s+Reviewer's open questions/m, "the section is rendered");
  assert.match(report, /overclaimed CLEAR on the narrative/,
    "the reviewer's cited defect must be the thing the lawyer reads — a section that renders without the "
    + "ground it was raised on is a heading, not a hand-off");
});

test("T3a: persistent BLOCKING after corrective + re-check → the run DELIVERS, with the open points printed", async () => {
  // Owner ruling 2026-08-26, verbatim: "Deliver always, with open points printed. The refusal on a
  // blocking review goes." This REVERSES spec-49 T3, whose flip to fail-on-BLOCKING is itself recorded in
  // itself an owner-approved decision. Both are his; this is the standing one. This arm is the
  // inversion of the one that stood here, kept at the same name-adjacent place on purpose: the two
  // doctrines are a pair and a reader who finds only one will conclude the code drifted from its contract.
  //
  // COPPER-SPIRE IS STILL ANSWERED, AND THAT IS WHAT THE SECTION ASSERTION IS FOR. Its failure was a
  // BLOCKING verdict reaching delivery and then CONTRADICTING its own client summary — a report reading
  // finished while the reviewer refused. "Never ships" and "never ships LOOKING FINISHED" were one
  // requirement in the old doctrine; they are two, and only the second was load-bearing.
  // THE BLOCKING CITES A DEFECT, and after conversion 9 that is the only kind a seat can produce:
  // `record_narrative_refutation` refuses a BLOCKING with an empty `flags` array in the turn it is
  // typed. This scenario used to drive a FLAGLESS blocking, which is now unproducible from a seat —
  // nothing about T3a depended on it, and the ruling under test is "a persistent BLOCKING delivers with
  // its open points printed", which a cited one exercises better than a bare one.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_VERDICT_DEFECTS: "- the summary says the phonetic axis ran; the receipt shows it never did" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the run delivers — that is the whole ruling");
  assert.ok(!existsSync(join(res.runDir, ".failed")), "and no failure record is written");
  assert.ok(stageOrder(events).includes("report-overview"), "the delivery phase now starts on a BLOCKING run");
  assert.ok(events.some((e) => e.event === "verdict-blocking-delivered"), "the delivery is recorded by its own event");
  assert.ok(!events.some((e) => e.event === "verdict-blocking-terminal"), "and the terminal is gone, not merely unreached");

  // THE LABEL STAYS HONEST. Delivering is not signing: the sidecar — "the single label authority" — must
  // still say BLOCKING, or the report ships looking reviewed.
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "BLOCKING", "the verdict is delivered WITH, never softened by delivering");

  // THE SECTION IS THE POINT. A delivered BLOCKING whose body does not say the reviewer refused is
  // precisely copper-spire, and it would pass every assertion above.
  const report = readFileSync(res.runDir + "/report.md", "utf8");
  assert.match(report, /^###\s+Reviewer's open questions/m,
    "the open points must reach the client document, not only the run log — a report that delivers "
    + "silently on a refused review is the failure the old doctrine existed to prevent");
  assert.match(report, /did not sign this report off/,
    "and it must say so in words a reading lawyer acts on, not by a heading alone");

  // The corrective ladder is still the fix arm and still runs FIRST: original + blocking re-synth.
  assert.ok(stageOrder(events).filter((s) => s.startsWith("synthesis")).length >= 2,
    "delivering at the bound must not skip the repair that tries to avoid reaching it");
});

// ── spec 64: the disposition is DERIVED from the typed actions register ────────────────────────
test("spec 64: a condition-kind action ships CONDITIONAL even off a CLEAR review — the copper-causeway/ashen-gantry fix", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the opinion's own named consent gates CLEAR");
  assert.ok(existsSync(join(res.runDir, ".delivered")), "delivered — the clamp never withholds");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.legalActions === 1), "the legalActions arm clamped");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "CONDITIONAL");
  assert.equal(sidecar.kinds.legalActions, true);
  assert.ok(sidecar.reasons.includes("Obtain consent from Mystery Owner LLC before filing in the US."),
    "the reason IS the action's own client-plain text");
  assert.match(sidecar.statement, /^High — conditional on: Obtain consent from Mystery Owner LLC/,
    "THE one risk statement carries band + stance in one sentence");
  assert.equal(sidecar.stance, "conditional", "PR-3: the structured stance rides the sidecar — no consumer regexes the wording");
});

test("spec 64: advisory-only actions (client-fact) stay CLEAR — an unanswered client question never blocks", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "advisory" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CLEAR");
  assert.ok(!events.some((e) => e.event === "coverage-floor-clamp"), "no clamp fired");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, undefined);
  assert.equal(sidecar.statement, "High — clear to proceed: no conditions beyond ordinary filing.",
    "severity and disposition read as ONE labelled sentence, never two bare words");
});

test("spec 64: an already-CONDITIONAL run RECORDS its condition actions — never again kinds:{} reasons:[]", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL");
  assert.ok(events.some((e) => e.event === "verdict-conditions-recorded"), "conditions appended on the CONDITIONAL entry path");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, true);
  assert.ok(sidecar.reasons.length >= 1, "reasons carry the conditions");
  assert.match(sidecar.statement, /^High — conditional on: /);
});

test("spec 64: a v4 emission omitting actions[] gets ONE warm re-demand, healed in place — the run delivers", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "absent" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "actions-missing"),
    "the actions-missing re-demand fired");
  assert.ok(!events.some((e) => e.event === "findings-actions-absent"), "the re-demand healed the register");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.ok(Array.isArray(findings.actions), "the healed file carries the register");
});

test("hard stage failure → .failed sentinel, pipeline returns ok:false, and the failure notice rides the delivery lane (spec-49 T5)", async () => {
  const { res } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "matter-frame");
  assert.ok(existsSync(join(res.runDir, ".failed")));
  // spec-49 T5 (J5), handoff form: the CODE-authored failure packet is written and the outbox marker
  // is the pending signal (the level-triggered *.pending watch keeps the notice alive until ack_event;
  // sendPending has no failure-side clear in the ack loop, so the handoff path never sets it).
  const packetPath = driverDir(res.runDir, "failure.json");
  assert.ok(existsSync(packetPath), "the failure packet is written");
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  assert.equal(packet.kind, "run-failed");
  assert.equal(packet.failed, true);
  assert.equal(packet.failedStage, "matter-frame");
  assert.match(packet.subject, /run FAILED, nothing delivered/);
  assert.match(packet.emailBodyHtml, /FAILED at stage <b>matter-frame<\/b>/);
  assert.ok(packet.text && packet.whatsappText, "short relay text + full notice both ride the packet");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed");
  const { config: obCfg } = await import("../driver.config.mjs");
  const markers = (await import("node:fs")).readdirSync(obCfg.outboxDir).filter((n) => n.endsWith(".pending"));
  assert.ok(markers.length > 0, "the outbox wake marker rides the failure (completion-watch lane)");
});

// FIX: a COLLAPSED core search must FAIL, not ship CONDITIONAL. The primary-sweep band carries a dangerous
// slice that enumerated 212 hits but extracted ZERO records (the band is otherwise non-empty, mirroring the
// ~220-record real failure). The content fail-gate must hard-fail the run — no publish, no CONDITIONAL.
test("collapsed core search → run FAILS (no publish), never a CONDITIONAL deliverable", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_BAND_COLLAPSED: "primary-sweep" });
  assert.equal(res.ok, false, "a collapsed slice must FAIL the run");
  assert.match(res.failedStage ?? "", /register-unit|fan-in/, "failed at the register-unit gate or its fan-in backstop");
  assert.ok(existsSync(join(res.runDir, ".failed")), ".failed sentinel written");
  assert.ok(!existsSync(join(res.runDir, ".delivered")), "never delivered");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed", "status records the failure, not a delivered CONDITIONAL");
});

// studioRoot is the stable ".../studio/prelim-search" prefix of any run-dir (live or archived). Derive it
// from res.runDir (config.workspaceRoot is frozen at first import, so the per-test `root` can't be trusted).
const MARKER = "/studio/prelim-search";
const studioRootOf = (runDir) => runDir.slice(0, runDir.indexOf(MARKER) + MARKER.length);

test("delivered run → status.json delivered, STATUS.md rollup, .delivered records the pending send", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true);
  // status.json rode into the archive with the delivered state
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "delivered");
  assert.equal(s.verdict, "CLEAR");
  assert.match(s.url, /report\.html$/);
  // STATUS.md (at the stable studio root) shows the delivered run
  const md = readFileSync(join(studioRootOf(res.runDir), "STATUS.md"), "utf8");
  assert.match(md, /TMP-2201 NOVAPULSE — delivered \(CLEAR\)/);
  // the delivery sentinel marks the run ready for clawdi's comms watch to send (handoff mode)
  const delivered = JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8"));
  assert.equal(delivered.sendPending, true, "sendPending marker set for clawdi's comms watch");
  // ONE report: the two-bit delivery is deleted — status/sentinel/packet carry NO readiness fields
  assert.equal(s.delivery, undefined, "no delivery{} second bit on status.json");
  assert.ok(!("clientReady" in delivered), "no clientReady on the .delivered sentinel");
  const packetOpen = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.ok(!("clientReady" in packetOpen) && !("defects" in packetOpen), "the packet carries no readiness bits");
  assert.match(packetOpen.whatsappText, /^✅/, "the plain completion ping");
  // charter P1 §3 — ONE canonical runId form: the delivery packet (and therefore the outbox marker it
  // names) carries the dated `<slug>-<date>-<codename>` — the SAME id status.json carries, so the
  // pipeline's marker and the rescan's re-drop can never be two different names for one delivery.
  assert.equal(packetOpen.runId, `${s.slug}-${s.date}-${s.codename}`, "packet runId = the dated canonical id");
  assert.equal(packetOpen.runId, s.runId, "and identical to status.runId — one form across every consumer");
  const { config: obCfg2 } = await import("../driver.config.mjs");
  assert.ok(existsSync(join(obCfg2.outboxDir, `${packetOpen.runId}.pending`)), "the wake marker is named by the canonical id");
  // charter P1 §4 — lifecycle honesty: the terminal delivered state ADVANCES the stepper to its final
  // step (handoff mode runs no notify stages, so without this the run froze at 7/9 forever).
  assert.equal(s.stepN, s.stepTotal, `a delivered run never reads mid-flight (got ${s.stepN}/${s.stepTotal})`);
  assert.equal(s.stepN, 9, "the clearance display sequence ends at 9/9");
  assert.ok(!readFileSync(join(res.runDir, "email-body.md"), "utf8").includes("Not client-ready"),
    "no defects block on the cover note");
});

// ── ONE report (spec 2026-07-30 §5): machine QC is telemetry, never a gate on who may read ─────────────
// A persistent QC defect (permission-prose — a false "tool was blocked" claim) used to close the client
// gate: the client export was withheld, the cover note grew a readiness block, and every delivery surface
// carried a readiness bit. All of that is deleted. The checks still RUN — their result lands on the audit
// workbook (a plain internal QC row), meta.json (the staff index's ⚠ QC pill) and the machine-qc-failed
// telemetry event — and the run delivers exactly like any other.
//
// A10 (addendum 2026-07-30, two-bit gate doctrine) fixes what ONE report alone would have left: with the
// readiness block gone, the reasons reached NO delivery surface at all — VENZY's failure exactly. The
// cover note now ENUMERATES them. The two rules are not in tension: what is deleted is the narration of
// a readiness BIT and the withholding it drove; what is required is that a recorded defect is never only
// a flag nobody reads. Warn beside the report link, never suppress the artifact.
//
// RULED 2026-07-31, and this test is where the ruling is pinned. #162 asserted here that QC reasons
// "never ride the email"; a rebase flipped that to a bare match on the engine's own sentence, which
// asserts the leak rather than the contract. Neither is right. composeEmailHtml is NOT only the
// reviewer's reply: portal-service stamps forwarderEmail from the verified principal, so on a
// client-started run this mail lands in the client's inbox — the failure lane already sanitises for
// that exact recipient and the success lane never did. And even reviewer-only, ~90 words of engine
// prose is not lawyer language. So the contract asserted below is BOTH halves at once: the defect is
// enumerated (A10), AND the engine's wording is absent from the whole note (outward-language rules),
// judged by the audit workbook's own BANNED list so the two delivery surfaces cannot drift apart.
// The fix is ONE projected wording for both readers — never a client variant of this note.
test("one report + A10: failed machine QC delivers normally and its defects ride the reviewer's cover note; nothing withholds or narrates readiness", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_PERMISSION_PROSE: "1" });
  assert.equal(res.ok, true, `failed QC must not fail the run: ${JSON.stringify(res)}`);
  assert.ok(!existsSync(join(res.runDir, ".failed")), "no .failed — the run ended delivered");
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the delivery sentinel exists");

  // status: terminal state is "delivered", full stop — no delivery{} second bit
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "delivered");
  assert.equal(s.delivery, undefined, "the two-bit delivery is deleted");

  // telemetry: the machine-qc-failed event fired with the plain-language reasons + stable codes
  const qcEvent = events.find((e) => e.event === "machine-qc-failed");
  assert.ok(qcEvent && Array.isArray(qcEvent.reasons) && qcEvent.reasons.length, "machine-qc-failed telemetry event logged");
  assert.ok(qcEvent.reasons.some((d) => /blocked or lacked permission/.test(d)), `the plain-language reason: ${JSON.stringify(qcEvent.reasons)}`);
  assert.ok(!events.some((e) => e.event === "client-gate-closed"), "the old gate incident event is retired");

  // pool: report.html published; NO client twin exists to withhold; meta records the QC result
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const poolDir = join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`);
  assert.ok(existsSync(join(poolDir, "report.html")), "the report reached the pool");
  assert.ok(!existsSync(join(poolDir, "report.client.html")), "no client twin is ever written");
  const meta = JSON.parse(readFileSync(join(poolDir, "meta.json"), "utf8"));
  assert.equal(meta.clientGate.released, false, "meta records the QC result (workbook + staff-pill surfaces)");

  // ZERO banners on the rendered report — the QC record lives on the workbook + telemetry only
  const html = readFileSync(join(poolDir, "report.html"), "utf8");
  assert.ok(!/Not client-ready|CLOSE.BEFORE.FILING/i.test(html), "the report document stays clean at every level");

  // the cover note narrates no readiness — but A10 requires the recorded defect to REACH the reviewer
  const email = readFileSync(join(res.runDir, "email-body.md"), "utf8");
  assert.doesNotMatch(email, /Not client-ready/, "the retired readiness block never renders");
  assert.doesNotMatch(email, /for your review only|withheld|clientReady/i, "no readiness narration survives anywhere on the note");
  // #600 — A10 put the sink's surviving failures on THIS note, and the note is the client's own inbox.
  // The defect still reaches the reviewer: the workbook's Machine Checks sheet and the run record both
  // carry the same projected line, and `machine-qc-failed` is logged above. What is gone is the client
  // reading an internal check they cannot act on. The gate is unchanged — it still never suppresses.
  assert.doesNotMatch(email, /Machine checks/, "THE DEFECT: an internal check enumerated to the client");
  assert.doesNotMatch(email, /describes a search as blocked or not permitted/, "…nor its projected line");
  assert.doesNotMatch(email, /permission-prose/, "…and never the internal check id");
  assert.match(email, /Open the full report/, "the deliverable is untouched");
  assert.doesNotMatch(email, /blocked or lacked permission|the supplemental lane|deterministic plan executor|register_enumerate/,
    "the check's own engine prose never rides the note — this mail is sent verbatim to forwarderEmail");
  // #600 — THE BLOCK IS GONE FROM THIS SURFACE, so what is pinned here is its absence and the absence
  // of everything it carried. The vocabulary sweep that used to run over the block moved to
  // client-surface-vocabulary.test.mjs, which runs a list calibrated for a WHOLE cover note: the
  // workbook's BANNED list is written for check LINES and legitimately matches a matter id and a report
  // link, so pointing it at the whole mail would fail on the deliverable itself.
  assert.equal(email.match(/<p style="[^"]*background:#fff8e6[\s\S]*?<\/p>/), null,
    "the amber machine-check block is rendered again on a QC-failed run");
  const { deliveryFlagLines } = await import("../predelivery-lint.mjs");
  const sinkChecks = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8")).checks ?? [];
  const projected = deliveryFlagLines(sinkChecks.filter((c) => !c.pass));
  assert.ok(projected.length, "premise: this run really does have a surviving failure, or this proves nothing");
  for (const line of projected)
    assert.ok(!email.includes(line), `a projected check line reached the client's mail: "${line}"`);

  // the outbox packet carries no readiness bits and the plain ping
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.ok(!("clientReady" in packet) && !("defects" in packet), "no readiness bits on the packet");
  assert.match(packet.whatsappText, /^✅/, "the plain completion ping — same message as every delivered run");
});

test("failed run → status.json failed + STATUS.md surfaces it (failure ping is best-effort, never masks the error)", async () => {
  // matter-frame is reliably caught by the mock (its message contains the skill path "skills/matter-frame/...").
  // The failure-ping's own message also contains "matter-frame", so the mock-send of the ping fails too — which
  // is exactly the gateway-wide-outage case: STATUS.md must STILL record the failure (written before the ping).
  const { res } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "matter-frame");
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "failed");
  assert.equal(s.failedStage, "matter-frame");
  const md = readFileSync(join(studioRootOf(res.runDir), "STATUS.md"), "utf8");
  assert.match(md, /TMP-2201 NOVAPULSE — ⚠️ FAILED at matter-frame/);
});

// ── Change B5 e2e ───────────────────────────────────────────────────────────────────────────────────────

test("applicant-unknown e2e: identity-band hit delivered as an ORDINARY finding with a neutral disregard note — no gate, no corrective", async () => {
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CANDSELF: "1" },
    { customerUnknown: true },
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  // the retired candidate-self gate must NOT fire — a missing applicant never re-synthesises or fails the run
  assert.ok(!events.some((e) => e.event === "candidate-self-violation"), "no candidate-self violation gate");
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "candidate-self"),
    "no candidate-self corrective followup");
  const narrative = readFileSync(join(res.runDir, "narrative.md"), "utf8");
  assert.doesNotMatch(narrative, /Candidate-self:|is this you\?/i, "retired 'is this you?' treatment is gone");
  assert.match(narrative, /own prior filing, disregard/i, "identity-band hit carries the neutral disregard note, counted as an ordinary finding");
});

test("B5b e2e: pre-seeded customer-bind.json folds at pre-matter-frame (normal path) + event logged", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  // create the run dir BEFORE the run and drop the bind — a thread reply that arrived pre-start.
  // driver.config freezes workspaceRoot at its FIRST import in this process, so derive the dir from the
  // (cached) config rather than this test's own root — correct in both full-file and solo runs.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { config } = await import("../driver.config.mjs");
  const runDir = join(config.studioRootForAgent("clawdi"), "tmp2201-novapulse", "2026-01-01-bind-test");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "customer-bind.json"),
    JSON.stringify({ customer: "ACME Interactive", exclusions: ["BigCo"], ts: "2026-01-01T00:00:00Z", source: "<reply@x>" }));
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, customerUnknown: true }, { codename: "bind-test" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bind = events.find((e) => e.event === "customer-late-bind");
  assert.ok(bind, "customer-late-bind event logged");
  assert.equal(bind.phase, "pre-matter-frame");
  assert.equal(bind.action, "fold-job");
  assert.equal(bind.customer, "ACME Interactive");
  assert.ok(!events.some((e) => e.event === "candidate-self-violation"), "bound customer ⇒ candidate-self never polices");
});

test("B5b ack: every consumed bind writes the plain-language confirmation packet (event logged)", async () => {
  // piggybacks the bind-fold flow: the ack is a best-effort outbox packet, written by code.
  const root = mkdtempSync(join(tmpdir(), "prelim-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { config } = await import("../driver.config.mjs");
  const runDir = join(config.studioRootForAgent("clawdi"), "tmp2201-novapulse", "2026-01-02-ack-test");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "customer-bind.json"),
    JSON.stringify({ customer: "ACME Interactive", exclusions: [], ts: "2026-01-02T00:00:00Z", source: "<reply@x>" }));
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, customerUnknown: true }, { codename: "ack-test" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ack = events.find((e) => e.event === "customer-late-bind-ack");
  assert.ok(ack, "ack event logged");
  assert.equal(ack.sent, true);
});

// ── spec-48 WS2: the plan path end-to-end (ALWAYS ON since the flag removal — every mock run mints) ──
test("spec-48 plan mode: frozen plan → dictated units → clean identity join → audited refutation → store minted", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const dr = driverDir(res.runDir);
  assert.ok(existsSync(join(dr, "register-plan.json")), "frozen plan rides the run dir");
  assert.ok(existsSync(join(dr, "instructed-scope.json")), "code-authoritative scope receipt written");
  const exec = JSON.parse(readFileSync(join(dr, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "every dictated qid owns a band block");
  assert.ok(exec.executed.length > 0, "entries executed");
  assert.ok(exec.skeleton.every((s) => s.state !== "unexecuted"), "no axis unexecuted");
  // minted on a cold store; REUSED byte-identical when the shared mock studio already carries the
  // slug store from an earlier flag-on test in this process (either way, THE F2 property: the plan
  // came from the deterministic compile/freeze path, never a re-improvisation). The store round-trip
  // decision itself is covered by the pure resolvePlanAgainstStore tests.
  assert.ok(events.some((e) => e.event === "register-plan" && (e.source === "minted" || e.source === "reused")), "plan attached via mint/reuse");
  // the refutation was fed the deterministic table and carries the audited section (validator-enforced)
  assert.match(readFileSync(join(res.runDir, "senior-eye-review.md"), "utf8"), /PLAN-EXECUTION CHECK/);
});

// ── spec-48 WS2 (B3) rider — the geography stamp rides the instructed-scope receipt ──────────────────
// The receipt is "what the JOB said, written before any model breathes on it" — and the job says WHERE
// as a typed stamp (enqueue-schema.mjs, "the GEOGRAPHY STAMP": {mode, origin}, written at the door).
// foldRecipeScope mutates job.jurisdictions on later passes (and re-stamps origin "saved-search" when
// it does), so by read time the stamp is the only surviving record of where the territories came from.
// A receipt without it forces the matter frame to reconstruct that provenance from the request prose —
// a reconstruction the paraphrase-drift validator (validators.matterContext) cannot check.
test("spec-48 receipt: the geography stamp is copied verbatim into instructed-scope.json; a pre-stamp job records null, never a missing key", async () => {
  // stamped job — the door's own shape, copied verbatim, never recomputed at write time
  const stamped = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { geography: { mode: "account-default", origin: "account-default" } });
  assert.equal(stamped.res.ok, true, JSON.stringify(stamped.res));
  const withStamp = JSON.parse(readFileSync(driverDir(stamped.res.runDir, "instructed-scope.json"), "utf8"));
  assert.deepEqual(withStamp.geography, { mode: "account-default", origin: "account-default" },
    "the stamp arrives in the receipt exactly as the job carried it");
  // pre-stamp job (queued before the field existed): the receipt states the absence ITSELF —
  // "unrecorded" arrives as an explicit null (the same `?? null` posture as goods and customer beside
  // it), never as a key a reader has to notice is missing.
  const bare = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(bare.res.ok, true, JSON.stringify(bare.res));
  const noStamp = JSON.parse(readFileSync(driverDir(bare.res.runDir, "instructed-scope.json"), "utf8"));
  assert.ok(Object.hasOwn(noStamp, "geography"), "the key is written on every receipt — a missing key is a silent gap, null is a state");
  assert.equal(noStamp.geography, null);
});

test("spec-48 plan mode: a dictated qid with no band block → ONE warm followup recovers it; the run proceeds", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DROP_QID: "+merch" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "plan-qids-missing"), "the identity join saw the hole");
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "the warm followup closed it — nothing dictated stays unexecuted");
  assert.ok(exec.executed.some((x) => x.qid.endsWith("+merch")), "the dropped slice now owns a block");
});

// ── envelope-settle: a refused slice is DECIDED at the receipt, not two expensive stages later ─────────
// MOCK_PLAN_DEFERRED makes the executor refuse a dictated slice the way a real capability gap arrives —
// error:true beside deferred:true, nothing dispatched — so joinPlanToBands routes it to the receipt's
// `deferred[]` and the run has to decide about it. The pure functions are pinned in envelope-settle.test.mjs;
// what these pin is the ORDER, the DURABILITY and the reach across digest passes, none of which a pure
// function can show. The knob targets a PRIMARY-SWEEP slice deliberately: that axis has sixteen other
// entries, so it is not deferred end to end and `accepted` can only come from the reason text matching
// isCapabilityGapReason — a fully-deferred axis is accepted whatever its reason says, which would let a
// broken reason string pass.
const DEFERRED_SLICE = "+merch";

test("envelope-settle: a provider-refused slice is DECIDED at the fan-in — before placement, before any digest", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE });
  assert.equal(res.ok, true, JSON.stringify(res));   // a disclosed gap is delivered, never a halt
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.equal(exec.deferred.length, 1, "the refusal joined the receipt's deferred bucket");
  assert.deepEqual(exec.missing, [], "a deterministic refusal is NOT a hole — no repair ladder fires on it");
  const gap = exec.deferred[0];
  assert.ok(gap.qid.endsWith(DEFERRED_SLICE), "the refusal is qid-stamped");

  // THE ORDERING CLAIM. The decision must precede every stage that reads the coverage it decides about.
  // findIndex takes the FIRST occurrence of each, which is the one that matters: a later frame-reopen can
  // emit a second placement-inquiry, and the settlement flush a second register-digest.
  const iEarly = events.findIndex((e) => e.event === "envelope-decision-early");
  const iPlacement = events.findIndex((e) => e.event === "stage" && e.stage === "placement-inquiry");
  const iDigest = events.findIndex((e) => e.event === "stage" && e.stage === "register-digest");
  assert.ok(iEarly >= 0, "the run decided about its deferrals at all");
  assert.equal(events[iEarly].source, "fan-in", "and decided at the fan-in seam — the moment the receipt exists");
  assert.equal(events[iEarly].deferred, 1);
  assert.ok(iPlacement >= 0 && iEarly < iPlacement, "decided BEFORE placement-inquiry (626s on the evidence run)");
  assert.ok(iDigest >= 0 && iEarly < iDigest, "decided BEFORE the first register-digest (810s, doomed at dispatch)");

  // and the decision is honest about WHAT it decided
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.deepEqual(decision.accepted.map((a) => a.qid), [gap.qid], "the refused slice is recorded as accepted");
  assert.equal(decision.accepted[0].decision, "accepted-capability-gap");
  assert.equal(decision.accepted[0].axis, "primary-sweep");
  const { isCapabilityGapReason } = await import("../coverage-ledger.mjs");
  assert.ok(isCapabilityGapReason(decision.accepted[0].reason),
    "acceptance rests on the executor's own reason — the axis still has entries that ran, so nothing else could grant it");
  const skeleton = exec.skeleton.find((s) => s.axis === "primary-sweep");
  assert.equal(skeleton.state, "deferred");
  assert.ok(skeleton.executed > 0, "the axis is NOT deferred end to end — the fullyDeferred shortcut is not in play here");
  assert.deepEqual(decision.closed, [], "a capability gap is never retried, so nothing was closed");

  // …and the settled facts reach the FLUSH pass, which is the one a fresh-dispatch hint cannot reach
  // (stageOnce ignores `extra` when opts.followup is set). The mock records one line per carrying dispatch.
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"),
    "the run did take a flush pass");
  const carried = readFileSync(driverDir(res.runDir, "mock-settled-facts.log"), "utf8").trim().split("\n");
  assert.ok(carried.length >= 1, "at least one digest dispatch carried the settled coverage facts");
});

test("envelope-settle: the decision artifact records a zero the same way it records a one (all four arrays, always)", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE });
  assert.equal(res.ok, true, JSON.stringify(res));
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(decision.schema_version, 1, "the artifact is versioned — a reader can tell which shape it holds");
  assert.equal(decision.plan_version, exec.plan_version,
    "the decision names the plan version it decided about; a supplemental fold that moves it un-settles the receipt");
  assert.ok(decision.decided_at, "and when");
  assert.equal(decision.deferred_total, exec.deferred.length);
  // AD-4 instrumentation house rule: a reader must distinguish "zero" from "nobody looked".
  for (const k of ["accepted", "closed", "close_failed", "history"])
    assert.ok(Array.isArray(decision[k]), `${k} is present as an array even when it is empty`);
  assert.deepEqual(decision.close_failed, []);
  assert.deepEqual(decision.history, []);
});

test("envelope-settle: a resume that finds no decision on disk re-settles the receipt before the expensive stages", async () => {
  // run 1 dies at synthesis — the first FATAL post-digest stage — so the run dir stays LIVE and resumable
  // (a delivered run is archived and pipeline() refuses to resume it).
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE, MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  assert.equal(r1.failedStage, "synthesis");
  const decisionPath = driverDir(r1.runDir, "envelope-decision.json");
  assert.ok(existsSync(decisionPath), "run 1 decided at its fan-in");

  // …and the artifact is lost (a torn write, a hand-cleaned _driver, a fork that never held it).
  const { rmSync } = await import("node:fs");
  rmSync(decisionPath);
  // The receipt is now UNSETTLED, and this is the exact predicate assertReceiptSettled keys on — pinned
  // through the exported piece because the guard itself cannot be provoked from this harness: the fan-in
  // seam runs on every resume, before both guard sites, so it always re-settles first and `unsettled-inputs`
  // never gets to fire. What the guard would have seen is asserted here; what actually heals is below.
  const { receiptSettled } = await import("../envelope-settle.mjs");
  const { paths } = await import("../stages.mjs");
  const receipt = JSON.parse(readFileSync(driverDir(r1.runDir, "plan-execution.json"), "utf8"));
  const state = receiptSettled(paths(r1.runDir), receipt);
  assert.equal(state.settled, false, "a recorded deferral with no recorded decision is unsettled");
  assert.equal(state.cause, "no-decision");
  assert.equal(state.unsettled.length, 1, "and it names what is open");
  assert.ok(state.unsettled[0].reason, "with the reason, not just the qid");

  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const events2 = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const resettled = events2.filter((e) => e.event === "envelope-decision-early").at(-1);
  assert.equal(resettled?.source, "receipt-reuse", "the resume re-decided at the seam it sails through — the reused clean receipt");
  const rewritten = JSON.parse(readFileSync(driverDir(r2.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(rewritten.accepted.length, 1, "the decision is a durable artifact again, not a log line from a run that ended");
  assert.equal(rewritten.plan_version, receipt.plan_version);
  assert.equal(receiptSettled(paths(r2.runDir), receipt).settled, true, "the receipt the later stages read is settled");
});

test("envelope-settle: a run with NO refusal still records the decision — the zero is looked at, not skipped", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.deferred, [], "nothing was refused on this run");
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(decision.deferred_total, 0);
  for (const k of ["accepted", "closed", "close_failed", "history"]) assert.deepEqual(decision[k], [], `${k} recorded empty`);
  assert.ok(events.some((e) => e.event === "envelope-decision-early" && e.source === "fan-in" && e.deferred === 0),
    "the fan-in still decided — a run that recorded nothing to decide is not the same as a run nobody asked");
  assert.ok(!events.some((e) => e.event === "unsettled-inputs"), "and no stage was reached on unsettled inputs");
  assert.ok(!existsSync(driverDir(res.runDir, "mock-settled-facts.log")),
    "with nothing accepted there is no settled-facts section to carry — the section returns null, never an empty heading");
});

// ── repair-first A1 (2026-07-05): direct executor dispatch at the fan-in plan join ─────────────────────
test("repair-first A1: a missing dictated qid is closed by DIRECT executor dispatch — no agent turn spent", async () => {
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    calls.push({ axis, qids });
    // simulate the tool: land the missing dictated blocks into the band (merge-preserving)
    const { qidBlocks } = await import("./mock-stage-fixtures.mjs");
    const blocks = JSON.parse(readFileSync(outputPath, "utf8"));
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    for (const qid of qids) {
      const e = plan.entries.find((x) => x.qid === qid);
      blocks.push(...qidBlocks(qid, e?.expected_kind === "count" ? "count" : "enumerate"));
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_PLAN_DROP_QID: "+merch" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(calls.length >= 1 && calls[0].qids.some((q) => q.endsWith("+merch")), "the dispatch targeted exactly the missing qids");
  const acts = events.filter((e) => e.event === "plan-qids-missing").map((e) => e.action);
  assert.ok(acts.includes("plan-direct-execute"), "the code repair ran first");
  assert.ok(!acts.includes("warm-followup") && !acts.includes("fresh-execute-plan"), "no agent turn spent on the repair");
  assert.ok(events.some((e) => e.event === "repair-attempted" && e.repair === "plan-direct-execute" && e.outcome === "ok"), "the repair ledger recorded the attempt");
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "the dispatch closed every dictated hole");
});

test("repair-first A1: a 414-shaped dispatch failure is terminal with ZERO parks and quotes the provider error", async () => {
  // The production 414-wedge shape end-to-end: dispatch fails deterministically (URI too long), the LLM
  // followup can't close it either (sticky drop) → ONE enriched fan-in failure, no recovery parks
  // despite budget, and the terminal diagnosis carries the provider's verbatim error.
  const planExecutor = async () => ({ ok: false, cause: "provider error during enumeration (page 0): ERROR: corsearch_search HTTP 414 URI Too Long" });
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
      MOCK_PLAN_DROP_QID: "+merch", MOCK_PLAN_DROP_STICKY: "1", CLEAROTRON_RECOVERY_MAX: "3" }, {}, { planExecutor });
    assert.equal(res.ok, false);
    assert.equal(res.postponed, undefined, "deterministic class buys ZERO parks despite recovery budget 3");
    assert.ok(existsSync(join(res.runDir, ".failed")), "terminal .failed on the first pass");
    const failed = JSON.parse(readFileSync(join(res.runDir, ".failed"), "utf8"));
    assert.equal(failed.terminalKind, "deterministic");
    assert.match(failed.reason, /HTTP 414/, "the provider's verbatim error reaches the terminal diagnosis");
    assert.match(failed.reason, /direct dispatch \+ followup/);
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.recoveryAttempts ?? 0, 0, "no recovery attempt was burned");
  } finally { delete process.env.MOCK_PLAN_DROP_STICKY; delete process.env.CLEAROTRON_RECOVERY_MAX; }
});

// ── Fix 2 (close-the-loop, arm #1): the register frame-reopen code-dispatch VERIFIES the intended search ──
// The blind spot the RUN1 project-halcyon false-close exploited: the mock executor only ever produced the
// RIGHT search, so a byte-diff always looked like a genuine close. These fixtures simulate the WRONG search
// (a wrong-class 0/0 enumerated block) reaching the band, and assert the close is NOT falsely swept.

// A planExecutor that writes controlled band blocks for the minted qids. `classesFor(call)` picks the
// class tag the block records (the [cl …] describePlanEntry writes); records=[] + total_hits=0 makes it an
// evidentially-empty 0/0 that byte-changes the band but must not count as a close on the wrong scope.
function fieldGapExecutor(scriptFn) {
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    const n = calls.length + 1;
    const { cls, hasRecords } = scriptFn(n);
    calls.push({ n, axis, qids, cls });
    const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
    for (const qid of qids) {
      const i = blocks.findIndex((b) => b && b.qid === qid);
      const block = { state: "enumerated", qid, query: `exact NOVAPULSE [cl ${cls.join(",")}]`,
        total_hits: hasRecords ? 2 : 0,
        records: hasRecords ? [{ record_id: `/mark/us/${qid.slice(-6)}`, mark_text: "NOVAPULSE", classes: cls.map(Number), status: "Registered", owner_name: "Owner", owner_country: "US", screen_verdict: "surface:in-scope-live" }] : [] };
      if (i >= 0) blocks[i] = block; else blocks.push(block);
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };
  return { planExecutor, calls };
}

test("Fix2 #1: a wrong-class 0/0 dispatch does NOT sweep the directive — the dominant gap stands, verdict clamps CLEAR→CONDITIONAL", async () => {
  // every dispatch searches the matter's OWN classes (9/28/41/42), never the intended Cl.35/38 → 0/0.
  const { planExecutor, calls } = fieldGapExecutor(() => ({ cls: [9, 28, 41, 42], hasRecords: false }));
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  // the mint dispatched NOVAPULSE in the INTENDED classes (Part A): the plan entries carry [35,38], not the item string.
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  const supp = plan.entries.filter((e) => e.origin === "supplemental");
  assert.ok(supp.length >= 1, "Part A minted supplemental register entries from the structured remedy");
  assert.ok(supp.every((e) => e.term === "NOVAPULSE"), "term is the DOMINANT ELEMENT, never the item class-description string");
  assert.ok(supp.every((e) => JSON.stringify(e.nice_classes) === JSON.stringify(["35", "38"])), "classes are the parsed Cl.35/38, never inScope");
  // the executor searched the wrong scope → the directive is NOT swept, the dominant gap is NOT closed.
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.ok(fr, "frame-reopen ran (dispatch arm)");
  assert.equal(fr.domClosed, false, "the wrong-scope 0/0 did NOT close the dominant-element gap");
  assert.equal(fr.swept, 0, "the wrong-class block swept NOTHING");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.equal(receipt.domClosed, false);
  assert.ok(receipt.deferrals.some((d) => d.layer === "field"), "the field directive stays a disclosed deferral");
  // re-attempt-once fired (bounded), then disclosed honestly.
  assert.ok(events.some((e) => e.event === "frame-reopen-reattempt"), "one bounded re-attempt fired");
  assert.ok(calls.length === 2, `exactly two dispatches (attempt + one re-attempt), got ${calls.length}`);
  // the unclosed dominant gap honestly clamps the verdict (never a false CLEAR).
  assert.equal(res.verdict, "CONDITIONAL", "the standing dominant-element gap clamped CLEAR→CONDITIONAL");

  // #248 WIRING — the remedy term ledger reaches the receipt, and a term that ran and returned
  // nothing carries its EXECUTED QUERY next to the zero. This is the pipeline half of #248: the pure
  // module is unit-tested elsewhere, and this asserts the field is actually written by the run.
  assert.ok(Array.isArray(receipt.remedy_terms) && receipt.remedy_terms.length >= 1,
    `the receipt carries per-term rows, not just qid strings: ${JSON.stringify(receipt.remedy_terms)}`);
  const empty = receipt.remedy_terms.find((r) => r.class === "searched-empty");
  assert.ok(empty, `the wrong-scope 0/0 term is searched-empty: ${receipt.remedy_terms.map((r) => `${r.term}=${r.class}`).join(", ")}`);
  assert.equal(empty.term, "NOVAPULSE");
  assert.ok(empty.slices.length >= 1 && /^exact NOVAPULSE \[cl /.test(empty.slices[0].query),
    "the executed query is on the row — the trace that did not exist before #248");
  assert.equal(empty.slices[0].total_hits, 0, "a counted zero");
  assert.equal(empty.slices[0].records, 0, "an empty records array, stated");
  const acct = events.find((e) => e.event === "remedy-accounting");
  assert.ok(acct && acct.computable === true, "the run.jsonl accounting row fired");
  assert.equal(acct.searched_empty >= 1, true);
  assert.equal(acct.unaccounted, 0, "nothing unaccounted here — the slice ran, it was simply wrong-scoped");
});

test("Fix2 #1: the re-attempt with the correct classes CLOSES the gap — attempt 1 wrong-scope, attempt 2 right", async () => {
  // attempt 1 searches the wrong classes (0/0); the ONE bounded re-attempt searches the intended Cl.35/38 with records.
  const { planExecutor, calls } = fieldGapExecutor((n) => n === 1
    ? { cls: [9, 28, 41, 42], hasRecords: false }
    : { cls: [35, 38], hasRecords: true });
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "frame-reopen-reattempt"), "the re-attempt fired after attempt 1 failed verification");
  assert.equal(calls.length, 2, "bounded to exactly one re-attempt");
  assert.ok(calls[1].cls.join(",") === "35,38", "the re-attempt carried the CORRECT intended classes");
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.equal(fr.domClosed, true, "the correctly-scoped re-attempt closed the dominant-element gap");
  assert.ok(fr.swept >= 1, "the field directive was swept once genuinely searched");
  assert.equal(res.verdict, "CLEAR", "a genuinely-closed gap does not clamp");
});

test("Fix2 #1: a genuine close on the FIRST dispatch sweeps with NO re-attempt (no over-fire, no infinite re-open)", async () => {
  const { planExecutor, calls } = fieldGapExecutor(() => ({ cls: [35, 38], hasRecords: true }));
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1, "a verified close on attempt 1 spends no re-attempt");
  assert.ok(!events.some((e) => e.event === "frame-reopen-reattempt"), "no re-attempt on a genuine first-pass close");
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.equal(fr.domClosed, true);
  assert.ok(fr.swept >= 1);
  assert.equal(res.verdict, "CLEAR");

  // #248 WIRING — the closure gate must not manufacture a clamp on a genuine close. Every remedy term
  // here is accounted (`found`: the slice landed with records), so domClosed stays true and the
  // verdict stays CLEAR. Paired with the pure-module test that a single unaccounted term blocks it,
  // this is the gate answering both ways through the real pipeline.
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.ok(Array.isArray(receipt.remedy_terms) && receipt.remedy_terms.length >= 1, "per-term rows written");
  assert.ok(receipt.remedy_terms.every((r) => ["found", "searched-empty"].includes(r.class)),
    `every term accounted: ${receipt.remedy_terms.map((r) => `${r.term}=${r.class}`).join(", ")}`);
  assert.ok(receipt.remedy_terms.some((r) => r.class === "found"), "the slice with records is `found`");
  assert.equal(receipt.remedy_accounting.totals.unaccounted, 0);
  assert.equal(receipt.domClosed, true, "a fully-accounted dominant directive still closes — no manufactured clamp");
});

test("Fix2 #1-resume: the warm-resume arm does NOT close a dominant-element gap on a bare unit byte-diff (planExec null — clarivate/signa/PLAN_DISPATCH=off)", async () => {
  // The dispatch arm's precondition includes `&& planExec`; with no injected planExecutor and
  // CLEAROTRON_PLAN_DISPATCH=off (the harness default, and the live shape for a provider with no executePlan
  // adapter — clarivate/signa), planExec is null so control falls to the warm-RESUME arm. The resumed
  // register-unit re-emits the unit .md byte-changed (the mock stamps a frame-reopen marker) but the band
  // never enumerates NOVAPULSE×[35,38] — exactly the RUN1 wrong-scope false-close, on the un-dispatched arm.
  // Pre-fix: regChanged (byte-diff) swept the dominant-element directive → domClosed:true → false CLEAR.
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.ok(fr, "frame-reopen ran (resume arm)");
  assert.equal(fr.domClosed, false, "a bare unit byte-diff must NOT close an unverifiable dominant-element gap in the resume arm");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.equal(receipt.domClosed, false, "the receipt records the dominant gap as unclosed");
  // pin the MECHANISM, not just the outcome: the deferral must cite unverifiable searched-scope, NOT a
  // record-class read (the co-classification trap — the band's records carry 35/38 from 9/28/41/42
  // co-classification even though 35/38 were never searched, so a records-based verifier would false-close).
  const domDefer = receipt.deferrals.find((d) => d.layer === "field");
  assert.ok(domDefer, "the dominant-element field directive stays a disclosed deferral");
  assert.match(domDefer.reason, /resume-arm-unverifiable/, "deferred because the resume arm cannot verify searched scope (not on a byte-diff / record-class read)");
  assert.equal(res.verdict, "CONDITIONAL", "the standing dominant-element gap clamps CLEAR→CONDITIONAL (never a false CLEAR)");
});


// ── 2026-07-04 production doctrine: AUTOMATIC RUN-LEVEL RECOVERY ────────────────────────────────────────
// A business-critical report converges to an honest delivery WITHOUT a human re-trigger: a recoverable
// failure PARKS (self-contained .postponed the runner watcher resumes), the resume skips valid stages,
// re-runs the broken segment fresh, and passes the SAME gates — recovery can converge, never bypass.
test("auto-recovery: a recoverable failure PARKS (no .failed, no notice) and the automatic resume DELIVERS", async () => {
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.ok, false);
    assert.equal(res.postponed, true, JSON.stringify(res));
    assert.equal(res.recovery, true);
    assert.equal(res.attempt, 1);
    assert.ok(!existsSync(join(res.runDir, ".failed")), "NOT terminal — no .failed sentinel");
    assert.ok(!existsSync(driverDir(res.runDir, "failure.json")), "no failure notice on a recoverable park");
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    assert.equal(sent.kind, "recovery");
    assert.ok(sent.job && sent.agent && sent.codename, "self-contained payload — the runner watcher re-invokes from this");
    // A4 field split: the recovery park's clock is recoveryResumesAt — resetsAt stays the rate-limit
    // cap's name and must NOT appear on a recovery park (the 2026-07-28 postmortem misread).
    assert.ok(sent.recoveryResumesAt > sent.postponedAt, "backoff window set");
    assert.equal(sent.resetsAt, undefined, "the recovery sentinel no longer overloads the rate-limit field");
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "recovering");
    assert.equal(status.recoveryAttempts, 1);
    assert.ok(status.recoveryResumesAt > sent.postponedAt, "status carries the same split clock");
    assert.equal(status.resetsAt, null, "any lingering rate-limit clock is actively cleared");
    // …the backoff elapses; the runner's self-resume watcher re-invokes pipeline() with the payload.
    // Simulate exactly that (same workspace, transient cause gone):
    delete process.env.MOCK_FAIL_STAGE;
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: sent.codename });
    assert.equal(res2.ok, true, JSON.stringify(res2));
    assert.ok(existsSync(join(res2.runDir, ".delivered")), "the report DELIVERED with zero human involvement");
    assert.ok(!existsSync(join(res2.runDir, ".postponed")), "the recovery sentinel is consumed on resume");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; }
});

// ── the two park lanes (2026-07-29) ──────────────────────────────────────────────────────────────────
// A clearance run, 2026-07-29: two upstream overload parks took the run-global recovery counter to 2/3
// and 3/3 while nothing the run produced had failed a check, and the run then spent its remaining four
// hours one failure from terminal. Weather and defect now draw on separate bounded budgets, and the run
// record has to say which lane paid — the run's own status.json is where an operator reads that.
test("park lanes: an UPSTREAM OVERLOAD park charges weather and leaves the defect budget whole", async () => {
  try {
    // MOCK_CLAUDE_OVERLOADED is the real Anthropic 529 shape (overloaded_error, exit 1); runStage
    // reclassifies it to status_overloaded, which is what a live overload park actually carries.
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CLAUDE_OVERLOADED: "1", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.postponed, true, JSON.stringify(res));
    assert.equal(res.recovery, true);
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "recovering");
    assert.equal(status.recoveryLane, "weather", "an upstream overload is weather, not a defect in this run's output");
    assert.deepEqual(status.recoveryLanes, { weather: { attempts: 1, ceiling: 6 }, defect: { attempts: 0, ceiling: 3 } },
      "BOTH counters are in the run record, and the defect budget is untouched");
    assert.equal(status.recoveryAttempts, 1, "the total park count keeps its old meaning (repair epoch, session keys, the notice)");
    assert.equal(status.recoveryHistory.at(-1).lane, "weather", "the append-only history is the lane ledger a resume reads back");
    // A4 clock honesty: a weather park is still OUR backoff guess, not a provider-declared reset —
    // recoveryResumesAt, resetsAt untouched, and the lane (not the clock field) says who caused it.
    assert.ok(status.recoveryResumesAt, "the recovery backoff clock is set");
    assert.equal(status.resetsAt, null, "resetsAt stays the rate-limit cap's name — nobody told us when the overload ends");
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    assert.equal(sent.lane, "weather", "the resume sentinel carries the lane too");
    assert.equal(sent.resetsAt, undefined);
    const parked = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => JSON.parse(l)).findLast((e) => e.event === "auto-recovery-parked") ?? {};
    assert.equal(parked.lane, "weather");
    assert.equal(parked.laneOf, 6, "and names the bound it is spending against");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_CLAUDE_OVERLOADED; }
});

test("park lanes: a park from the run's OWN output still charges the defect budget", async () => {
  try {
    // nonzero_exit is transient but wedge-shaped, not weather: the remedy is a fresh sample of our own
    // work, which is exactly what the (small, deliberate) defect budget buys.
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.recovery, true, JSON.stringify(res));
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.recoveryLane, "defect");
    assert.deepEqual(status.recoveryLanes, { weather: { attempts: 0, ceiling: 6 }, defect: { attempts: 1, ceiling: 3 } },
      "the defect lane is spent — the split changes who pays, never that somebody pays");
    assert.equal(status.recoveryHistory.at(-1).lane, "defect");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_FAIL_STAGE; }
});

test("resumed-after-terminal-failure: a stale .sent (from the failure notice) never skip-guards the report send", async () => {
  // The VENZY 2026-07-04 shape: run went TERMINAL (notice sent → deliver skill wrote .sent), a human
  // re-triggers after addressing the cause, the resume converges. prelim-deliver skips any run with a
  // .sent marker — so the delivery handoff MUST clear the previous send's markers or the report is
  // silently lost. Same invariant on the failure arm: a resumed run that fails again must re-notify.
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_DELIVERY: "handoff" });
  assert.equal(res.ok, false);
  assert.ok(existsSync(join(res.runDir, ".failed")), "terminal (recovery off in this harness)");
  assert.ok(existsSync(driverDir(res.runDir, "failure.json")), "notice packet handed off");
  // the deliver skill sends the notice and stamps the run dir:
  writeFileSync(join(res.runDir, ".sent"), JSON.stringify({ messageId: "<notice@test>", at: "2026-07-04T00:00:00Z" }));
  // human re-trigger, cause addressed:
  delete process.env.MOCK_FAIL_STAGE;
  process.env.CLEAROTRON_DELIVERY = "handoff";
  try {
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const codename = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).codename;
    const res2 = await resume({ ...JOB }, { codename });
    assert.equal(res2.ok, true, JSON.stringify(res2));
    const dir = existsSync(join(res2.runDir, ".delivered")) ? res2.runDir : res.runDir;
    assert.ok(!existsSync(join(dir, ".sent")), "stale .sent CLEARED at the delivery handoff — the report send cannot be skip-guarded");
    assert.ok(!existsSync(driverDir(dir, "failure.json")), "stale failure packet removed — one delivery story");
    assert.ok(existsSync(driverDir(dir, "delivery.json")), "fresh delivery packet handed off");
    assert.equal(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).sendPending, true, "send is pending again for the REPORT");
  } finally { delete process.env.CLEAROTRON_DELIVERY; }
});

test("repeat-signature: an identical failure on resume is terminal at attempt 2 — never bought 3×", async () => {
  // The 414-wedge production shape (2026-07-05): a deterministic defect re-failed BYTE-IDENTICALLY
  // across three parks (~77 min) before the terminal. With the signature backstop the second identical
  // failure goes terminal immediately, with the honest terminalKind — even though park budget remains.
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.recovery, true, "attempt 1 parks (first sighting of this signature)");
    const status1 = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status1.recoveryHistory?.length, 1, "the park recorded its signature");
    assert.ok(status1.recoveryHistory[0].sig, "history rows carry the signature");
    // the resume hits the SAME persistent cause (knob still set) → identical signature → terminal
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: res.codename });
    assert.equal(res2.ok, false);
    assert.equal(res2.postponed, undefined, "NOT parked again — budget remained (1/3 used) but the signature repeated");
    assert.ok(existsSync(join(res2.runDir, ".failed")), "terminal .failed at attempt 2");
    const failed = JSON.parse(readFileSync(join(res2.runDir, ".failed"), "utf8"));
    assert.equal(failed.terminalKind, "repeat-signature", "the sentinel names the honest terminal kind");
    assert.equal(failed.sig, status1.recoveryHistory[0].sig, "same defect, same fingerprint");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_FAIL_STAGE; }
});

test("auto-recovery exhaustion: attempts beyond CLEAROTRON_RECOVERY_MAX go terminal, and the notice says so", async () => {
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "1" });
    assert.equal(res.recovery, true, "attempt 1 parks");
    // the resume hits the SAME persistent cause → attempts (1) >= max (1) → terminal circuit breaker
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: res.codename });
    assert.equal(res2.ok, false);
    assert.equal(res2.postponed, undefined, "no further parking — terminal");
    assert.ok(existsSync(join(res2.runDir, ".failed")), "terminal .failed after exhaustion");
    // Repair-first phase 3: the identical resume failure terminates as REPEAT-SIGNATURE, and the notice
    // says exactly that — no more blanket "the cause is systemic (credentials/provider/config)" claim
    // (teal-causeway's notice asserted a systemic cause for a deterministic 414).
    const packet = JSON.parse(readFileSync(driverDir(res2.runDir, "failure.json"), "utf8"));
    assert.match(packet.whatsappText, /after 1 automatic recovery attempt\b/, "the notice names the burned recovery attempt");
    assert.equal(packet.terminalKind, "repeat-signature");
    assert.match(packet.emailBodyHtml, /failed IDENTICALLY to the first attempt/);
    assert.match(packet.emailBodyHtml, /The driver reported, verbatim:/);
    assert.doesNotMatch(packet.emailBodyHtml, /cause is systemic \(credentials\/provider\/config\)/, "no invented systemic claim");
    assert.ok(packet.failureSignature && packet.reasonVerbatim, "the packet carries the signature + verbatim reason");
    // #862 — the payload fields, through the REAL writers rather than a unit call. This failure carries
    // no detail and no count, so both must be present AND null in both sinks: a status.json or a notice
    // with no such key cannot be told apart from one whose failure had nothing to say, and that
    // ambiguity is exactly what sent E2E to replay the merge gate against preserved artifacts.
    assert.ok("reasonDetail" in packet && "reasonQuantity" in packet, "the notice declares both payload fields");
    assert.equal(packet.reasonDetail, null);
    assert.equal(packet.reasonQuantity, null);
    const st = JSON.parse(readFileSync(join(res2.runDir, "status.json"), "utf8"));
    assert.ok("reasonDetail" in st && "reasonQuantity" in st, "status.json declares both payload fields");
    assert.equal(st.reasonQuantity, null, "absent is not zero");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; }
});

// doc-50 regression (2026-07-07 wobble outage): the nightly wobble replays PRE-doc-50 runs. verify
// reads _driver/framework.json from DISK, so a replay over a run with no sidecar failed
// framework_manifest_missing_for_v4 on EVERY replay (the whole nightly sweep went red, ~$65 burned on
// doomed Opus retries). pipelineInner's setup must BACKFILL the sidecar on a RESUME too (attachFramework
// runs write:true even when isResume) so the replayed v4 gate has its band vocabulary. Both directions below.
test("doc-50: a resume backfills a missing framework.json sidecar, and is a no-op when present (wobble replay)", async () => {
  const { res: r1 } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(r1.ok, false);
  const fwPath = driverDir(r1.runDir, "framework.json");
  assert.ok(existsSync(fwPath), "cold setup writes the sidecar (attachFramework write:true) before any stage");

  // simulate a pre-doc-50 frozen run: the framework sidecar never existed
  const { rmSync } = await import("node:fs");
  rmSync(fwPath);
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const { parseFrameworkManifest } = await import(`../framework.mjs?bust=${Math.random()}`);

  // MOCK_FAIL_STAGE stays armed, so the resume halts at matter-frame again and the run stays LIVE for the
  // second pass below. The stage outcome is not what is under test: the BACKFILL runs FIRST, in the
  // pipelineInner setup, and is what the wobble needs. Without it the sidecar stays absent and the v4
  // verify fails framework_manifest_missing_for_v4.
  try { await pipeline(JOB, { codename }); } catch { /* stage outcome not under test */ }
  assert.ok(existsSync(fwPath), "the resume BACKFILLED the missing sidecar before any stage ran");
  const minted = parseFrameworkManifest(readFileSync(fwPath, "utf8"));   // throws if corrupt/invalid
  assert.ok(Array.isArray(minted.bands) && minted.bands.length > 0, "the backfilled manifest is valid (carries bands)");

  // NO-OP on the hot path: a second resume with the sidecar present reads it verbatim, never re-derives/rewrites.
  const before = readFileSync(fwPath, "utf8");
  try { await pipeline(JOB, { codename }); } catch { /* idem */ }
  assert.equal(readFileSync(fwPath, "utf8"), before, "present sidecar read verbatim — never re-derived or rewritten");
});

// F2 owner lane (2026-07-29): reconstructCtx mirrors the cold path's axis-from-plan UNION. The owner
// lane routinely puts plan entries on incumbent-class for a watchlist-owners-only manifest — a manifest
// whose prose carries no incumbent marker, so decideAxes alone would leave the axis OFF and a
// stale-repair or --experiment of register-digest/placement would exclude the executed lane from the
// per-axis unit list and the declared inputs/freshness stamps.
test("reconstructCtx: axes union the frozen plan's axes — a plan-only axis survives stage surgery", async () => {
  const { res: r1 } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(r1.ok, false);
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  // a prose manifest with NONE of the decideAxes markers: prose alone activates only the two defaults
  writeFileSync(join(r1.runDir, "variant-manifest.md"),
    "# Variant manifest\n\n- NOVAPULSE (exact)\n- NOVA PULSE (visual spacing)\n");
  // the frozen plan carries the owner lane on incumbent-class (watchlist-owners-only shape)
  writeFileSync(driverDir(r1.runDir, "register-plan.json"), JSON.stringify({
    schema_version: 1, plan_version: 1, nice_classes: ["9"], regions: [],
    entries: [
      { qid: "primary-sweep:exact:novapulse", axis: "primary-sweep", predicate: "exact", term: "NOVAPULSE", nice_classes: ["9"], regions: [], expected_kind: "enumerate", term_literal: true },
      { qid: "incumbent-class:default:novapulse+owner-vantage-orchard-inc", axis: "incumbent-class", predicate: "default", term: "NOVAPULSE", owner: "Vantage Orchard Inc.", nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
      { qid: "incumbent-class:owner:vantage-orchard-inc+watch", axis: "incumbent-class", predicate: "owner", term: "Vantage Orchard Inc.", nice_classes: ["9"], regions: [], expected_kind: "count", covered_by: ["incumbent-class:default:novapulse+owner-vantage-orchard-inc"] },
    ] }, null, 2) + "\n");
  const { reconstructCtx } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const ctx = reconstructCtx(JOB, { codename });
  assert.ok(ctx.axes.includes("primary-sweep"));
  assert.ok(ctx.axes.includes("incumbent-class"), "the plan-only axis joins ctx.axes (the cold path's B3 union)");
  assert.ok(!ctx.axes.includes("transliteration-numeric"), "prose decideAxes still governs axes the plan does not carry");
});

test("spec 64 review fix: a condition action AND a machinery gap BOTH reach the delivered verdict — neither arm swallows the other", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition", MOCK_COVERAGE_INSUFFICIENT: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.kinds.legalActions, true, "the condition arm recorded");
  assert.equal(sidecar.kinds.coverage, true, "the machinery arm recorded TOO (review fix: it used to be skipped once legalActions clamped)");
  assert.ok(sidecar.reasons.some((r) => r.includes("Obtain consent from Mystery Owner LLC")), "the condition reason survives");
  assert.ok(sidecar.reasons.some((r) => r.includes("not fully cleared")), "the coverage reason survives beside it");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.legalActions === 1));
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.coverageInsufficient === true));
});

// ── A2: the report-card loop fans out (runBatched) ─────────────────────────────────────────────────
// Cards are isolated by design (each sees only ITS finding and writes only ITS file), so the fan-out
// must be a pure wall-time win: byte-identical assembly, real overlap, sibling-safe failures.
test("A2 report-cards: batched render assembles a report.md byte-identical to the serial baseline", async () => {
  // driver.config freezes at FIRST import in this shared process (same reason the harness header gives
  // for the recall knobs), so the serial baseline rides CLEAROTRON_TURN_CAP instead — gateway re-reads it
  // from env on EVERY slot acquire, and cap 1 executes every turn strictly one-at-a-time (the pre-A2
  // shape). Both runs pin the cap explicitly so declaration order can never leak a frozen value.
  const knobs = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3" };
  const serial = await runPipeline({ ...knobs, CLEAROTRON_TURN_CAP: "1" });
  assert.equal(serial.res.ok, true, JSON.stringify(serial.res));
  const parallel = await runPipeline({ ...knobs, CLEAROTRON_TURN_CAP: "3" });
  assert.equal(parallel.res.ok, true, JSON.stringify(parallel.res));
  for (const r of [serial, parallel])
    for (const ord of [1, 2, 3]) assert.ok(existsSync(join(r.res.runDir, "report-cards", `${ord}.md`)), `card ${ord} rendered`);
  assert.equal(readFileSync(join(parallel.res.runDir, "report.md"), "utf8"),
    readFileSync(join(serial.res.runDir, "report.md"), "utf8"),
    "assembled report.md is byte-identical to the serial baseline");
});

test("A2 report-cards: more than one card in flight; the first card warms the cache alone", async () => {
  const trace = join(mkdtempSync(join(tmpdir(), "prelim-cardtrace-")), "cards.jsonl");
  const { res } = await runPipeline({
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "4",
    MOCK_STAGE_TRACE: trace, MOCK_STAGE_DELAY_MS: "500", CLEAROTRON_TURN_CAP: "3",   // pin: the cap is env-read per acquire
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  const marks = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(new Set(marks.map((e) => e.card)).size, 4, "all four cards rendered through the mock");
  // max in-flight from interval overlap; at equal timestamps settle ends before starts (conservative —
  // an interval that already closed never counts toward the window that follows it).
  const deltas = marks.map((e) => ({ t: e.t, d: e.phase === "start" ? 1 : -1 })).sort((a, b) => a.t - b.t || a.d - b.d);
  let inFlight = 0, maxInFlight = 0;
  for (const { d } of deltas) { inFlight += d; maxInFlight = Math.max(maxInFlight, inFlight); }
  assert.ok(maxInFlight > 1, `expected concurrent card renders, saw max in-flight ${maxInFlight}`);
  // cache-warm: the FIRST card settles before any sibling starts (then the rest batch)
  const first = marks.find((e) => e.phase === "start");
  const firstEnd = marks.find((e) => e.card === first.card && e.phase === "end");
  assert.ok(marks.filter((e) => e.phase === "start" && e.card !== first.card).every((e) => e.t >= firstEnd.t),
    "the first card ran alone (prompt-prefix cache warm) before the batch");
  const md = readFileSync(join(res.runDir, "report.md"), "utf8");
  for (const ord of [1, 2, 3, 4]) assert.match(md, new RegExp(`^- ord: ${ord}$`, "m"), `card ${ord} assembled`);

  // #527 — THE WAVE'S WALLS, CHECKED AGAINST A CLOCK THE JOURNAL DOES NOT OWN.
  // This is the arm that catches a start instant captured too late. Move `tDispatch` below the stage's
  // await and every field is still present, every schema assertion still passes, and every interval
  // collapses to ~0ms — the journal would then assert that a 14-minute half took no time. Presence cannot
  // see that; only a second, independent measurement can. The mock's own trace above is exactly that: it
  // stamps a start and an end around each card's 500ms turn, from inside the dispatch, with no knowledge
  // of run.jsonl. Each card's journalled interval must CONTAIN its traced interval.
  const cardRows = res.events
    ? res.events.filter((e) => e.event === "stage" && String(e.stage).startsWith("report-card"))
    : readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
      .filter((e) => e.event === "stage" && String(e.stage).startsWith("report-card"));
  assert.equal(cardRows.length, 4, "one completion row per wave member — that half was never the defect");
  for (const row of cardRows) {
    const ord = String(row.stage).split(":")[1];
    const start = marks.find((e) => e.card === ord && e.phase === "start");
    const end = marks.find((e) => e.card === ord && e.phase === "end");
    assert.ok(start && end, `card ${ord}: the mock traced this turn — if not, the arm proves nothing`);
    const lo = Date.parse(row.dispatchedAt), hi = Date.parse(row.settledAt);
    assert.ok(lo <= start.t,
      `report-card:${ord} says it dispatched at ${row.dispatchedAt}, but the mock was already running ${start.t - lo}ms earlier — the start instant is captured after the work, so wallSec measures nothing`);
    assert.ok(hi >= end.t, `report-card:${ord} says it settled before the mock finished`);
    assert.ok(row.wallSec >= 0.5,
      `report-card:${ord} reports ${row.wallSec}s over a turn the mock held open for 500ms`);
  }
  // And the property the round could not read at all: the members of a wave OVERLAP, provably, from the
  // journal alone. Two rows whose intervals intersect ran concurrently, so neither one's cost is the
  // other's, and neither can be inferred from the row that happens to precede it.
  const overlapping = cardRows.some((a) => cardRows.some((b) => a !== b
    && Date.parse(a.dispatchedAt) < Date.parse(b.settledAt) && Date.parse(b.dispatchedAt) < Date.parse(a.settledAt)));
  assert.ok(overlapping, "no two card intervals intersect — a wave that reads as serial is the defect #527 reported");
});

test("A2 report-cards: one card's failure is non-fatal — siblings complete and the note is recorded", async () => {
  const noted = [];
  const orig = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) { noted.push(String(chunk)); return orig.call(this, chunk, ...rest); };
  let out;
  try {
    out = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FAIL_STAGE: "BOUND TO CARD 2" });
    // #1092 conversion 5 — keyed on the dispatch's own statement of its bound card. It used to read
    // "report-cards/2.md", and a converted dispatch names no path: the knob would have stopped matching
    // and this test would have measured a run where NO card failed while still asserting one did.
  } finally { process.stderr.write = orig; }
  const { res, events } = out;
  assert.equal(res.ok, true, JSON.stringify(res));   // the run still delivers
  const cards = events.filter((e) => e.event === "stage" && e.stage.startsWith("report-card"));
  assert.equal(cards.find((e) => e.stage === "report-card:2").ok, false, "card 2 failed");
  for (const ord of [1, 3]) assert.equal(cards.find((e) => e.stage === `report-card:${ord}`).ok, true, `sibling card ${ord} completed`);
  const md = readFileSync(join(res.runDir, "report.md"), "utf8");
  assert.match(md, /^- ord: 1$/m);
  assert.match(md, /^- ord: 3$/m);
  assert.doesNotMatch(md, /^- ord: 2$/m, "the failed card is omitted from report.md (render shows it structured-only)");
  assert.ok(noted.some((l) => /report-card\[2\] failed \(non-fatal/.test(l)), "the non-fatal note was recorded");
});

// ── A1 SPLIT: the two-member common-law gather (perf/commonlaw-split-gather) ─────────────────────────────

// Normalize a grid ledger (single object / merged object / batch array) to comparable sets — the
// acceptance is "same cells, gaps, pr_risk", never byte-identity (the merged object legitimately
// reorders keys and normalizes gap strings to objects).
function ledgerSets(raw) {
  const batches = Array.isArray(raw) ? raw : [raw];
  const cells = [], gaps = [], prRisk = [];
  for (const b of batches) {
    for (const c of b.cells ?? []) cells.push(`${c.term}|${c.platform}`);
    for (const g of b.gaps ?? []) gaps.push(typeof g === "string" ? g.split("|").slice(0, 2).map((s) => s.trim()).join("|") : `${g.term}|${g.platform}`);
    for (const e of b.extras?.pr_risk ?? []) if (e?.query) prRisk.push(e.query);
  }
  return { cells: cells.sort(), gaps: gaps.sort(), prRisk: prRisk.sort() };
}

// ── THE SURVIVING UNSPLIT LEVERS, and which of them a test can actually drive ─────────────────────
//
// #1149 item 8 deleted CLEAROTRON_COMMONLAW_SPLIT, and with it the only way to ask for the single-member
// assembly by flipping one variable. Two levers still reach that assembly, both production shapes
// rather than switches (pipeline.mjs deriveGridSpec), and they are NOT interchangeable here:
//
//   single-term-grid   a grid carrying fewer than 2 terms. NOT CONSTRUCTIBLE IN THIS HARNESS, and that
//                      is written down rather than left to look covered: the variant manifest carries a
//                      completeness floor (verify.mjs refuses a fresh manifest missing a core, phonetic
//                      or visual member), so a one-variant manifest fails its gate before any grid is
//                      authored. Reaching this lever needs new fixture machinery, not a new env value.
//   resumed-unsplit    a resume of a run whose findings were produced BEFORE the split existed: a valid
//                      common-law-findings.md with no half artifacts beside it. This is the back-compat
//                      path and it is what the tests below drive.
//
// The fixture builds that on-disk shape the only honest way — run until after the merge, then remove the
// half artifacts an older build would never have written, then resume. It does NOT re-run the grid (the
// point of the lever is that re-running would re-spend it), so it yields an unsplit ASSEMBLY, never a
// second independent ledger.
async function resumedUnsplitRun(extra = {}) {
  const { res: seed } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_FAIL_STAGE: "joint synthesis narrative", ...extra });
  assert.equal(seed.ok, false, `the seed run must run the split and stop AFTER the merge: ${JSON.stringify(seed)}`);
  assert.ok(existsSync(join(seed.runDir, "common-law-findings.md")),
    "the seed run must have merged its halves — without the canonical findings file there is no pre-split shape to resume");
  const half = (h) => [`common-law-findings.half-${h}.md`, `common-law-grid.half-${h}.json`,
    `common-law-dispositions.half-${h}.json`, driverRel(`grid-spec.half-${h}.json`)];
  assert.ok(existsSync(join(seed.runDir, `common-law-findings.half-${MEANING_SEAT}.md`)),
    "…and it must really have SPLIT — if no half artifact exists the fixture removes nothing and proves nothing");
  const { rmSync } = await import("node:fs");
  for (const h of ["a", "b", MEANING_SEAT]) for (const f of half(h)) rmSync(join(seed.runDir, f), { force: true });
  // READ THE JOURNAL FROM THE RUN DIR THE CALL RETURNED, never from a path captured earlier: a run that
  // DELIVERS is archived, so `seed.runDir` is an empty directory by the time the resume finishes and the
  // same read that worked before it succeeded returns ENOENT after. Three populations, one name.
  const journalAt = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const seedEvents = journalAt(seed.runDir);
  delete process.env.MOCK_FAIL_STAGE;
  const codename = seed.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline(JOB, { codename });
  // The journal is APPENDED to across the resume, so the seed's own `grid-split` and `common-law-path`
  // rows are still in it. Everything the resume asserts about events reads this slice, never the file —
  // counting the whole file would let the seed's split row answer a question about the resume.
  return { res, seedRunDir: seed.runDir, events: journalAt(res.runDir).slice(seedEvents.length) };
}

test("A1 split: the merged canonical ledger accounts for exactly the DICTATED grid (cells/gaps/pr_risk)", async () => {
  const split = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(split.res.ok, true, JSON.stringify(split.res));
  // member shape: the two grid halves AND the meaning seat (#517) — never the single member
  const clStages = stageOrder(split.events).filter((s) => s.startsWith("common-law"));
  assert.deepEqual(clStages.sort(), ["common-law-half:a", "common-law-half:b", `common-law-half:${MEANING_SEAT}`].sort(),
    "split gather = two grid halves + the meaning seat");
  assert.ok(split.events.some((e) => e.event === "grid-split"), "the half-spec producer stamped its receipt");
  assert.ok(split.events.some((e) => e.event === "common-law-merged" && e.gaps === 0), "the code merge ran clean");
  // half artifacts exist AND the canonical pair is the merged derivation
  for (const h of ["a", "b"]) {
    assert.ok(existsSync(join(split.res.runDir, `common-law-findings.half-${h}.md`)), `half ${h} findings written`);
    assert.ok(existsSync(join(split.res.runDir, `common-law-grid.half-${h}.json`)), `half ${h} ledger written`);
    assert.ok(existsSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`)), `half ${h} spec sidecar written`);
  }
  const canonical = readFileSync(join(split.res.runDir, "common-law-findings.md"), "utf8");
  assert.match(canonical, /driver-assembled/, "canonical findings = the driver merge");
  // #517 — THE MEANING SEAT'S DOCUMENT REACHES THE DELIVERABLE. Its whole output is the meaning read,
  // and a loaded reading is a FINDING; concatenating only the two grid halves would drop the one seat
  // whose findings are about what the mark MEANS, leaving a merged document that still looks complete
  // because the grid halves are complete. The grid ledger would even still carry the receipts.
  assert.match(canonical, new RegExp(`half-${MEANING_SEAT}`), "the assembly banner names every seat it concatenated");
  assert.match(canonical, /meaning sweep/i, "and the meaning seat's own document is in the merged file");

  // THE DIFFERENTIAL RUN IS GONE, and keeping the line would have been the silent green this whole
  // change is about. This asserted split-vs-unsplit over the same six terms, and the second run was
  // obtained with CLEAROTRON_COMMONLAW_SPLIT="off". Item 8 deleted that switch, so the same call now returns
  // ANOTHER SPLIT RUN and deepEqual compares a run against itself — passing, forever, asserting nothing.
  // Neither surviving lever can stand in: single-term-grid is unconstructible here, and resumed-unsplit
  // keeps the findings it resumed instead of re-running the grid. There is no second independent ledger
  // over these terms to compare against any more, and pretending otherwise is worse than saying so.
  //
  // What the comparison stood IN FOR is checkable directly, against a stronger reference than a second
  // run that could carry the same bug: the merge must account for every cell the DICTATED spec demands —
  // each one a result or a recorded gap — and invent none.
  const full = JSON.parse(readFileSync(driverDir(split.res.runDir, "grid-spec.json"), "utf8"));
  const mergedSets = ledgerSets(JSON.parse(readFileSync(join(split.res.runDir, "common-law-grid.json"), "utf8")));
  const dictated = full.terms.flatMap((t) => full.platforms.map((pl) => `${t}|${pl}`)).sort();
  assert.deepEqual([...mergedSets.cells, ...mergedSets.gaps].sort(), dictated,
    "the merge accounts for exactly the dictated term x platform grid — every cell a result or a recorded gap, and nothing the spec never asked for");
  const halfTerms = ["a", "b"].flatMap((h) => JSON.parse(readFileSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`), "utf8")).terms);
  assert.deepEqual(halfTerms.sort(), [...full.terms].sort(), "the two GRID halves partition the FULL canonical spec");
  assert.equal(full.ledger_required, true, "the canonical spec keeps its fail-closed stamp");
  // #517 — the seat that owns the meaning work owns NO cells, and the grid halves own NO meaning work.
  // This pair of facts is the regression signal the issue asked for: the gate that refused 13 of 14
  // first attempts cannot fire on a seat that owes nothing.
  const seatSpec = (h) => JSON.parse(readFileSync(driverDir(split.res.runDir, `grid-spec.half-${h}.json`), "utf8"));
  assert.deepEqual(seatSpec(MEANING_SEAT).terms, [], "the meaning seat sweeps no term x platform cells");
  assert.deepEqual(seatSpec(MEANING_SEAT).connotation.queries, full.connotation.queries,
    "and it holds the WHOLE sweep — undivided, exactly as #345 requires");
  for (const h of ["a", "b"])
    assert.deepEqual(seatSpec(h).connotation.queries, [], `grid half ${h} owes no meaning ruling`);
  const splitEv = split.events.find((e) => e.event === "grid-split");
  assert.equal(splitEv.connotation_a, 0);
  assert.equal(splitEv.connotation_b, 0, "the 49/0 imbalance this issue reported is now 0/0");
  assert.equal(splitEv.connotation_m, full.connotation.queries.length);
  assert.equal(splitEv.connotationOwner, MEANING_SEAT);
});

test("A1 split pre-split resume: the single-member assembly is restored VERBATIM (member list shape, no half artifacts)", async () => {
  // Was "flag-off". The flag is deleted; the ASSEMBLY it selected is not, and this is the lever that
  // still reaches it — a resume of a run whose findings predate the split. The properties are the ones
  // the flag-off arm asserted, because they are properties of the assembly, not of the switch.
  const { res, events } = await resumedUnsplitRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "common-law-path.json"), "utf8"));
  assert.equal(rec.path, "unsplit");
  assert.deepEqual(rec.members, ["common-law"], "the original single common-law member, by name");
  assert.ok(!events.some((e) => e.event === "grid-split" || e.event === "common-law-merged"),
    "no split machinery fired ON THE RESUME — the seed's own rows are excluded by construction, see resumedUnsplitRun");
  // The half artifacts the fixture removed must STAY removed: re-authoring them is the re-spend the
  // lever exists to prevent, and it would be invisible in the delivered report.
  for (const h of ["a", "b", MEANING_SEAT])
    for (const f of [`common-law-findings.half-${h}.md`, `common-law-grid.half-${h}.json`, driverRel(`grid-spec.half-${h}.json`)])
      assert.ok(!existsSync(join(res.runDir, f)), `no half artifact ${f}`);
});

test("A1 split repair BALANCE (item 25): the closable set is partitioned EVENLY across the usable halves, and the partition is recorded", async () => {
  // This test used to assert the opposite — that closable cells on a half-B term went to half B's
  // session and half A stayed untouched — because the reopen routed every cell through halfOfTerm.
  //
  // halfOfTerm is right for the FRESH gather (a pure function of the term, and the two halves come out
  // 1.4× apart). It is wrong for the reopen, which re-runs a SUBSET chosen by what failed, and that
  // subset does not respect the term partition: on the evidence run one half drew 857s of closure work
  // while the other drew 100s. Term-ownership was never the property that mattered here — the followup
  // DICTATES its cells by name, so any usable half can run any cell.
  //
  // What replaces it is a deterministic even deal (sorted by cell key, round-robin), which is the
  // balance the rejected N-worker queue was proposed for, without spending the pure partition every
  // followup depends on.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_GAPS: "translit" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const closure = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: closure.requested, closed: closure.closed, remaining: closure.remaining },
    { requested: 2, closed: 2, remaining: 0 }, "every closable cell is still run — balancing must never drop one");
  const part = events.find((e) => e.event === "closure-partition");
  assert.ok(part, "the partition is RECORDED: a balance nobody can see is a balance nobody can check");
  assert.equal(part.cells, 2);
  assert.equal(part.unassigned, 0);
  const counts = Object.values(part.per_half);
  assert.equal(counts.reduce((a, b) => a + b, 0), 2, "every cell is assigned exactly once");
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "…and the halves differ by at most one cell, which is what even means");
  const passes = events.filter((e) => e.event === "stage" && e.trigger === "coverage-closure").map((e) => e.stage).sort();
  assert.deepEqual(passes, ["common-law-half:a", "common-law-half:b"],
    "two cells over two usable halves ⇒ both sessions work, where before one did all of it and the other idled");
  // the re-merge refreshed the canonical ledger: the closed cells are real cells again, zero gaps left
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.equal(merged.gaps.length, 0, "post-closure re-merge recomputed the gaps away");
});

test("A1 split quarantine: the MEANING SEAT's dictated queries are NEVER silently dropped — merge gate fails transient; a resume re-runs ONLY that seat and converges", async () => {
  // The seat that owns the sweep dies on transient infrastructure BEFORE writing anything (the mock exits
  // pre-write), so NOT ONE dictated meaning query was executed. The canonical connotation gate is
  // COUNT-based, and the merged document still concatenates two complete grid halves — so nothing else in
  // the pipeline can see the hole. Pre-fix this shipped a clean meaning-read over searches that never ran
  // (a production false-clean class). The merge gate's per-query identity join must fail the run instead.
  //
  // #517 MOVED THE SEAT THIS TEST KILLS, and that is the point. It used to kill half b, which owned the
  // whole sweep as well as half a grid; killing a grid half now drops CELLS ONLY (they merge as honest
  // gaps and ride the closure pass), because a grid half is dictated no meaning query at all. The
  // false-clean this test guards lives entirely at the meaning seat now, so that is where it is aimed.
  const { res: r1, events: e1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: `grid-spec.half-${MEANING_SEAT}` });
  assert.equal(r1.ok, false, "the run must NOT complete over un-executed dictated meaning queries");
  assert.equal(r1.failedStage, "common-law");
  // #614 — the SENTENCE names the defect, the PAYLOAD names the queries, and they are separate fields
  // now: the portal renders one to a user and puts the other behind a disclosure. Both are still
  // recorded, which is what this arm is actually about — a dropped dictated query must never vanish.
  assert.match(r1.reason, /merged half-grids (failed the canonical validator|dropped \d+ dictated connotation quer)/i,
    "the failure sentence must still say WHAT went wrong — this shape reaches the merge gate by either "
    + "route depending on which check fires first, and both are reader-safe sentences now");
  assert.ok(!/wikipedia|meaning slang/i.test(r1.reason),
    "…and must not carry the query list, which is what shipped to a user's dashboard");
  const st1 = JSON.parse(readFileSync(join(r1.runDir, "status.json"), "utf8"));
  assert.match(String(st1.reasonDetail ?? ""), /connotation|:/,
    "the queries themselves must reach status.json as their own field — dropped from the sentence AND "
    + "from the record is how a dictated query vanishes silently");
  assert.ok(e1.some((ev) => ev.event === "common-law-half-quarantined" && ev.half === MEANING_SEAT), "the meaning seat was quarantined on transient infra");
  assert.ok(e1.some((ev) => ev.event === "recovery-classified" && ev.class === "transient" && ev.classSource === "throw-site"),
    "classified transient at the throw site — the park loop owns convergence");
  // resume: half a's artifacts stand (skip), ONLY half b re-runs; the re-merge restores the full receipt set
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const all = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // the resume APPENDS to run 1's run.jsonl — judge run 2's slice only (from ITS grid-split event on)
  const e2 = all.slice(all.map((ev) => ev.event).lastIndexOf("grid-split"));
  assert.deepEqual(e2.filter((ev) => ev.event === "stage" && ev.stage.startsWith("common-law")).map((ev) => ev.stage),
    [`common-law-half:${MEANING_SEAT}`], "the resume re-ran ONLY the failed seat (both grid halves skipped, not re-spent)");
  for (const h of ["a", "b"])
    assert.ok(e2.some((ev) => ev.event === "skip" && ev.stage === `common-law-half:${h}`), `grid half ${h}'s completed work was reused`);
  const spec = JSON.parse(readFileSync(driverDir(r2.runDir, "grid-spec.json"), "utf8"));
  const merged = JSON.parse(readFileSync(join(r2.runDir, "common-law-grid.json"), "utf8"));
  assert.ok(spec.connotation.queries.length >= 2, "the spec dictates a real sweep (test precondition)");
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query).sort(), [...spec.connotation.queries].sort(),
    "every dictated meaning query is recorded in the merged canonical ledger");
});

// ── P2-C §8b leg 2 through the SPLIT (2026-07-31 review round). The mock's default receipts carry
// results:[] on every query, so no test had ever driven an ARMED with-results disposition through the
// split pipeline — the exact blind spot the review named. MOCK_PR_RESULTS closes it.

test("P2-C split armed: with-results receipts flow the disposition contract end to end — half seats write the rows, the merged gate passes, no remedy fires", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_PR_RESULTS: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.ok(merged.extras.pr_risk.length >= 2 && merged.extras.pr_risk.every((e) => e.results.length === 1),
    "every recorded receipt carries a result (the evidence-run shape)");
  assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8")).connotation.disposition_required, true);
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  assert.match(md, /None identified — affirmative sweep/, "the designated owner half wrote the clean bottom line");
  assert.match(md, /news\.example\/mock-meaning-receipt/, "the disposition rows cite the recorded result");
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [], "no merge remedy needed — the half seats carried the contract");
  assert.ok(events.filter((e) => e.event === "stage" && e.stage.startsWith("common-law-half"))
    .every((e) => e.ok && e.attempts === 1), "both halves passed first-try under the armed gate");
});

test("P2-C split: an undisposed receipt fails AT THE OWNING HALF SEAT and the corrective retry heals it — the connotation hint reaches the authoring session", async () => {
  // needle = the FULL first dictated query ("<first grid term> meaning slang", connotation index 0).
  //
  // #345 MOVED THIS SEAT, and that is what this test now pins. Index 0 used to land on half a under the
  // parity partition, which was also the half writing the clean bottom line. The meaning sweep is now
  // SINGLE-SEAT (MEANING_SEAT), so EVERY dictated query — index 0 included — is owned by one half,
  // and the seat that asserts the clean bottom line is no longer the seat that holds the receipts.
  // That separation is safe precisely because #350 armed the gate on the RECEIPTS rather than on prose:
  // the owning half is policed on what its ledger records, whatever its own document claims.
  // MOCK_CL_UNDISPOSED withholds the rows until a turn carrying the connotation correction dictate.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PR_RESULTS: "novapulse meaning slang", MOCK_CL_UNDISPOSED: "1", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const owner = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT}` && e.trigger === "fresh");
  assert.equal(owner.ok, true);
  assert.equal(owner.attempts, 2, "attempt 1 failed the disposition arm; the corrective retry healed it in-stage");
  // …and it healed on a FRESH dispatch, which is #589's whole subject. This fixture leaves the seat's
  // form with zero of its one row ruled and no seat-owned field set anywhere — a TOTAL defect — and a
  // resumed session re-reads its own output, so the warm patch is vetoed and attempt 2 runs fresh. That
  // is R6's measured 1007 seconds, not spent.
  //
  // THE PROPERTY THIS LINE USED TO GUARD IS NOT LOST. It asserted `warm === true` so the test could not
  // pass if the connotation tokens were quietly dropped from WARM_ELIGIBLE_RE. They are still on that
  // allowlist — it routes the repair at the disposition form and decides draft carry — and
  // retry-by-failure-shape.test.mjs arm 5 asserts exactly that, while arm 3 pins that a PARTIAL defect
  // still warm-patches.
  assert.equal(owner.warm, false,
    "attempt 2 resumed a session that had ruled none of its rows — the veto is not firing (#589)");
  // the NON-owning half is asked to dispose nothing, and passes first try over an empty sweep
  const other = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT === "a" ? "b" : "a"}` && e.trigger === "fresh");
  assert.equal(other.attempts, 1, "the sibling holds no dictated meaning queries — nothing for it to dispose");
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [],
    "healed at the seat — the merge gate never had to route a remedy");
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  // THE LEDGER-WIPE TRAP (mock-stage-fixtures.mjs, the `resuming` guard): a warm patch makes no tool call,
  // so the plugin does not re-run and the half's grid ledger must not move. If a future change lets a warm
  // turn re-derive that ledger, extras.pr_risk[] empties, the receipts under repair vanish and the half
  // passes over silence. This row assertion is the tripwire: a wiped ledger yields no obligations, so the
  // driver-rendered table is empty and nothing matches here.
  // #460 — the row is DRIVER-RENDERED from the form now, so the receipt's URL comes from the tool-written
  // ledger rather than from anything the seat typed.
  assert.match(md, /meaning-sweep dispositions \(driver-rendered\)/, "the driver rendered the table, not the seat");
  assert.match(md, /\| novapulse meaning slang \|[^|]*\|[^|]*news\.example\/mock-meaning-receipt/,
    "the healed half's ruled row reached the merged findings");
});

test("P2-C split cross-half: the half that OWNS the receipt now catches it at ITS OWN seat — the merged doc never has to (#350)", async () => {
  // needle = "<first grid term> gang" (connotation index 1 → half b): the with-results receipt lives in
  // half b's ledger, which writes NO bottom line of its own, while half a writes the clean claim over zero
  // with-results receipts of its own.
  //
  // THE SHAPE THIS TEST WAS WRITTEN FOR IS THE HOLE #350 CLOSES, so it can no longer arise. Half b used to
  // PASS its own seat — its doc asserted nothing CLEAN_CLAIM_RE matched, so the disposition arm never armed
  // over its own undisposed receipt — and only the MERGED doc was in violation. That is precisely the defect:
  // the arm was a phrase match on model prose, so the half seat that actually owned the receipt was silent
  // about it. Armed on the receipts, half b fails where the receipt lives and its own corrective ladder
  // heals it — earlier, cheaper, and at the seat holding the ledger it must read.
  //
  // What this DOES still guard is that the outcome is a healed run, not a terminal one: pre-fix this shape
  // threw StageFailure failClass "deterministic" (parkBudget 0, "never parked at all") and the first fresh
  // split run with it died .failed after the full paid gather with no model turn ever seeing the hint.
  //
  // #345 CLOSED the merge-only channel this comment used to describe. It read: "the recurrence floor
  // counts distinct queries over the UNION, so a receipt under the floor in each half and over it in the
  // merged pair still fails only at the merge." That was true, and it was the VENZY terminal — both
  // halves passed and the merge of them failed, on an obligation neither reader could observe from the
  // receipts it held. With the sweep single-seat the owning half sees exactly what the merge sees, so
  // merged violations are a subset of that half's by construction. common-law-receipts.test.mjs proves
  // the containment at unit level, and reproduces the old split shape to show what it cost.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PR_RESULTS: "novapulse gang", MOCK_CL_UNDISPOSED: "1", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  // #517 — THIS IS THE ACCEPTANCE CRITERION, AS A TEST. The receipt is still caught at the seat that
  // holds it and still healed by that seat's own corrective ladder; what changed is WHICH seat that is.
  // The grid halves are handed no meaning query, so the gate that refused 13 of 14 first attempts cannot
  // arm on them — and both of them now pass first try, over the very receipt that used to fail one.
  const owner = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT}` && e.trigger === "fresh");
  assert.equal(owner.ok, true);
  assert.equal(owner.attempts, 2, "attempt 1 failed the disposition arm at the seat that OWNS the sweep; its corrective retry healed it");
  for (const h of ["a", "b"]) {
    const grid = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${h}` && e.trigger === "fresh");
    assert.equal(grid.ok, true, `grid half ${h} passed`);
    assert.equal(grid.attempts, 1,
      `grid half ${h} owes no meaning ruling, so connotation_no_ruling cannot refuse its first attempt — the structural failure this issue reported`);
  }
  // Asserted as an ABSENCE on purpose: if a future change re-opens the merged-only per-query hole, half b
  // starts passing its seat again and the remedy fires. Dropping this line would let that pass silently,
  // which is the failure class this whole change is about.
  assert.deepEqual(events.filter((e) => e.event === "connotation-remedy"), [],
    "the merge gate never had to route a remedy — the owning seat caught its own receipt");
  const md = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  assert.match(md, /None identified — affirmative sweep/, "half a's bottom line stands");
  assert.match(md, /\| novapulse gang \|[^|]*\|[^|]*news\.example\/mock-meaning-receipt/,
    "the meaning seat's healed ruled row reached the merged findings, rendered by the driver from the form");
  // the merged canonical pair passes the same gate a single-member run faces
  assert.ok(events.filter((e) => e.event === "common-law-merged").length >= 1, "the canonical pair was derived and passed the merge gate");
});

test("A1 split frame-reopen: a source-channel omission sweeps EVERY live half over its dictated term scope and closes", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "source" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const sweeps = events.filter((e) => e.event === "stage" && e.trigger === "frame-reopen" && e.stage.startsWith("common-law-half"));
  assert.deepEqual(sweeps.map((s) => s.stage).sort(), ["common-law-half:a", "common-law-half:b"], "BOTH live halves swept");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.ok(receipt.swept.some((k) => /^source:/.test(k)), "the source directive is SWEPT (full-grid coverage via both halves)");
  assert.equal(receipt.deferrals.length, 0, "nothing deferred on a clean full sweep");
  const cl = readFileSync(join(res.runDir, "common-law-findings.md"), "utf8");
  for (const v of ["novapulse", "转码"]) assert.ok(cl.includes(`| ${v} | github.com | No results — supplemental source-channel sweep |`),
    `variant ${v} carries its supplemental channel row in the merged canonical findings`);
});

test("A1 split frame-reopen: one half's sweep failing mechanically DEFERS the omission (disclosed) even though the merged file changed", async () => {
  // Pre-fix regression: srcSwept was a bare merged-file byte-diff — half a's successful sweep changed the
  // file, so half b's mechanical failure was swallowed and the omission read CLOSED while half b's
  // variants were never searched on the flagged channel. The single-member arm's contract is full sweep
  // OR disclosed deferral (open row + clamp) — the split must match it.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_FRAME_DIFF: "source", MOCK_FAIL_STAGE: "SOURCE CHANNELS&&half-b" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.ok(!receipt.swept.some((k) => /^source:/.test(k)), "the omission is NOT marked swept over a partial sweep");
  const def = receipt.deferrals.find((d) => /^source:/.test(d.directive));
  assert.ok(def, "the source directive is a DISCLOSED deferral");
  assert.match(def.reason, /mechanical-fail/, "the deferral carries the mechanical-failure reason");
  // the trap the fix guards: half a's sweep DID change the merged canonical file
  assert.ok(readFileSync(join(res.runDir, "common-law-findings.md"), "utf8")
    .includes("| novapulse | github.com | No results — supplemental source-channel sweep |"),
    "half a's supplemental rows landed (the byte-diff alone would have read as swept)");
  assert.ok(events.some((e) => e.event === "frame-reopen" && e.deferred >= 1), "the reopen event records the deferral");
});

// ── #577: a provider hard-error on a dictated slice becomes a DISCLOSED DEFERRAL ──────────────────────
//
// R5 (engine `8098215`), a worldwide Global preliminary: two `incumbent-class` slices took an
// "HTTP 500 … Count Failed - IL - Near/Adj" through the in-tool retry, the direct dispatch, the followup
// and FOUR recovery parks, and the fan-in then refused — 140 minutes, nothing delivered, worldwide sales
// held. The provider ACCEPTED both slices and then failed on one jurisdiction's index; `deferred` covered
// only slices a provider cannot EXPRESS, so there was no exit for a slice it accepted and then dropped.
//
// This is the whole arc in one test, because neither half is the claim on its own: the first pass MUST
// still refuse (the recovery ladder keeps its chance at a bad minute), and the resume MUST deliver with
// the slices named. A test that only asserted the second half would pass on an engine that had simply
// stopped checking.
test("#577 a provider hard-error refuses ONCE, then ships as a disclosed deferral — never as clean", async () => {
  try {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
      MOCK_PLAN_HARD_ERROR: "+merch", CLEAROTRON_RECOVERY_MAX: "3" });

    // ── PASS 1: the ladder runs, and the run refuses rather than shipping over the hole ──────────────
    assert.equal(res.ok, false, "a slice the plan dictated did not run — the first fan-in does not ship");
    assert.ok(events.some((e) => e.event === "plan-qids-missing"), "the identity join saw it as a hole and tried to close it");
    assert.ok(!events.some((e) => e.event === "plan-qids-provider-hard-error-deferred"),
      "and did NOT defer on the first pass — deferring costs a disclosed gap, so recovery gets its chance first");
    const exec1 = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
    assert.ok(exec1.missing.length >= 1, "the receipt records the hole, which is what makes pass 2 possible");
    assert.deepEqual(exec1.deferred ?? [], [], "nothing is disclosed as deferred yet");

    // ── PASS 2: the resume the runner's watcher performs. Same run dir, same 500 ─────────────────────
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: sent.codename });
    assert.equal(res2.ok, true, `the run DELIVERS with the gap on its face: ${JSON.stringify(res2)}`);
    assert.ok(existsSync(join(res2.runDir, ".delivered")), "delivered, not parked and not terminal");

    const exec2 = JSON.parse(readFileSync(driverDir(res2.runDir, "plan-execution.json"), "utf8"));
    const hard = (exec2.deferred ?? []).filter((d) => d.qid.includes("+merch"));
    assert.equal(hard.length, exec1.missing.filter((q) => q.includes("+merch")).length,
      "every hard-errored slice is now a deferral — none was dropped on the way");
    assert.deepEqual(exec2.missing, [], "and none is left claiming to be merely missing");
    for (const d of hard) {
      assert.match(d.reason, /HTTP 500/, "the provider's own error is the stated reason, verbatim");
      assert.match(d.reason, /never searched and cannot be read as clean/, "and the row says what that means");
    }

    // The axis states what happened to it. `deferred` is not `executed`, and the confirmed-clean gates
    // read this skeleton — which is what stops the gap being swallowed downstream.
    const sk = exec2.skeleton.find((s) => s.axis === "primary-sweep");
    assert.equal(sk.state, "deferred", "the axis carrying the failed slice is not claimed as executed");

    // A run that CANNOT retry it forever, and did not: one bounded envelope attempt, recorded either way.
    const decision = JSON.parse(readFileSync(driverDir(res2.runDir, "envelope-decision.json"), "utf8"));
    const decided = [...decision.accepted, ...decision.closed, ...decision.close_failed].map((r) => r.qid);
    for (const d of hard) assert.ok(decided.includes(d.qid), `${d.qid} was decided about, not left open`);

    const events2 = readFileSync(driverDir(res2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const deferredRow = events2.find((e) => e.event === "plan-qids-provider-hard-error-deferred");
    assert.ok(deferredRow, "the conversion is a loud event — a reader can find WHY a territory went unsearched");

    // #1126 — AND THE ROW CARRIES THE THING IT IS A DECISION ABOUT.
    //
    // Its keys were `ts, event, count, permanent, qids`. A reader who saw `permanent: 0` had nothing to
    // audit that classification against: the verdict was recorded and the provider string it was made
    // from was not, so the one row that says "this refusal is weather" could never be checked from the
    // record. `qids_omitted` closes the same gap one level down — `slice(0, 8)` dropped the ninth qid
    // onward with no marker, which is this issue's own pathology occurring inside the line that records
    // this issue's defect.
    assert.ok(Array.isArray(deferredRow.reasons) && deferredRow.reasons.length,
      "the deferred row names the provider text its classification rests on");
    assert.equal(typeof deferredRow.qids_omitted, "number",
      "and says how many qids it did not list, so a list of eight cannot be mistaken for the whole set");
    assert.equal(deferredRow.qids.length + deferredRow.qids_omitted, deferredRow.count,
      "listed + omitted must equal the population");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; delete process.env.MOCK_PLAN_HARD_ERROR; }
});

// ── #563: the basis is DERIVED, at every seam, and the third synthesis pass is gone ──────────────────
//
// The pass this replaced ran ONCE, before refutation, and cost ~10 serial minutes on 3 of 4 runs to have
// a model re-assert what the reading log already knew. Two live claims are worth pinning from the
// outside, because neither is visible in a pure function:
//
//   · the derivation runs at BOTH seams — after synthesis AND before delivery. Re-derived on the four
//     delivered findings.json files the old pass measured, its own stamp counts did not hold (35→37,
//     28→31, 37→38, 41→40): stamps entered the deliverable after the only check that policed them.
//   · no synthesis dispatch carries `trigger: "read-verification"` any more. That is the ~10 minutes.
test("#563 the basis derivation runs at both seams, and no third synthesis pass runs at all", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));

  const seams = events.filter((e) => e.event === "basis-derivation").map((e) => e.at);
  assert.deepEqual(seams, ["post-synthesis", "pre-delivery"],
    "both seams, in order — one settle before refutation reads the findings, one after the corrective pass has written to them");

  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "read-verification"),
    "the third synthesis pass is GONE — this is the ~10 serial minutes the issue costed");
  assert.ok(!events.some((e) => e.event === "read-verification" || e.event === "read-verification-failed"),
    "and its events with it");

  // The record is written whether or not anything moved (AD-4): "nothing was demoted" must not read the
  // same as "nobody looked".
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "basis-derivation.json"), "utf8"));
  assert.equal(rec.at, "pre-delivery", "the last settle is the one on disk");
  assert.ok(Array.isArray(rec.rows), "rows is always present");
  assert.equal(typeof rec.stamped_after, "number");
  assert.equal(typeof rec.demoted, "number");
  assert.ok(!existsSync(driverDir(res.runDir, "read-verification.json")), "the old artifact is not written");
});

// ── #753 — the run RECORDS which common-law path it took, and which term of the selector decided it ──
//
// THE INCIDENT (E2E round, 2026-08-12). One build ran a single unsplit `common-law` stage and delivered
// in 95 minutes; the next ran three halves and died at 34. Nothing in either run's artifacts said what
// selected either path. `CLEAROTRON_COMMONLAW_SPLIT` was the obvious suspect and was a red herring both
// times — it is ON by default and was ON for both. The selector is a CONJUNCTION and a different term
// differed, but no artifact recorded any term, so the round's single most important open question was
// unanswerable from the record.
//
// THE SELECTOR, named:
//   a spec is authored at all  ⟸ !registerOnly && gridVariants.length && profile.platforms.length
//   then, only if a spec exists ⟸ gridSpec.terms.length >= 2
//                              && !resumedUnsplit
//
// #1149 item 8 deleted the `config.commonLawSplit` conjunct (CLEAROTRON_COMMONLAW_SPLIT). That is worth
// reading against the incident above rather than skipping: the flag was the obvious suspect BOTH times
// and was the answer NEITHER time, which is the argument for recording every term instead of trusting
// the one with a name. The record is why deleting it is safe.
//
// The property under test is that the record exists on EVERY path and agrees with the assembly. The
// unsplit path is the one that mattered on 08-11 and the one that emitted nothing at all before this:
// a record that appears only when the split arms cannot explain a run that did not split.
const readPathRecord = (runDir) => {
  const p = driverDir(runDir, "common-law-path.json");
  assert.ok(existsSync(p), `#753: _driver/common-law-path.json must exist on EVERY run — its absence IS the defect (${runDir})`);
  return JSON.parse(readFileSync(p, "utf8"));
};

test("#753 a SPLIT run records the split and the quantity that armed it", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "split");
  assert.equal(rec.reason, "armed");
  assert.ok(rec.terms >= 2, "the deciding quantity is recorded, not merely the verdict");
  // `rec.flag` is gone with #1149 item 8: the record names the terms of the selector, and the flag is no
  // longer one of them. The two test lines here were its only readers in the whole tree.
  assert.ok(!("flag" in rec), "a record that still carried `flag` would be naming a term the selector no longer has");
  assert.ok(rec.members.length && rec.members.every((m) => m.startsWith("common-law-half:")),
    "and the members it actually assembled");
});

test("#753 an UNSPLIT run records WHICH surviving term decided it — the branch that emitted nothing before", async () => {
  // Was the flag-off branch. #753's property was never about the flag: it is that a run which did NOT
  // split says so, and says why, on the path that used to emit nothing at all. Deleting the switch
  // removed one reason from the conjunction and left the property untouched.
  const { res, events } = await resumedUnsplitRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "unsplit", "the record agrees with the assembly");
  assert.equal(rec.reason, "resumed-unsplit", "and names WHICH term of the conjunction decided it");
  assert.match(rec.detail, /re-spend/i, "carrying what the term MEANS, not merely its slug — the detail is what a reader of the run acts on");
  assert.deepEqual(rec.members, ["common-law"], "naming the single-member assembly");
  const ev = events.filter((e) => e.event === "common-law-path");
  assert.equal(ev.length, 1, "exactly one path event per run — the journal carries it too, for a reader who has no run dir");
  assert.equal(ev[0].reason, "resumed-unsplit");
});

test("#753 the record can never explain a path the run did not take", async () => {
  // deriveGridSpec's branch and the gather assembly derive the path from DIFFERENT values, so a future
  // edit can make the explanation describe the wrong path — a confident wrong answer to the exact
  // question this issue was opened to answer. A divergence must overwrite the reason, never sit quietly
  // in a field nobody reads.
  // THIS LOOP WENT DEGENERATE AND STAYED GREEN. It ran `[{}, { CLEAROTRON_COMMONLAW_SPLIT: "off" }]`, and
  // once item 8 deleted the switch both elements were the same environment — so the invariant was
  // checked twice on the split path and not at all on the unsplit one, which is the path it exists for.
  // A loop over a list whose members have quietly become identical asserts less than it reads as
  // asserting, and nothing goes red to say so. Both paths are named explicitly now.
  const runs = [
    { label: "split", get: async () => (await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" })).res },
    { label: "unsplit (resumed-unsplit)", get: async () => (await resumedUnsplitRun()).res },
  ];
  const seen = new Set();
  for (const { label, get } of runs) {
    const res = await get();
    const rec = readPathRecord(res.runDir);
    assert.notEqual(rec.reason, "selector-record-disagreement",
      `selector and record diverged on the ${label} path: ${rec.detail}`);
    assert.equal(rec.path === "split", rec.members.some((m) => m.startsWith("common-law-half:")),
      `path and members must describe the same assembly (${label})`);
    seen.add(rec.path);
  }
  assert.deepEqual([...seen].sort(), ["split", "unsplit"],
    "both paths were actually exercised — if these two setups ever collapse onto one path again, this is the line that says so instead of the loop passing twice");
});

// ── #979 — the recorded downgrade is READ, and a run that took it cannot deliver clean ────────────────
//
// #753 wrote the record; nothing consulted it. A run whose dictated meaning sweep silently became the
// legacy spec-less path delivered CLEAN, with common-law-path.json sitting on disk naming the downgrade.
//
// THE LEVER, and it is a real production shape rather than a synthetic one: a resume of a run with no
// `_driver/profile.json`. attachProfile deliberately stays legacy on a sidecar-less resume (ctx.profile
// = null), so profile.platforms is 0, no grid spec is authored, and a variant-carrying non-register-only
// matter takes the spec-less path. The sweep report for this issue proposed seeding a zero-platform
// profile instead; that is impossible — profiles.mjs validateProfileShape refuses a whole profile whose
// platforms array is empty OR absent ("platforms must be a non-empty array of store-domain strings"),
// and loadProfiles validates at load, so no such profile can exist to be selected.
test("#979 a no-grid-spec downgrade on a variant-carrying manifest clamps CLEAR→CONDITIONAL and names the gap", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "joint synthesis narrative" });
  assert.equal(r1.ok, false);
  // a run created before the profile freeze existed: strip the sidecar the cold start minted
  const { rmSync } = await import("node:fs");
  rmSync(driverDir(r1.runDir, "profile.json"));
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));

  // PRECONDITION — the run really did take the downgraded path, for the reason the clamp keys on.
  const rec = readPathRecord(r2.runDir);
  assert.equal(rec.path, "unsplit");
  assert.equal(rec.reason, "no-grid-spec", "the spec-less path, not one of the four legitimate unsplit arms");
  assert.equal(rec.spec_inputs.registerOnly, false, "not a register-only matter — the common-law half was in scope");
  assert.ok(rec.spec_inputs.gridVariants > 0, "the manifest DID carry variants for the sweep to partition");
  assert.equal(rec.spec_inputs.profilePlatforms, 0, "…and no dictated platforms is the term that disarmed it");

  // THE FIX — the verdict clamps and the delivered statement names the gap. On unmodified main this is
  // CLEAR with kinds {} — that failure IS the defect.
  const v = JSON.parse(readFileSync(driverDir(r2.runDir, "verdict.json"), "utf8"));
  assert.equal(v.verdict, "CONDITIONAL", "a dictated sweep that did not run cannot deliver CLEAN");
  assert.equal(v.kinds.commonLawDowngrade, true, "the clamp KIND is what the report bound line and the workbook join on");
  assert.match(v.statement, /dictated meaning sweep did not run/i,
    "the statement is the sentence the report renders (VERDICT_INFO.statement) — the gap must be IN it, not merely recorded");
  assert.ok(v.reasons.some((r) => /dictated meaning sweep did not run/i.test(r)), "and it rides the reason list");

  // the journal carries it too, for a reader with no run dir
  const events = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const clamp = events.filter((e) => e.event === "common-law-downgrade-clamp");
  assert.equal(clamp.length, 1, "recorded exactly once — this floor is re-entered and an event per re-entry stops being a measurement");
  assert.equal(clamp[0].profilePlatforms, 0);
  assert.ok(clamp[0].gridVariants > 0);
});

test("#979 a legitimate unsplit path is NOT a failure: a pre-split resume still delivers CLEAR", async () => {
  // "Deliberately NOT proposed: making the unsplit path itself a failure. It is the legitimate rollback
  // path." The flag was one legitimate reason to be unsplit and is deleted; resumed-unsplit is another,
  // and the clamp must still discriminate. THIS ARM IS THE PAIR to the no-grid-spec arm above — that one
  // asserts the clamp FIRES, this one that it does not fire on a legitimate reason. Delete either and
  // "clamps CLEAR→CONDITIONAL" stops being a claim about discrimination and becomes one about a constant.
  const { res } = await resumedUnsplitRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "unsplit");
  assert.equal(rec.reason, "resumed-unsplit", "unsplit for a legitimate reason — not the spec-less downgrade");
  const v = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(v.verdict, "CLEAR", "the documented rollback path must not be clamped");
  assert.ok(!v.kinds?.commonLawDowngrade, "and carries no downgrade kind");
});

// #979 (3) — the selector/record disagreement FAULTS instead of riding along as a recorded row.
//
// It cannot fire on any path the engine has today (both sides of `agrees` come from the one
// deriveGridSpec call above it), so there is no live run to assert against — the behaviour under test is
// that the throw EXISTS and sits AFTER the record is durable. Asserted against the module's own source,
// on the dependency-repair.test.mjs:76-95 precedent, because the failure being guarded is a future edit
// quietly demoting it back to a recorded row, not a particular run.
test("#979 selector/record disagreement FAULTS, and the record is written BEFORE the throw", async () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const start = src.indexOf("#753 — RECORD THE CHOICE");
  assert.ok(start > 0, "the #753 record block must be findable — if this fails the assertions below are vacuous");
  const end = src.indexOf("const gather =", start);
  assert.ok(end > start, "…and delimitable");
  const block = src.slice(start, end);

  const writeAt = block.indexOf("atomicWrite(P.commonLawPath");
  const noteAt = block.indexOf("note(`common-law path:");
  const throwAt = block.search(/throw new StageFailure\(/);
  assert.ok(writeAt > 0, "the record is still written");
  assert.ok(throwAt > 0, "a disagreement must FAULT — a record nobody can trust must not ride along as a row");
  assert.ok(throwAt > writeAt && throwAt > noteAt,
    "ORDER: the throw must follow atomicWrite and note, or the run dies with no forensic file — the exact failure the record exists to prevent");
  assert.match(block, /failClass: "deterministic"/, "a re-sample re-derives the identical divergence; the retry ladder has nothing to offer it");
});

// ── #1101: the salvage lane repairs what it admits ─────────────────────────────────────────────
test("#1101: a malformed ACTION gets its own named re-emit and the run recovers — it used to exhaust", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition-broken" });
  assert.equal(res.ok, true, `the run should recover through the action re-emit: ${JSON.stringify(res)}`);
  // RE-AIMED (tracker issue 1893): the action-shaped defect is refused at the call now, so there is no
  // `action-reemit` and no warm re-dispatch to observe — the seat restates in the same turn. Everything
  // this arm is FOR is asserted below and unchanged: the run recovers, the condition survives, and the
  // verdict it gates is still CONDITIONAL.
  assert.ok(refusalsFor(res.runDir).some((r) => /action/.test(r.reason)),
    "the action-shaped defect was refused at the call, by name");
  // The action is a CONSENT kind, so the recovered register must still gate the verdict — a repair that
  // healed the shape by dropping the condition would pass an ok:true check and lose the ask.
  assert.equal(res.verdict, "CONDITIONAL", "the repaired condition still conditions the result");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.equal(findings.actions.length, 1, "the action survived the repair — a dropped condition changes the verdict");
  assert.equal(findings.actions[0].kind, "consent");
  assert.ok(!("bogus_key" in findings.actions[0]), "the unknown key is gone");
});

test("#1101: a malformed ask_answers entry gets its OWN named re-emit — the last family the lane admitted and could not name", async () => {
  // `finding_ask_answer_key_unknown` matches the lane's `finding_[a-z]` admission test, and the lenient
  // parser used to DROP a malformed ask_answer with no record in any list — so the lane admitted a
  // defect nothing could name and the run exhausted. ask_answers joins to the FROZEN intake asks, so a
  // dropped one ships a question the client committed at intake unanswered: worth a repair, not a shrug.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ASK_ANSWER_BAD: "1" });
  assert.equal(res.ok, true, `the run should recover through the ask_answers re-emit: ${JSON.stringify(res)}`);
  // RE-AIMED (tracker issue 1893): refused at the call, restated in the same turn, so there is no
  // `ask-answer-reemit` and no warm re-dispatch. The subject is unchanged and is asserted below — a
  // dropped ask_answer ships a question the client committed at intake UNANSWERED, and that is what
  // must not happen however the defect is caught.
  assert.ok(refusalsFor(res.runDir).some((r) => /ask_answer/.test(r.reason)),
    "the ask_answers defect was refused at the call, by name");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.equal(findings.ask_answers.length, 1, "the entry survived the repair — a deleted ask ships unanswered");
  assert.ok(!("bogus" in findings.ask_answers[0]), "the unknown key is gone");
});
