// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — SYNTHESIS RULES OVER STRUCTURAL INPUT.
//
// The defect, as a fact about the tables on `origin/main` @5b5c08c: four stages sit downstream of the
// register funnel and three of them were handed the machine receipts. `skeptic` declared the coverage
// ledger and the plan-execution receipt AND got both as a driver-computed table; `narrative-refutation`
// got the receipt deterministically at dispatch; `register-digest` authors the ledger. `synthesis` — the
// stage that makes the judgment, emits a MANDATORY coverage judgment and writes the claim the reviewer
// then blocks — had NEITHER, in the prompt or in the staleness map. A grep for either path over the whole
// synthesis stage block returned zero.
//
// On the first delivered clearance that cost a fabricated Biogen enforcement history over a check the grid
// never dispatched, three named attributions the reviewer deleted, and a blocked first pass. The evidence
// that the check never ran was on disk before synthesis started.
//
// Every fixture here is DERIVED by the production derivations (`joinPlanToBands` → `deriveCoverageSkeleton`
// → the receipt shape `writePlanExecutionReceipt` writes) rather than hand-typed, because a hand-typed
// receipt certifies the shape you imagined instead of the one a run produces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { paths, stageInputs, STAGES, REGISTER_AXES } from "../stages.mjs";
import { DISPATCH_EXTRAS, sandboxManifest } from "../stage-context.mjs";
import { joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { coverageLedgerTableRows } from "../coverage-ledger.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// The mock-run harness, same shape as ab-tooling-honesty / experiment-context: fully offline, no
// billable call. The env has to be set BEFORE pipeline.mjs is imported (driver.config reads it at
// import), which is why this import is dynamic and the pure imports above are not.
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "prelim-447-mock-"));
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
const { composeDispatchExtra } = PL;

// A plan in the shape a real run freezes: three axes, one entry each, one of them a query the provider
// never produced a band block for. That last one is the class — a planned slice that NEVER RAN.
const PLAN = {
  schema_version: 1, plan_version: 3, nice_classes: ["5", "44"], regions: ["US", "EM", "GB"], provider: "corsearch",
  entries: [
    { qid: "primary-sweep:exact:venzy", nice_classes: ["5", "44"], regions: ["US", "EM", "GB"], axis: "primary-sweep", predicate: "exact", term: "VENZY", expected_kind: "enumerate" },
    { qid: "primary-sweep:wildcard:venz", nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "wildcard", term: "VENZ*", expected_kind: "enumerate" },
    { qid: "incumbent-class:owner:muster", nice_classes: ["5"], regions: ["GB"], axis: "incumbent-class", predicate: "owner", term: "Muster Handels GmbH & Co. KG", expected_kind: "count" },
  ],
};
// The bands the funnel actually wrote: two blocks for two of the three qids. The owner probe has no
// block at all, so `joinPlanToBands` lands it in `missing` — the search that never ran.
const BANDS = {
  "primary-sweep": [
    { qid: "primary-sweep:exact:venzy", state: "enumerated", records: [] },
    { qid: "primary-sweep:wildcard:venz", state: "incomplete", records: [] },
  ],
  "incumbent-class": [],
};
const MISSING_QID = "incumbent-class:owner:muster";

// The ledger in the shape `renderCoverageLedgerJsonFromForm` writes (keys EXACTLY axis/scope/status/
// reason, plus optional classes) — one row per axis, one of them a slice the run did not close.
const LEDGER = [
  { axis: "primary-sweep", scope: "exact VENZY, cl. 5/44, US/EU/GB", status: "confirmed-clean", reason: "enumerated to has_more:false" },
  { axis: "primary-sweep", scope: "VENZ* wildcard, cl. 5, US", status: "coverage-limited", reason: "count-only, saturated" },
  { axis: "incumbent-class", scope: "owner probe, cl. 5, GB", status: "deferred", reason: "the provider produced no band block for this query" },
];

