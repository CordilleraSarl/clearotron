// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a full corrective cycle end to end on the mock pipeline
// AD-2 — corrective-cycle cost (E2E-R2 addendum A1 + A9), in its own process (mirrors the
// pipeline.mock.registergap harness; every run is billable-call-free).
//
//   A1 ordering: the pre-delivery lint repair re-ran report-overview, the redo turn rewrote
//     findings.json, EVERY report card + the client summary went stale, and the only remedy was the
//     delivery stale-block → a full park/resume that re-drove the whole pipeline (34% of the E2E-R2
//     run). Fix: staleness confined to the delivery TAIL is re-done IN-PASS — exactly the staled
//     stages, from the current inputs — and the stale guard still blocks whatever remains.
//   A1 recovery granularity: the corrective re-synthesis + verdict-recheck ran `force:true` on EVERY
//     resume of a CONDITIONAL/BLOCKING run, re-emitting narrative + findings and staling the whole
//     delivery tail behind them. Fix: a completion receipt keyed on the exact review + narrative
//     bytes; an unchanged resume skips the settled cycle.
//   A9: the corrective dispatch carries placement's rulings tail AS DATA (computed things reach the
//     next stage as data, not prose) and never asks the repair pass to re-read placement.
import { test, after } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";


// EVERY temp directory this file makes is removed — including ones created inside helpers, and ones
// made by a test that then failed. A `beforeEach` that cleans the PREVIOUS iteration leaves the last of
// every run, and a hook over named bindings cannot reach a helper's dir at all; this file makes them at
// 2 sites. So `mkdtempSync` is wrapped and the collector is the only way one gets made — a new call
// site cannot forget to register itself..
const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE",
  "MOCK_ACTIONS", "MOCK_LINT_REPAIR_TOUCH_FINDINGS", "MOCK_LINT_REPAIR_TOUCH_FINDING",
  "MOCK_REVIEW_BLOCKS_AFTER_VERDICT", "MOCK_NARRATIVE_OVER_CAP"];

async function runPipeline(env, jobPatch = {}, opts = {}) {
  const root = tempDir("prelim-mock-adc-");
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, root, events };
}
const readEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ── the pure helpers ────────────────────────────────────────────────────────────────────────────────

// The section shapes come from the placement-inquiry SKILL contract: `### Coverage rulings & open
// questions` and `### Open questions for the client / reviewer` CLOSE the file — the "rulings tail".
const PLACEMENT_MD = [
  "# Placement recommendations",
  "",
  "## Band reconciliation",
  "Expectation vs band checked — one mismatch noted below.",
  "",
  "## Headline candidates",
  "- LUMENGARDE — Acme (DK, cl. 9)",
  "",
  "## Disagreements / flags surfaced to downstream",
  "- none",
  "",
  "### Coverage rulings & open questions",
  "- cleared: saturation-probe crowd descriptor — immaterial noise off the dangerous band (confirmed-clean)",
  "- material-gap: named band for transliteration-numeric absent — search output did not cross; cannot judge this axis",
  "",
  "### Open questions for the client / reviewer",
  "- whether the DK incumbent's use genuinely meets the applicant's channel",
  "",
].join("\n");

