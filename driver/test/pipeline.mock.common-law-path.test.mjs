// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet: the common-law path a run records, salvage, delivery and the reviewer's sign-off
// Offline driver dry-run against a mock engine (no billable calls). The shared harness is pipeline-mock-harness.mjs.
import { JOB, readPathRecord, runPipeline, singleTermGridRun } from "./pipeline-mock-harness.mjs";
import { test } from "node:test";
import { refusalsFor } from "../synthesis-record.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

test("a SPLIT run records the split and the quantity that armed it", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "split");
  assert.equal(rec.reason, "armed");
  assert.ok(rec.terms >= 2, "the deciding quantity is recorded, not merely the verdict");
  // `rec.flag` is gone with it: the record names the terms of the selector, and the flag is no
  // longer one of them. The two test lines here were its only readers in the whole tree.
  assert.ok(!("flag" in rec), "a record that still carried `flag` would be naming a term the selector no longer has");
  assert.ok(rec.members.length && rec.members.every((m) => m.startsWith("common-law-half:")),
    "and the members it actually assembled");
});

test("an UNSPLIT run records WHICH surviving term decided it — the branch that emitted nothing before", async () => {
  // Was the flag-off branch. the property was never about the flag: it is that a run which did NOT
  // split says so, and says why, on the path that used to emit nothing at all. Deleting the switch
  // removed one reason from the conjunction and left the property untouched.
  const { res, events } = await singleTermGridRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "unsplit", "the record agrees with the assembly");
  assert.equal(rec.reason, "single-term-grid", "and names WHICH term of the conjunction decided it");
  assert.match(rec.detail, /nothing to partition/i, "carrying what the term MEANS, not merely its slug — the detail is what a reader of the run acts on");
  assert.deepEqual(rec.members, ["common-law"], "naming the single-member assembly");
  const ev = events.filter((e) => e.event === "common-law-path");
  assert.equal(ev.length, 1, "exactly one path event per run — the journal carries it too, for a reader who has no run dir");
  assert.equal(ev[0].reason, "single-term-grid");
});

