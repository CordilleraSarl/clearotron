// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-wider-families-wait-on-the-identical-question.test.mjs — the crowded-field design.
//
// MEASURED ON A DENSE MATTER. The identical mark in the instructed classes came back as a COUNT and not
// a list: 1,289 live records against a 600 fetch ceiling, nine forms of the question, no records
// released. The run then read 4,805 records from 139 OTHER questions — class slices, compounds, script
// and digit forms, a 117-term neighbour list — while the one question that matters went unread.
// Seventeen identical-mark records reached the band, every one through a side door.
//
// So the wider families now WAIT on that question, and the reading turn is given a lever to narrow it:
// the same question limited to the client's goods words. This arm holds the three pieces that make
// that possible, because each of them was individually absent and the design would have been inert
// with any one of them missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, entryQuestionKey, foldSupplementalEntries } from "../register-plan.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";
import { defaultBuildEntryQuery, planPredicateParams } from "../../providers/_shared/execute-plan.mjs";
import { buildSearchRequest, GOODS_FIELD } from "../../providers/clarivate/src/core.js";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const MARK = "INVENTEDMARK";
const manifest = (extra = {}) => ({
  schema_version: 1, mark: MARK, dominant_element: MARK,
  elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: `${MARK}LY`, category: "composite" },
    { value: "インベンテッド", category: "transliteration", romanization: "INBENTEDDO" }],
  incumbent_classes: [], ...extra,
});
const JOB = { jobKey: "t", classes: ["9"], jurisdictions: [] };
const planFor = (extra) => compileRegisterPlan({ manifest: manifest(extra), job: JOB, capabilities: CLARIVATE });

test("only the identical question and the saturation probe run without waiting", () => {
  const plan = planFor();
  const open = plan.entries.filter((e) => !e.when);
  const waiting = plan.entries.filter((e) => e.when);
  assert.ok(waiting.length > 0, "nothing waits — the gate did not apply");
  for (const e of open) {
    const ok = e.axis === "saturation-probe" || e.predicate !== "default" || e.unsupported === true
      || (Array.isArray(e.goods_text) && e.goods_text.length);
    assert.ok(ok, `${e.axis}/${e.predicate} runs in the same breath as a crowded identical question`);
  }
  // …and every waiting family names the identical question, not something else.
  const identical = open.find((e) => e.axis === "primary-sweep" && e.predicate !== "default");
  assert.ok(identical, "the identical question is not among the entries that run first");
  for (const e of waiting) {
    assert.equal(typeof e.when.runs_if_enumerated, "string");
  }
});

test("the goods-narrowed contains entry is always on, and never waits", () => {
  const plan = planFor({ goods_words: ["headphones"] });
  const narrowed = plan.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);
  assert.equal(narrowed.length, 1, "the goods-narrowed entry did not compile");
  assert.equal(narrowed[0].when, undefined,
    "the one entry that makes a crowded identical question answerable was made to wait for it");
});

test("an unsupported entry does not wait — a disclosure is not a search", () => {
  // Gating it would turn a `deferred` row (this was not searchable) into a `skipped` one (nothing on
  // the axis ran), which says something different about why a territory went unread. It costs no
  // reading, so there is nothing for the gate to save.
  const plan = compileRegisterPlan({ manifest: manifest(), job: JOB,
    capabilities: { ...CLARIVATE, predicates: { ...CLARIVATE.predicates, phonetic: null } } });
  for (const e of plan.entries.filter((x) => x.unsupported === true)) {
    assert.equal(e.when, undefined, `an unsupported slice was made to wait: ${e.qid}`);
  }
});

test("a goods-narrowed re-ask of the identical mark is a DIFFERENT question, and survives the fold", () => {
  // THE TWO LINKS THAT WOULD HAVE MADE THE DESIGN INERT, and both were absent. The first move against a
  // crowded identical question is to re-ask THAT question limited to the client's goods words: same
  // axis, same predicate, same term, same classes, same scope. If the goods are not part of the
  // question's identity, the fold reads the narrowing as the crowd it is replacing and refuses it as a
  // duplicate — the lever sits in the schema, the manual and the model's proposal, and nothing runs.
  const plan = planFor();
  const crowd = { predicate: "exact", term: MARK, nice_classes: [9], regions: ["US"], rationale: "the identical mark" };
  const narrowed = { ...crowd, goods_words: ["headphones", "wireless headphones"] };

  const minted = mintSupplementalEntries("primary-sweep", [crowd, narrowed], { capabilities: CLARIVATE });
  assert.equal(minted.rejected.length, 0, `a proposal was rejected: ${JSON.stringify(minted.rejected[0] ?? {})}`);
  assert.equal(minted.minted.length, 2, "the narrowed re-ask reused the crowd's entry instead of minting its own");
  const [a, b] = minted.minted;
  assert.notEqual(a.qid, b.qid, "the narrowing minted the crowd's own qid — it would read as a re-proposal");
  assert.deepEqual(b.goods_text, ["headphones", "wireless headphones"], "the goods did not reach the entry");

  // …and the two are different questions to the FOLD, which is what lets the narrowing be added at all.
  assert.notEqual(entryQuestionKey(a, plan), entryQuestionKey(b, plan),
    "the fold reads the narrowing as the question it is narrowing — it would be refused as a duplicate");
  const folded = foldSupplementalEntries(plan, minted.minted);
  assert.equal(folded.added.length, 2, `the fold refused one: ${JSON.stringify(folded.refused)}`);
});

