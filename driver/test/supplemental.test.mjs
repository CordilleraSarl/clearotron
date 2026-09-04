// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The supplemental mint-and-execute seam (copper-lattice re-route): the model PROPOSES register
// queries; CODE mints them as qid'd plan entries, executes them via the injected executor, and hands
// back results read from the band — the hand-transcription lane is gone. Offline: executePlan stubbed.
//
//: these calls used to open with a fake credential (`proposeSupplemental("COOKIE", …)`), which
// is exactly what production did — and on corsearch the real cookie was not fake and not discarded.
// The mint takes no credential at all now; the executor is bound at each server, where the secret
// already lives. A fixture that still passed one would be pinning the removed parameter back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { mintSupplementalEntries, proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { PLAN_MAX_OR_WIDTH } from "../register-plan.mjs";

const tctx = { kind: "propose_supplemental", sessionKey: "run-x", agentId: "clawdi", sessionId: "s1" };

test("mintSupplementalEntries: deterministic qids, rejection matrix, caps, in-batch + existing dedup", () => {
  const good = { predicate: "exact", term: "FROSTBERRY", nice_classes: [32], rationale: "rare near-form seen in common-law" };
  const a = mintSupplementalEntries("primary-sweep", [good]);
  const b = mintSupplementalEntries("primary-sweep", [good]);
  assert.equal(a.minted.length, 1);
  assert.equal(a.minted[0].qid, b.minted[0].qid, "same proposal ⇒ same qid (retry-idempotent)");
  assert.match(a.minted[0].qid, /^supp:primary-sweep:exact:frostberry:[0-9a-f]{8}$/);
  assert.equal(a.minted[0].origin, "supplemental");
  assert.equal(a.minted[0].expected_kind, "enumerate");

  const { minted, reused, rejected } = mintSupplementalEntries("primary-sweep", [
    good,
    good,                                                            // in-batch duplicate → reused
    { predicate: "owner", term: "Xyience", nice_classes: ["32"] },   // owner sweep is legal
    { predicate: "teleport", term: "X", nice_classes: [32] },        // unknown predicate
    { predicate: "exact", term: "X", terms: ["Y"], nice_classes: [32] },  // term XOR terms
    { predicate: "exact", nice_classes: [32] },                      // neither
    { predicate: "exact", term: "X", nice_classes: [] },             // unscoped forbidden
    { predicate: "exact", terms: Array.from({ length: PLAN_MAX_OR_WIDTH + 1 }, (_, i) => `T${i}`), nice_classes: [32] },  // too wide
    { predicate: "exact", term: "X", nice_classes: [32], when: { runs_if_enumerated: "z" } },  // no guards
  ]);
  assert.equal(minted.length, 2, "the good + the owner sweep");
  assert.equal(reused.length, 1, "in-batch duplicate reused, never re-minted");
  assert.equal(rejected.length, 6);
  assert.ok(rejected.some((r) => /unknown predicate/.test(r.issue)));
  assert.ok(rejected.some((r) => /OR-stack .* exceeds/.test(r.issue)));
  assert.ok(rejected.some((r) => /nice_classes/.test(r.issue)));
  assert.ok(rejected.some((r) => /`when` guards/.test(r.issue)));

  // existing-qid dedup + axis cap
  const again = mintSupplementalEntries("primary-sweep", [good], { existingQids: new Set([a.minted[0].qid]) });
  assert.equal(again.minted.length, 0);
  assert.deepEqual(again.reused, [a.minted[0].qid]);
  const capped = mintSupplementalEntries("primary-sweep", [good], { axisMax: 3, existingCount: 3 });
  assert.equal(capped.minted.length, 0);
  assert.match(capped.rejected[0].issue, /per-axis cap 3/);
});

