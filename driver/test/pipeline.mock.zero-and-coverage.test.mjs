// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet: the retired summary stage, zero semantics and the coverage ledger
// Offline driver dry-run against a mock engine (no billable calls). The shared harness is pipeline-mock-harness.mjs.
import { ARCHIVED, CLAUDE, JOB, runPipeline, stageOrder } from "./pipeline-mock-harness.mjs";
import { test } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

// ── THE BAND A STAGE'S WALL RAN AGAINST REACHES THE SPINE, on a LIVE dispatch ──────────────────────
//
// Written here rather than beside the unit arms because of what a plant showed: with the measurement
// disabled at the dispatch site, every arm that hands `runStage` a size directly stayed green — they
// drive the gateway, never the site that computes one. Only a real run exercises that call. The band
// itself may or may not exist in a mock run, and the assertion does not care: what must hold is that a
// band-reading stage's attempt event SAYS something about the band, measured or named-absent, and that
// a stage which never reads one says nothing at all.
test("a band-reading stage's attempt event carries the band it ran against; other stages carry no such key", async () => {
  const { BAND_READING_STAGES } = await import("../stages.mjs");
  const { events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  const attempts = events.filter((e) => e.event === "attempt");
  assert.ok(attempts.length > 0, "no attempt events at all — the run dispatched nothing and this arm is blind");
  const base = (e) => String(e.stage).split(":")[0];
  const bandAttempts = attempts.filter((e) => BAND_READING_STAGES.has(base(e)));
  // A FLOOR ON THE POPULATION: an empty intersection would satisfy every assertion below while proving
  // nothing, which is the shape a passing-but-blind arm always has.
  assert.ok(bandAttempts.length >= 1,
    `this run dispatched no band-reading stage (${[...new Set(attempts.map(base))].join(", ")}) — the arm cannot see the wiring`);
  for (const e of bandAttempts) {
    assert.ok("band" in e, `${e.stage} reads the band and its attempt event records nothing about it`);
    assert.equal(typeof e.band, "object", `${e.stage}'s band is not an object: ${JSON.stringify(e.band)}`);
    // Either a measurement or a named absence — never a bare zero, and never null.
    assert.ok(Number.isFinite(e.band?.records) || typeof e.band?.absent === "string",
      `${e.stage}'s band is neither a measurement nor a named absence: ${JSON.stringify(e.band)}`);
  }
  // The other direction, on this run's own stages: a stage outside the set must not carry the key.
  const others = attempts.filter((e) => !BAND_READING_STAGES.has(base(e)));
  assert.ok(others.length >= 1, "every dispatched stage reads the band — the negative half is untestable here");
  for (const e of others) {
    assert.ok(!("band" in e), `${e.stage} does not read the band yet its row claims one: ${JSON.stringify(e.band)}`);
  }
});

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
  assert.ok(ARCHIVED.test(res.runDir), "run-dir archived");

  // THE TRANSPORT WAS THE WRITER, asserted on the CALL CAPTURE and never on the artifact. The
  // artifact is void as evidence in either direction: `recordBlindFrame` writes blind-frame-model.json AND
  // the capture, so a surface with two writers discriminates nothing (e2e's ruling, from having to answer
  // this question off 2e203b75's tree). The capture is written BEFORE validation, so it exists even for a
  // refused call — which is what makes its ABSENCE mean "the seat took the deleted path" rather than "the
  // call failed". Before this PR, this run left no capture at all.
  assert.ok(existsSync(driverDir(res.runDir, "blind-frame-calls", "call-001.json")),
    "no record_blind_frame call capture — the model reached disk by some other writer");
  assert.ok(existsSync(join(res.runDir, "blind-frame-model.json")), "…and the driver rendered the artifact from it");
  // The second recording conversion — same keying for skeptic. Both recording stages are now proven by their
  // capture in every run of this test, which is the state e2e could not find on 2e203b75: capture absent,
  // artifact present, hand-written.
  assert.ok(existsSync(driverDir(res.runDir, "skeptic-calls", "call-001.json")),
    "no record_skeptic call capture — skeptic-flags.md reached disk by some other writer");
  assert.ok(existsSync(join(res.runDir, "skeptic-flags.md")), "…and the driver rendered the flags from it");
  // The third recording conversion — frame-diff, and the first whose ONE call owns TWO artifacts. Both are
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
  assert.ok(idx("matter-frame") < idx("clearance-variants"), "matter-frame before variants");
  assert.ok(idx("clearance-variants") < idx("common-law"), "variants before gather");
  assert.ok(idx("register-digest") > idx("placement-inquiry"), "digest after placement");
  assert.ok(idx("placement-inquiry") > idx("register-unit:primary-sweep"), "placement after units");
  assert.ok(idx("skeptic") < idx("synthesis"), "skeptic before synthesis");
  assert.ok(idx("synthesis") < idx("narrative-refutation"), "synthesis before refutation");
  // delivery (B1): report-overview (LLM shell) + report-card (LLM, one per finding) → assemble/audit/publish
  // (all CODE). On the anthropic-agent engine the driver runs in HANDOFF mode: it writes a self-contained
  // _driver/delivery.json packet + leaves .delivered{sendPending} for intake-agent's comms watch, and does NOT run
  // the notify/notify-chat gateway stages (they live on intake-agent's comms plane; see pipeline.anthropic.test.mjs).
  assert.ok(idx("narrative-refutation") < idx("report-overview"), "report-overview after refutation");
  assert.ok(order.some((s) => s.startsWith("report-card")), "B1 per-card render ran (≥1 full-prose finding)");
  assert.ok(!order.includes("notify") && !order.includes("notify-chat"), "handoff mode: no notify gateway stages");
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.equal(packet.verdict, "CLEAR", "delivery packet carries the verdict for intake-agent's send");
  assert.equal(JSON.parse(readFileSync(join(res.runDir, ".delivered"), "utf8")).sendPending, true, ".delivered marks sendPending");
  assert.ok(!order.includes("audit-emit"), "audit-emit is no longer an LLM stage");
  assert.ok(existsSync(join(res.runDir, ".published")) || ARCHIVED.test(res.runDir), "published");
  // fan-out breadth: the manifest markers select all 4 axes
  for (const ax of ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"])
    assert.ok(order.includes(`register-unit:${ax}`), `axis ${ax} ran`);
  // the narrative mentions "watchlist", and this job's product is NOT the Full country search, so
  // the reading is RECORDED and NOT RUN. REWRITTEN, not deleted: the old assertion here
  // (`order.includes("case-law")`) is the defect at integration level — a case-law pass starting mid-run
  // on a product that does not carry it, past no door and with no scope guard.
  assert.ok(!order.includes("case-law"),
    "case-law must not run on a product that does not carry the reading — this is the whole subject");
  const clDecision = events.find((e) => e.event === "case-law-decision");
  assert.ok(clDecision, "the decision is journalled UNCONDITIONALLY — its absence is what made this invisible");
  assert.equal(clDecision.detected, true, "the run's own reading still noticed the watchlist mention");
  assert.equal(clDecision.run, false);
  assert.equal(clDecision.declined, true, "and the state has a name a round can grep for");
  assert.equal(clDecision.trigger, "watchlist", "which word triggered it, or the observation cannot be acted on");
  assert.ok(!events.some((e) => e.event === "case-law-trigger"), "nothing claims the pass was triggered");
  // verdict event recorded
  assert.ok(events.some((e) => e.event === "verdict" && e.verdict === "CLEAR"));
  // Spec A3 — a mock run carries no standing deferral, so the envelope has nothing to close here. Its in-loop close is
  // driven by the test below, on an axis the plan-execution receipt does not cover.
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
  assert.ok(idx("clearance-variants") < idx("blind-frame"), "blind-frame after variants");
  // the frame settles BEFORE placement dispatches, so placement runs once on the settled frame.
  assert.ok(idx("frame-diff") < idx("placement-inquiry"), "frame-diff settles the frame before placement");
  assert.ok(idx("placement-inquiry") < idx("register-digest") && idx("register-digest") < idx("synthesis"),
    "placement → digest → synthesis order is unchanged below the frame seam");
  assert.ok(events.some((e) => e.event === "frame-diff" && e.firing === 0), "clean frame-diff: zero firing directives");
  assert.ok(!events.some((e) => e.event === "frame-reopen"), "no reopen on a clean diff");
  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "frame-reopen"), "no frame-reopen re-digest on a clean diff");
});