test("the narrowed re-ask reaches the register as the goods clause it asked for", () => {
  const minted = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: [9], regions: ["US"], goods_words: ["headphones", "wireless headphones"] }],
    { capabilities: CLARIVATE });
  const entry = minted.minted[0];
  const query = defaultBuildEntryQuery(entry, planPredicateParams(entry));
  const wire = buildSearchRequest({ ...query, name: MARK, regions: ["US"] })
    .searchFields.find((f) => f.name === GOODS_FIELD).value;
  assert.equal(wire, "headphones OR wireless ADJ headphones");
});

test("a goods narrowing is refused where it would mean nothing", () => {
  const bad = (p) => mintSupplementalEntries("primary-sweep", [{ predicate: "exact", term: MARK, nice_classes: [9], regions: ["US"], ...p }],
    { capabilities: CLARIVATE });
  assert.equal(bad({ goods_words: ["head*"] }).minted.length, 0, "a wildcard goods word was accepted");
  assert.equal(bad({ goods_words: [] }).minted.length, 0, "an empty goods list was accepted as a narrowing");
  // On an owner sweep the owner name IS the term; there is no mark text for goods to narrow.
  assert.equal(mintSupplementalEntries("incumbent-class",
    [{ predicate: "owner", term: "An Owner", nice_classes: [9], regions: ["US"], goods_words: ["headphones"] }],
    { capabilities: CLARIVATE }).minted.length, 0, "goods narrowed an owner sweep");
});