function fixtureRun() {
  const runDir = mkdtempSync(join(tmpdir(), "prelim-447-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const joinRes = joinPlanToBands(PLAN, BANDS);
  const receipt = { plan_version: PLAN.plan_version, ...joinRes, skeleton: deriveCoverageSkeleton(PLAN, joinRes) };
  writeFileSync(driverDir(runDir, "plan-execution.json"), JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(join(runDir, "register-coverage-ledger.json"), JSON.stringify(LEDGER, null, 2) + "\n");
  return { runDir, ctx: { paths: paths(runDir), registerPlan: PLAN }, receipt };
}

// ── 1. THE STALENESS GRAPH ─────────────────────────────────────────────────────────────────────────
//
// EXACT SET, not membership. "the declaration includes the ledger and the receipt" stays green while
// somebody deletes three other inputs, and the list is both the staleness graph and what `--experiment`
// copies — a phantom entry parks runs, a dropped one lets a stage rule over material that has moved.
test("#447: synthesis declares EXACTLY its inputs, and the plan-execution receipt + coverage ledger are two of them", () => {
  const P = paths("/RUN");
  const sorted = (a) => [...new Set(a)].sort();
  const COMMON = [P.registerFindings, P.placement, P.placementModel, P.registerNamedBand, P.matterContext,
    P.variantManifest, P.skepticFlags, P.frameReopenReceipt, P.crowdContext, P.crowdContextMd,
    P.planExecution, P.registerCoverageLedger];

  for (const registerOnly of [false, true]) {
    const declared = stageInputs("synthesis", P, { axes: REGISTER_AXES, registerOnly });
    const expected = registerOnly ? COMMON : [...COMMON, P.commonLaw];
    assert.deepEqual(sorted(declared), sorted(expected),
      `stageInputs[synthesis] (registerOnly=${registerOnly}) is the staleness graph AND what --experiment copies`);
  }

  // Named individually so a regression fails by NAME rather than as a count mismatch on a 13-entry list.
  const declared = stageInputs("synthesis", P, { axes: REGISTER_AXES, registerOnly: false });
  assert.ok(declared.includes(P.planExecution),
    "synthesis must declare the plan-execution receipt — its coverage judgment rules over what actually ran (#447)");
  assert.ok(declared.includes(P.registerCoverageLedger),
    "synthesis must declare the machine coverage ledger — it emits a MANDATORY coverage judgment over those rows (#447)");

  // The asymmetry this closes, asserted as a fact rather than as history: the reviewer's declaration is
  // a SUBSET of the author's plus the author's own output. If synthesis loses either file while
  // narrative-refutation keeps its receipt, the auditor knows something the author does not — which is
  // exactly, and it is invisible from synthesis's own list.
  const skeptic = stageInputs("skeptic", P, { axes: REGISTER_AXES, registerOnly: false });
  for (const f of [P.planExecution, P.registerCoverageLedger])
    assert.ok(skeptic.includes(f) && declared.includes(f),
      `both judgment seats hold ${f} — the skeptic held it alone and that asymmetry was the defect`);
});

// ── 2. THE BLOCKS ARE BUILT, AND THEY CARRY THE ROWS ───────────────────────────────────────────────
//
// Through the SAME composer the production dispatch uses. The declaration and the binding are checked by
// the import-time guard in pipeline.mjs; what that guard cannot see is whether the built text actually
// carries the facts, so this drives the real builders over a real-derived receipt.
test("#447: the synthesis dispatch composes both structural blocks, carrying the missing qid and the ledger rows", () => {
  const { ctx } = fixtureRun();
  const { text, ids } = composeDispatchExtra("synthesis", ctx);

  assert.deepEqual(ids.map((x) => x.id), ["synthesis-plan-audit", "synthesis-coverage-ledger"],
    "both blocks build, in registry order — an id missing here is a block the dispatch silently did not carry");

  assert.ok(text.includes(MISSING_QID),
    `the receipt block must name the qid that never ran (${MISSING_QID}) VERBATIM — a truncated or summarised identifier is one the seat cannot match back to the plan`);
  assert.match(text, /missing \(no band block\): 1/,
    "the receipt block states the missing count as code derived it, not as prose the seat re-derives");

  // The ledger rows must be present cell for cell — INCLUDING THE REASON, and written out as literals.
  //
  // review: this used to build its expectation by calling `coverageLedgerTableRows` and asserting
  // the text contained the result, which is the fixture-compared-to-itself shape the house rules name —
  // any change to the formatter moved both sides together. Proof it was vacuous: `reasonMax` 180 → 3
  // truncated the reason cell of the one row grammar BOTH judgment seats read, and all 3898 driver
  // tests stayed green. The reason is the only cell that says WHY a slice did not close, so a silently
  // truncated one degrades the skeptic's escalation decision and this stage's coverage judgment at once.
  assert.ok(text.includes("| incumbent-class | incumbent-class / owner probe, cl. 5, GB | deferred | the provider produced no band block for this query |"),
    "the deferred row rides in full, reason cell included — the cell that says why the slice did not close");
  assert.ok(text.includes("| primary-sweep | primary-sweep / VENZ* wildcard, cl. 5, US | coverage-limited | count-only, saturated |"),
    "the coverage-limited row rides too — a slice the run did not close is exactly what the judgment weighs");
});

// ── 3. ONE RULE, ONE COPY ──────────────────────────────────────────────────────────────────────────
//
// The three graded classes are the rule. Class (1) — a slice listed MISSING never ran — is the blocking
// condition on one seat and the unwriteable condition on the other, and it is the same fact about the
// same receipt. Two copies of it, one per seat, is 's shape: they drift, and the drift is silent
// because each copy reads correct on its own.
test("#447: the graded classes are ONE literal — the author's block, the reviewer's, and the repair turn", async () => {
  const { ctx } = fixtureRun();
  const synth = composeDispatchExtra("synthesis", ctx).text;
  const refute = composeDispatchExtra("narrative-refutation", ctx).text;
  // THE THIRD READER. `correctionHint` is what a reviewer is handed when its review comes back without
  // the audit section — the exact moment it is rewriting the section this grading governs. It restated
  // the three classes in its own words until, which made it a copy nothing kept in step.
  const { correctionHint } = await import("../gateway.mjs");
  const hint = correctionHint("invalid_file:prelim-search/x/y/senior-eye-review.md:plan_audit_missing");

  const classesOf = (t) => {
    const m = t.match(/THE THREE CLASSES, GRADED:[^\n]*?by itself\./);
    return m ? m[0] : null;
  };
  const a = classesOf(synth), b = classesOf(refute), c = classesOf(hint);
  assert.ok(a, "the synthesis block states the three classes");
  assert.ok(b, "the refutation block states the three classes");
  assert.ok(c, "the plan_audit_missing repair hint states the three classes");
  assert.equal(a, b, "the two seats must read the SAME classes literal, byte for byte — a second copy is the rule drifting");
  assert.equal(a, c, "and so must the repair turn — a hint that paraphrases the grading is the copy that goes stale first");
  assert.match(a, /a slice listed MISSING NEVER RAN/, "class (1) is the blocking condition and must survive verbatim");
  assert.match(hint, /section titled exactly "PLAN-EXECUTION CHECK"/, "the hint still names the section the validator keys on");

  // The seats differ where they must: the frame, and nowhere else.
  assert.match(refute, /Your review MUST include a section titled "PLAN-EXECUTION CHECK"/,
    "verify.mjs seniorEyeReview keys plan_audit_missing on that exact section title — it may not move");
  assert.match(synth, /ruling over this receipt BEFORE you write/,
    "the author's frame reverses the direction: it rules over the classes, it is not audited against them");
  assert.ok(!/PLAN-EXECUTION CHECK" auditing/.test(synth),
    "synthesis must NOT be ordered to write the reviewer's audit section into the client-facing narrative");
});

// ── 4. THE PROMPT NAMES THE AUTHORITY, AND STATES THE RULE ONCE ────────────────────────────────────
//
// REVIEW — THIS TEST USED TO CERTIFY THE DEFECT. It rendered the message with NO dispatch-block
// stamp (the shape a run with no register record produces) and asserted that the prompt named both
// artifacts and promised a table — i.e. it pinned the unconditional promise as if it were correct. The
// blocks are best-effort and vanish on three reachable shapes, so what the old assertions actually
// guaranteed was that a seat with no table would still be told one was below. Every shape is now
// driven, and the branch that claims a table is the branch that has one.
const BOTH = { synthesis: { built: ["synthesis-plan-audit", "synthesis-coverage-ledger"], failed: [] } };
const synthMsg = (P, job, { dispatchBlocks, registerOnly = false } = {}) =>
  STAGES.synthesis.message({ paths: P, job, axes: REGISTER_AXES, registerOnly, dispatchBlocks, agent: "clawdi", run: { slug: "s", codename: "c" } });

test("#447: the synthesis prompt names both machine artifacts and carries assert-or-defer", () => {
  const P = paths("/RUN");
  const job = { marks: [{ name: "VENZY", classes: [5] }], markName: "VENZY", name: "PROJECT K", classes: [5], ref: "TMP447", customer: "ACME", goods: "supplements", forwarder: "jordan", msgId: "<m>" };
  const msg = synthMsg(P, job, { dispatchBlocks: BOTH });

  assert.ok(msg.includes(P.planExecution), "the plan-execution receipt is named as the authority in the prompt");
  assert.ok(msg.includes(P.registerCoverageLedger), "the machine coverage ledger is named as the authority in the prompt");
  assert.match(msg, /ASSERT-OR-DEFER: a fact whose supporting search did not run is not yours to assert/,
    "the general rule #447 asked for is stated in the prompt");
  assert.match(msg, /never describe what such a check would have shown/,
    "the half the reviewer had to repair by hand: the narrative may not narrate a search that did not run");

  // THE RULE IS GENERAL; ONE LAYER HAS A RECEIPT. The two artifacts it hands over are the REGISTER
  // plan's receipt and the REGISTER coverage ledger — `writePlanExecutionReceipt` derives the receipt
  // from `ctx.registerPlan` and `deriveCoverageSkeleton` walks register axes, so neither says anything
  // about the marketplace grid. Two ways to get this wrong, and both have been written: claim the rule
  // "governs every layer" (which makes every common-law finding unassertable), or hand the common-law
  // layer a record of its own and name common-law-findings.md as it. That file is the common-law
  // stage's NARRATIVE. Treating it as proof a check ran is how one stage's unsupported assertion
  // becomes the next stage's supported fact — 's shape, and what this build exists to stop.
  assert.match(msg, /KNOW WHICH GROUND YOU ARE ON/,
    "the rule stays general by saying which layer has a receipt, not by claiming a register receipt covers all of them");
  assert.ok(!/governs every layer of the opinion/.test(msg),
    "the over-broad scope is gone: it pointed a register-only record at facts no register receipt can carry");
  assert.match(msg, new RegExp(`${P.commonLaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a dispatch record either — it is that stage's own narrative`),
    "and the common-law narrative is named as NOT a receipt — the second wrong answer, stated so it cannot be given again");
  assert.ok(!/for the common-law layer it is/.test(msg),
    "nothing on the common-law side is described as the layer's dispatch record");

  // THE CARVE-OUT, AND ITS DIRECTION. De-authorising the whole file also de-authorised its
  // `## Coverage ledger`, which prelim-common-law/SKILL.md writes FOR this seat and synthesis-rules.md
  // orders it to read before any clean statement — two opposed instructions about one file in one
  // dispatch. The section is carved back in, and the direction is the load-bearing half: it constrains
  // (a coverage-limited row forbids a clean negative) and never licenses (confirmed-clean there is the
  // stage's own word). Drop the direction and 's laundering route is open again.
  assert.match(msg, /Its `## Coverage ledger` section is the exception you MUST still read, and in one direction only/,
    "the common-law coverage ledger keeps its standing as a coverage input the seat must read");
  assert.match(msg, /can never be written as a clean negative/,
    "the constraining direction: a coverage-limited or deferred common-law unit is not a clean negative");
  assert.match(msg, /It licenses nothing/,
    "and the licensing direction stays shut — a confirmed-clean row there is still that stage's own assertion");

  // Register-only runs have no second layer at all, and the sentence must not name a file the run
  // never wrote — `stageInputs` filters commonLaw out of the declaration on exactly those runs.
  const ro = synthMsg(P, job, { dispatchBlocks: BOTH, registerOnly: true });
  assert.match(ro, /No other layer does on this run/,
    "on a register-only run the rule says so rather than naming a common-law file that does not exist");
  assert.ok(!ro.includes(P.commonLaw), "and it does not name that file");
});

// ── 4b. THE PROMPT PROMISES A TABLE ONLY WHEN THE COMPOSER BUILT ONE ───────────────────────────────
//
// The three shapes that produce no block are all reachable and all documented in the codebase itself:
// no frozen register plan (attachRegisterPlan degrades to null on a class-less matter or a pre-spec48
// resume), a receipt that exists and will not parse, and neither artifact on disk. On every one of
// them the seat that signs the run was told a driver-computed record was tabulated below and handed
// nothing — an absence dressed as a pass, which is the inference exists to stop.
test("#447 review: the promise of a tabulated record tracks the blocks that actually built", () => {
  const P = paths("/RUN");
  const job = { marks: [{ name: "VENZY", classes: [5] }], markName: "VENZY", name: "PROJECT K", classes: [5], ref: "TMP447", customer: "ACME", goods: "supplements", forwarder: "jordan", msgId: "<m>" };

  // (a) NO BLOCKS. The promise is withdrawn — and the rule is NOT. Going silent here is the digest's
  // own recorded failure one stage upstream (stages.mjs: "the run passed having judged no coverage at
  // all"), so ASSERT-OR-DEFER still stands and the seat is told what the silence means.
  const none = synthMsg(P, job, { dispatchBlocks: { synthesis: { built: [], failed: [] } } });
  assert.match(none, /DISPATCH RECORD — NONE this run/, "with no block composed the prompt says so instead of naming a table");
  assert.ok(!/tabulated for you below/.test(none), "and it does not promise a table that is not there");
  assert.match(none, /ASSERT-OR-DEFER: a fact whose supporting search did not run is not yours to assert/,
    "the rule survives the branch — losing it here would be the seat judging no coverage at all");
  assert.match(none, /An absence of tabulated gaps is NOT a clean register/,
    "the seat is told what the missing table means, so silence cannot read as a clean sweep");

  // (b) PARTIAL. Shape B: the receipt is on disk and readable, and only the frozen plan is absent, so
  // the ledger block builds and the receipt block does not. The prompt names what is below and nothing
  // else — naming the receipt here would be the same false promise in miniature.
  const ledgerOnly = synthMsg(P, job, { dispatchBlocks: { synthesis: { built: ["synthesis-coverage-ledger"], failed: [] } } });
  assert.ok(ledgerOnly.includes(P.registerCoverageLedger), "the block that built is named");
  assert.match(ledgerOnly, /tabulated below/, "and it is described as tabulated, because it is");
  assert.ok(!new RegExp(`${P.planExecution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) — tabulated`).test(ledgerOnly),
    "the block that did NOT build is not described as tabulated");

  // (c) BROKEN ≠ ABSENT. A receipt that exists and cannot be parsed is a driver-artifact bug, not a run
  // shape. Collapsing the two would make the bug read as an ordinary run — an absence that is not a
  // finding — so the fault is named and the seat is forbidden from reading past it.
  const broken = synthMsg(P, job, { dispatchBlocks: { synthesis: { built: ["synthesis-coverage-ledger"], failed: [{ id: "synthesis-plan-audit", error: "Unterminated string in JSON" }] } } });
  assert.match(broken, /DRIVER ARTIFACT FAULT/, "an unparseable driver artifact is announced as a machine defect");
  assert.match(broken, /you may not call any register slice searched-clean on the strength of a record the driver could not read/,
    "and the seat is told the consequence, which is the only part that changes an outcome");
  assert.ok(!/DRIVER ARTIFACT FAULT/.test(none), "a run that simply has no record is NOT reported as a driver fault");

  // (d) An unstamped ctx claims nothing. The only route here is a cold dispatch nobody composed for,
  // and fail-safe is the branch that claims less.
  assert.match(synthMsg(P, job, {}), /DISPATCH RECORD — NONE this run/,
    "no stamp ⇒ no promise; a prompt must never promise a block on a path that built none");
});

// ── 5. THE SANDBOX CARRIES WHAT THE PROMPT NOW DEPENDS ON ──────────────────────────────────────────
//
// A declared dispatch extra whose reads are not in the manifest is an `--experiment` arm running a
// thinner prompt than the run it is compared against — corruption 2, which is why DISPATCH_EXTRAS
// exists at all. Two new entries, two new read sets.
test("#447: synthesis's sandbox manifest carries the receipt, the frozen plan and the machine ledger", () => {
  const P = paths("/RUN");
  const manifest = sandboxManifest("synthesis", P, { axes: REGISTER_AXES });
  const held = new Set(manifest.map((e) => e.path));
  for (const [path, why] of [
    [P.planExecution, "planAuditExtra tabulates it"],
    [P.registerPlan, "planAuditExtra returns EMPTY without the frozen plan attached"],
    [P.registerCoverageLedger, "coverageLedgerExtra tabulates it"],
  ]) assert.ok(held.has(path), `synthesis's sandbox must hold ${path} — ${why}`);

  const ids = DISPATCH_EXTRAS.filter((x) => x.stage === "synthesis").map((x) => x.id);
  assert.deepEqual(ids, ["synthesis-plan-audit", "synthesis-coverage-ledger"],
    "both blocks are DECLARED; the import-time guard in pipeline.mjs binds each to a builder in the same commit");
});

// ── 6. AND THE DISPATCH ACTUALLY CARRIES THEM ──────────────────────────────────────────────────────
//
// Everything above tests the composer. NONE of it can see the call site: `stage("synthesis", …)` took no
// `extra` at all until this build, and a regression that drops the argument again leaves every assertion
// above green while the model receives nothing. So this one drives a real (mocked, offline) pipeline to
// the synthesis dispatch and reads `_driver/synthesis.attempt1.dispatch.txt` — the verbatim record of
// what the stage was TOLD, which added for exactly this question.
test("#447: a real dispatch carries both blocks — read out of the recorded synthesis prompt, not the composer", async () => {
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FAIL_STAGE = "joint synthesis narrative";   // park AT synthesis: the dispatch happens, the stage fails
  const job = { id: "job-TMP447D", msgId: "<tmp447d@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMP447D", markName: "MARK TMP447D", classes: [9, 41], provider: "corsearch" };
  const res = await PL.pipeline(job);
  delete process.env.MOCK_FAIL_STAGE;
  assert.equal(res.failedStage, "synthesis", "the run must reach and dispatch synthesis for this to be testing anything");

  const recorded = readFileSync(driverDir(res.runDir, "synthesis.attempt1.dispatch.txt"), "utf8");
  assert.match(recorded, /DETERMINISTIC PLAN-EXECUTION CHECK/,
    "the plan-execution receipt block reached the real synthesis dispatch");
  assert.match(recorded, /THE THREE CLASSES, GRADED:/,
    "the graded classes reached the real synthesis dispatch");
  assert.match(recorded, /ruling over this receipt BEFORE you write/,
    "and in the AUTHOR's frame — not the reviewer's audit-section frame");
  assert.match(recorded, /COVERAGE LEDGER, DRIVER-COMPUTED/,
    "the machine coverage ledger block reached the real synthesis dispatch");
  assert.match(recorded, /Coverage ledger \(axis \| unit \| status \| reason\):/,
    "with its rows, in the one row grammar both judgment seats read");
  assert.match(recorded, /ASSERT-OR-DEFER/,
    "and the prompt's own statement of the rule the blocks exist to serve");

  // THE PROMPT'S CLAIM ABOUT ITSELF MATCHES WHAT IS BELOW IT. Everything above would stay green if the
  // composer stopped stamping the ctx: the blocks would still be composed and appended, and the
  // message would take the no-record branch and tell the seat there is no table while a table sits
  // under it. That is the same class of lie as the unconditional promise, pointing the other way.
  assert.match(recorded, /DISPATCH RECORD — the REGISTER layer's, authoritative and driver-written/,
    "the stamp reached the message: a dispatch that carries the blocks says so");
  assert.ok(!/DISPATCH RECORD — NONE this run/.test(recorded),
    "and never tells a seat there is no record while handing it one");
});

// ── 7. THE STALE-REPAIR RE-DISPATCH IS COLD, AND IT CARRIES THEM TOO ───────────────────────────────
//
// review. `UPSTREAM_STALE_REPAIR.synthesis` re-authors narrative.md and findings.json — the
// delivered opinion — from a FULL `def.message(ctx)`, and it took no `extra`. So the one pass most
// likely to be rewriting a coverage claim ruled with the receipt and the ledger withheld, on a prompt
// that told it both were tabulated below. It also SUCCEEDED: the refutation's equivalent gap fails
// closed on verify.mjs's `plan_audit_missing`, and synthesis has no such validator.
test("#447 review: the stale-repair re-dispatch of synthesis carries the structural blocks", async () => {
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FAIL_STAGE = "delivery-contract";   // fail LATE so the run stays live and repairable
  const job = { id: "job-TMP447SR", msgId: "<tmp447sr@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMP447SR", markName: "MARK TMP447SR", classes: [9, 41], provider: "corsearch" };
  const res = await PL.pipeline(job);
  delete process.env.MOCK_FAIL_STAGE;

  const runDir = res.runDir;
  const fresh = readFileSync(driverDir(runDir, "synthesis.attempt1.dispatch.txt"), "utf8");
  // The shape production's blocked delivery pass writes, driven through the production entry point.
  writeFileSync(driverDir(runDir, "delivery-stale.json"), JSON.stringify({
    ts: new Date().toISOString(), labels: ["synthesis"], changed: { synthesis: ["register-findings.md"] },
  }, null, 2));

  const codename = basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");
  const rep = await PL.repairStale(job, { codename });
  assert.deepEqual(rep.repaired, ["synthesis"], "the repair must actually re-dispatch synthesis for this to be testing anything");

  const repaired = readFileSync(driverDir(runDir, "synthesis.attempt1.dispatch.txt"), "utf8");
  assert.match(repaired, /DETERMINISTIC PLAN-EXECUTION CHECK/,
    "the repair pass rules over the same receipt the fresh pass did — it rewrites the delivered opinion");
  assert.match(repaired, /COVERAGE LEDGER, DRIVER-COMPUTED/,
    "and over the same ledger");
  assert.match(repaired, /DISPATCH RECORD — the REGISTER layer's, authoritative and driver-written/,
    "and its prompt's claim about what it carries is true, exactly as the fresh pass's is");
  // The original justification for withholding was that a repair must not carry a different prompt from
  // the pass it repairs. It had it backwards, and the sizes say so: withholding is what made them differ.
  assert.ok(repaired.length >= fresh.length - 200,
    `the repair prompt is no longer the thinner one — fresh ${fresh.length}, repair ${repaired.length}`);
});