test("on an axis the receipt does not cover, the envelope closes a deferred row in-loop, as before", async () => {
  // A deferral the run's plan-execution receipt says nothing about: the seat defers one row on an axis the receipt does
  // not cover (MOCK_SEAT_DEFERS), so the closeability split cannot tell whether a re-run could send anything and answers
  // as it did before it read the receipt. The job has no deadline, so the envelope closes the row in-loop: decision
  // logged, the owning unit re-run warm, and (spec-66 funnel) the re-digest rides the ONE pre-synthesis settlement flush
  // instead of firing its own pass.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_SEAT_DEFERS: "incumbent-class" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.ok(!(receipt.skeleton ?? []).some((s) => s.axis === "incumbent-class"), "guard: the receipt covers the axis, so this arm tests the receipt rule");
  assert.ok(events.some((e) => e.event === "envelope-decision" && e.close === true), "envelope decision logged");
  assert.ok(events.some((e) => e.event === "envelope-closed" && e.axes.includes("incumbent-class")), "the deferred row was not closed in-loop");
  // The re-opened unit is told not to run the whole axis again: a register_execute_plan call without qids asks every
  // entry again. Read off the prompt the run actually dispatched, not off the builder.
  const prompts = readdirSync(driverDir(res.runDir)).filter((f) => /\.dispatch\.txt(\.prev-[0-9a-f]+)?$/.test(f))
    .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).filter((t) => t.includes("records DEFERRED (planned but never run)"));
  assert.equal(prompts.length, 1, "the envelope's follow-up was dispatched once, and its text was recorded");
  const { PLAN_ENTRY_RERUN_RULE } = await import("../stages.mjs");
  assert.ok(prompts[0].includes(PLAN_ENTRY_RERUN_RULE), "the follow-up carries the rule against a whole-axis re-run");
  assert.ok(events.some((e) => e.event === "digest-queued" && e.trigger === "envelope"), "envelope minted a durable digest receipt");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"), "the settlement flush paid the receipt down");
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

// THE FRAME'S MEANING QUESTIONS ARE THE WHOLE MEANING SWEEP (ruled 2026-09-25): dictated VERBATIM in the
// spec with no fixed shape beside them, executed and receipted into extras.pr_risk (the identity gate's join
// surface), and count-ASSERTED in the grid-spec event. A frame that asserts none gets no meaning search, and
// the run still delivers.
test("the frame's meaning questions are the whole dictated sweep — spec, receipts, asserted count; none still delivers", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_MEANING_ANGLES: "novapulse gaming backlash; novapulse political meaning" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const spec = JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8"));
  const q = spec.connotation.queries;
  assert.equal(spec.connotation.disposition_required, true,
    "every fresh spec carries the receipts-disposition stamp (leg 2's receipt-presence key — archived specs lack it)");
  assert.deepEqual(q, ["novapulse gaming backlash", "novapulse political meaning"],
    "the dictated sweep is exactly the frame's questions, with no fixed shape beside them");
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
  // …and the asserted zero: a frame that names no meaning question gets no meaning search, the driver stamps
  // the empty list as the frame's decision and writes the meaning seat's empty ledger, and the run DELIVERS.
  const { res: noneRes, events: noneEvents } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_MEANING_ANGLES: "none" });
  assert.equal(noneRes.ok, true, `a frame that named no meaning question failed the run: ${JSON.stringify(noneRes)}`);
  const noneSpec = JSON.parse(readFileSync(driverDir(noneRes.runDir, "grid-spec.json"), "utf8"));
  assert.deepEqual(noneSpec.connotation.queries, []);
  assert.equal(noneSpec.connotation.none_named, true, "the empty list is not stamped as the frame's decision");
  assert.equal(noneEvents.find((e) => e.event === "grid-spec").connotation, 0,
    "'Meaning angles: none' is an asserted zero, never an absence");
});