test("proposeSupplemental: persists the per-axis plan, executes via the injected executor, returns band-read results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supp-"));
  const bandPath = join(dir, "register-units", "primary-sweep-band.json");
  const calls = [];
  const executePlan = async (params) => {
    calls.push(params);
    // the real executor writes the band itself — the stub mirrors that contract
    const supp = JSON.parse(readFileSync(params.plan_path, "utf8"));
    const blocks = supp.entries.filter((e) => params.qids.includes(e.qid)).map((e) => ({
      state: "incomplete", qid: e.qid, query: `${e.predicate} ${e.term ?? (e.terms ?? []).join("|")}`,
      total_hits: 28001, fetched: 1, sample: [],
      reason: "count-first per-term rescue ran — a populated term is never recorded 0",
      term_counts: { FROSTBERRY: { total_hits: 1, disposition: "enumerated" }, ICEBERRY: { total_hits: 28000, disposition: "crowd" } },
      records: [{ record_id: "/mark/us/90491258", mark_text: "Xyience FROSTBERRY", classes: [32], status: "Registered", owner_name: "Xyience" }],
    }));
    writeFileSync(bandPath, JSON.stringify(blocks, null, 2));
    return { type: "text", text: JSON.stringify({ written: bandPath, blocks: blocks.length, executed: blocks.length }) };
  };
  const r = await proposeSupplemental({
    axis: "primary-sweep", output_path: bandPath,
    proposals: [{ predicate: "exact", terms: ["FROSTBERRY", "ICEBERRY"], nice_classes: [32], rationale: "near-form pair" }],
  }, tctx, { executePlan });
  const out = JSON.parse(r.text);
  assert.equal(out.minted.length, 1);
  assert.equal(out.executed, true);
  const suppPath = join(dir, "register-units", "primary-sweep-supplemental-plan.json");
  assert.ok(existsSync(suppPath), "the per-axis supplemental plan persisted");
  const supp = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.equal(supp.entries.length, 1);
  assert.equal(supp.entries[0].origin, "supplemental");
  assert.equal(calls[0].plan_path, suppPath, "the executor runs the SUPPLEMENTAL plan file, never the frozen shared plan");
  assert.deepEqual(calls[0].qids, [supp.entries[0].qid]);
  const res = out.results[supp.entries[0].qid];
  assert.equal(res.state, "incomplete");
  assert.equal(res.term_counts.FROSTBERRY.disposition, "enumerated", "per-term truth crosses back to the model");
  assert.equal(res.records_preview[0].record_id, "/mark/us/90491258", "the rare record is in the reasoning payload");

  // second call, same proposal: reused qid, still executed (refresh), no duplicate entry
  const r2 = await proposeSupplemental({
    axis: "primary-sweep", output_path: bandPath,
    proposals: [{ predicate: "exact", terms: ["FROSTBERRY", "ICEBERRY"], nice_classes: [32], rationale: "near-form pair" }],
  }, tctx, { executePlan });
  const out2 = JSON.parse(r2.text);
  assert.equal(out2.minted.length, 0);
  assert.equal(out2.reused.length, 1);
  assert.equal(JSON.parse(readFileSync(suppPath, "utf8")).entries.length, 1, "no duplicate entries on a re-propose");
});

test("proposeSupplemental: an executor error surfaces loudly — never a silent clean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supp-err-"));
  const bandPath = join(dir, "register-units", "primary-sweep-band.json");
  const r = await proposeSupplemental({
    axis: "primary-sweep", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "FROSTBERRY", nice_classes: [32] }],
  }, tctx, { executePlan: async () => ({ type: "text", text: "ERROR: provider 502" }) });
  const out = JSON.parse(r.text);
  assert.equal(out.executed, false);
  assert.match(out.error, /provider 502/);
});

test("pipeline fold: per-axis supplemental plans join the RUN plan (version bump, receipt supplemental[], store untouched)", async () => {
  const { foldSupplementalProposals, writePlanExecutionReceipt } = await import("../pipeline.mjs");
  const { joinPlanToBands } = await import("../register-plan.mjs");
  const { mkdirSync, writeFileSync: wf, readFileSync: rf, existsSync: ex } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "fold-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  const runPlan = { schema: "register-plan/1", plan_version: 3, derived_from: { job_key: "k", variants_fingerprint: "f" }, contract: { supplemental_lane: 1 },
    entries: [{ qid: "primary-sweep:exact:mark", axis: "primary-sweep", predicate: "exact", term: "MARK", nice_classes: ["32"], regions: [], expected_kind: "enumerate" }] };
  wf(driverDir(dir, "register-plan.json"), JSON.stringify(runPlan));
  wf(join(dir, "register-units", "primary-sweep-supplemental-plan.json"), JSON.stringify({
    schema: "register-plan/1", plan_version: 2, derived_from: { job_key: "supplemental:primary-sweep", variants_fingerprint: "supplemental" },
    entries: [{ qid: "supp:primary-sweep:exact:frostberry:abcd1234", axis: "primary-sweep", predicate: "exact", terms: ["FROSTBERRY", "ICEBERRY"], nice_classes: ["32"], regions: [], expected_kind: "enumerate", origin: "supplemental" }],
  }));
  const ctx = { registerPlan: runPlan, axes: ["primary-sweep"], paths: { runDir: dir, registerPlan: driverDir(dir, "register-plan.json"), planExecution: driverDir(dir, "plan-execution.json"), registerBand: (a) => join(dir, "register-units", `${a}-band.json`) } };
  const added = foldSupplementalProposals(ctx);
  assert.deepEqual(added, ["supp:primary-sweep:exact:frostberry:abcd1234"]);
  assert.equal(ctx.registerPlan.plan_version, 4, "fold bumps the version — the join receipt invalidates");
  assert.equal(ctx.registerPlan.derived_from.variants_fingerprint, "f", "a supplemental fold is not a manifest change");
  assert.equal(JSON.parse(rf(driverDir(dir, "register-plan.json"), "utf8")).plan_version, 4, "run plan persisted");
  // the receipt names the supplemental qids — the not-finished substrate covers them like dictated entries
  wf(ctx.paths.registerBand("primary-sweep"), JSON.stringify([
    { state: "enumerated", qid: "primary-sweep:exact:mark", query: "exact MARK", total_hits: 0, records: [] },
  ]));
  writePlanExecutionReceipt(ctx, joinPlanToBands(ctx.registerPlan, { "primary-sweep": JSON.parse(rf(ctx.paths.registerBand("primary-sweep"), "utf8")) }));
  const receipt = JSON.parse(rf(driverDir(dir, "plan-execution.json"), "utf8"));
  assert.deepEqual(receipt.supplemental, ["supp:primary-sweep:exact:frostberry:abcd1234"]);
  assert.deepEqual(receipt.missing, ["supp:primary-sweep:exact:frostberry:abcd1234"], "an unexecuted supplemental is MISSING — the dispatch/followup/StageFailure ladder owns it");
  assert.equal(receipt.skeleton.find((s) => s.axis === "primary-sweep").state, "unexecuted");
  // idempotent re-fold
  assert.deepEqual(foldSupplementalProposals(ctx), []);
  assert.equal(ctx.registerPlan.plan_version, 4);
});

