// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// SCRIPT FORM — "can this provider's index answer a term written in THESE characters?"
//
// The defect these tests exist to pin (a clearance run, 2026-07-29): the frozen plan's
// transliteration axis carried 13 raw native-script terms. The active provider indexes non-Latin
// filings by their ROMANISATION and holds no character index, so it refused them inside its own
// request builder and the axis disclosed a hole. That refusal existed in exactly ONE provider file.
// Every other provider would have SENT the same 13 terms; on an index that does not hold the
// characters they come back 0 with no error, and `state:"enumerated", total_hits:0` reads as CLEAN —
// thirteen silent false cleans on the axis most likely to carry a real obstacle.
//
// The fix is NOT a blanket ban. A register that genuinely indexes characters answers native script
// productively (live: 小米 = 553, 华威豹 = 6, 스타벅스 = 15), and guarding it there would convert
// evidenced coverage into deferrals — the mirror-image defect. So the rule is DECLARED per provider
// (capabilities.nativeScriptIndex) and enforced once, in the shared plan executor.
//
// The four contracts pinned below:
//   1. declared romanisation-index  → REFUSES, as a `capability-gap:` deferral
//   2. declared character-index     → ACCEPTS, and the characters reach the wire unchanged
//   3. undeclared (or no contract)  → takes the FAIL-LOUD default and defers
//   4. the refusal SHAPE is byte-identical whichever provider produces it

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isNonLatinTerm, nativeScriptIndexGap } from "../script-form.mjs";
import { isCapabilityGap, makeExecutePlan } from "../execute-plan.mjs";

// The 2026-07-29 axis, verbatim from the run's frozen plan — eight scripts, six of them spaced.
const NATIVE_TERMS = [
  "ティキスラッシュ", "提基斯拉什", "提基冰沙", "冰沙", "沙冰", "碎冰饮", "刨冰",
  "티키 슬러시", "تيكي سلاش", "Тики Слаш", "टिकी स्लश", "ทิกิ สลัช", "Τίκι Σλας",
];

const entry = (over = {}) => ({
  qid: "transliteration-numeric:exact:t", axis: "transliteration-numeric", predicate: "exact",
  term: "冰沙", nice_classes: [32], regions: ["CN"], expected_kind: "enumerate", ...over,
});