// blind-frame's prose twin is retired and the structured model is the stage's ONLY output. The
// question that change has to answer is what happens when the model does NOT land: the stage used to gate
// on a prose file, and a gate that no longer exists is how an absence starts reading as a pass. It must
// fail by NAME. MOCK_NO_BLIND_MODEL is a turn that completes and writes nothing at all — the exact shape.
test("a blind-frame turn that writes no model FAILS by name (missing_file) — the run degrades, it never passes silently", async () => {
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
  // ── THE WHOLE POINT: ONE placement dispatch ─────────────────────────────────────────────────────────────────
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
  // settlement flush at the standalone seam, unchanged by the single-dispatch change).
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
  // THE ENGINE'S SENTENCE STAYS IN THE RUN RECORD (ruled 2026-10-13): the frame reason is the record's, with no
  // client clause; the client's page never prints it; the audit records the register part it left unfinished.
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  const at = sidecar.reasons.findIndex((r) => /blind frame-diff flagged/.test(r));
  assert.ok(at >= 0, "the run record lost the frame reason");
  assert.equal(sidecar.clauses[at], null, "the frame reason was stored as a client clause");
  assert.doesNotMatch(String(sidecar.statement), /frame[- ]diff|reopen pass/i, "the statement carries the engine's sentence");
  const { config: frameCfg } = await import("../driver.config.mjs");
  const page = readFileSync(join(frameCfg.poolRoot, `${basename(dirname(res.runDir))}-${basename(res.runDir)}`, "report.html"), "utf8");
  assert.doesNotMatch(page, /frame[- ]diff|reopen pass/i, "the client's page printed the engine's sentence");
  const parts = JSON.parse(readFileSync(driverDir(res.runDir, "degraded-parts.json"), "utf8")).parts;
  assert.ok(parts.some((p) => p.part === "register" && /blind frame comparison flagged/.test(p.cause)), "the audit does not record the unfinished part");
});