// ---- PR-1 (A1/F1): the proposal seam — term-shape lint + the owner scope field ---------------------

test("mint (A1): term-shape/term-predicate lint at the proposal seam — the model gets the reason in-turn", () => {
  const { minted, rejected } = mintSupplementalEntries("primary-sweep", [
    { predicate: "exact", term: "TIKI*", nice_classes: [5] },                                       // wildcard under literal
    { predicate: "wildcard", term: "TIKI", nice_classes: [5] },                                     // star-less pattern
    { predicate: "exact", term: "Reverse-order TIKI composites (TROPICAL TIKI, ISLAND TIKI)", nice_classes: [5] },  // label
    { predicate: "default", term: "SLUSH FREEZE, SLUSH ICE, SLUSH POP", nice_classes: [32] },       // the prose family
    { predicate: "wildcard", term: "TIKI*", nice_classes: [5] },                                    // agreeing pair — minted
    { predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER", term_literal: true, nice_classes: [29] },  // escape hatch
    { predicate: "owner", term: "KESTREL BEVERAGES INC., SOCIÉTÉ ORGANISÉE SELON LES LOIS DE L'ETAT DU DELAWARE", nice_classes: [32] },  // owner names exempt
  ]);
  assert.equal(rejected.length, 4);
  assert.match(rejected[0].issue, /false clean/i);
  assert.match(rejected[1].issue, /neither `\*` nor `\?`/);
  assert.match(rejected[2].issue, /label\/prose-shaped/);
  assert.match(rejected[3].issue, /label\/prose-shaped/);
  assert.equal(minted.length, 3);
  assert.equal(minted[1].term_literal, true, "the escape hatch persists onto the entry (the executor honours it too)");
});

test("mint (F1): the owner scope field — accepted on a mark-text proposal, part of the qid identity, refused on predicate:owner", () => {
  const base = { predicate: "default", term: "TIKI", nice_classes: [32] };
  const plain = mintSupplementalEntries("primary-sweep", [base]);
  const scoped = mintSupplementalEntries("primary-sweep", [{ ...base, owner: "Kestrel Beverages Inc." }]);
  assert.equal(scoped.minted.length, 1);
  assert.equal(scoped.minted[0].owner, "Kestrel Beverages Inc.");
  assert.notEqual(scoped.minted[0].qid, plain.minted[0].qid, "a different owner scope is a different slice — different qid");
  // re-proposing the same owner×term slice reuses, never duplicates
  const again = mintSupplementalEntries("primary-sweep", [{ ...base, owner: "Kestrel Beverages Inc." }], { existingQids: new Set([scoped.minted[0].qid]) });
  assert.deepEqual(again.reused, [scoped.minted[0].qid]);
  // predicate:"owner" carries the owner name AS its term — an owner field on top is refused, not guessed about
  const dbl = mintSupplementalEntries("primary-sweep", [{ predicate: "owner", term: "Kestrel Beverages Inc.", owner: "Kestrel Beverages Inc.", nice_classes: [32] }]);
  assert.equal(dbl.minted.length, 0);
  assert.match(dbl.rejected[0].issue, /rides a MARK-TEXT predicate/);
  const empty = mintSupplementalEntries("primary-sweep", [{ ...base, owner: "  " }]);
  assert.match(empty.rejected[0].issue, /non-empty string/);
});

test("mint (F1): owner×term on a provider WITHOUT the intersection is minted UNSUPPORTED — a disclosed deferred row, never an owner-less sweep", () => {
  const p = { predicate: "default", term: "TIKI", owner: "Kestrel Beverages Inc.", nice_classes: [32] };
  const thin = mintSupplementalEntries("primary-sweep", [p], { capabilities: { id: "signa", ownerTermIntersection: false } });
  assert.equal(thin.minted.length, 1, "the gap belongs ON the record, so it mints");
  assert.equal(thin.minted[0].unsupported, true);
  assert.match(thin.minted[0].unsupported_reason, /owner×term intersection is not supported .*signa/);
  const able = mintSupplementalEntries("primary-sweep", [p], { capabilities: { id: "corsearch", ownerTermIntersection: true } });
  assert.equal(able.minted[0].unsupported, undefined);
  // a BARE owner sweep is untouched by the intersection capability (its own predicate gap governs it)
  const bare = mintSupplementalEntries("primary-sweep", [{ predicate: "owner", term: "Kestrel Beverages Inc.", nice_classes: [32] }],
    { capabilities: { id: "signa", ownerTermIntersection: false } });
  assert.equal(bare.minted[0].unsupported, undefined);
});

// ── PR-6 (C3): the Cl.30 SLUSH cap-ordering fix + persisted rejections ─────────────────────────────
test("C3 mint: priorityClasses stable-sorts the batch before budget assignment — priority proposals win the cap; values unchanged; no-priority order is byte-identical", () => {
  const prop = (term, cls) => ({ predicate: "exact", term, nice_classes: cls });
  const batch = [prop("ALPHA", [30]), prop("BRAVO", [5]), prop("CHARLIE", [30]), prop("DELTA", [32]), prop("ECHO", [30])];
  // axis budget of 2: WITHOUT priority the first two proposals (30, 5) take it…
  const plain = mintSupplementalEntries("primary-sweep", batch, { axisMax: 2 });
  assert.deepEqual(plain.minted.map((e) => e.term), ["ALPHA", "BRAVO"]);
  // …WITH the matter's classes as priority, the in-scope pair wins the SAME cap, in original order.
  const prio = mintSupplementalEntries("primary-sweep", batch, { axisMax: 2, priorityClasses: ["5", "32"] });
  assert.deepEqual(prio.minted.map((e) => e.term), ["BRAVO", "DELTA"], "priority-class proposals get budget first, stable order kept");
  assert.equal(prio.rejected.length, 3, "the cap VALUE did not move — ordering did");
  assert.ok(prio.rejected.every((r) => /per-axis cap 2/.test(r.issue)));
  // rejection rows keep the ORIGINAL proposal index + a compact proposal copy (the ask ledger's substrate)
  const rejectedIdx = prio.rejected.map((r) => r.index).sort();
  assert.deepEqual(rejectedIdx, [0, 2, 4], "index refers to the caller's batch positions, not the sorted ones");
  assert.ok(prio.rejected.every((r) => r.proposal && r.proposal.term && r.proposal.nice_classes), "every rejection carries what was asked");
});

test("PR-6 mint: every rejection row carries a compact proposal copy", () => {
  const { rejected } = mintSupplementalEntries("primary-sweep", [
    { predicate: "teleport", term: "X", nice_classes: [32] },
    { predicate: "exact", term: "GLIMMER*", nice_classes: [32], owner: "Aurora Beverages" },
  ]);
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected[0].proposal, { predicate: "teleport", term: "X", nice_classes: ["32"] });
  assert.equal(rejected[1].proposal.owner, "Aurora Beverages");
});