/** Run ONE axis through the shared executor and hand back the band + everything that reached the wire. */
async function execute(entries, capabilities, deps = {}) {
  const dir = mkdtempSync(join(tmpdir(), "script-form-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify({ regions: ["CN"], entries }));
  const wire = [];
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { wire.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { wire.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
    capabilities, ...deps,
  });
  const res = await executePlan("auth", { plan_path: planPath, axis: "transliteration-numeric", output_path: outPath }, {});
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);
  const band = JSON.parse(readFileSync(outPath, "utf8"));
  rmSync(dir, { recursive: true, force: true });
  return { band, wire };
}

// ── the detector ─────────────────────────────────────────────────────────────────────────────────

test("the detector: every script on the 2026-07-29 axis registers as non-Latin, and Latin marks never do", () => {
  for (const t of NATIVE_TERMS) assert.ok(isNonLatinTerm(t), `${t} must register as non-Latin`);
  for (const t of ["CORAL FREEZE", "GRANIZADO", "HUA WEI BAO", "TIKI SURASSHU", "24/7", "E*TRADE", "CORAL-FREEZE"])
    assert.equal(isNonLatinTerm(t), false, `${t} is Latin/Common and must pass untouched`);
  // Diacritics are Latin+Inherited, in EITHER normalisation form — a mark like CAFÉ is not a script gap
  // (it has its own, unrelated, owner-field problem on one provider and that is a different rule).
  assert.equal(isNonLatinTerm("CAFÉ"), false);
  assert.equal(isNonLatinTerm("CAFÉ"), false, "NFD: the combining accent is Inherited, not another script");
  assert.equal(isNonLatinTerm(""), false);
  assert.equal(isNonLatinTerm(null), false);
});

// ── the policy, declaration by declaration ───────────────────────────────────────────────────────

test("the policy reads the DECLARATION, never the vendor: true accepts, false and undeclared refuse", () => {
  const chars = { id: "chars", nativeScriptIndex: true };
  const roman = { id: "roman", nativeScriptIndex: false };
  const unknown = { id: "unknown", nativeScriptIndex: null };

  for (const t of NATIVE_TERMS) {
    assert.equal(nativeScriptIndexGap(chars, [t]), null, `${t}: a character index must be SENT the characters`);
    assert.ok(nativeScriptIndexGap(roman, [t]), `${t}: a romanisation index must refuse`);
    assert.ok(nativeScriptIndexGap(unknown, [t]), `${t}: an undeclared index must refuse`);
  }
  // Latin terms are never anyone's gap — the Latin members of that same axis (GRANITA, GRANIZADO,
  // SLUSHICE) ran fine on the very provider that refused the natives, and must keep doing so.
  for (const caps of [chars, roman, unknown, null])
    for (const t of ["GRANITA", "TIKI GRANIZADO", "SLUSHICE"])
      assert.equal(nativeScriptIndexGap(caps, [t]), null, `${t} on ${caps?.id ?? "no contract"}`);

  // NO CONTRACT AT ALL is treated exactly like an undeclared one. A caller who wired an executor
  // without a capability contract has declared even less than one who wrote `null`.
  assert.ok(nativeScriptIndexGap(null, ["冰沙"]), "no contract ⇒ fail-loud, not fail-open");
  assert.ok(nativeScriptIndexGap(undefined, ["冰沙"]));
  assert.ok(nativeScriptIndexGap({ id: "x" }, ["冰沙"]), "field simply absent ⇒ fail-loud");

  // The two refusals say DIFFERENT things, because the remedies differ: one is "send the romanisation",
  // the other is "go and probe this provider". A single generic sentence would hide the open question.
  assert.match(nativeScriptIndexGap(roman, ["冰沙"]), /TRANSLITERATION/);
  assert.match(nativeScriptIndexGap(roman, ["冰沙"]), /romanizedTerms/);
  assert.match(nativeScriptIndexGap(unknown, ["冰沙"]), /NOT DECLARED/);
  assert.match(nativeScriptIndexGap(unknown, ["冰沙"]), /prob/i);
  // Whichever term tripped it is NAMED — a deferral nobody can trace is not a disclosure.
  assert.match(nativeScriptIndexGap(roman, ["GRANITA", "冰沙"]), /冰沙/);
});

// ── the executor: the same thirteen terms, three providers, three correct outcomes ────────────────

test("a provider declaring a ROMANISATION index refuses every native term — deferred, never sent, never zero", async () => {
  const entries = NATIVE_TERMS.map((t, i) => entry({ qid: `q${i}`, term: t }));
  const { band, wire } = await execute(entries, { id: "roman", nativeScriptIndex: false });

  assert.equal(wire.length, 0, "ZERO provider calls — a client-side refusal never reaches the wire");
  assert.equal(band.length, NATIVE_TERMS.length, "every refused slice still gets a BLOCK: the gap is recorded, not invisible");
  for (const b of band) {
    assert.equal(b.state, "incomplete", "never `enumerated` — the slice was not executed");
    assert.equal(b.error, true, "error:true, so no consumer reads it as a sanctioned crowd");
    assert.equal(b.deferred, true, "…and DEFERRED: retrying a capability gap is provably futile");
    assert.equal(b.total_hits, 0);
    assert.deepEqual(b.sample, []);
    assert.ok(isCapabilityGap(b.reason), "the reason carries the capability-gap marker the ledger reads");
    assert.match(b.reason, /not in Latin script/);
  }
});

test("a provider declaring a CHARACTER index sends the characters unchanged — the coverage is real, not a gap", async () => {
  const entries = NATIVE_TERMS.map((t, i) => entry({ qid: `q${i}`, term: t }));
  const { band, wire } = await execute(entries, { id: "chars", nativeScriptIndex: true });

  // THE anti-overreach assertion. Archived executed bands on such a provider carry non-zero hit counts
  // for native characters in Han, Katakana, Cyrillic and Greek — a blanket ban deletes all of it, and
  // deleted coverage is exactly as wrong as a false clean.
  assert.equal(wire.length, NATIVE_TERMS.length, "every native term is dispatched");
  assert.deepEqual(wire.map((w) => w.name), NATIVE_TERMS, "…verbatim: no romanisation, no folding, no widening");
  assert.deepEqual(wire.map((w) => w.match_mode), NATIVE_TERMS.map(() => "exact"),
    "…and the predicate is untouched — widening `exact` here pushes a usable slice past the provider's own result ceiling");
  for (const b of band) {
    assert.equal(b.state, "enumerated");
    assert.ok(!b.error, "an answerable slice is never an error block");
    assert.ok(!b.deferred);
  }
});

test("an UNDECLARED provider takes the fail-loud default — an unprobed index may not answer silently", async () => {
  for (const caps of [{ id: "signa-shaped", nativeScriptIndex: null }, { id: "no-field" }, null]) {
    const { band, wire } = await execute([entry({ qid: "q0", term: "티키 슬러시" })], caps);
    assert.equal(wire.length, 0, `${caps?.id ?? "no contract"}: nothing sent to an index nobody characterised`);
    assert.equal(band[0].deferred, true, `${caps?.id ?? "no contract"}: deferred`);
    assert.equal(band[0].error, true);
    assert.equal(band[0].total_hits, 0, "the one thing it must NEVER be is a clean zero");
    assert.ok(isCapabilityGap(band[0].reason));
  }
});

// ── the ROMANISATION RESCUE must survive the guard ───────────────────────────────────────────────

test("a native entry carrying romanizedTerms is RESCUED, not refused — the guard reads the BUILT query", async () => {
  // The romanisation-indexed provider substitutes `romanizedTerms` for the native name in its own
  // buildEntryQuery (and relaxes the predicate, because `exact` on a transliteration is itself a silent
  // zero). A guard that inspected the plan entry's raw term would refuse exactly the slices that rescue
  // exists to save — killing the Chinese jx lane, which is the ONE lane that mints both forms today.
  const substitute = (e, pp) => {
    const roman = Array.isArray(e.romanizedTerms) ? e.romanizedTerms : [];
    if (roman.length && isNonLatinTerm(e.term)) return { names: roman, match_mode: "default", nice_classes: e.nice_classes };
    return { name: e.term, ...pp, nice_classes: e.nice_classes };
  };
  const entries = [
    entry({ qid: "rescued", term: "华威豹", romanizedTerms: ["HUA WEI BAO", "HUAWEIBAO"] }),
    entry({ qid: "bare", term: "冰沙" }),
  ];
  const { band, wire } = await execute(entries, { id: "roman", nativeScriptIndex: false }, { buildEntryQuery: substitute });

  assert.equal(wire.length, 1, "the rescued slice IS dispatched; the bare one is not");
  assert.deepEqual(wire[0].names, ["HUA WEI BAO", "HUAWEIBAO"]);
  assert.equal(band.find((b) => b.qid === "rescued").state, "enumerated");
  assert.ok(!band.find((b) => b.qid === "rescued").deferred, "a rescued slice is answerable — refusing it would be the mirror-image defect");
  assert.equal(band.find((b) => b.qid === "bare").deferred, true, "…and a native term with no romanisation still defers");
});

test("a builder that spells mark text some OTHER way still trips the guard — the default cannot be dodged", async () => {
  // The fail-open corner, closed before it could open. The guard reads the built query's name/names,
  // which is the shape both live providers' builders emit. A provider whose request is a single `query`
  // string (signa) would present NO recognised mark field, and a guard that shrugged at that would sail
  // the term straight through — on the ONE provider whose declaration is an undeclared null. So with no
  // recognised field the guard falls back to the entry's own terms.
  const singleString = (e) => ({ query: e.term, strategies: ["exact"] });
  const { band, wire } = await execute(
    [entry({ qid: "q0", term: "冰沙" }), entry({ qid: "q1", term: "GRANITA" })],
    { id: "thin-unprobed", nativeScriptIndex: null }, { buildEntryQuery: singleString });

  assert.equal(band.find((b) => b.qid === "q0").deferred, true, "the native term defers even with no name field in the query");
  assert.ok(isCapabilityGap(band.find((b) => b.qid === "q0").reason));
  assert.equal(wire.length, 1, "…and only the Latin term reached the wire");
  assert.equal(wire[0].query, "GRANITA");
});

test("an OWNER sweep is exempt — a non-Latin owner name is a different question, and this is the mark rule", async () => {
  const owners = [entry({ qid: "own", predicate: "owner", term: "株式会社ティキ" })];
  const { band, wire } = await execute(owners, { id: "roman", nativeScriptIndex: false });
  assert.equal(wire.length, 1, "the owner slice is dispatched — term-shape.mjs exempts owner names identically");
  assert.equal(wire[0].owner, "株式会社ティキ");
  assert.ok(!band[0].deferred);
});

// ── ONE shape, every provider ────────────────────────────────────────────────────────────────────

test("the refusal SHAPE is identical whichever provider produces it — scope-facts and the ledger read one thing", async () => {
  const shapeOf = (b) => ({
    keys: Object.keys(b).sort(), state: b.state, error: b.error, deferred: b.deferred,
    total_hits: b.total_hits, fetched: b.fetched, sample: b.sample,
  });
  const contracts = [
    { id: "roman", nativeScriptIndex: false },
    { id: "unprobed", nativeScriptIndex: null },
    { id: "no-field" },
  ];
  const shapes = [];
  for (const caps of contracts) {
    const { band } = await execute([entry({ qid: "q0", term: "碎冰饮" })], caps);
    assert.ok(isCapabilityGap(band[0].reason), `${caps.id}: the marker rides the reason`);
    assert.match(band[0].reason, new RegExp(caps.id ?? "unknown"), `${caps.id}: the reason NAMES the provider that could not answer`);
    shapes.push(shapeOf(band[0]));
  }
  for (const s of shapes.slice(1)) assert.deepEqual(s, shapes[0], "one refusal shape, not three near-misses");
  assert.deepEqual(shapes[0], {
    keys: ["deferred", "error", "fetched", "qid", "query", "reason", "sample", "state", "total_hits"],
    state: "incomplete", error: true, deferred: true, total_hits: 0, fetched: 0, sample: [],
  });
  // …and it is the SAME shape the pre-existing capability gaps already emit (the owner×term refusal),
  // so scope-facts, joinPlanToBands and the coverage skeleton need no second vocabulary.
  const { band: ownerBand } = await execute(
    [entry({ qid: "q0", term: "GRANITA", owner: "TIKI HOLDINGS SA" })],
    { id: "no-intersection", nativeScriptIndex: true, ownerTermIntersection: false });
  assert.deepEqual(shapeOf(ownerBand[0]), shapes[0],
    "the owner×term gap and the script-form gap are ONE deferral shape");
});

// ── the REAL contracts, not synthetic ones ───────────────────────────────────────────────────────

test("the three shipped contracts each get the outcome their probes earned", async () => {
  const { CAPABILITIES: CORSEARCH } = await import("../../corsearch/src/capabilities.js");
  const { CAPABILITIES: CLARIVATE } = await import("../../clarivate/src/capabilities.js");
  const { CAPABILITIES: SIGNA } = await import("../../signa/src/capabilities.js");

  for (const t of NATIVE_TERMS) {
    assert.equal(nativeScriptIndexGap(CORSEARCH, [t]), null,
      `corsearch answers ${t} — its index holds the characters and a guard here would delete real coverage`);
    assert.match(nativeScriptIndexGap(CLARIVATE, [t]), /TRANSLITERATION/,
      `clarivate cannot answer ${t} — the characters are not a search key there`);
    // The deferral is gone and this assertion changed SIDES rather than being deleted: signa returns a
    // record whose `mark_text_script` is Hant, and that record's own characters searched back recall the
    // same id at total_count 1. The characters are the index key.
    assert.equal(nativeScriptIndexGap(SIGNA, [t]), null,
      `signa answers ${t} — its index holds the characters, and a guard here would now delete real coverage`);
  }
  // No provider may refuse Latin mark text on script grounds, ever.
  for (const caps of [CORSEARCH, CLARIVATE, SIGNA])
    assert.equal(nativeScriptIndexGap(caps, ["CORAL FREEZE", "GRANITA"]), null, `${caps.id}: Latin text is nobody's gap`);
});

// ── the axis this came from ──────────────────────────────────────────────────────────────────────

test("the 2026-07-29 axis end to end: the Latin members always run, the natives split on the declaration", async () => {
  const entries = [
    ...["TIKI GRANIZADO", "GRANIZADO", "GRANITA"].map((t, i) => entry({ qid: `lat${i}`, term: t })),
    ...NATIVE_TERMS.map((t, i) => entry({ qid: `nat${i}`, term: t })),
  ];
  const latin = new Set(["lat0", "lat1", "lat2"]);

  const roman = await execute(entries, { id: "roman", nativeScriptIndex: false });
  assert.equal(roman.wire.length, 3, "on a romanisation index only the Latin members are searched…");
  assert.equal(roman.band.filter((b) => b.deferred).length, NATIVE_TERMS.length, "…and all 13 natives DEFER");
  for (const b of roman.band) assert.equal(b.deferred === true, !latin.has(b.qid));
  // The axis is therefore NOT clean and NOT executed — it is a disclosed hole, which is the whole
  // point: the run that produced this shipped a gap on its face instead of thirteen false cleans.
  assert.ok(roman.band.some((b) => b.deferred), "the axis carries a deferral a clean claim cannot survive");

  const chars = await execute(entries, { id: "chars", nativeScriptIndex: true });
  assert.equal(chars.wire.length, entries.length, "on a character index the WHOLE axis is searched");
  assert.equal(chars.band.filter((b) => b.deferred).length, 0, "…and nothing defers — this coverage is real");
});