// ── ZERO SEMANTICS ────────────────────────────────────────────────────────────────────────────────────────────────
// Seven bugs have shipped at this seam where an absence was read as a pass, so moving the block earns
// the question directly: after the move, does "the reopen produced no directives" read differently from
// "the reopen never ran"? Both are an absence of frame-reopen rows, so the discriminator cannot be an
// absence — it has to be positive evidence, and every ending now writes one. This test is the guard on
// that: three runs, three distinct endings, none of them inferrable from silence.
test("zero semantics: a settled frame, a frame nobody asked about, and a swept reopen are three DISTINCT endings in run.jsonl", async () => {
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

  // …and wherever the question IS asked, it is answered BEFORE the one placement dispatch
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
  assert.ok(existsSync(join(res.runDir, ".delivered")) || ARCHIVED.test(res.runDir), "delivered, not halted");
  assert.ok(!existsSync(join(res.runDir, ".incomplete-needs-human")), "no halt state exists any more");
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.review?.signoff, "CONDITIONAL", "delivered status carries the clamp, as the reviewer's sign-off");
  assert.equal(status.verdict, undefined, "the sign-off is still at the top of the run record as `verdict`");
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
  // no SKEPTIC re-digest fired.
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "escalation"),
    "no escalation re-digest");
  const digests = events.filter((e) => e.event === "stage" && e.stage === "register-digest");
  // A mock run carries no standing deferral, so there is no envelope digest either: the fresh one alone.
  assert.equal(digests.length, 1, `expected the fresh digest only, got ${digests.length}`);
});

test("escalation NOT skipped: an axis with a `deferred` gap still re-runs even alongside the skip path (floor guard)", async () => {
  // incumbent-class carries the seat's own `deferred` row (MOCK_SEAT_DEFERS) on an axis the plan-execution receipt does
  // not cover, so it reads as a real closeable gap, while transliteration-numeric is a documented coverage-limit.
  // Escalating BOTH: only the documented limit is skipped; the deferred axis fires.
  const { res, events } = await runPipeline({
    MOCK_VERDICT: "CLEAR",
    MOCK_LEDGER_LIMITED: "transliteration-numeric",
    MOCK_SEAT_DEFERS: "incumbent-class",
    MOCK_SKEPTIC: "- two gaps\n\n## Escalation decisions\nESCALATE: incumbent-class — read the owner's records\nESCALATE: transliteration-numeric — extra script group",
  });
  assert.equal(res.ok, true);
  assert.ok(events.some((e) => e.event === "escalation-skipped" && e.axis === "transliteration-numeric"), "documented limit skipped");
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && e.escalated.includes("incumbent-class")), "deferred axis still escalates");
  assert.ok(events.some((e) => e.event === "skeptic-escalation" && !e.escalated.includes("transliteration-numeric")), "skipped axis is not in the escalated set");
});