test("PR-6 proposeSupplemental: rejected proposals PERSIST to the sidecar's rejected[] (they used to live only in the tool response)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "supp-rej-"));
  const bandPath = join(dir, "register-units", "primary-sweep-band.json");
  const executePlan = async () => ({ type: "text", text: JSON.stringify({ executed: 0 }) });
  // a rejected-ONLY call must still persist (nothing minted, but the question must not evaporate)
  const r = await proposeSupplemental({
    axis: "primary-sweep", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "Reverse-order GLIMMER composites (POLAR GLIMMER, ICE GLIMMER)", nice_classes: [32] }],
  }, tctx, { executePlan });
  const out = JSON.parse(r.text);
  assert.equal(out.minted.length, 0);
  assert.equal(out.rejected.length, 1);
  const suppPath = join(dir, "register-units", "primary-sweep-supplemental-plan.json");
  assert.ok(existsSync(suppPath), "the sidecar exists even though nothing minted");
  const supp = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.equal(supp.entries.length, 0);
  assert.equal(supp.rejected.length, 1);
  assert.equal(supp.rejected[0].origin, "propose-tool");
  assert.match(supp.rejected[0].issue, /label|prose/i);
  assert.match(supp.rejected[0].proposal.term, /Reverse-order GLIMMER/);
  // append-only: a second rejected call adds a row, never rewrites
  await proposeSupplemental({
    axis: "primary-sweep", output_path: bandPath,
    proposals: [{ predicate: "teleport", term: "X", nice_classes: [32] }],
  }, tctx, { executePlan });
  assert.equal(JSON.parse(readFileSync(suppPath, "utf8")).rejected.length, 2);
});

// ---- 2026-07-30 review round: the supplemental lane gets its romanisation INVITATION ---------------
// Half the live incident's non-Latin deferrals (12 of 25) were supp: entries, and the guard's own
// remediation ("supply the romanisation on the entry's romanizedTerms") pointed at a field the
// proposing surface could not set — enforcement without invitation. The proposal now carries it.