test("AD-2 A9: extractRulingsTail — heading→EOF verbatim; absent-safe; the cap cuts on a line boundary and says so", async () => {
  const { extractRulingsTail } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const tail = extractRulingsTail(PLACEMENT_MD);
  assert.ok(tail.startsWith("### Coverage rulings & open questions"), "the tail starts at the rulings heading");
  assert.match(tail, /material-gap: named band for transliteration-numeric absent/, "rulings travel verbatim");
  assert.match(tail, /### Open questions for the client \/ reviewer/, "the whole TAIL travels — open questions included");
  assert.ok(!tail.includes("Headline candidates"), "nothing above the heading rides along");
  // absent-safe: no heading / empty / null ⇒ "" (a legacy or register-less run costs the dispatch nothing)
  assert.equal(extractRulingsTail("# Placement\n\n## Headline candidates\n- X\n"), "");
  assert.equal(extractRulingsTail(""), "");
  assert.equal(extractRulingsTail(null), "");
  // the cap: line-boundary cut + an explicit truncation note, never a silent mid-row chop
  const long = "### Coverage rulings & open questions\n" + Array.from({ length: 400 }, (_, i) => `- cleared: crowd descriptor ${i} — immaterial noise`).join("\n");
  const capped = extractRulingsTail(long, { cap: 500 });
  assert.ok(capped.includes("[rulings tail truncated at 500 chars"), "the cut is disclosed");
  const body = capped.slice(0, capped.indexOf("\n\n[rulings tail truncated"));
  const rows = body.split("\n").slice(1);   // [0] is the heading; every kept RULING row must be whole
  assert.ok(rows.length >= 1 && rows.every((l) => /immaterial noise$/.test(l)),
    `every kept line is whole, never mid-chopped: ${JSON.stringify(rows.slice(-1))}`);
});

test("AD-2 A9: the corrective dispatch carries the rulings tail AS DATA and forbids a placement re-read", async () => {
  const { correctionsExtra } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const dir = tempDir("adc-a9-");
  writeFileSync(join(dir, "placement-recommendations.md"), PLACEMENT_MD);
  writeFileSync(join(dir, "senior-eye-review.md"), "CONDITIONAL\n\n- FLAGGED CORRECTION: coverage row for transliteration-numeric reads clean [kind: coverage-disposition]\n");
  const P = { placement: join(dir, "placement-recommendations.md"), seniorEyeReview: join(dir, "senior-eye-review.md"),
    narrative: join(dir, "narrative.md"), findings: join(dir, "findings.json") };
  const msg = correctionsExtra(P);
  assert.match(msg, /PLACEMENT RULINGS TAIL/, "the dispatch carries the tail explicitly");
  assert.match(msg, /do NOT re-read the placement file/, "the repair pass is never asked to re-read placement");
  assert.match(msg, /material-gap: named band for transliteration-numeric absent/, "the rulings arrive verbatim, as data");
  assert.ok(msg.indexOf("PLACEMENT RULINGS TAIL") < msg.indexOf("The reviewer's flags, verbatim:"), "the tail is in hand BEFORE the flags it adjudicates");
  assert.match(msg, /FLAGGED CORRECTION: coverage row/, "the review still rides the dispatch unchanged");
  // — and the flags now arrive TYPED first, as a worklist, with the raw review still below it. The
  // ordering is the claim: an index is only useful in front of the thing it indexes.
  assert.match(msg, /THE FLAGS, TYPED \(1/, "the typed worklist rides the corrective dispatch");
  assert.match(msg, /coverage-disposition \(1\):/, "grouped by the reviewer's own declared kind");
  assert.ok(msg.indexOf("THE FLAGS, TYPED") < msg.indexOf("The reviewer's flags, verbatim:"),
    "the worklist precedes the prose it indexes");
  // no placement file ⇒ no block, and the dispatch is otherwise unchanged (legacy / register-less runs)
  const P2 = { ...P, placement: join(dir, "no-such-file.md") };
  const msg2 = correctionsExtra(P2);
  assert.ok(!msg2.includes("PLACEMENT RULINGS TAIL"), "an absent placement costs the dispatch nothing");
  assert.match(msg2, /The reviewer's flags, verbatim:/);
});

test("AD-2 A1: partitionDeliveryStale — tail vs upstream, exactly the stages the delivery pass generates", async () => {
  const { partitionDeliveryStale, DELIVERY_TAIL_LABEL_RE } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const stale = [
    { label: "report-card:1", changed: [] }, { label: "report-card:12", changed: [] },
    { label: "report-overview", changed: [] },
    { label: "synthesis", changed: [] }, { label: "register-digest:primary-sweep", changed: [] },
  ];
  const { tail, upstream } = partitionDeliveryStale(stale);
  assert.deepEqual(tail.map((s) => s.label), ["report-card:1", "report-card:12", "report-overview"]);
  // `client-summary` is a RETIRED stage (2026-08-01): the label can never appear in a stale set,
  // so the tail alternation no longer carries it.
  assert.ok(!DELIVERY_TAIL_LABEL_RE.test("client-summary"), "the retired stage is not a delivery-tail label");
  assert.deepEqual(upstream.map((s) => s.label), ["synthesis", "register-digest:primary-sweep"]);
  assert.deepEqual(partitionDeliveryStale([]), { tail: [], upstream: [] });
  assert.deepEqual(partitionDeliveryStale(null), { tail: [], upstream: [] });
  // a bare "report-card" (no ordinal) is NOT a tail label — nothing to re-render without an ordinal
  assert.ok(!DELIVERY_TAIL_LABEL_RE.test("report-card"), "ordinal-less card label stays on the park path");
  assert.ok(!DELIVERY_TAIL_LABEL_RE.test("narrative-refutation"));
});

test("AD-2 A1: correctiveCycleSettledDecision — settled only on exact, non-null review + narrative bytes", async () => {
  const { correctiveCycleSettledDecision } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const shas = { review: "aaa111", narrative: "bbb222" };
  assert.equal(correctiveCycleSettledDecision({ shas: { review: "aaa111", narrative: "bbb222" } }, shas), true);
  assert.equal(correctiveCycleSettledDecision({ shas: { review: "MOVED0", narrative: "bbb222" } }, shas), false, "a fresh review re-arms the cycle");
  assert.equal(correctiveCycleSettledDecision({ shas: { review: "aaa111", narrative: "MOVED0" } }, shas), false, "a recomputed narrative re-arms the cycle");
  assert.equal(correctiveCycleSettledDecision(null, shas), false, "no receipt ⇒ the cycle runs (legacy resume)");
  assert.equal(correctiveCycleSettledDecision({}, shas), false);
  assert.equal(correctiveCycleSettledDecision({ shas: { review: null, narrative: null } }, { review: null, narrative: null }), false, "absent files are never settled");
});

// ── the two e2e scenarios (offline mock pipeline) ───────────────────────────────────────────────────

test("AD-2 A1 ordering: a lint repair that moves findings.json re-does ONLY the staled delivery tail in-pass — delivered, no stale-block", async () => {
  // MOCK_PERMISSION_PROSE plants a persistent shell lint failure (the redo fires and re-emits it —
  // the PR-5 closed-gate shape); MOCK_LINT_REPAIR_TOUCH_FINDINGS makes that redo turn ALSO rewrite
  // findings.json — the exact E2E-R2 A1 incident. Before the fix this run stale-blocked at delivery
  // and (recovery off here) went terminal; now the tail is re-done in-pass and the run delivers.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PERMISSION_PROSE: "1", MOCK_LINT_REPAIR_TOUCH_FINDINGS: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")), "delivered in ONE pass — no park, no pipeline restart");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "report-overview" && e.trigger === "lint-repair"), "the shell redo fired (the staling repair)");
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "the stale guard had nothing left to block");
  // — THIS KNOB MOVES A COVERAGE NOTE AND TRAILING WHITESPACE, NOT A FINDING. A report card reads
  // only its own finding (inline as ctx.finding), so no card's input changed and no card is re-derived.
  // Before the projection, the whole-file sha moved and all 26 cards were re-dispatched: 496,327 output
  // tokens, 43 dispatches of which 33 were repeats, 1h29m. The run still delivers in ONE pass — that is
  // the assertion that matters and it is unchanged above.
  //
  // The signal is NARROWED, NOT SUPPRESSED, and the test below is what proves it: move an actual finding
  // and the tail repair fires for exactly the card built from it.
  assert.ok(!events.some((e) => e.event === "stage" && String(e.stage).startsWith("report-card:") && e.trigger === "stale-repair"),
    "no card is re-rendered for a change to material no card reads");
  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "stale-repair" && /^(register-digest|synthesis|narrative-refutation|matter-frame|common-law)/.test(String(e.stage))),
    "and never an upstream stage, never a pipeline restart");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  assert.equal(receipt.staleStages.length, 0, "nothing left stale in the receipt — freshness restored in-pass");
});