test("the manual tells the model the order of moves, in the shipping tree", () => {
  for (const f of ["SKILL.md", "unit.md"]) {
    const manual = readFileSync(join(ROOT, "driver", "skills", "clearance-register", f), "utf8");
    assert.match(manual, /Look at the count before you read anything/, `${f} does not carry the crowd-narrow doctrine`);
    assert.match(manual, /limited to the client's goods words/, `${f} does not state the first move`);
    assert.match(manual, /one question per market/, `${f} does not state the second move`);
    assert.match(manual, /the crowd it\s+replaces stays on the record with its count/,
      `${f} does not say a narrowing replaces nothing silently`);
  }
});

test("a clean zero releases the families — a fully resolved stack is a complete band", async () => {
  // THE REGRESSION THIS DESIGN NEARLY SHIPPED, and the first fix for it was inert. `verified-zero` is a
  // per-term DISPOSITION, never a band state (named-band.mjs BAND_STATES is enumerated | incomplete),
  // so a guard testing the parent for it could never fire. The ordinary search path already returns
  // `enumerated` for a zero-record answer, and that has always released the children.
  //
  // The real case is the RESCUE paths. A per-term or per-class stack in which every member came back a
  // verified zero has nothing unresolved and no records, and it was falling through to `incomplete` —
  // which says nobody answered the question. With the wider families waiting on the identical question
  // that is the best case a matter can have, a mark NOBODY HAS REGISTERED, producing a run that
  // searches almost nothing.
  const src = readFileSync(join(ROOT, "providers", "_shared", "enumerate.mjs"), "utf8");
  assert.doesNotMatch(src, /unresolved === 0 && records\.length > 0/,
    "a fully resolved stack with no records still falls through to incomplete — a clean zero reads as unanswered");
  assert.equal((src.match(/if \(unresolved === 0\) \{/g) ?? []).length, 2,
    "both rescue paths must treat a fully resolved stack as a complete band");

  // …and the guard itself releases on the state a parent can actually hold.
  const { joinPlanToBands, deriveCoverageSkeleton } = await import("../register-plan.mjs");
  const plan = planFor();
  const identical = plan.entries.find((e) => !e.when && e.axis === "primary-sweep" && e.predicate !== "default");
  for (const [parentState, released] of [["enumerated", true], ["incomplete", false]]) {
    const blocks = {};
    for (const e of plan.entries) {
      (blocks[e.axis] ??= []).push({ qid: e.qid, total_hits: 0, records: [],
        state: e.qid === identical.qid ? parentState : "enumerated" });
    }
    const join = joinPlanToBands(plan, blocks);
    const waited = plan.entries.filter((e) => e.when?.runs_if_enumerated === identical.qid);
    const skippedQids = new Set(join.skipped.map((x) => x.qid));
    assert.equal(!waited.some((e) => skippedQids.has(e.qid)), released,
      `a ${parentState} identical question ${released ? "must release" : "must hold"} the waiting families`);
    if (released) {
      const axis = deriveCoverageSkeleton(plan, join).find((a) => a.axis === "primary-sweep");
      assert.notEqual(axis.state, "skipped", "an answered parent left the axis reading skipped");
    }
  }
});

test("a withheld family is not a clean, and does not fail the run", async () => {
  // DECISION 8: the run always delivers. With the families gated, a matter whose identical question
  // crowds leaves them skipped — and a confirmed-clean row over a skipped axis is refused, which ended
  // the run at the digest rather than delivering it. `withheld-by-judgment` is the word for a family
  // the reading turn chose not to open under step 5: not clean, because nobody searched it; not
  // coverage-limited, which says the engine tried and could not finish; not deferred, which says the
  // provider could not express the question at all.
  const { COVERAGE_STATUSES } = await import("../coverage-ledger.mjs");
  const { findUnexecutedCleanClaims, deriveCoverageSkeleton, joinPlanToBands } = await import("../register-plan.mjs");
  assert.ok(COVERAGE_STATUSES.includes("withheld-by-judgment"), "the ledger has no word for a family nobody opened on purpose");

  const plan = planFor();
  const identical = plan.entries.find((e) => !e.when && e.axis === "primary-sweep" && e.predicate !== "default");
  // The identical question crowds; every waiting family is therefore skipped.
  const blocks = {};
  for (const e of plan.entries) {
    (blocks[e.axis] ??= []).push({ qid: e.qid, total_hits: 9999, records: [],
      state: e.qid === identical.qid ? "incomplete" : "verified-zero" });
  }
  const skeleton = deriveCoverageSkeleton(plan, joinPlanToBands(plan, blocks));
  const axis = skeleton.find((a) => a.axis === "transliteration-numeric") ?? skeleton[0];

  // A clean over it is still impossible — that gate does not soften.
  assert.ok(findUnexecutedCleanClaims([{ axis: axis.axis, status: "confirmed-clean" }], skeleton).length > 0,
    "a confirmed-clean row over a family nobody opened stopped being refused");
  // …and the withheld row passes, so the run delivers with the decision on the record.
  assert.deepEqual(findUnexecutedCleanClaims([{ axis: axis.axis, status: "withheld-by-judgment" }], skeleton), [],
    "a withheld family is treated as a clean claim — the run would fail at the digest");
});

test("a narrowing names the crowd it replaced, and the name survives the fold", () => {
  const plan = planFor();
  const crowd = plan.entries.find((e) => !e.when && e.axis === "primary-sweep" && e.predicate !== "default");
  const minted = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: [9], regions: ["US"], goods_words: ["headphones"], narrows: crowd.qid }],
    { capabilities: CLARIVATE });
  assert.equal(minted.minted[0].narrows, crowd.qid, "the narrowing does not name what it replaced");
  const folded = foldSupplementalEntries(plan, minted.minted);
  assert.equal(folded.plan.entries.find((e) => e.narrows)?.narrows, crowd.qid,
    "the pairing was lost in the fold — the crowd reads as a question nobody answered");
  // A per-market read is the same shape with one region.
  const perMarket = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: [9], regions: ["DE"], goods_words: ["headphones"], narrows: crowd.qid }],
    { capabilities: CLARIVATE });
  assert.deepEqual(perMarket.minted[0].regions, ["DE"]);
  assert.equal(perMarket.minted[0].narrows, crowd.qid);
});

test("the doctrine teaches both, in the shipping tree", () => {
  for (const f of ["SKILL.md", "unit.md"]) {
    const manual = readFileSync(join(ROOT, "driver", "skills", "clearance-register", f), "utf8");
    assert.match(manual, /withheld-by-judgment/, `${f} does not name the withheld state`);
    assert.match(manual, /`narrows`/, `${f} does not tell the model to name the crowd it replaced`);
  }
});