test("mint: romanization threads to romanizedTerms; orphans, OR-stacks, owner sweeps and non-ASCII forms are rejected in-turn", () => {
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", term: "ティキスラッシュ", nice_classes: [30], romanization: "TIKI SURASSHU" },
    { predicate: "exact", term: "FROSTBERRY", nice_classes: [32], romanization: "FROSTBERRY" },      // orphan: already Latin
    { predicate: "exact", terms: ["冰沙", "沙冰"], nice_classes: [30], romanization: "BING SHA" },    // OR-stack never substitutes
    { predicate: "owner", term: "冰沙公司", nice_classes: [30], romanization: "BING SHA GONG SI" },   // owner names ride their own rules
    { predicate: "exact", term: "华威豹", nice_classes: [30], romanization: "HUÁ WĒI BÀO" },          // tone marks are not a romanisation
  ]);
  assert.equal(minted.length, 1, "only the well-formed pair mints");
  assert.deepEqual(minted[0].romanizedTerms, ["TIKI SURASSHU", "TIKISURASSHU"],
    "both spellings, from the SAME shared helper the dictated plan uses (script-form.mjs)");
  assert.equal(minted[0].term, "ティキスラッシュ", "the native characters stay the searched term");
  assert.equal(rejected.length, 4);
  assert.ok(rejected.some((r) => /already Latin script/.test(r.issue)), "orphan");
  assert.ok(rejected.some((r) => /OR-stack proposal cannot carry a romanization/.test(r.issue)), "or-stack");
  assert.ok(rejected.some((r) => /owner sweep/.test(r.issue)), "owner");
  assert.ok(rejected.some((r) => /not plain ASCII/.test(r.issue)), "tone marks");
  // With NO capability contract in hand the mint has nothing deterministic to screen against, so a
  // bare non-Latin proposal still mints and the executor's own guard decides — unchanged.
  const bare = mintSupplementalEntries("transliteration-numeric", [{ predicate: "exact", term: "冰沙", nice_classes: [30] }]);
  assert.equal(bare.minted.length, 1);
  assert.ok(!("romanizedTerms" in bare.minted[0]));
});

// ---- A5 (addendum 2026-07-30): screen the proposal against the test that produced the deferral -----
// The corrective cycle spent 277s proposing six queries that deferred for the identical reason the
// deferral they were answering had. The refusal is deterministic and client-side, so the mint runs it
// one seam earlier and the answer comes back IN-TURN, naming the field gave this surface.

test("A5: on a transliteration-indexed provider a bare non-Latin proposal is refused AT THE MINT, with the remedy named", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", term: "冰沙", nice_classes: [30] },
  ], { capabilities: caps });
  assert.equal(minted.length, 0, "no dead qid is minted — the deferral it would produce is already on the record");
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].issue, /indexes\s+non-Latin filings by their TRANSLITERATION/i, "the executor's own reason, verbatim");
  assert.match(rejected[0].issue, /"romanization" field and re-propose/, "the remedy names the field this surface can actually set");
  assert.deepEqual(rejected[0].proposal.terms ?? [rejected[0].proposal.term], ["冰沙"], "the question is preserved in the sidecar, never evaporated");
});

test("A5: screen FIRST, then enrich — the same proposal WITH the romanisation mints and keeps the rescue path", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", term: "冰沙", nice_classes: [30], romanization: "BING SHA" },
  ], { capabilities: caps });
  assert.equal(rejected.length, 0);
  assert.equal(minted.length, 1);
  assert.deepEqual(minted[0].romanizedTerms, ["BING SHA", "BINGSHA"]);
  assert.equal(minted[0].term, "冰沙", "the native characters stay the searched term — the provider substitutes");
});

test("A5: a provider that really indexes characters screens NOTHING — the gap is capability-declared, never a vendor rule", () => {
  const caps = { id: "test-native-index", nativeScriptIndex: true };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", term: "冰沙", nice_classes: [30] },
  ], { capabilities: caps });
  assert.equal(rejected.length, 0);
  assert.equal(minted.length, 1, "banning native script here would destroy real coverage");
});

// FINDING 2 (2026-07-31 review round) — the A5 remedy must be FOLLOWABLE. "Supply it as this
// proposal's `romanization` field and re-propose" is a dead end on an OR-stack: the romanization
// guard refuses a `terms` proposal outright, so a model doing exactly what it was told earns a
// second, guaranteed rejection — and on a MIXED stack the Latin members the provider would have
// answered are lost with it. The stack gets the split remedy directly.
test("A5: a MIXED OR-stack gets the SPLIT remedy — not the romanization field the next guard refuses", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", terms: ["ALPHAMARK", "BETAMARK", "冰沙"], nice_classes: [30] },
  ], { capabilities: caps });
  assert.equal(minted.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].issue, /SPLIT it instead/, "the instruction is the split, not the field that cannot be set");
  assert.match(rejected[0].issue, /\["ALPHAMARK","BETAMARK"\]/, "the Latin members the provider WOULD answer are named, so they are not lost");
  assert.match(rejected[0].issue, /"冰沙"[\s\S]*single-term entry carrying the "romanization" field/, "and the non-Latin member's own entry is named");
  assert.doesNotMatch(rejected[0].issue, /Supply it as this proposal's "romanization" field/,
    "the dead-end instruction is exactly what this replaces on a stack");
});