test("AD-2 A1 / #393: a lint repair that moves an actual FINDING still re-does that card in-pass — the narrowing is not a silencing", async () => {
  // The companion to the test above. Same run shape, same staling repair, but the redo turn edits a
  // FINDING object rather than a coverage note. The card built from it genuinely is stale, so the tail
  // repair must still fire and the delivered report must carry the post-repair prose. A projection that
  // reported this fresh would be the gate lying, which is the failure mode 's ruling names.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PERMISSION_PROSE: "1", MOCK_LINT_REPAIR_TOUCH_FINDING: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")), "delivered in ONE pass");
  assert.ok(events.some((e) => e.event === "delivery-stale-repair"), "the in-pass tail repair fired");
  assert.ok(events.some((e) => e.event === "stage" && String(e.stage).startsWith("report-card:") && e.trigger === "stale-repair"),
    "the card whose OWN finding moved was re-rendered in-pass, from the CURRENT findings");
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "and nothing was left for the guard to block");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  assert.ok(Array.isArray(receipt.staleRepaired) && receipt.staleRepaired.some((l) => l.startsWith("report-card:")),
    "the receipt names the card that was re-done");
  assert.equal(receipt.staleStages.length, 0, "nothing left stale — freshness restored in-pass");
  // THE CLAIM ACTUALLY MAKES: it changes what gets RECOMPUTED, not what the report CONTAINS. The
  // delivered content must equal a full re-derive minus the wasted dispatches — so assert the artifact,
  // not only that the re-render event fired. A card re-rendered from a stale finding would satisfy every
  // assertion above and still ship the superseded text.
  const ord = Number(receipt.staleRepaired.find((l) => l.startsWith("report-card:")).slice("report-card:".length));
  const finding = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8")).findings.find((f) => f.ordinal === ord);
  assert.match(String(finding.owner?.name), /\(post-redo\)/, "the finding on disk carries the corrective edit");
  const card = readFileSync(join(res.runDir, "report-cards", `${ord}.md`), "utf8");
  assert.match(card, /post-redo/, "and the re-rendered card was built from the POST-edit finding, not the superseded one");
});