test("a withheld family's row never reaches the client, whatever the model wrote", async () => {
  // RULING 111, enforced where the model cannot get it wrong. The reading turn AUTHORS the coverage
  // rows and it has been told the family was withheld — so a row saying "we did not search this" can
  // reach a lawyer about a decision that made the search better. The ledger is the authority.
  const { withoutWithheldRows } = await import("../synthesis-record.mjs");
  const ledger = [
    { axis: "transliteration-numeric", scope: "worldwide", status: "withheld-by-judgment", reason: "not opened" },
    { axis: "incumbent-class", scope: "worldwide", status: "coverage-limited", reason: "a documented limit" },
    { axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "read in full" },
  ];
  const authored = [
    { area: "transliteration-numeric / worldwide", state: "not-searched", note: "we did not open this" },
    { area: "incumbent-class / worldwide", state: "coverage-limited", note: "a documented limit" },
    { area: "primary-sweep / worldwide", state: "confirmed-clean", note: "read in full" },
  ];
  const kept = withoutWithheldRows(authored, ledger).map((r) => r.area);

  // ── EVERY SHAPE A COVERAGE AREA ACTUALLY TAKES ──────────────────────────────────────────────────
  //
  // The first version of this gate read the family as everything before the first slash, and was inert
  // for the two shapes that matter most — failing OPEN, toward the client, which is the wrong
  // direction for a gate that exists to keep a row off the page. These are the real strings, taken
  // from the arms that already assert on them, not invented ones.
  const dropped = (area, withheldAxis = "incumbent-class") =>
    withoutWithheldRows([{ area }], [{ axis: withheldAxis, status: "withheld-by-judgment" }]).length === 0;

  assert.ok(dropped("incumbent-class (entire axis)"),
    "the whole-axis row — no slash at all — reached the client");
  assert.ok(dropped("Register / incumbent-class"),
    "the axis is the SECOND segment here, and a first-segment read never saw it");
  assert.ok(dropped("incumbent-class / extra script group"),
    "the suffixed row reached the client");
  // …and the direction that must never fail: equality on a segment, never a substring. A false match
  // DROPS a row, and a documented limit the reader is owed disappearing is the worse error.
  assert.ok(!dropped("primary-sweep / worldwide"), "an unrelated axis was dropped");
  assert.ok(!dropped("Register / incumbent-class-extra"),
    "a longer name containing the withheld one was dropped — a substring test, and it loses disclosures");
  assert.ok(!dropped("incumbent-class / worldwide", "transliteration-numeric"),
    "a row was dropped for a family the ledger does not hold as withheld");

  assert.ok(!kept.some((a) => a.startsWith("transliteration-numeric")),
    "a withheld family's row reached the client's coverage list");
  // THE DIRECTION THAT MATTERS MORE: a documented limit dropped by accident is a disclosure the reader
  // is owed and does not get. That is the worse error of the two by a long way.
  assert.ok(kept.some((a) => a.startsWith("incumbent-class")), "a documented limit was dropped");
  assert.ok(kept.some((a) => a.startsWith("primary-sweep")), "an unrelated row was dropped");

  // A ledger holding nothing withheld changes nothing at all.
  assert.deepEqual(withoutWithheldRows(authored, ledger.slice(1)), authored);
  assert.deepEqual(withoutWithheldRows(authored, []), authored);
  assert.deepEqual(withoutWithheldRows(authored, null), authored);

  // …and the receiver uses it, rather than this rule living only where a test can reach it.
  const src = readFileSync(join(ROOT, "driver", "synthesis-record.mjs"), "utf8");
  assert.match(src, /const rows = withoutWithheldRows\(/,
    "the receiver does not apply the rule — it would hold only in this arm");
});

test("a family withheld at axis level still carries its slice-level disclosure", async () => {
  // MEASURED, AND IT IS THE WORSE ERROR TWICE OVER. A family can be withheld as a whole and still hold
  // a documented limit on one of its slices. Dropping by family name alone deleted the row that
  // carried that limit — so the reader lost a disclosure they are owed, AND the synthesis gate then
  // refused the run for not carrying it, so the run did not deliver either.
  //
  // A family qualifies only when EVERY ledger row for it is withheld. One row saying anything else
  // keeps the family's rows, and that is the direction to fail in.
  const { withoutWithheldRows } = await import("../synthesis-record.mjs");
  const mixed = [
    { axis: "primary-sweep", scope: "worldwide", status: "withheld-by-judgment", reason: "not opened" },
    { axis: "primary-sweep", scope: "exact", status: "coverage-limited", reason: "a documented limit" },
  ];
  const row = [{ area: "primary-sweep (exact: INVENTEDMARK [cl 25])", state: "coverage-limited", note: "a documented limit" }];
  assert.equal(withoutWithheldRows(row, mixed).length, 1,
    "the slice-level disclosure was dropped because its family was withheld elsewhere");

  // …and a family the ledger holds as withheld and nothing else still goes.
  const wholly = [{ axis: "incumbent-class", scope: "worldwide", status: "withheld-by-judgment", reason: "not opened" }];
  assert.equal(withoutWithheldRows([{ area: "Register / incumbent-class" }], wholly).length, 0);
});