test("A5: FOLLOWING the split remedy mints both halves — one corrected re-proposal, zero rejections", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", terms: ["ALPHAMARK", "BETAMARK"], nice_classes: [30] },
    { predicate: "exact", term: "冰沙", romanization: "BING SHA", nice_classes: [30] },
  ], { capabilities: caps });
  assert.deepEqual(rejected.map((r) => r.issue), [], "the remedy the model was handed is the remedy that works");
  assert.equal(minted.length, 2);
  assert.deepEqual(minted[0].terms, ["ALPHAMARK", "BETAMARK"]);
  assert.deepEqual(minted[1].romanizedTerms, ["BING SHA", "BINGSHA"]);
});

test("A5: an ALL-non-Latin stack still gets the split, without inventing Latin members to keep", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "exact", terms: ["冰沙", "沙冰"], nice_classes: [30] },
  ], { capabilities: caps });
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].issue, /their own single-term entries/, "plural — both members need their own entry");
  assert.doesNotMatch(rejected[0].issue, /keep \[/, "there is nothing to keep as a stack, so nothing is claimed to be");
});

test("A5: owner names ride their own rules — a non-Latin OWNER sweep is never screened as mark text", () => {
  const caps = { id: "test-translit-index", nativeScriptIndex: false };
  const { minted, rejected } = mintSupplementalEntries("transliteration-numeric", [
    { predicate: "owner", term: "冰沙公司", nice_classes: [30] },
  ], { capabilities: caps });
  assert.equal(rejected.length, 0, "queryMarkTerms exempts owner slices at the executor; the mint matches it");
  assert.equal(minted.length, 1);
});

test("mint: the qid ignores the romanization — re-proposing a stored bare qid WITH it ENRICHES instead of duplicating", () => {
  const bareP = { predicate: "exact", term: "ティキスラッシュ", nice_classes: [30] };
  const a = mintSupplementalEntries("transliteration-numeric", [bareP]);
  const b = mintSupplementalEntries("transliteration-numeric", [{ ...bareP, romanization: "TIKI SURASSHU" }]);
  assert.equal(a.minted[0].qid, b.minted[0].qid, "carriage is not a different question — same qid either way");
  const again = mintSupplementalEntries("transliteration-numeric", [{ ...bareP, romanization: "TIKI SURASSHU" }],
    { existingQids: new Set([a.minted[0].qid]) });
  assert.equal(again.minted.length, 0);
  assert.deepEqual(again.reused, [a.minted[0].qid]);
  assert.deepEqual(again.enriched, [{ qid: a.minted[0].qid, term: "ティキスラッシュ", romanizedTerms: ["TIKI SURASSHU", "TIKISURASSHU"] }]);
});

test("proposeSupplemental: the natural retry — re-proposing WITH the romanization — persists the enrichment and re-executes the slice", async () => {
  const { mkdirSync: mkd } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "supp-rom-"));
  const bandPath = join(dir, "register-units", "transliteration-numeric-band.json");
  const executePlan = async (params) => {
    const supp = JSON.parse(readFileSync(params.plan_path, "utf8"));
    const blocks = supp.entries.filter((e) => params.qids.includes(e.qid)).map((e) => ({
      qid: e.qid, state: "enumerated", query: `${e.predicate} ${e.term}`, total_hits: 1, records: [] }));
    mkd(join(dir, "register-units"), { recursive: true });
    writeFileSync(bandPath, JSON.stringify(blocks, null, 2));
    return { type: "text", text: JSON.stringify({ written: bandPath, blocks: blocks.length }) };
  };
  const p1 = await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "ティキスラッシュ", nice_classes: [30] }] }, tctx, { executePlan });
  const first = JSON.parse(p1.text);
  assert.equal(first.minted.length, 1);
  const suppPath = join(dir, "register-units", "transliteration-numeric-supplemental-plan.json");
  let doc = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.ok(!("romanizedTerms" in doc.entries[0]), "the first, bare proposal persisted bare");

  const p2 = await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "ティキスラッシュ", nice_classes: [30], romanization: "TIKI SURASSHU" }] }, tctx, { executePlan });
  const second = JSON.parse(p2.text);
  assert.deepEqual(second.minted, [], "no duplicate qid");
  assert.deepEqual(second.enriched, [doc.entries[0].qid], "the response names the enrichment");
  assert.equal(second.executed, true, "the reused qid re-executes — now answerable");
  doc = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.equal(doc.entries.length, 1, "still one entry");
  assert.deepEqual(doc.entries[0].romanizedTerms, ["TIKI SURASSHU", "TIKISURASSHU"],
    "the persisted entry carries the field the executor threads to romanized_names");
  // additive only: a third call with a DIFFERENT romanisation never re-rolls the stored one
  await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "ティキスラッシュ", nice_classes: [30], romanization: "DIKI SURASSHU" }] }, tctx, { executePlan });
  assert.deepEqual(JSON.parse(readFileSync(suppPath, "utf8")).entries[0].romanizedTerms, ["TIKI SURASSHU", "TIKISURASSHU"]);
});