test("the record can never explain a path the run did not take", async () => {
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
    { label: "unsplit (single-term-grid)", get: async () => (await singleTermGridRun()).res },
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

// ── the recorded downgrade is READ, and a run that took it cannot deliver clean ────────────────
//
// The record was written; nothing consulted it. A run whose dictated meaning sweep silently became the
// legacy spec-less path delivered CLEAN, with common-law-path.json sitting on disk naming the downgrade.
//
// THE LEVER: a resume whose frozen profile carries no marketplace list at all. deriveGridSpec authors no grid
// spec for it, so a variant-carrying non-register-only matter takes the spec-less path. (This used to be a resume
// with no `_driver/profile.json`, which ran profile-free; such a resume is now refused, since its stage work cannot
// be shown to be for the product ordered.) A zero-platform profile is NOT this lever: an empty marketplace list
// is valid now and still writes a grid of the general-web cell and the meaning sweep — the arm after this
// one pins that it does, and that it delivers without this clamp.
test("a no-grid-spec downgrade on a variant-carrying manifest clamps CLEAR→CONDITIONAL and names the gap", async () => {
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.ok, false);
  // a frozen profile that carries no marketplace list at all: the spec-less path's one remaining door
  const frozen = JSON.parse(readFileSync(driverDir(r1.runDir, "profile.json"), "utf8"));
  delete frozen.platforms;
  writeFileSync(driverDir(r1.runDir, "profile.json"), JSON.stringify(frozen, null, 2) + "\n");
  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
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


test("a company with no marketplaces still searches the web and the meanings, and is not clamped for it", async () => {
  // THE DEFECT THIS PINS AGAINST: the grid spec was gated on a NON-EMPTY marketplace list, and the
  // general-web cell and the meaning sweep ride in that spec. An empty list would have switched both off
  // with the stores, and the clamp above would then have downgraded every CLEAR for a sweep that "did
  // not run". None means no store cells — never no web and no meanings.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" }, { profileKey: "harbour-goods" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar.profileKey, "harbour-goods");
  assert.deepEqual(sidecar.platforms, [], "the company's own list is empty");
  const spec = JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8"));
  const added = events.find((e) => e.event === "commonlaw-channels-added")?.added ?? [];
  assert.deepEqual(spec.platforms, [...added, "web"], "the web cell, plus only what the matter frame named — no store from any house list");
  assert.ok(spec.terms.length > 0, "every variant still gets its web search");
  assert.ok((spec.connotation?.queries ?? []).length > 0, "the meaning sweep is still dictated");
  const rec = readPathRecord(res.runDir);
  assert.notEqual(rec.reason, "no-grid-spec", "not the spec-less path");
  const v = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(v.kinds?.commonLawDowngrade ?? false, false, "no downgrade for a sweep that ran");
  assert.ok(!events.some((e) => e.event === "common-law-downgrade-clamp"), "and none was recorded");
});
test("a legitimate unsplit path is NOT a failure: a single-term grid still delivers CLEAR", async () => {
  // "Deliberately NOT proposed: making the unsplit path itself a failure. It is the legitimate rollback
  // path." The flag was one legitimate reason to be unsplit and is deleted, and so is a pre-split resume;
  // a single-term grid is the reason that remains, and the clamp must still discriminate. THIS ARM IS THE PAIR to the no-grid-spec arm above — that one
  // asserts the clamp FIRES, this one that it does not fire on a legitimate reason. Delete either and
  // "clamps CLEAR→CONDITIONAL" stops being a claim about discrimination and becomes one about a constant.
  const { res } = await singleTermGridRun();
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = readPathRecord(res.runDir);
  assert.equal(rec.path, "unsplit");
  assert.equal(rec.reason, "single-term-grid", "unsplit for a legitimate reason — not the spec-less downgrade");
  const v = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(v.verdict, "CLEAR", "the documented rollback path must not be clamped");
  assert.ok(!v.kinds?.commonLawDowngrade, "and carries no downgrade kind");
});

// ── the salvage lane repairs what it admits ─────────────────────────────────────────────
test("a malformed ACTION gets its own named re-emit and the run recovers — it used to exhaust", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ACTIONS: "condition-broken" });
  assert.equal(res.ok, true, `the run should recover through the action re-emit: ${JSON.stringify(res)}`);
  // RE-AIMED: the action-shaped defect is refused at the call now, so there is no
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

test("a malformed ask_answers entry gets its OWN named re-emit — the last family the lane admitted and could not name", async () => {
  // `finding_ask_answer_key_unknown` matches the lane's `finding_[a-z]` admission test, and the lenient
  // parser used to DROP a malformed ask_answer with no record in any list — so the lane admitted a
  // defect nothing could name and the run exhausted. ask_answers joins to the FROZEN intake asks, so a
  // dropped one ships a question the client committed at intake unanswered: worth a repair, not a shrug.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_ASK_ANSWER_BAD: "1" });
  assert.equal(res.ok, true, `the run should recover through the ask_answers re-emit: ${JSON.stringify(res)}`);
  // RE-AIMED: refused at the call, restated in the same turn, so there is no
  // `ask-answer-reemit` and no warm re-dispatch. The subject is unchanged and is asserted below — a
  // dropped ask_answer ships a question the client committed at intake UNANSWERED, and that is what
  // must not happen however the defect is caught.
  assert.ok(refusalsFor(res.runDir).some((r) => /ask_answer/.test(r.reason)),
    "the ask_answers defect was refused at the call, by name");
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.equal(findings.ask_answers.length, 1, "the entry survived the repair — a deleted ask ships unanswered");
  assert.ok(!("bogus" in findings.ask_answers[0]), "the unknown key is gone");
});

// ── A RUN THAT COMPLETED ALL BUT ONE DICTATED MEANING SEARCH MUST DELIVER ─────────────────────────
//
// A delivered clearance ran fifty-nine of its sixty dictated meaning searches. The sixtieth left no
// receipt, no gap row and no error anywhere, the merge gate refused, and the whole report was thrown
// away — the fifty-nine included. "Never fail and don't deliver" is the standing rule and this was the
// clearest breach of it: the work was done and the client got nothing.
//
// What lands instead, in order: the model gets ONE repair turn, then the engine re-issues the missing
// search itself through the same provider, and only if it is STILL missing does the run deliver with
// the gap disclosed. Disclosure is the last resort, never the first answer — the ordinary retries are
// untouched, which is what keeps this on the right side of the false-clean line the merge gate guards.
test("the engine re-issues a missing meaning search itself, and a recovered one leaves nothing to disclose", async () => {
  const asked = [];
  const reissuer = async (queries) => {
    asked.push(...queries);
    return { ok: true, rows: queries.map((q) => ({ query: q, results: [] })), requested: queries.length };
  };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_MISSING_QUERIES: "1" }, {}, { connotationReissuer: reissuer });

  assert.equal(res.ok, true, `the run must deliver once the engine recovered the search: ${JSON.stringify(res)}`);
  assert.ok(asked.length >= 1, "the engine never re-issued anything — the model was asked to redo the sweep instead");
  assert.ok(events.some((e) => e.event === "connotation-reissue-result" && e.ok === true),
    "the re-issue was not recorded; an attempt nobody can see is the defect this issue is about");
  assert.ok(!events.some((e) => e.event === "connotation-unfinished-disclosed"),
    "a search the engine RECOVERED must not be disclosed as unfinished — that tells a client work was missed that was not");
  assert.ok(!events.some((e) => e.event === "meaning-gap-coverage"),
    "a recovered search grew a coverage row on the report saying it did not complete");
  // THE ROW THE CAPTURE LEFT IS GONE, NOT CLOSED. The grid tool records a gap row for the query its program did
  // not return, and the re-issue answers it later in the same ledger. A row kept beside that answer reaches the
  // canonical grid, where the closure pass takes every gap row for a store cell and runs the meaning query
  // again, restricted to a site called "connotation": a search of nothing that then reads as a searched cell.
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.deepEqual(merged.cells.filter((c) => String(c.platform).toLowerCase() === "connotation"), [],
    "a meaning query came back as a store cell: the closure pass re-ran it on a site called \"connotation\"");
  assert.deepEqual(merged.gaps.filter((g) => String(g.platform).toLowerCase() === "connotation"), [],
    "a recovered meaning query still carries a gap row beside its answer");
});