test("AD-2 A1 recovery granularity: a resume with unchanged review/narrative bytes never re-fires the settled corrective cycle", async () => {
  // Pass 1: CONDITIONAL → the corrective cycle runs + completes (receipt written), then the run dies
  // at report-overview (knob). Pass 2 (the recovery resume): the cycle is settled work — it must NOT
  // re-fire; the resume re-does only what is missing (the delivery tail) and delivers.
  const { res } = await runPipeline({ MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_ACTIONS: "condition", MOCK_FAIL_STAGE: "record_report_overview" });
    // conversion 4 — the knob is a SUBSTRING OF THE DISPATCH, and it used to read
    // "report-overview.md". A converted dispatch names no output path, so that string stops matching the
    // stage it was aimed at and starts matching whatever else mentions the file — the failure then lands
    // on a DIFFERENT stage while this test still asserts a stage name, which reads as an ordinary pin
    // failure. Keyed on the tool the dispatch orders: it cannot drift without the conversion being undone.
  assert.equal(res.ok, false, "pass 1 dies in the delivery phase, AFTER the corrective cycle");
  const cyclePath = driverDir(res.runDir, "corrective-cycle.json");
  assert.ok(existsSync(cyclePath), "the completion receipt was written before the failure");
  const rec = JSON.parse(readFileSync(cyclePath, "utf8"));
  assert.equal(rec.entryVerdict, "CONDITIONAL");
  assert.ok(rec.shas?.review && rec.shas?.narrative, "the receipt fingerprints the exact bytes the cycle settled");
  const pass1 = readEvents(res.runDir);
  assert.equal(pass1.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective").length, 1, "pass 1 ran the corrective once");
  assert.equal(pass1.filter((e) => e.event === "stage" && e.stage === "narrative-refutation" && e.trigger === "verdict-recheck").length, 1, "pass 1 ran the recheck once");

  // the human/recovery resume — cause addressed (knob cleared), same run, same workspace root
  // (codename from status.json: a terminal-failed result does not carry it — the terminal-failure
  // resume test reads it the same way)
  delete process.env.MOCK_FAIL_STAGE;
  const codename = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).codename;
  const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res2 = await resume({ ...JOB }, { codename });
  assert.equal(res2.ok, true, JSON.stringify(res2));
  assert.equal(res2.verdict, "CONDITIONAL", "the settled cycle's verdict stands on the resume");
  assert.ok(existsSync(join(res2.runDir, ".delivered")), "the resume finishes the delivery tail");
  const all = readEvents(res2.runDir);
  assert.ok(all.some((e) => e.event === "corrective-cycle-settled"), "the resume recognised the settled cycle");
  assert.equal(all.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective").length, 1,
    "the corrective re-synthesis NEVER re-fired on the resume — one cycle across both passes");
  assert.equal(all.filter((e) => e.event === "stage" && e.stage === "narrative-refutation" && e.trigger === "verdict-recheck").length, 1,
    "the verdict-recheck never re-fired either — a stale-artifact recovery re-does what went stale, nothing settled");
});

// ──: the delivery-time repair re-runs the reviewer and the verdict is never revisited ──