// ── post-merge audit 2 (b): a corrected romanisation on a reused qid — monotone, but never silent ───
// The audit's exact two-call repro: the model minted a term with the WRONG Latin form first
// ("HUA WEI BOA"), then re-proposed the correction ("HUA WEI BAO"). The stored form must stay (a tool
// response never re-rolls a frozen carriage — recall stays monotone), but the old code swallowed the
// correction with a bare `continue`: the response said only `reused`, the wrong spelling kept
// executing, and no surface for the rest of the run recorded that the model now dictates another
// form. The disagreement now rides the response (`conflict[]`) and persists in the sidecar
// (conflicts[], append-only beside rejected[]).
test("audit 2 (b): HUA WEI BOA then HUA WEI BAO — stored form kept, conflict surfaced in response AND sidecar", async () => {
  const { mkdirSync: mkd } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "supp-conf-"));
  const bandPath = join(dir, "register-units", "transliteration-numeric-band.json");
  const executePlan = async (params) => {
    const supp = JSON.parse(readFileSync(params.plan_path, "utf8"));
    const blocks = supp.entries.filter((e) => params.qids.includes(e.qid)).map((e) => ({
      qid: e.qid, state: "enumerated", query: `${e.predicate} ${e.term}`, total_hits: 1, records: [] }));
    mkd(join(dir, "register-units"), { recursive: true });
    writeFileSync(bandPath, JSON.stringify(blocks, null, 2));
    return { type: "text", text: JSON.stringify({ written: bandPath, blocks: blocks.length }) };
  };
  const p1 = await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "华威豹", nice_classes: [32], romanization: "HUA WEI BOA" }] }, tctx, { executePlan });
  const first = JSON.parse(p1.text);
  assert.equal(first.minted.length, 1);
  assert.ok(!("conflict" in first), "the first call has nothing to disagree with");
  const suppPath = join(dir, "register-units", "transliteration-numeric-supplemental-plan.json");

  const p2 = await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "华威豹", nice_classes: [32], romanization: "HUA WEI BAO" }] }, tctx, { executePlan });
  const second = JSON.parse(p2.text);
  assert.deepEqual(second.reused, [first.minted[0]], "same question ⇒ same qid, reused");
  assert.deepEqual(second.conflict, [{ qid: first.minted[0],
    stored: ["HUA WEI BOA", "HUAWEIBOA"], proposed: ["HUA WEI BAO", "HUAWEIBAO"] }],
    "the response carries the disagreement beside reused/enriched/rejected");
  let doc = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.deepEqual(doc.entries[0].romanizedTerms, ["HUA WEI BOA", "HUAWEIBOA"], "the stored form is never re-rolled");
  assert.equal(doc.conflicts.length, 1, "the sidecar persists the note — the wrong-form substitution is visible for the rest of the run");
  assert.equal(doc.conflicts[0].qid, first.minted[0]);
  assert.deepEqual(doc.conflicts[0].stored, ["HUA WEI BOA", "HUAWEIBOA"]);
  assert.deepEqual(doc.conflicts[0].proposed, ["HUA WEI BAO", "HUAWEIBAO"]);
  assert.ok(doc.conflicts[0].ts, "append-only rows are timestamped, like rejected[]");

  // an IDENTICAL re-proposal is agreement, not conflict — and the sidecar does not grow
  const p3 = await proposeSupplemental({ axis: "transliteration-numeric", output_path: bandPath,
    proposals: [{ predicate: "exact", term: "华威豹", nice_classes: [32], romanization: "HUA WEI BOA" }] }, tctx, { executePlan });
  assert.ok(!("conflict" in JSON.parse(p3.text)));
  assert.equal(JSON.parse(readFileSync(suppPath, "utf8")).conflicts.length, 1);
});