test("THE HOLD — a designated floor axis excused as coverage-limited is NOT skipped, and IS disclosed", async () => {
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

test("THE CONTROL — the SAME ledger with no designation still skips, so the arm above is not vacuous", async () => {
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

// The C-2 acceptance arm and Fix2 #7 are RETIRED with the ⭐ search floor (ruling). They
// drove `MOCK_STAR_FLOOR` through a full mock run and asserted the breach reached the delivery
// disclosure. Both were real end-to-end coverage of a mechanism that is now deleted: after recording
// conversion 3 no typed field can designate a ⭐, and the owner ruled the capability removed rather than
// regrown. Git history holds them if mandatory-sweep compliance is ever refiled.

// ── WS-A machine coverage ledger e2e (design of record CLEAROTRON-VNEXT-THREE-WORKSTREAM-DESIGN) ─────────

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

test("spec-49 T3 (H3): a digest that settles NO coverage row ships no verdict — the write-up fails, naming the rows (the D1 ship-as-CONDITIONAL clamp is retired)", async () => {
  // The doctrine is unchanged: machinery that leaves the coverage-honesty floor unable to run FAILS the
  // run, and never ships a finished-looking CONDITIONAL (the retired spec-48 D1 behaviour).
  //
  // WHERE THIS IS CAUGHT MOVED, AND EARLIER IS BETTER. Before the form, "no readable coverage" meant a
  // findings file whose Coverage-ledger section carried no parseable table — a shape that passed the
  // digest's own validator and only died at the pre-verdict floor, after the whole run had been spent.
  // The seat no longer writes that table: it fills in a form the driver wrote, and a form with no status
  // on any row is refused BY THE DIGEST'S OWN VALIDATOR (coverage_no_status) through the whole corrective
  // ladder. It fails at the stage that produced the defect, naming it.
  //
  // AND NO VERDICT SHIPS, but the run is no longer ended with nothing delivered: once the write-up's recovery
  // is spent the assessment is recorded as not completed, and the resumed pass delivers what the run holds with no
  // rating anywhere — never a finished-looking CONDITIONAL. That delivery is held by
  // a-run-whose-register-reading-cannot-finish-delivers-what-it-holds.pipeline.test.mjs.
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_UNPARSEABLE_LEDGER: "1" });
  assert.equal(res.ok, false, "no settled coverage judgment ⇒ no verdict can ship");
  const record = JSON.parse(readFileSync(driverDir(res.runDir, "not-completed", "assessment.json"), "utf8"));
  assert.equal(record.stage, "register-digest", "the run did not stop at the stage that produced the defect");
  assert.match(String(record.reason), /coverage_no_status/, "the failure NAMES the rows that carry no status");
  assert.ok(!existsSync(join(res.runDir, ".delivered")), "a verdict was delivered over coverage nobody settled");
  assert.ok(!existsSync(join(res.runDir, ".failed")), "the run was ended instead of delivered without the assessment");
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
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.postponed, true, JSON.stringify(r1));
  assert.equal(JSON.parse(readFileSync(join(r1.runDir, "status.json"), "utf8")).failedStage, "synthesis");
  const ledgerPath = join(r1.runDir, "register-coverage-ledger.json");
  assert.ok(existsSync(ledgerPath), "run 1 derived the JSON before failing");
  // plant a recognizable STALE-but-valid JSON, as if the prose were about to be rewritten under it
  const { writeFileSync: wf } = await import("node:fs");
  wf(ledgerPath, JSON.stringify([{ axis: "primary-sweep", scope: "STALE-MARKER", status: "deferred", reason: "stale" }]));
  // run 2: resume --from register-digest; the drop must still fire (forceFromActive, no followup) and the
  // driver must RE-DERIVE a fresh JSON from the re-emitted prose (Map #3 — no model save, no save-followup).
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
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
  // The mock emits a fetched record for the cited uri via the PRODUCTION record log — which is now
  // the RUN's own `_driver/register-record-bodies.jsonl`, not a box-global file, so `MOCK_WRITE_RECORD`
  // alone is the whole setup. The driver's lint-pass assembleRunRecords materializes
  // _records/us-90000001.json from it, and the publish render must source the registry IDs from that body.
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_SEAT_DEFERS", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_CL_MISSING_QUERIES", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
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
  const poolRoot = join(res.runDir.split(/[\\/]workspace-/)[0], "pool");
  // the pool dir name is the runId `${slug}-${date}-${codename}`; res.runDir basename is `${date}-${codename}`.
  // Match THIS run's pool dir by that suffix (the shared pool may hold other tests' novapulse runs).
  const suffix = res.runDir.split(/[\\/]/).pop();   // <date>-<codename>
  const poolDir = readdirSync(poolRoot, { withFileTypes: true }).find((d) => d.isDirectory() && d.name.endsWith(suffix));
  assert.ok(poolDir, `published run dir for ${suffix} present in the pool`);
  const html = readFileSync(join(poolRoot, poolDir.name, "report.html"), "utf8");
  // The fetched record's facts are its register record entry on the card.
  const entry = html.match(/<div class="rr">[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.match(entry, /7100200/, "registration number rendered FROM the fetched record body");
  assert.match(entry, /registered 2023-/, "registration date rendered FROM the record (not model prose)");
});