test("T3a/#1674: a review that flips to BLOCKING during the delivery stale-repair DELIVERS on the LATE verdict, never the settled one", async () => {
  // The delivered run of (`bf21580e`, round of 2026-08-23). Its own event log:
  //   00:22:11  verdict-2 → CONDITIONAL          the reviewer had signed at that point
  //   00:38:35  delivery-stale-repair            stages: [narrative-refutation, report-overview]
  //   00:52:01  senior-eye-review.md → BLOCKING  written by that repair
  //   00:52:10  stage narrative-refutation ok    trigger: stale-repair
  // It delivered, carrying a registration date the review said contradicted the fetched record.
  //
  // The cause is NOT a stale verdict: `verdict-recheck` returned ok and the file agreed with the
  // verdict at the moment it settled. It is that `UPSTREAM_STALE_REPAIR["narrative-refutation"]`
  // (pipeline.mjs) re-runs the reviewer at delivery time and the caller re-reads only findings.json
  // and the case-law layer — never senior-eye-review.md, the one artifact that stage authors.
  // MOCK_NARRATIVE_OVER_CAP reproduces the staling: finding 1's write-up breaches the word cap, the
  // lint repair rewrites narrative.md, and narrative.md is a DECLARED INPUT of narrative-refutation —
  // so the reviewer goes stale and the delivery gate re-runs it. The lint-repair-touches-findings knobs
  // deliberately do NOT reach it ('s projection), which is why this needed its own knob.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_NARRATIVE_OVER_CAP: "1", MOCK_REVIEW_BLOCKS_AFTER_VERDICT: "1" });

  // CONTROL FIRST — if the repair never re-ran the reviewer, the arm below proves nothing.
  const repair = events.find((e) => e.event === "delivery-stale-repair");
  assert.ok(repair, "the delivery stale-repair pass fired at all");
  assert.ok((repair.stages ?? []).includes("narrative-refutation"),
    `the repair re-ran the reviewer — stages were ${JSON.stringify(repair.stages)}`);
  // THE CONTROL THAT MATTERS. A first cut of this arm went green with `ok: false` — because the repair
  // FAILED (`plan_audit_missing`) and the run stale-BLOCKED, an ending with nothing to do with the
  // verdict. Assert the repair SUCCEEDED and the run did not stale-block, so the only route to the claim
  // below is the one under test.
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "narrative-refutation" && e.trigger === "stale-repair" && e.ok === true),
    "the re-run SUCCEEDED — a failed repair fails the run for an unrelated reason and proves nothing");
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"),
    "and the run did not stale-block — freshness was restored, so delivery was genuinely on the table");
  // and the review on disk really does say BLOCKING now, so the scenario is the one described
  assert.match(readFileSync(join(res.runDir, "senior-eye-review.md"), "utf8"), /^BLOCKING/,
    "the review the repair wrote is a BLOCKING one");

  // ── THE CLAIM, INVERTED BY T3a — owner ruling 2026-08-26 ────────────────────────────────────────
  //
  // "Deliver always, with open points printed. The refusal on a blocking review goes." What
  // established stands and is untouched: a reviewer who refuses at delivery time must be HEARD. What
  // changed is the answer — the run no longer dies, it adopts the late verdict and says so in the
  // document. So the controls above are unchanged and the claim below is the opposite one.
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the run delivers — the refusal is removed by the ruling");

  // ── AND THIS IS THE HALF THAT MATTERS, because delivering is the easy part to get right ──────────
  //
  // The settled verdict was CLEAR. The reviewer then returned BLOCKING during the repair. Deleting the
  // terminal WITHOUT adopting that verdict would deliver a report BADGED ON THE SETTLED ONE — refused by
  // the reviewer, labelled clear — which is worse than either behaviour this replaces and is bf21580e's
  // shape one layer up: the reviewer's word on disk and the client's document disagreeing.
  const hardened = events.filter((e) => e.event === "verdict-hardened-by-repair").pop();
  assert.ok(hardened, "the run recognised the late hardening at all");
  assert.equal(hardened.now, "BLOCKING", "and recognised it AS BLOCKING");
  assert.equal(hardened.adopted, true, "the late verdict is adopted, not merely logged");

  assert.equal(res.verdict, "BLOCKING", "the run's own verdict is the LATE one, not the one it had settled");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(sidecar.verdict, "BLOCKING",
    "verdict.json is 'the single label authority' in its own words — a stale one here is the whole defect");

  // THE BADGE AGREES WITH THE AUTHORITY. Asserted as an INVARIANT rather than against a literal tier, so
  // the arm cannot go stale when the tier vocabulary moves: whatever the sidecar says, the report says.
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const label = fm.match(/^overall_label:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(label, "the report carries an overall_label at all");
  assert.equal(label, String(sidecar.tier),
    `the report is badged ${label} while the label authority says ${sidecar.tier} — the reassembly did not `
    + "re-stamp the front matter from the adopted verdict, which is exactly the silent half of this defect");

  // AND THE LATE REVIEWER'S OWN WORDS REACH THE CLIENT DOCUMENT. A run that adopts the verdict, rebuilds
  // the badge and still prints no open points has heard the reviewer and told nobody.
  assert.match(readFileSync(join(res.runDir, "report.md"), "utf8"), /^###\s+Reviewer's open questions/m,
    "the section is built from the review THIS repair wrote, which is why the reassembly must re-run");
});