// ──: the driver-side screen closes the model-settable `term_literal` path ─────────────────────
test("#516 pipeline fold: a model-shielded markup entry is REFUSED at the fold and lands in rejected[]", async () => {
  // `term_literal` is a field the MODEL fills in on a proposal. It used to suppress every term rule,
  // including at the executor, which runs the same walk — so a `**`-wrapped term wearing it passed the
  // mint, was persisted to this sidecar, folded into the run plan unexamined, and dispatched. It came
  // back total_hits:0, state:"enumerated": a false clean, and QUIETER than the run that died at fan-in.
  const { foldSupplementalProposals } = await import("../pipeline.mjs");
  const { mkdirSync, writeFileSync: wf, readFileSync: rf } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "fold-516-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  const runPlan = { schema: "register-plan/1", plan_version: 3, derived_from: { job_key: "k", variants_fingerprint: "f" },
    contract: { supplemental_lane: 1 }, entries: [] };
  wf(driverDir(dir, "register-plan.json"), JSON.stringify(runPlan));
  const suppPath = join(dir, "register-units", "primary-sweep-supplemental-plan.json");
  wf(suppPath, JSON.stringify({ schema: "register-plan/1", plan_version: 2,
    derived_from: { job_key: "supplemental:primary-sweep", variants_fingerprint: "supplemental" },
    entries: [
      { qid: "supp:primary-sweep:exact:core:aaaa1111", axis: "primary-sweep", predicate: "exact",
        term: "**BIOVELTRIN**", term_literal: true, nice_classes: ["9"], regions: [], expected_kind: "enumerate", origin: "supplemental" },
      { qid: "supp:primary-sweep:exact:biodelfis:bbbb2222", axis: "primary-sweep", predicate: "exact",
        term: "BIOVELTRYN", nice_classes: ["9"], regions: [], expected_kind: "enumerate", origin: "supplemental" },
    ] }));
  const ctx = { registerPlan: runPlan, axes: ["primary-sweep"], paths: { runDir: dir,
    registerPlan: driverDir(dir, "register-plan.json"), planExecution: driverDir(dir, "plan-execution.json"),
    registerBand: (a) => join(dir, "register-units", `${a}-band.json`) } };

  const added = foldSupplementalProposals(ctx);
  assert.deepEqual(added, ["supp:primary-sweep:exact:biodelfis:bbbb2222"], "the clean proposal still folds");
  const persisted = JSON.parse(rf(driverDir(dir, "register-plan.json"), "utf8"));
  assert.ok(!persisted.entries.some((e) => e.term === "**BIOVELTRIN**"),
    "the shielded entry never reaches the plan, so nothing dispatches it");
  // and the refusal is written where the authoring stage already reads its rejects
  const sidecar = JSON.parse(rf(suppPath, "utf8"));
  assert.equal(sidecar.rejected.length, 1);
  assert.equal(sidecar.rejected[0].origin, "supplemental-fold");
  assert.equal(sidecar.rejected[0].proposal.term, "**BIOVELTRIN**");
  assert.match(sidecar.rejected[0].issue, /markdown emphasis/);
});

// ──: the receipt distinguishes "owns a block" from "answered" ────────────────────────────────
//
// `joinPlanToBands` pushes to `executed` any block that is neither error nor deferred, carrying its
// `state` through. A delivered run's receipt (2026-08-15) opened with
// `{"qid":"…","state":"incomplete"}` inside `executed`, reported `executed: 146, missing: []`, and a
// reader had to open the band files to learn that 45 of 161 blocks were incomplete.
test("#960: plan-execution.json states `answered` and `incomplete`, not just `executed`", async () => {
  const { writePlanExecutionReceipt } = await import("../pipeline.mjs");
  const { joinPlanToBands } = await import("../register-plan.mjs");
  const { mkdirSync, writeFileSync: wf, readFileSync: rf } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "answered-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  mkdirSync(driverDir(dir), { recursive: true });
  const plan = { schema: "register-plan/1", plan_version: 1, derived_from: { job_key: "k", variants_fingerprint: "f" }, entries: [
    { qid: "primary-sweep:exact:a", axis: "primary-sweep", predicate: "exact", term: "A", nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
    { qid: "primary-sweep:exact:b", axis: "primary-sweep", predicate: "exact", term: "B", nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
    { qid: "primary-sweep:exact:c", axis: "primary-sweep", predicate: "exact", term: "C", nice_classes: ["9"], regions: [], expected_kind: "enumerate" },
  ] };
  const ctx = { registerPlan: plan, axes: ["primary-sweep"], paths: { runDir: dir, registerPlan: driverDir(dir, "register-plan.json"),
    planExecution: driverDir(dir, "plan-execution.json"), registerBand: (a) => join(dir, "register-units", `${a}-band.json`) } };
  const blocks = [
    { state: "enumerated", qid: "primary-sweep:exact:a", records: [] },
    // A CROWD: a legitimate, disclosed non-answer. It belongs in `executed` and must not be counted answered.
    { state: "incomplete", qid: "primary-sweep:exact:b", reason: "total_hits 1022 exceeds the enumerate ceiling 600 — this is a CROWD" },
    { state: "enumerated", qid: "primary-sweep:exact:c", records: [] },
  ];
  wf(ctx.paths.registerBand("primary-sweep"), JSON.stringify(blocks));
  writePlanExecutionReceipt(ctx, joinPlanToBands(plan, { "primary-sweep": blocks }));
  const receipt = JSON.parse(rf(driverDir(dir, "plan-execution.json"), "utf8"));

  assert.equal(receipt.executed.length, 3, "all three own a block — unchanged");
  assert.deepEqual(receipt.missing, [], "…and nothing is missing — which is what used to read as 'the plan ran'");
  assert.equal(receipt.answered, 2, "but only two were ANSWERED");
  assert.equal(receipt.incomplete, 1, "and the crowd is stated, not left to subtraction");
  // The regression in one line: missing:[] must no longer be readable as "nothing outstanding".
  assert.notEqual(receipt.answered, receipt.executed.length,
    "a receipt whose answered equals executed over an incomplete block is the defect this closes");
});