test("and when the re-issue cannot recover it, the run DELIVERS with the gap disclosed", async () => {
  const reissuer = async () => ({ ok: false, cause: "provider declined on the retry too", rows: [] });
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_MISSING_QUERIES: "1" }, {}, { connotationReissuer: reissuer });

  assert.equal(res.ok, true,
    `a run that completed all but one dictated meaning search must DELIVER, not throw the report away: ${JSON.stringify(res)}`);
  const disclosed = events.find((e) => e.event === "connotation-unfinished-disclosed");
  assert.ok(disclosed, "the run delivered but disclosed nothing — that is the false-clean the merge gate exists to prevent");
  assert.equal(disclosed.count, 1, "the disclosure must count the searches that did not complete");

  // THE GAP CARRIES ITS TERM. A disclosure that cannot name which search is short is not a disclosure.
  const merged = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  const connGaps = (Array.isArray(merged.gaps) ? merged.gaps : [])
    .filter((g) => String(g?.platform ?? "").toLowerCase() === "connotation");
  assert.ok(connGaps.length >= 1, "no connotation gap row was written — the coverage row has nothing to read");
  assert.ok(connGaps.every((g) => String(g.term ?? "").trim()), "a gap row names no term, so no page can say which search was short");

  // AND IT REACHES THE CLIENT'S OWN PAGE, not only the audit. The report is never handed the grid, so
  // without the driver putting the gap on the coverage it renders, whether a client learns a meaning
  // search is missing would be the synthesis model's choice.
  const findings = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  for (const g of connGaps) {
    const row = (findings.coverage ?? []).find((c) => c.area === `Follow-up / ${g.term}`);
    assert.ok(row, `the unfinished meaning search "${g.term}" is on the audit and not on the report's coverage`);
    assert.equal(row.state, "open", "an unfinished search must read as open, never as searched");
    assert.match(row.note, /not completed this run/);
  }
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const html = readFileSync(join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`, "report.html"), "utf8");
  assert.ok(connGaps.every((g) => html.includes(g.term)), "the rendered report does not name the meaning search that did not complete");
});

test("the model gets ONE repair turn, not a loop", async () => {
  const reissuer = async () => ({ ok: false, cause: "still nothing", rows: [] });
  const { events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CL_MISSING_QUERIES: "1" }, {}, { connotationReissuer: reissuer });
  assert.ok(events.filter((e) => e.event === "connotation-remedy").length <= 1,
    "the model was asked more than once; that loop is what cost eight attempts on a delivered clearance");
  assert.ok(events.filter((e) => e.event === "connotation-reissue").length <= 1,
    "the engine re-issued more than once — the attempts are supposed to be bounded");
});

// ── A STAGE THAT WAS ENTERED AND DID NOT SUCCEED IS STILL WHERE THE RUN IS ──────────────────────────
//
// The displayed step advanced on SUCCESS only, so a run sitting in a stage read as being in the previous
// one for as long as that stage took. The live case is what the issue measured — placement entered at
// 10:05Z, the portal still saying "Register sweeps" at 10:10Z — and it cannot be asserted after the fact,
// because a run in flight has settled nothing. A stage that is entered and FAILS is the same distinction
// in a state that persists: under success-only recording the run's own status names the last stage that
// finished, which is not where it stopped.
test("a run that dies in a stage says THAT stage is where it was, not the last one that finished", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(res.postponed, true, JSON.stringify(res));
  assert.equal(JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage, "synthesis");

  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.lastStage, "synthesis",
    `the run stopped in synthesis and its status says it was in ${status.lastStage} — the reader is told the last stage that SUCCEEDED, which is the defect`);

  // And synthesis genuinely did not succeed, so this is not a stage that merely finished quietly: without
  // it the arm would pass against success-only recording the moment the mock stopped failing.
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.ok),
    "synthesis recorded a successful stage event — the fixture is no longer failing where this arm needs it to");
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "synthesis"),
    "synthesis never produced a stage event at all — the run died before reaching it and this arm proves nothing");
});

// ── THE REVIEWER'S SIGN-OFF LIVES UNDER THE STAGE THAT PRODUCED IT (ruled 2026-09-22) ────────────────
//
// At the top of the run record as `verdict` it read as the clearance's answer. It is now `review.signoff`,
// and a rebuilt run (stale repair, an experiment arm) restores it from there — or, on a record written
// before the move, from the old field, so an archived run's sign-off is not lost on the way back in.
test("a rebuilt run restores the reviewer's sign-off from review.signoff, and from a record written before the move", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CONDITIONAL", MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(res.postponed, true, JSON.stringify(res));
  assert.equal(JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage, "synthesis");
  delete process.env.MOCK_FAIL_STAGE;
  // The run stopped before the refutation signed, so the sign-off is planted here in each shape; the writer
  // side is held by the delivered-run arms above, which read review.signoff off the run's own status.
  const statusPath = join(res.runDir, "status.json");
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  assert.equal(status.verdict, undefined, "a record this run wrote carries the retired top-level field");
  writeFileSync(statusPath, JSON.stringify({ ...status, review: { signoff: "CONDITIONAL" } }));
  const codename = res.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { reconstructCtx } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  assert.equal(reconstructCtx(JOB, { codename }).verdict, "CONDITIONAL", "a rebuilt run lost its sign-off");
  // A record in the shape every archived run carries.
  const { review: _new, ...legacy } = status;
  writeFileSync(statusPath, JSON.stringify({ ...legacy, verdict: "BLOCKING" }));
  assert.equal(reconstructCtx(JOB, { codename }).verdict, "BLOCKING", "a run recorded before the move lost its sign-off on the way back in");
});
