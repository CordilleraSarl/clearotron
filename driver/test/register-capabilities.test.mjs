// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The PER-PROVIDER CAPABILITY CONTRACT.
//
// What these tests defend (doctrine rules 1 + 2):
//   * every provider declares the SAME contract shape — a capability is either a mode string or an
//     explicit null, never absent-and-assumed;
//   * a null capability compiles to an `unsupported` entry with a plain-English reason, and that reason
//     reaches `deferred` through BOTH mechanisms (the executor's error:true block → joins MISSING; the
//     ledger's coerceToolAbsenceDeferred relabel → a closeable, escalated, disclosed gap);
//   * the office vocabulary is TRANSLATED before it is coverage-checked (EU→EM on clarivate — checking
//     the raw ISO code against a vocabulary that spells the EUIPO "EM" would defer every EU matter);
//   * the planner's OR-width equals the ACTIVE PROVIDER's executor bound — per provider, never one
//     hardcoded 80 pretending to be universal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import {
  compileRegisterPlan, parseRegisterPlan, joinPlanToBands, deriveCoverageSkeleton,
  validatePlanFeasibility, planMaxOrWidth, predicateGap, resolveRegions, wildcardCapabilityKey,
  unsupportedPredicateReason, uncoveredJurisdictionReason, PLAN_MAX_OR_WIDTH, findUnexecutedCleanClaims,
} from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES, capabilitiesFor } from "../register-capabilities.mjs";
import { coerceToolAbsenceDeferred, deriveCoverageStatus, parseCoverageLedgerFull as parseCoverageLedgerFullSync } from "../coverage-ledger.mjs";
// — the deferred-slice requirement is a driver-written form row, not a prose disclosure join.
import { coverageFormRows, rowIsSettled, findCoverageFormViolations } from "../coverage-form.mjs";
import { ENUMERATE_NAMES_CHUNK_DEFAULT } from "../../providers/corsearch/src/core.js";
import { SIGNA_OFFICES } from "../../providers/signa/src/core.js";
import { SIGNA_OFFICE_KEYS } from "../../providers/signa/src/capabilities.js";
import { SIGNA_OFFICE_SNAPSHOT } from "../../providers/signa/src/offices.generated.js";
import { CLARIVATE_OFFICE_CODES } from "../../providers/clarivate/src/capabilities.js";

const MODEL = {
  schema_version: 1,
  mark: "DAWN: LEGENDS OF LUMENGARDE",
  dominant_element: "LUMENGARDE",
  elements: [
    { value: "LUMENGARDE", kind: "distinctive" },
    { value: "DAWN", kind: "common" },
  ],
  variants: [
    { value: "EVERLITE", category: "phonetic", rationale: "sound-alike" },
    { value: "ЭВЕРЛАЙТ", category: "transliteration", rationale: "cyrillic" },
  ],
  incumbent_classes: ["9"],
};
const JOB = { jobKey: "TMP9999-lumengarde", classes: ["9", "28"], jurisdictions: ["US", "EU", "CH"] };
const FORM = { elements: [{ element: "LUMENGARDE", band: {
  exactQueries: ["AVERLIGHT", "EVERLIGT"], wildcardPatterns: ["EVERLIGH*", "*VERLIGHT"] } }] };

const manifest = () => parseVariantManifestModel(JSON.stringify(MODEL));
const compile = (capabilities, { job = JOB, form = FORM } = {}) =>
  compileRegisterPlan({ manifest: manifest(), job, form, skillVersion: "phase3", capabilities });

const PROVIDERS = ["corsearch", "clarivate", "signa", "euipo", "uspto-local", "free-tier"];

// ── the contract shape ───────────────────────────────────────────────────────────────────────────

test("every provider declares the SAME capability contract shape — closed vocabularies, explicit nulls", () => {
  const PAGINATION = ["page", "single-shot", "cursor"];
  const COUNT_PROBE = ["cheap", "endpoint", "none"];
  const CLASS_FILTER = ["native", "fanout"];
  const SCREEN_SOURCE = ["bulk-endpoint", "billed-record-fetch", "search-row"];
  const PREDICATE_KEYS = ["exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix", "phonetic", "owner"];

  for (const id of PROVIDERS) {
    const c = capabilitiesFor(id);
    assert.equal(c.id, id, `${id}: id is self-describing`);
    assert.ok(PAGINATION.includes(c.pagination), `${id}: pagination`);
    assert.ok(COUNT_PROBE.includes(c.countProbe), `${id}: countProbe`);
    assert.ok(CLASS_FILTER.includes(c.classFilter), `${id}: classFilter`);
    assert.ok(SCREEN_SOURCE.includes(c.screenSource), `${id}: screenSource`);
    assert.ok(Number.isInteger(c.maxOrWidth) && c.maxOrWidth >= 1, `${id}: maxOrWidth`);
    assert.ok(c.resultCeiling === null || Number.isInteger(c.resultCeiling), `${id}: resultCeiling is a number or an explicit null`);
    assert.deepEqual(Object.keys(c.predicates).sort(), [...PREDICATE_KEYS].sort(), `${id}: the predicate contract is complete`);
    for (const k of PREDICATE_KEYS) {
      const v = c.predicates[k];
      assert.ok(v === null || (typeof v === "string" && v.length > 0),
        `${id}.predicates.${k} must be a provider mode string or an EXPLICIT null — never undefined/absent`);
    }
    assert.equal(typeof c.offices.translate, "function", `${id}: offices.translate`);
    assert.ok(typeof c.offices.vocabulary === "string" && c.offices.vocabulary, `${id}: offices.vocabulary`);
    assert.ok(c.offices.covered === null || Array.isArray(c.offices.covered), `${id}: offices.covered is a list or an explicit null (= no declared restriction)`);
    for (const k of ["phonemeExpansion", "oppositions", "hasPublicRecordUrl", "ownerTermIntersection"])
      assert.equal(typeof c[k], "boolean", `${id}.${k} must be a boolean`);
    // nativeScriptIndex is TRI-state on purpose: true (the index holds the characters) / false (it
    // holds only the transliteration) / an EXPLICIT null meaning UNDECLARED — nobody probed it. It may
    // never be simply absent, because an absent field and a declared "we don't know" read identically
    // to a human and only one of them is honest. `undefined` fails here.
    assert.ok(c.nativeScriptIndex === true || c.nativeScriptIndex === false || c.nativeScriptIndex === null,
      `${id}.nativeScriptIndex must be true, false, or an EXPLICIT null (undeclared) — never absent`);
    assert.ok("nativeScriptIndex" in c, `${id}: nativeScriptIndex must be declared, not omitted`);
    assert.ok(Object.isFrozen(c), `${id}: the contract is frozen`);
  }
  assert.deepEqual(Object.keys(PROVIDER_CAPABILITIES).sort(), [...PROVIDERS].sort());
  assert.throws(() => capabilitiesFor("markify"), /unknown register provider/i,
    "an undeclared provider must throw LOUDLY — never fall back to another provider's abilities");
});

test("the probed provider facts are encoded, not the stale core's warts", () => {
  const cor = capabilitiesFor("corsearch");
  const cla = capabilitiesFor("clarivate");
  const sig = capabilitiesFor("signa");

  // corsearch: page-0 IS the count probe; the 5000 window truncates SILENTLY (hence the page guard).
  assert.equal(cor.pagination, "page");
  assert.equal(cor.countProbe, "cheap");
  assert.equal(cor.screenSource, "bulk-endpoint");
  assert.equal(cor.resultCeiling, 5000);
  assert.equal(cor.maxOrWidth, 80);
  assert.ok(cor.phonemeExpansion && cor.oppositions && cor.hasPublicRecordUrl);

  // clarivate (live probe 2026-07-21): multi-class is ONE call — the per-class fan-out is obsolete and
  // must NOT be canonised as "fanout"; /count is the cheap endpoint probe; 30000 fails LOUD; oppositions
  // are DEFINED in the swagger but never populated ⇒ "not available", never "none found".
  assert.equal(cla.pagination, "single-shot");
  assert.equal(cla.countProbe, "endpoint");
  assert.equal(cla.classFilter, "native", "INT_CLASS_NUMBER takes an OR-stack in one call");
  assert.equal(cla.screenSource, "billed-record-fetch");
  assert.equal(cla.resultCeiling, 30000);
  assert.equal(cla.maxOrWidth, 500, "1000 terms → nesting-depth 500; 500 is the probed safe chunk");
  assert.equal(cla.oppositions, false);
  assert.equal(cla.phonemeExpansion, false, "/similarity/word/* is not available on this provider (403) — never wired");
  assert.equal(cla.hasPublicRecordUrl, false);
  assert.equal(cla.predicates.exact, "EXACT_WORD_MARK_SPECIFICATION");
  assert.equal(cla.predicates.phonetic, "PHONETIC_WORD_MARK_SPECIFICATION");
  assert.equal(cla.predicates.owner, "APPLICANT_NAME");
  assert.ok(cla.predicates.default.includes("*TERM*"),
    "default is a TRUE contains via the term wildcard, not the recall-losing bare EQUALS");
  for (const v of Object.values(cla.predicates))
    assert.ok(!/CONTAINS/.test(String(v)), "CONTAINS is a hard 400 on APPLICANT_NAME — never emit it anywhere");

  // signa: no total anywhere, no OR surface, no owner field, no contains mode.
  // signa, RE-PROBED 2026-08-17. The five nulls and the `false` this block used to pin were
  // written against the API of 2026-06-14 and every one of them had gone false — the vendor moved and
  // the contract did not. Kept as by-value assertions because that is what made the drift visible at
  // all: these lines failed the moment the contract changed, which is the only reason anyone re-read
  // them. The figure beside each is the live total the probe returned.
  assert.equal(sig.pagination, "cursor");
  assert.equal(sig.countProbe, "cheap", "options.include_total puts the corpus total on the search response");
  assert.equal(sig.screenSource, "search-row");
  assert.equal(sig.resultCeiling, null);
  assert.equal(sig.maxOrWidth, 1, "still one term per call — the endpoint has no OR array");
  assert.equal(sig.predicates.owner, "owner_name", "filters.owner_name exists and composes with a query (2047 → 689)");
  assert.equal(sig.predicates.default, "contains", "the unanchored mode is `match: contains` (2047), not a fuzzy stand-in");
  assert.equal(sig.predicates.wildcardSuffix, "ends_with", "363");
  assert.equal(sig.predicates.wildcardPrefix, "starts_with",
    "the DETERMINISTIC mode, not the `prefix` strategy — planPredicateParams emits starts_with and never prefix, so `prefix` named a call this engine does not make (830)");
  assert.equal(sig.predicates.wildcardInfix, null,
    "STILL the gap, and deliberately: the kernel hands the infix case its raw `*foo*` pattern, so a contains sweep would search the punctuation");
  assert.equal(sig.oppositions, true, "opposition_window on the row, proceedings_count on the record, has_proceedings as a filter (18)");
  assert.equal(sig.countStatusFilter, "native", "filters.status_primary narrows a count (685 → 375)");

  // ── the script-form declaration: two OPPOSITE probed answers, and one honest unknown ─────────────
  // These three values are the whole point of declaring it as data. corsearch answers the characters
  // (小米 = 553, 华威豹 = 6, 스타벅스 = 15 — live, 2026-07-29); clarivate answers 0 on all three and
  // 57632 / 32 / 18 on their romanisations. Neither is a bug on the other side, so there is no house
  // default a third provider could inherit — signa stays an explicit, deferring unknown until probed.
  assert.equal(cor.nativeScriptIndex, true, "corsearch has a REAL native-script index — never guard it");
  assert.equal(cla.nativeScriptIndex, false, "clarivate indexes non-Latin filings by their transliteration only");
  // signa was the honest unknown here for two months and closed it by running the procedure the
  // contract described: a record with mark_text_script "Hant", its own characters searched back, exact
  // total 1, same id recalled.
  assert.equal(sig.nativeScriptIndex, true, "signa indexes the characters — they are the index key");
  // …and the third value is still represented, so this trio does not quietly become two. uspto-local
  // is the unprobed one now, and an undeclared index must go on DEFERRING rather than inheriting a
  // house default from the two providers that answer oppositely.
  assert.equal(capabilitiesFor("uspto-local").nativeScriptIndex, null,
    "an unprobed index stays a declared unknown that defers — never a guess in either direction");
});

// ── the two facts a PROSE ABSENCE REASON rests on, pinned so the prose cannot outlive them ───────
//
// wired register_propose_supplemental into signa and wrote a stated reason for the two tools
// that stay absent. `register_batch_screen`'s reason is an endpoint that 404s — it fails loud if that
// changes. `register_image_fetch`'s does not: it is a claim about what this provider's source does NOT
// contain, written in a comment in driver/engine/mcp/gather-config.mjs, and nothing joined the two.
// Add a `vienna_classes` field to signa's core tomorrow and that paragraph is silently false — which is
// the exact shape exists to punish, one level out from where it punished it.
const SIGNA_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "providers", "signa", "src");

test("#1161 signa's core still carries NO figurative data — the absence reason in gather-config holds", () => {
  const files = readdirSync(SIGNA_SRC).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
  const corpus = files.map((f) => readFileSync(join(SIGNA_SRC, f), "utf8")).join("\n");

  // POSITIVE CONTROL FIRST. A scan that reads nothing reports every absence, so the arm below is
  // evidence only once this proves the corpus is real and the matcher works on it.
  assert.ok(files.length >= 3, `read ${files.length} file(s) from providers/signa/src — the scan lost its corpus`);
  assert.match(corpus, /has_media/,
    "the control token is gone, so a clean vienna scan below would mean the matcher stopped matching");

  // The claim itself: the tool's payload is Vienna figurative-element codes and a citable public page,
  // and this provider publishes neither.
  const figurative = [...corpus.matchAll(/\b\w*(?:vienna|figurativ)\w*\b/gi)].map((m) => m[0]);
  assert.deepEqual([...new Set(figurative)], [],
    "signa's core now names figurative data, so gather-config's register_image_fetch absence reason is "
    + "stale — re-read it, and wire the tool if the vendor really does publish Vienna codes now");
  assert.equal(capabilitiesFor("signa").hasPublicRecordUrl, false,
    "signa now declares a per-record public URL — half the register_image_fetch reason just went false");
});

test("#1645 signa's core does not document a count endpoint it HAS — the doc and the value agree", () => {
  // A doc comment that contradicts the value it cites, five lines above the block that records the
  // change correctly. moved `countProbe` from "none" to "cheap" (the total was always there,
  // behind an opt-in flag nobody had set) and this header went on asserting "THIS PROVIDER HAS NO
  // COUNT ENDPOINT" for weeks. `countProbe` is the field the kernel branches on for count-first, so a
  // reader who stopped at the doc comment had the load-bearing premise backwards.
  const core = readFileSync(join(SIGNA_SRC, "core.js"), "utf8");
  assert.equal(capabilitiesFor("signa").countProbe, "cheap",
    "the contract moved off `cheap` — re-read doCountHits's header before changing this line");
  // Scoped to the CLAIM, not to the words: a header may quote the retired wording while explaining it
  // (this one does), so the arm looks for the claim asserted beside the stale value that backed it.
  assert.doesNotMatch(core, /countProbe: "none"` says so/,
    "signa's core cites `countProbe: \"none\"` as the contract's agreement while the contract says "
    + "\"cheap\" — the drift #1645 fixed has come back");
});

test("#1656 no INLINE comment in signa's core reasons from the retired `countProbe: \"none\"`", () => {
  const core = readFileSync(join(SIGNA_SRC, "core.js"), "utf8");

  // THE CLAIM, NOT THE TOKEN. Two of the four sites this arm was built for said "exposes no corpus
  // total anywhere" and "no corpus total to catch a short answer against" — neither contains the word
  // countProbe. A token-only pattern found two of four and calling that population "discovered" did
  // not make it one.
  const CLAIM = /no corpus total|no count endpoint|countProbe "none"|countProbe: "none"|No total exists|exposes no [a-z ]*total/i;

  // POSITION IS THE DISCRIMINATOR, and that is why this arm can exist at all. The correction
  // quotes the retired wording ON PURPOSE; every stale site was a `//` comment in a function body. A
  // pattern keyed on the correction's own text would need an ignore-list, and an ignore-list is how a
  // pin stops being a pin. Scoping by position means rewording either block cannot break this.
  const withoutBlockComments = core.replace(/\/\*[\s\S]*?\*\//g, "");
  const inline = withoutBlockComments.split("\n").filter((l) => /^\s*\/\//.test(l));

  // THREE CONTROLS, because each failure mode below looks exactly like a pass.
  assert.ok(inline.length > 50,
    `only ${inline.length} inline comment line(s) survived the block-comment strip — the scan lost its `
    + "corpus and the assertion below would agree with itself over nothing");
  assert.match(core, CLAIM,
    "the claim pattern matches NOWHERE in this file — not even the #1645 header that quotes the retired "
    + "wording to explain it. The matcher is dead, and a clean scan below would mean nothing");
  assert.doesNotMatch(withoutBlockComments, /THIS HEADER SAID THE OPPOSITE UNTIL/,
    "the #1645 correction survived the block-comment strip, so this arm is not scoping the way it says "
    + "it does and would red on the correction rather than on a regression");

  const offenders = inline.filter((l) => CLAIM.test(l)).map((l) => l.trim());
  assert.deepEqual(offenders, [],
    "an inline comment in signa's core reasons from the retired `countProbe: \"none\"` premise again. "
    + "#1030 moved that value to \"cheap\" on 2026-08-17: `include_total` puts `pagination.total_count` on "
    + "the ordinary search response, and buildSearchRequest asks for it on every request. Correct the "
    + "comment — do NOT add the line to an allowlist here:\n  " + offenders.join("\n  "));
});

// ── office vocabulary: translate FIRST, then coverage-check ──────────────────────────────────────

test("office translation: clarivate spells the EUIPO EM (never EU); signa uses lowercase office keys; corsearch is ISO passthrough", () => {
  const cla = capabilitiesFor("clarivate").offices;
  assert.equal(cla.translate("EU"), "EM", "THE footgun: the EU office code on Compumark is EM");
  assert.equal(cla.translate("eu"), "EM");
  assert.equal(cla.translate("US"), "US");
  assert.equal(cla.translate("ch"), "CH");
  assert.ok(cla.covered.includes("EM") && !cla.covered.includes("EU"),
    "the 186-code enum carries EM — a raw-ISO coverage check would defer every EU matter");
  assert.equal(cla.covered.length, 186);
  assert.equal(CLARIVATE_OFFICE_CODES.length, 186);
  assert.equal(cla.translate("ZZZ"), "ZZZ", "an unknown code translates to itself and then fails the coverage check");

  const sig = capabilitiesFor("signa").offices;
  assert.equal(sig.translate("US"), "uspto");
  assert.equal(sig.translate("EU"), "euipo");
  assert.equal(sig.translate("CH"), "ipi", "ipi = the Swiss IGE/IPI");
  assert.equal(sig.translate("uspto"), "uspto", "an already-native key passes through");
  assert.equal(sig.translate("JP"), null, "genuinely uncovered — null, not a guess");
  // NOT A NUMERIC PIN ANY MORE. The covered set is derived from the committed office snapshot,
  // so the count is the vendor's to change and a hardcoded number would rot into a failure that says
  // nothing about whether the derivation is right. Asserted against the snapshot's own live entries.
  const liveInSnapshot = SIGNA_OFFICE_SNAPSHOT.offices.filter((o) => o.status === "live");
  assert.equal(sig.covered.length, liveInSnapshot.length,
    "the covered set IS the snapshot's live offices — no more, and never fewer");
  assert.ok(liveInSnapshot.length > 0,
    "an empty snapshot would make the line above vacuously true and the covered set 'covers nothing'");
  // A non-live office must NEVER be covered: planning against an office the vendor no longer serves
  // returns thin and reads as clean, which is the wide-snapshot failure the sync exists to prevent.
  for (const o of SIGNA_OFFICE_SNAPSHOT.offices.filter((x) => x.status !== "live")) {
    assert.ok(!sig.covered.includes(o.key), `${o.key} is status:${o.status} and must not be covered`);
  }
  // The office this issue was opened over: UKIPO was live all along and we refused to search it.
  assert.equal(sig.translate("GB"), "ukipo", "UKIPO is covered — it was live and hand-omitted until #1031");

  const cor = capabilitiesFor("corsearch").offices;
  assert.equal(cor.translate("EU"), "EU");
  assert.equal(cor.translate("us"), "US");
  assert.equal(cor.covered, null, "no declared restriction — never read as 'covers nothing'");

  // the capabilities office map must not drift from the core's live-probed SIGNA_OFFICES
  assert.deepEqual(SIGNA_OFFICE_KEYS, SIGNA_OFFICES);
});

test("resolveRegions translates then coverage-checks, and defers what the provider does not reach", () => {
  const r1 = resolveRegions(["US", "EU", "CH"], capabilitiesFor("clarivate"));
  // WO is the international layer of all three, and clarivate's own codes are the only thing that
  // decides whether it can be reached. EM is already here because the EU was ordered.
  assert.deepEqual(r1.regions, ["US", "EM", "CH", "WO"]);
  assert.deepEqual(r1.deferred, []);

  // signa adds nothing, and that is the point of reading the contract rather than appending a code:
  // its offices declare all three layers `returns` (territory_match: "protection" makes ONE France
  // query return the EU and Madrid rights protecting France), so the expansion stays out of the way.
  const r2 = resolveRegions(["US", "EU", "JP"], capabilitiesFor("signa"));
  assert.deepEqual(r2.regions, ["uspto", "euipo"]);
  assert.equal(r2.deferred.length, 1);
  assert.equal(r2.deferred[0].jurisdiction, "JP");
  assert.match(r2.deferred[0].reason, /not covered by the active register provider \(signa\)/);

  const r3 = resolveRegions(["US", "EU", "CH"], null);
  assert.deepEqual(r3.regions, ["US", "EU", "CH"], "no contract ⇒ untouched passthrough");
});

// ──: the ordered territory is a stack of registers, and the plan must reach all of it ────────
test("resolveRegions expands an ordered territory to the registers that BIND it", () => {
  // THE DEFECT, in the shape production had it: France ordered alone. An EU trade mark blocks use in
  // France without appearing in the French register, and a Madrid registration designating France or
  // the EU does the same — and neither was searched unless the client separately listed the EU.
  assert.deepEqual(resolveRegions(["FR"], capabilitiesFor("clarivate")).regions, ["FR", "EM", "WO"]);
  assert.deepEqual(resolveRegions(["FR"], capabilitiesFor("corsearch")).regions, ["FR", "EU", "WO"],
    "the same three registers, in the provider's own ISO vocabulary — EM is not an ISO code");
  assert.deepEqual(resolveRegions(["FR"], capabilitiesFor("signa")).regions, ["inpi-fr"],
    "…and nothing is added where the provider's own office already returns all three layers");

  // A non-EU territory has no regional layer to add — the table is per territory, not a blanket append.
  assert.deepEqual(resolveRegions(["CH"], capabilitiesFor("clarivate")).regions, ["CH", "WO"]);
  assert.deepEqual(resolveRegions(["US"], capabilitiesFor("clarivate")).regions, ["US", "WO"]);
  // Benelux: BX IS the national register for NL, so it is not joined by a second national one —
  // clarivate's own translate already resolves NL there. Corsearch takes ISO codes, so `NL` is what
  // the client ordered and BX is the register that actually holds Dutch national rights: the national
  // layer is matched BY OFFICE, so the expansion adds it rather than reading `NL` as covering it.
  assert.deepEqual(resolveRegions(["NL"], capabilitiesFor("clarivate")).regions, ["BX", "EM", "WO"]);
  assert.deepEqual(resolveRegions(["NL"], capabilitiesFor("corsearch")).regions, ["NL", "BX", "EU", "WO"]);
  // The EU ordered AS a territory: there is no national layer to miss.
  assert.deepEqual(resolveRegions(["EU"], capabilitiesFor("clarivate")).regions, ["EM", "WO"]);

  // A DEFERRED territory contributes no layers. Otherwise a matter whose every named territory fell
  // outside the provider's coverage would acquire a non-empty region list, and compileRegisterPlan's
  // allJurisdictionsDeferred — which exists to fail loudly on exactly that — would stop firing.
  const jp = resolveRegions(["JP"], capabilitiesFor("signa"));
  assert.deepEqual(jp.regions, [], "must stay empty so allJurisdictionsDeferred still fires");
  assert.equal(jp.deferred.length, 1);
  const usOnly = resolveRegions(["FR"], capabilitiesFor("uspto-local"));
  assert.deepEqual(usOnly.regions, [], "a provider that reaches neither the territory nor its layers adds nothing");
  assert.equal(usOnly.deferred.length, 1);

  // Idempotent: compiling a plan whose regions are already expanded must not compound.
  const once = resolveRegions(["FR"], capabilitiesFor("clarivate")).regions;
  assert.deepEqual(resolveRegions(once, capabilitiesFor("clarivate")).regions, once);
});

test("#1028: the coverage form stops disclosing a layer the plan now searches", async () => {
  const { territoryLayerReport } = await import("../binding-layers.mjs");
  // EVERY territory, not just the handful a contract happens to name individually. Clarivate covers
  // 186 office codes and wrote eight of them down, so before the `"*"` entry this loop passed on FR
  // and disclosed a missing national register on CH, GB, JP, CN and AU — about a register the plan
  // had just searched. A caveat that fires on covered territories is how a real one gets skimmed.
  for (const id of ["clarivate", "corsearch", "signa"]) {
    const caps = capabilitiesFor(id);
    for (const t of ["FR", "US", "CH", "GB", "JP", "CN", "AU", "NL", "EU", "WO"]) {
      const { regions, deferred } = resolveRegions([t], caps);
      if (deferred.length) continue;         // uncovered here — that IS a disclosure, and a correct one
      const report = territoryLayerReport(t, regions, caps);
      assert.equal(report.complete, true,
        `${id}/${t}: every binding layer reached — ${JSON.stringify(regions)}`);
    }
  }
  // And the disclosure comes straight back if the plan stops carrying them: the form checks the
  // offices the plan ACTUALLY holds, so this can never be satisfied by a contract edit alone.
  const bare = territoryLayerReport("FR", ["FR"], capabilitiesFor("clarivate"));
  assert.equal(bare.complete, false);
  assert.deepEqual(bare.unsearched.map((u) => u.layer), ["regional", "international"]);
});

// ── the compile-time wiring ──────────────────────────────────────────────────────────────────────

test("REGRESSION FLOOR: a corsearch compile adds binding registers and changes NOTHING else", () => {
  const bare = compile(null);
  const withCaps = compile(capabilitiesFor("corsearch"));
  const { provider, ...withoutProviderStamp } = withCaps;
  assert.equal(provider, "corsearch");

  // ── WHAT THIS FLOOR NOW PINS, AND WHY IT MOVED ──────────────────────────────────────────
  //
  // It used to demand BYTE-IDENTICAL: corsearch is the default shape, so its contract had to be a
  // no-op against the no-contract path, and F2 store reuse depends on nothing being rewritten.
  //
  // A contract can now ADD — the ordered territory is a stack of registers and the plan must reach all
  // of it — so identity is the wrong floor and would forbid the fix. The property worth guarding is
  // the one that was actually at risk: an addition is additive. Nothing the bare compile produced may
  // be dropped, renamed or reordered, no entry may gain or lose a key, and the ONLY permitted
  // difference is extra binding-register codes on `regions`. That is stricter than "it changed
  // somehow" and it still fails on the rewrite F2 cares about.
  const BINDING_ADDITIONS = new Set(["EM", "EU", "WO", "BX"]);
  const strip = (plan) => ({ ...plan, regions: null, entries: plan.entries.map((e) => ({ ...e, regions: null })) });
  assert.deepEqual(strip(withoutProviderStamp), strip(bare),
    "no entry may gain a key and no field but `regions` may move — F2 store reuse depends on it");

  const added = (after, before) => {
    assert.deepEqual(after.slice(0, before.length), before,
      "the bare regions survive in order — an expansion appends, it never rewrites");
    for (const r of after.slice(before.length)) assert.ok(BINDING_ADDITIONS.has(r), `only binding registers may be added, got ${r}`);
  };
  added(withCaps.regions, bare.regions);
  for (const [i, e] of withCaps.entries.entries()) added(e.regions, bare.entries[i].regions);

  for (const e of withCaps.entries) {
    assert.equal(e.unsupported, undefined);
    assert.equal(e.unsupported_reason, undefined);
  }
  assert.equal(withCaps.deferred_coverage, undefined, "a fully-covered plan carries no deferred rows");
  assert.deepEqual(withCaps.regions, ["US", "EU", "CH", "WO"]);
});

test("OR-width agreement, PER PROVIDER: the planner's split == the active provider's executor bound", () => {
  // the corsearch bound is still pinned to the KERNEL constant, so drift is caught at its source
  assert.equal(PLAN_MAX_OR_WIDTH, ENUMERATE_NAMES_CHUNK_DEFAULT);
  assert.equal(planMaxOrWidth(capabilitiesFor("corsearch")), ENUMERATE_NAMES_CHUNK_DEFAULT);
  assert.equal(planMaxOrWidth(null), PLAN_MAX_OR_WIDTH, "no contract ⇒ the corsearch-shaped default");

  const wide = { elements: [{ element: "LUMENGARDE", band: {
    exactQueries: Array.from({ length: 197 }, (_, i) => `NEIGHBOUR${i}`), wildcardPatterns: [] } }] };
  // euipo 50: MEASURED against the sandbox, and set beneath the worst case rather than at the best.
  // The real constraint is a URL budget (the whole RSQL expression rides the query string), so the
  // clause count that fits depends on mark length — 90 at 8 chars, 60 at 40. The plan speaks clause
  // counts and cannot know the lengths, so the declaration has to hold for the long ones.
  // uspto-local 25: SQLite's own measured ceilings, not a trademark-data measurement.
  // free-tier 25: DERIVED, not measured — the MIN across its members, which is uspto-local's. This is
  // the number the whole pointwise-weakest rule exists for: planning the free tier to euipo's 50 would
  // dictate OR-stacks the US index rejects, on a plan the driver believes it can execute.
  const expected = { corsearch: 80, clarivate: 500, signa: 1, euipo: 50, "uspto-local": 25, "free-tier": 25 };
  for (const id of PROVIDERS) {
    const caps = capabilitiesFor(id);
    assert.equal(planMaxOrWidth(caps), expected[id], `${id}: declared OR-width`);
    const plan = compile(caps, { form: wide });
    const stacks = plan.entries.filter((e) => Array.isArray(e.terms));
    assert.ok(stacks.every((e) => e.terms.length <= caps.maxOrWidth),
      `${id}: the planner must never dictate an OR-stack the executor would have to chunk-rescue`);
    assert.equal(stacks.flatMap((e) => e.terms).length, 197, `${id}: no name lost in the split`);
    assert.equal(new Set(stacks.map((e) => e.qid)).size, stacks.length, `${id}: each chunk owns a distinct qid`);
    assert.deepEqual(validatePlanFeasibility(plan, { capabilities: caps }), [],
      `${id}: the split plan is feasible against its OWN bound`);
  }
  // signa: 197 names → 197 single-term entries (it has no OR surface at all)
  assert.equal(compile(capabilitiesFor("signa"), { form: wide }).entries.filter((e) => Array.isArray(e.terms)).length, 197);
});

test("the kernel seam block is CONSISTENT with the contract it sits in (no second source of truth)", async () => {
  const { CAPABILITIES: CORE_CAPABILITIES } = await import("../../providers/corsearch/src/core.js");
  // corsearch's core spreads THIS object into makeEnumerate — same object identity, so no literal in
  // core.js can drift from the contract.
  assert.equal(CORE_CAPABILITIES, capabilitiesFor("corsearch"));
  assert.equal(capabilitiesFor("corsearch").kernel.namesChunkDefault, ENUMERATE_NAMES_CHUNK_DEFAULT);
  // WHAT THIS LOOP DOES AND DOES NOT PROVE. It checks that each provider's kernel seam agrees
  // with that provider's own top-level facts. It does NOT check that anything RUNS them: a block can
  // be internally perfect and never reach a kernel. signa's capabilities.js says so of itself —
  // "PROVISIONAL -- signa does NOT call makeEnumerate yet" -- and passes this loop exactly as the
  // wired providers do, so a green sweep here reads as coverage it does not have. The exercised set is
  // asserted separately below, by VALUE, so the distinction is stated rather than assumed.
  for (const id of PROVIDERS) {
    const c = capabilitiesFor(id);
    assert.equal(c.kernel.countProbe, c.countProbe, `${id}: kernel countProbe seam`);
    assert.equal(c.kernel.screenSource, c.screenSource, `${id}: kernel screenSource seam`);
    assert.equal(c.kernel.namesChunkDefault, c.maxOrWidth, `${id}: the kernel chunk bound IS the declared OR-width`);
  }
});

test("wildcard is THREE sub-capabilities: the anchoring decides which one is checked", () => {
  assert.equal(wildcardCapabilityKey("EVERLIGH*"), "wildcardPrefix");
  assert.equal(wildcardCapabilityKey("*VERLIGHT"), "wildcardSuffix");
  assert.equal(wildcardCapabilityKey("*VERLIGH*"), "wildcardInfix");
  assert.equal(wildcardCapabilityKey("VERLIGHT"), "wildcardInfix");
  const sig = capabilitiesFor("signa");
  assert.equal(predicateGap("wildcard", "EVERLIGH*", sig), null, "signa anchors a prefix — `starts_with`");
  assert.equal(predicateGap("wildcard", "*VERLIGHT", sig), null, "…and a suffix, as of #1030 — `ends_with`");
  // The INFIX case is the one signa still cannot serve, and it is the one that keeps this test honest:
  // an assertion where every key resolves proves nothing about the gap machinery.
  assert.match(predicateGap("wildcard", "*VERLIGH*", sig), /wildcard \(wildcardInfix\)/,
    "the doubly-anchored pattern has no mapping — `contains` would search the asterisks");
  assert.match(predicateGap("wildcard", "VERLIGHT", sig), /wildcard \(wildcardInfix\)/,
    "and so does an unanchored one — same key, same refusal");
  assert.equal(predicateGap("exact", "LUMENGARDE", sig), null);
  assert.equal(predicateGap("owner", "ACME AG", sig), null, "#1030: signa has an owner field now");
  assert.equal(predicateGap("owner", "ACME AG", capabilitiesFor("corsearch")), null);
  assert.equal(predicateGap("owner", "ACME AG", null), null, "no contract ⇒ nothing is unsupported");
  // The gap machinery still has a REAL contract driving it, which matters more than which provider it
  // is: phonetic has no free-tier surface, so a phonetic slice defers on all three of those.
  for (const id of ["euipo", "uspto-local", "free-tier"]) {
    assert.match(predicateGap("phonetic", "LUMENGARDE", capabilitiesFor(id)), /phonetic/,
      `${id}: no phonetic surface — the slice must defer, never degrade to an exact search`);
  }
});

test("an unsupported predicate compiles to a DEFERRED slice, never a weaker query", () => {
  // ── THE SUBJECT MOVED, THE PROPERTY DID NOT ────────────────────────────────────────────
  // This was signa's test, because signa was the thin provider: no owner field, no contains mode, no
  // suffix operator. It has all three now, so driving the deferral machinery from signa's contract
  // would assert nothing — every predicate resolves. The property under test is "a gap defers rather
  // than degrading", and it needs a contract with a gap in it.
  //
  // A SYNTHETIC contract, not another shipped one, and deliberately: the shipped gaps are phonetic-only
  // (euipo, uspto-local, free-tier), which exercises one key. This shape is what signa WAS, so the
  // three-key case stays covered after the provider that used to embody it stopped doing so.
  const thin = { id: "thinco", ownerTermIntersection: false, maxOrWidth: 1,
    offices: capabilitiesFor("signa").offices,
    predicates: { exact: "exact", phonetic: "phonetic", wildcardPrefix: "prefix",
      default: null, wildcardSuffix: null, wildcardInfix: null, owner: null } };
  const job = { ...JOB, jurisdictions: ["US", "EU"] };
  const plan = compile(thin, { job });

  const unsupported = plan.entries.filter((e) => e.unsupported === true);
  assert.ok(unsupported.length > 0);
  // the crowd-gate parent + the incumbent-class sweep are `default` predicate entries → deferred here
  const defaults = plan.entries.filter((e) => e.predicate === "default");
  assert.ok(defaults.length > 0 && defaults.every((e) => e.unsupported === true),
    "no contains mode: every default-predicate slice defers rather than silently running `fuzzy`");
  // the ends-with fringe defers; the starts-with fringe does not
  const suffixFringe = plan.entries.find((e) => e.predicate === "wildcard" && String(e.term).startsWith("*"));
  const prefixFringe = plan.entries.find((e) => e.predicate === "wildcard" && String(e.term).endsWith("*"));
  assert.equal(suffixFringe.unsupported, true);
  assert.equal(prefixFringe.unsupported, undefined);
  // exact slices stay fully executable — a thin provider is not a dead provider
  assert.ok(plan.entries.some((e) => e.predicate === "exact" && e.unsupported === undefined));
  for (const e of unsupported) assert.match(e.unsupported_reason, /not supported by the active register provider \(thinco\)/);

  // the frozen artifact still parses and still validates: unsupported is DATA, not a broken entry
  const parsed = parseRegisterPlan(JSON.stringify(plan));
  assert.equal(parsed.entries.length, plan.entries.length);
  assert.deepEqual(validatePlanFeasibility(plan, { capabilities: thin }), []);
});

test("#1030 signa's plan now compiles with NO deferred predicate at all — the thin provider is not thin", () => {
  // The other half of the test above, and the one that will fail if a declaration is ever quietly
  // reverted to null: the same job that used to defer its owner slices, its contains sweeps and its
  // suffix fringe now compiles fully executable. A provider's reach is a property worth pinning in
  // BOTH directions — the old test could only ever catch a contract that over-claimed.
  const caps = capabilitiesFor("signa");
  const plan = compile(caps, { job: { ...JOB, jurisdictions: ["US", "EU"] } });
  const deferred = plan.entries.filter((e) => e.unsupported === true);
  assert.deepEqual(deferred.map((e) => `${e.predicate}:${e.term}`), [],
    "every predicate this job emits is now servable on signa — owner, default and the suffix fringe included");
  assert.ok(plan.entries.some((e) => e.predicate === "default"), "…and the job does emit the ones that used to defer");
  assert.deepEqual(validatePlanFeasibility(plan, { capabilities: caps }), []);
});

test("a jurisdiction outside the provider's coverage becomes a deferred row, never a dropped filter", () => {
  const caps = capabilitiesFor("signa");
  const plan = compile(caps, { job: { ...JOB, jurisdictions: ["US", "JP", "BR"] } });
  assert.deepEqual(plan.regions, ["uspto"], "the covered offices are translated into the provider's vocabulary");
  // JP and BR are DEFERRED, so they contribute no binding layers — a territory the provider cannot
  // reach must not quietly hand the plan a register list it never asked for.
  assert.deepEqual(plan.deferred_coverage.map((d) => d.jurisdiction), ["JP", "BR"]);
  for (const d of plan.deferred_coverage) assert.match(d.reason, /not covered by the active register provider \(signa\)/);
  // …and entries still RUN for the covered office (a partial coverage gap does not kill the plan)
  assert.ok(plan.entries.some((e) => e.unsupported === undefined));

  // every jurisdiction uncovered ⇒ EVERY entry is unsupported. An empty regions filter would sweep the
  // WORLD instead of the matter's scope — the opposite of what was asked, and it would answer "clean".
  const none = compile(caps, { job: { ...JOB, jurisdictions: ["JP", "BR"] } });
  assert.deepEqual(none.regions, []);
  assert.ok(none.entries.every((e) => e.unsupported === true));
  assert.ok(none.entries.every((e) => /not covered by the active register provider/.test(e.unsupported_reason)));

  // clarivate translates EU→EM and covers all three, so nothing defers — and WO joins them as the
  // international layer every one of the three is bound by.
  const cla = compile(capabilitiesFor("clarivate"));
  assert.deepEqual(cla.regions, ["US", "EM", "CH", "WO"]);
  assert.equal(cla.deferred_coverage, undefined);
  assert.ok(cla.entries.every((e) => e.unsupported === undefined),
    "clarivate maps every plan predicate — nothing defers on capability grounds");
  // Every entry carries the plan's own region list — the executor's scope comes from here, so an entry
  // that kept the pre- three would search fewer registers than the plan claims to have covered.
  assert.ok(cla.entries.every((e) => JSON.stringify(e.regions) === JSON.stringify(["US", "EM", "CH", "WO"])));
});

// ── mechanism A: the ledger relabel (coverage-limited → deferred) ─────────────────────────────────

test("RELABEL, per provider: an unsupported/uncovered reason on a coverage-limited row is coerced to `deferred`", () => {
  for (const id of PROVIDERS) {
    for (const reason of [unsupportedPredicateReason("owner", id), uncoveredJurisdictionReason(["JP"], id)]) {
      const rows = [{ axis: "primary-sweep", status: "coverage-limited", unit: "register", reason }];
      const [out] = coerceToolAbsenceDeferred(rows);
      assert.equal(out.status, "deferred",
        `${id}: a capability gap is a CLOSEABLE gap (another provider can reach it) — never an accepted saturation limit`);
      const { complete, materialGaps } = deriveCoverageStatus([out]);
      assert.equal(complete, false);
      assert.equal(materialGaps.length, 1);
    }
  }
});

test("the relabel stays NARROW: genuine saturation prose is untouched", () => {
  const untouched = [
    "total_hits 28412 exceeds the enumerate ceiling 600 — this is a CROWD, not a named exact/near band",
    "the band was too large to exhaust; we could not reach completeness within the pagination window",
    "a crowded field: the register is saturated with this element in these classes",
  ];
  for (const reason of untouched) {
    const [out] = coerceToolAbsenceDeferred([{ axis: "primary-sweep", status: "coverage-limited", reason }]);
    assert.equal(out.status, "coverage-limited", `must NOT relabel: ${reason.slice(0, 50)}`);
  }
});

// ── mechanism B: the executor short-circuit (error:true → joins MISSING) ─────────────────────────

test("EXECUTOR: an unsupported entry never builds a query — it emits error:true and joins DEFERRED", async () => {
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // A contract WITH A GAP is the whole input to this test, and signa stopped being one at —
  // its plan now compiles with nothing unsupported, which would make every assertion below vacuous
  // while the suite stayed green. Same synthetic shape as the deferral test above: what signa was.
  const caps = { id: "thinco", ownerTermIntersection: false, maxOrWidth: 1,
    offices: capabilitiesFor("signa").offices,
    predicates: { exact: "exact", phonetic: "phonetic", wildcardPrefix: "prefix",
      default: null, wildcardSuffix: null, wildcardInfix: null, owner: null } };
  const plan = compile(caps, { job: { ...JOB, jurisdictions: ["US"] } });
  const dir = mkdtempSync(join(tmpdir(), "phase3-plan-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify(plan));

  const calls = [];
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
  });
  const res = await executePlan("k", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);

  const band = JSON.parse(readFileSync(outPath, "utf8"));
  // guard-free unsupported entries get a block; a when-GUARDED one is `skipped` instead, because its
  // parent's failure is terminal for the fringe — that is the pre-existing crowd-gate doctrine,
  // and it is still a gap: the parent itself joins MISSING, so the axis can never read clean.
  const unsupportedQids = new Set(plan.entries.filter((e) => e.axis === "primary-sweep" && e.unsupported && !e.when).map((e) => e.qid));
  assert.ok(unsupportedQids.size > 0);
  for (const qid of unsupportedQids) {
    const b = band.find((x) => x.qid === qid);
    assert.ok(b, `${qid}: an unsupported slice still gets a BLOCK — the gap is recorded, not invisible`);
    assert.equal(b.error, true, "a provider that cannot run the slice is an ERROR block, never a sanctioned crowd");
    assert.equal(b.deferred, true, "…and a CAPABILITY gap is additionally marked deferred (nothing is left to retry)");
    assert.equal(b.state, "incomplete");
    assert.equal(b.total_hits, 0);
    assert.match(b.reason, /not supported by the active register provider/);
  }
  // …and NOTHING was sent to the provider for those slices
  const executedQids = plan.entries.filter((e) => e.axis === "primary-sweep" && !e.unsupported && !e.when).length;
  assert.equal(calls.length, executedQids, "an unsupported slice must issue ZERO provider calls");

  // ── 2026-07-21 review finding 10 — this assertion was CHANGED, and the change IS the fix ──────────
  // It previously demanded `fanIn.missing.includes(qid)` and skeleton state "unexecuted". That was the
  // defect, not the contract: MISSING is the retry bucket, so an unsupported slice rode the repair
  // ladder (which re-ran the identical deterministic refusal every rung) into the fan-in StageFailure —
  // i.e. the "deferred coverage row" doctrine 2 and this module's own comments promise was in fact a
  // RUN-KILLER. It now joins its own `deferred` bucket, and the guarantee the old assertion existed to
  // protect is asserted DIRECTLY below (and more strictly): a confirmed-clean claim over the axis is
  // still impossible, and the slice is still not counted executed.
  const fanIn = joinPlanToBands(parseRegisterPlan(JSON.stringify(plan)), { "primary-sweep": band });
  const deferredQids = new Set((fanIn.deferred ?? []).map((d) => d.qid));
  for (const qid of unsupportedQids) {
    assert.ok(deferredQids.has(qid), `${qid} must join DEFERRED — a gap to disclose, not a slice to retry`);
    assert.ok(!fanIn.missing.includes(qid), `${qid} must NOT join MISSING — retrying a capability gap is pointless`);
    assert.ok(!fanIn.executed.some((x) => x.qid === qid), `${qid} must never count as EXECUTED`);
  }
  const skeleton = deriveCoverageSkeleton(parseRegisterPlan(JSON.stringify(plan)), fanIn);
  const axis = skeleton.find((s) => s.axis === "primary-sweep");
  assert.equal(axis.state, "deferred");
  assert.deepEqual(axis.deferred.sort(), [...unsupportedQids].sort());
  // THE guarantee: a clean can never be claimed over it. — the deferred branch left
  // findUnexecutedCleanClaims with the prose disclosure join it carried; the driver now writes one form
  // row per refused qid and marks it `open`, so the requirement is structural rather than typed.
  const { rows: formRows } = coverageFormRows({ skeleton, plan: parseRegisterPlan(JSON.stringify(plan)),
    bandBlocksByAxis: { "primary-sweep": band } });
  for (const qid of unsupportedQids) {
    const owed = formRows.find((r) => r.kind === "deferred" && r.qid === qid);
    assert.ok(owed, `${qid} owes a row of its own`);
    assert.equal(rowIsSettled({ ...owed, status: "confirmed-clean", reason: "clean" }, owed), false);
  }
});

// ── PR-1: the executor's LAST-HANDS refusals — plan defects and the owner scope field ────────────

test("EXECUTOR (A1): a plan-defect entry is REFUSED at dispatch — error:true, NOT deferred, zero provider calls, deterministic class", async () => {
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { classifyFailureReason } = await import("../repairs.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // a hand-shaped frozen plan carrying the 2026-07-28 defect classes, plus one clean entry
  const plan = { entries: [
    { qid: "primary-sweep:exact:tiki-star", axis: "primary-sweep", predicate: "exact", term: "TIKI*", nice_classes: ["5"], regions: [], expected_kind: "enumerate" },
    { qid: "primary-sweep:exact:label", axis: "primary-sweep", predicate: "exact", term: "TIKE, TIPI one-keystroke neighbours of TIKI", nice_classes: ["5"], regions: [], expected_kind: "enumerate" },
    { qid: "primary-sweep:exact:slogan", axis: "primary-sweep", predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER", term_literal: true, nice_classes: ["29"], regions: [], expected_kind: "enumerate" },
    { qid: "primary-sweep:exact:clean", axis: "primary-sweep", predicate: "exact", term: "TIKI", nice_classes: ["5"], regions: [], expected_kind: "enumerate" },
  ] };
  const dir = mkdtempSync(join(tmpdir(), "plan-defect-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify(plan));

  const calls = [];
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
  });
  const res = await executePlan("k", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);
  const band = JSON.parse(readFileSync(outPath, "utf8"));

  for (const qid of ["primary-sweep:exact:tiki-star", "primary-sweep:exact:label"]) {
    const b = band.find((x) => x.qid === qid);
    assert.equal(b.error, true, `${qid}: a plan defect is an ERROR block`);
    assert.notEqual(b.deferred, true, `${qid}: NOT deferred — this is a defect in the plan, not a capability the provider honestly lacks`);
    assert.match(b.reason, /^plan-defect: /);
    assert.match(b.reason, /slice NOT dispatched \(a literal search here would be a false clean\)/);
    assert.equal(classifyFailureReason(b.reason), "deterministic", "no park ladder grinds against an answer that cannot change");
  }
  // the escape hatch and the clean entry both dispatched
  for (const qid of ["primary-sweep:exact:slogan", "primary-sweep:exact:clean"]) {
    const b = band.find((x) => x.qid === qid);
    assert.notEqual(b.error, true, `${qid} must dispatch`);
  }
  assert.equal(calls.length, 2, "defective slices issue ZERO provider calls");
  // fan-in: the defective slices join MISSING (the honest-fail lane), never executed
  const fanIn = joinPlanToBands(plan, { "primary-sweep": band });
  assert.ok(fanIn.missing.includes("primary-sweep:exact:tiki-star"));
  assert.ok(fanIn.missing.includes("primary-sweep:exact:label"));
  assert.ok(!fanIn.executed.some((x) => x.qid === "primary-sweep:exact:tiki-star"));
});

test("EXECUTOR (F1): the owner scope field rides the query on a capable provider; a declared-incapable one defers, never widens", async () => {
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const plan = { entries: [
    { qid: "supp:primary-sweep:default:tiki:owner1", axis: "primary-sweep", predicate: "default", term: "TIKI",
      owner: "Kestrel Beverages Inc.", nice_classes: ["32"], regions: [], expected_kind: "enumerate" },
  ] };
  const dir = mkdtempSync(join(tmpdir(), "owner-scope-"));
  const planPath = join(dir, "register-plan.json");
  writeFileSync(planPath, JSON.stringify(plan));

  // capable provider (declaration-driven, no vendor name anywhere): the query carries BOTH clauses
  const seen = [];
  const able = makeExecutePlan({
    search: async () => ({ type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }),
    enumerate: async (_a, p) => { seen.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 2, count: 2, records: [] }) }; },
    capabilities: { id: "able", ownerTermIntersection: true },
  });
  const outA = join(dir, "band-able.json");
  await able("k", { plan_path: planPath, axis: "primary-sweep", output_path: outA }, {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "TIKI", "the mark clause survives");
  assert.equal(seen[0].owner, "Kestrel Beverages Inc.", "…AND the owner filter rides beside it (the intersection)");
  const ableBlock = JSON.parse(readFileSync(outA, "utf8"))[0];
  assert.equal(ableBlock.state, "enumerated");
  assert.match(ableBlock.query, /owner:Kestrel Beverages Inc./,
    "the band's query string DISCLOSES the owner narrowing — an owner×term slice must never read as the full term band");

  // incapable provider: refused BEFORE the query is built — a deferred, disclosed capability gap
  const calls = [];
  const thin = makeExecutePlan({
    search: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
    capabilities: { id: "thin", ownerTermIntersection: false },
  });
  const outT = join(dir, "band-thin.json");
  await thin("k", { plan_path: planPath, axis: "primary-sweep", output_path: outT }, {});
  assert.equal(calls.length, 0, "dropping the owner filter would be a silently different search — nothing is sent");
  const b = JSON.parse(readFileSync(outT, "utf8"))[0];
  assert.equal(b.error, true);
  assert.equal(b.deferred, true, "a capability gap defers (disclosed), it does not ride the retry ladder");
  assert.match(b.reason, /owner×term intersection is not supported by the active register provider \(thin\)/);
  const fanIn = joinPlanToBands(plan, { "primary-sweep": JSON.parse(readFileSync(outT, "utf8")) });
  assert.equal(fanIn.deferred.length, 1);
});

test("EXECUTOR (script form): a native-script slice on a romanisation-indexed provider rides the SAME deferral chain — and a clean can never be claimed over the axis", async () => {
  // The 2026-07-29 defect, followed all the way to the gate. The frozen plan's transliteration axis
  // carried native-script terms; on a provider whose index holds only the romanisation those searches
  // would answer 0 with no error, and `enumerated / total_hits: 0` reads as CLEAN. The refusal must
  // therefore land in the DEFERRED bucket — not MISSING (nothing to retry), not EXECUTED (nothing was
  // searched) — and the axis must become unclaimable. This asserts the whole chain, not the block shape.
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const plan = { entries: [
    { qid: "transliteration-numeric:exact:native", axis: "transliteration-numeric", predicate: "exact",
      term: "ティキスラッシュ", nice_classes: ["32"], regions: [], expected_kind: "enumerate" },
    { qid: "transliteration-numeric:exact:latin", axis: "transliteration-numeric", predicate: "exact",
      term: "TIKI GRANIZADO", nice_classes: ["32"], regions: [], expected_kind: "enumerate" },
  ] };
  const dir = mkdtempSync(join(tmpdir(), "script-form-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify(plan));

  const calls = [];
  // Declaration-driven, no vendor name anywhere: this is any provider that indexes the romanisation.
  const romanIndexed = makeExecutePlan({
    search: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { calls.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
    capabilities: { id: "roman-indexed", nativeScriptIndex: false },
  });
  await romanIndexed("k", { plan_path: planPath, axis: "transliteration-numeric", output_path: outPath }, {});

  const band = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(calls.length, 1, "the Latin member is searched; the native one never reaches the wire");
  const native = band.find((b) => b.qid === "transliteration-numeric:exact:native");
  assert.equal(native.state, "incomplete");
  assert.equal(native.error, true);
  assert.equal(native.deferred, true);
  assert.equal(native.total_hits, 0, "…and it is a DISCLOSED zero, which is a different object from a counted one");
  assert.match(native.reason, /capability-gap:/);
  assert.match(native.reason, /not in Latin script/);

  const parsed = parseRegisterPlan(JSON.stringify(plan));
  const fanIn = joinPlanToBands(parsed, { "transliteration-numeric": band });
  assert.ok((fanIn.deferred ?? []).some((d) => d.qid === "transliteration-numeric:exact:native"),
    "the refusal joins DEFERRED — a gap to disclose");
  assert.ok(!fanIn.missing.includes("transliteration-numeric:exact:native"),
    "…never MISSING: no rung of the repair ladder can change a client-side refusal");
  assert.ok(!fanIn.executed.some((x) => x.qid === "transliteration-numeric:exact:native"),
    "…and never EXECUTED: nothing was searched");

  const skeleton = deriveCoverageSkeleton(parsed, fanIn);
  const axis = skeleton.find((s) => s.axis === "transliteration-numeric");
  assert.equal(axis.state, "deferred", "one deferred slice makes the whole axis deferred");
  // THE guarantee the whole change exists for: the axis cannot be reported clean. — carried by the
  // coverage form's `open` row for that qid rather than by a prose disclosure join.
  const owed = coverageFormRows({ skeleton, plan: parsed, bandBlocksByAxis: {} }).rows
    .find((r) => r.kind === "deferred" && r.qid === "transliteration-numeric:exact:native");
  assert.ok(owed, "the refused slice owes a row of its own");
  assert.equal(owed.open, true);
  assert.equal(rowIsSettled({ ...owed, status: "confirmed-clean", reason: "clean" }, owed), false);

  // …and the SAME plan on a provider that declares a character index runs in full — no deferral, no
  // gate violation. The declaration is the only thing that differs.
  const charCalls = [];
  const charIndexed = makeExecutePlan({
    search: async (_a, p) => { charCalls.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
    enumerate: async (_a, p) => { charCalls.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 4, count: 4, records: [] }) }; },
    capabilities: { id: "char-indexed", nativeScriptIndex: true },
  });
  const outChars = join(dir, "band-chars.json");
  await charIndexed("k", { plan_path: planPath, axis: "transliteration-numeric", output_path: outChars }, {});
  const charBand = JSON.parse(readFileSync(outChars, "utf8"));
  assert.equal(charCalls.length, 2, "both members searched — banning native script here would DELETE real coverage");
  assert.equal(charCalls[0].name, "ティキスラッシュ", "the characters go to the wire verbatim");
  assert.equal(charBand.filter((b) => b.deferred).length, 0);
  const charSkeleton = deriveCoverageSkeleton(parsed, joinPlanToBands(parsed, { "transliteration-numeric": charBand }));
  assert.notEqual(charSkeleton.find((s) => s.axis === "transliteration-numeric").state, "deferred");
});

test("F1 declarations match the wire truth: every shipped provider intersects owner × term natively", () => {
  assert.equal(capabilitiesFor("corsearch").ownerTermIntersection, true);
  assert.equal(capabilitiesFor("clarivate").ownerTermIntersection, true);
  // signa was the counter-example here and removed it: `filters.owner_name` composes with a text
  // query in ONE request. Evidenced on the DETERMINISTIC shape, where recall is fixed and the totals
  // are comparable — `match: contains` alone 2047, the same term with an owner filter 689, a proper
  // subset. (The ranked shape gave 238 → 1054, i.e. MORE with the extra clause, because `similar`
  // recall varies with the filter; a reader measuring there would wrongly conclude the filter was
  // being ignored, which is why the note is in the contract and not only here.)
  assert.equal(capabilitiesFor("signa").ownerTermIntersection, true);
  assert.equal(capabilitiesFor("signa").predicates.owner, "owner_name");
  // The property this test actually guards is that the declaration and the wire agree, so the
  // MECHANISM still needs a false case somewhere or the "defer, never widen" lane is untested. It has
  // one: driver/test/register-plan.test.mjs drives it from a synthetic contract, which is where the
  // false case has to live now that no shipped provider carries it.
});

// ── the owner lane: the bare-owner count descriptor points at its owner×term slice qids ──────────

test("owner-lane count descriptor: covered_by rides the block and the reason NAMES the slice qids — never a count and a shrug", async () => {
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const plan = { entries: [
    { qid: "incumbent-class:default:glimmer+owner-vantage-orchard-inc", axis: "incumbent-class", predicate: "default",
      term: "GLIMMER", owner: "Vantage Orchard Inc.", nice_classes: ["32"], regions: [], expected_kind: "enumerate" },
    { qid: "incumbent-class:owner:vantage-orchard-inc+watch", axis: "incumbent-class", predicate: "owner",
      term: "Vantage Orchard Inc.", nice_classes: ["32"], regions: [], expected_kind: "count",
      covered_by: ["incumbent-class:default:glimmer+owner-vantage-orchard-inc"] },
    { qid: "plain-count", axis: "incumbent-class", predicate: "default", term: "GLIMMER", nice_classes: ["32"], regions: [], expected_kind: "count" },
  ] };
  const dir = mkdtempSync(join(tmpdir(), "owner-count-"));
  const planPath = join(dir, "register-plan.json");
  const outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify(plan));

  const calls = { search: [], enumerate: [] };
  const executePlan = makeExecutePlan({
    search: async (_a, p) => { calls.search.push(p); return { type: "text", text: JSON.stringify({ total_hits: 3, results: [] }) }; },
    enumerate: async (_a, p) => { calls.enumerate.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 1, records: [] }) }; },
  });
  await executePlan("k", { plan_path: planPath, axis: "incumbent-class", output_path: outPath }, {});
  const blocks = JSON.parse(readFileSync(outPath, "utf8"));
  const watch = blocks.find((b) => b.qid.endsWith("+watch"));
  assert.equal(watch.state, "incomplete", "a count descriptor is an honest incomplete, by contract");
  assert.deepEqual(watch.covered_by, ["incumbent-class:default:glimmer+owner-vantage-orchard-inc"]);
  assert.match(watch.reason, /CROWD CONTEXT, never coverage/);
  assert.match(watch.reason, /incumbent-class:default:glimmer\+owner-vantage-orchard-inc/);
  assert.match(watch.reason, /"Portfolio too large, noted" is not a finding/);
  // an ordinary dictated count keeps its historical descriptor byte-identical
  const plain = blocks.find((b) => b.qid === "plain-count");
  assert.equal(plain.reason, "count-only crowd descriptor (plan-dictated)");
  assert.equal(plain.covered_by, undefined);
  // the owner×term slice dispatched as one owner-scoped query (F1 carries both clauses)
  assert.equal(calls.enumerate.length, 1);
  assert.equal(calls.enumerate[0].name, "GLIMMER");
  assert.equal(calls.enumerate[0].owner, "Vantage Orchard Inc.");
});

// ── the owner lane: the enumerate ceiling is PER-PROVIDER capabilities DATA ──────────────────────

test("the enumerate ceiling is declared per provider — plumbing is data, values stay 600 until the live owner×term probe", async () => {
  const { ENUMERATE_CEILING_DEFAULT } = await import("../../providers/_shared/enumerate.mjs");
  assert.equal(ENUMERATE_CEILING_DEFAULT, 600, "the kernel fallback");
  for (const id of PROVIDERS) {
    const c = capabilitiesFor(id);
    assert.ok(Number.isInteger(c.kernel.ceilingDefault) && c.kernel.ceilingDefault >= 1,
      `${id}: the ceiling is a declared per-provider number, not a shared literal`);
    // The VALUES are deliberately identical today. F8 verified the 600 is OURS (not the providers':
    // corsearch reaches 5000, clarivate 30000) and that three of the postmortem run's owner crowds died on it —
    // but raising any provider's value is a decision for the empirical owner×term probe, recorded as
    // fixtures, never a side effect of plumbing. Change a value here WITH that probe, or not at all.
    assert.equal(c.kernel.ceilingDefault, 600, `${id}: value unchanged until the probe`);
  }
});

// ── The F3 `deferred` disclosure join (E2E R2 / VENZY, 2026-07-31) ──────────────────────────────────
//
// The second unclearable gate. Same slice-vs-axis defect ION/copper-foundry fixed for the INCOMPLETE
// gate on 2026-07-22, in the sibling gate nobody carried it to. Fixtures below are the REAL rows from
// the E2E R2 run that hit it — the deferred qids, the disclosure row's own wording (bold status and
// all), and a representative clean row — not invented shapes. An invented fixture here would certify
// the bug: the whole point is that the digest's honest row was not recognised.

const VENZY_DEFERRED = ["primary-sweep:exact:z+form", "primary-sweep:exact:inz+form"];
const VENZY_SKELETON = [{
  axis: "primary-sweep", state: "deferred", entries: 58, executed: 56, crowds: 2, skipped: 0,
  missing: [], deferred: VENZY_DEFERRED,
}];
// the digest's actual disclosure row — both qids named verbatim in the unit cell
const VENZY_DISCLOSURE = {
  axis: "primary-sweep", status: "deferred",
  unit: "primary-sweep / homoglyph exact slices — qids `primary-sweep:exact:z+form` (κιηzυ) and `primary-sweep:exact:inz+form` (кinzу)",
  reason: 'Quoting the plan-execution receipt: "capability-gap: term is not in Latin script…" These two dictated slices were never run.',
};
const VENZY_CLEANS = [
  { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / exact-in-class-live: VENZY (cl. 5+44, US/EU/UK/AU)", reason: "enumerated to has_more:false across all four regions" },
  { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / formative root VENZ", reason: "three independent instruments all enumerated" },
  { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / phonetic band + 82-term edit-distance-1 OR-stack", reason: "all enumerated" },
];

// — THE DISCLOSURE JOIN IS GONE, AND WITH IT EVERY WAY OF GETTING IT WRONG.
//
// The four tests that stood here all measured one thing: whether prose the digest TYPED named the
// deferred qids well enough for a substring join to recognise it. Full disclosure cleared the axis, half
// disclosure fired on the remainder, a non-clean row that named nothing laundered nothing, and a bolded
// `**deferred**` status still had to normalise. Every one of them is a test of a transcription contract.
//
// The driver writes one form row PER DEFERRED QID now, carrying that qid and its own receipt reason, and
// marks it `open`. The requirement is identical — every refused slice is on the report's face, and no
// clean claim may rest on one — and it holds by construction: there is no text to get right, no partial
// disclosure to compute, and no status cell to bold. What survives is the JUDGMENT, and these assert it
// on the same real R2 fixtures.
const VENZY_PLAN = { entries: VENZY_DEFERRED.map((qid) => ({ qid, axis: "primary-sweep", predicate: "exact",
  term: qid.endsWith("z+form") ? "κιηzυ" : "кinzу", nice_classes: ["5", "44"], expected_kind: "enumerate" })) };
const VENZY_REASONS = Object.fromEntries(VENZY_DEFERRED.map((q) =>
  [q, "capability-gap: term is not in Latin script; the provider indexes by transliteration"]));
const venzyForm = (skeleton = VENZY_SKELETON) =>
  coverageFormRows({ skeleton, plan: VENZY_PLAN, bandBlocksByAxis: {}, deferredReasons: VENZY_REASONS }).rows;

test("F3 deferred (VENZY): every refused qid owes its OWN row, carrying its OWN receipt reason", () => {
  // Before the join this gate returned one violation PER clean row — ten on the live run — so no honest
  // digest could pass: relabelling slices that genuinely paged to has_more:false is a lie the other way.
  // The digest's honest row WAS recognised in the end, but only because it retyped two qids correctly.
  const rows = venzyForm();
  const owed = rows.filter((r) => r.kind === "deferred");
  assert.deepEqual(owed.map((r) => r.qid).sort(), [...VENZY_DEFERRED].sort(),
    "both qids ship — the old dispatch hint printed six per axis and elided the rest");
  for (const r of owed) {
    assert.equal(r.open, true);
    assert.match(r.receipt_reason, /not in Latin script/, "each carries ITS OWN reason, not the first qid's");
  }
});

test("F3 deferred: the axis's OTHER slices keep their clean rows once the refused ones are settled honestly", () => {
  const rows = venzyForm().map((r) => r.open
    ? { ...r, status: "deferred", reason: "never run; the provider cannot express the query" }
    : { ...r, status: "confirmed-clean", reason: "enumerated to has_more:false" });
  const seat = VENZY_CLEANS.map((c, i) => ({ row_id: `CS-${i}`, axis: c.axis, kind: "seat", unit: c.unit,
    open: false, status: c.status, reason: c.reason }));
  assert.deepEqual(findCoverageFormViolations([...rows, ...seat]), [],
    "genuinely enumerated slices STAY confirmed-clean — the relabel-everything demand is what made this unclearable");
});

test("F3 deferred: a refused slice claimed CLEAN is still refused, and no other row can launder it", () => {
  const rows = venzyForm().map((r) => ({ ...r, status: "confirmed-clean", reason: "swept" }));
  const vague = { row_id: "CS-V", axis: "primary-sweep", kind: "seat", open: false,
    unit: "primary-sweep / some limits apply", status: "coverage-limited", reason: "various gaps, not enumerated here" };
  const v = findCoverageFormViolations([...rows, vague]);
  assert.equal(v.filter((x) => x.reason === "no_status").length, VENZY_DEFERRED.length,
    "one violation per refused slice claimed clean — and a non-clean row elsewhere on the axis excuses none of them");
  for (const x of v) assert.match(x.detail, /never searched/);
});

test("F3 deferred: PARTIAL settlement fires, and names ONLY the row that is still unsettled", () => {
  const rows = venzyForm();
  const half = rows.map((r, i) => i === rows.length - 1
    ? { ...r, status: null, reason: null }
    : { ...r, status: r.open ? "deferred" : "confirmed-clean", reason: "judged" });
  const v = findCoverageFormViolations(half);
  assert.equal(v.length, 1, "a half-settled axis is not a settled axis");
  assert.equal(v[0].row, rows[rows.length - 1].row_id,
    "the violation names the row alone — not the whole axis, which is what made it unactionable");
});

test("F3 deferred: a `deferred` axis carrying no qids is a contradiction and still fires", () => {
  // undisclosedDeferredQids returned [] (fire, naming nothing) rather than null for this shape, and its
  // own doc block called silently passing it "the one way this join could turn a gate into a hole". The
  // contradiction rides the AXIS row's `open` flag now.
  const rows = venzyForm([{ axis: "primary-sweep", state: "deferred", missing: [], deferred: [] }]);
  const ax = rows.find((r) => r.kind === "axis");
  assert.equal(ax.open, true, "the gate must never turn into a hole on a malformed skeleton");
  assert.equal(rowIsSettled({ ...ax, status: "confirmed-clean", reason: "clean" }, ax), false);
  assert.equal(rowIsSettled({ ...ax, status: "deferred", reason: "the skeleton contradicts itself" }, ax), true);
});

test("F3 deferred: the join is deferred-ONLY — `unexecuted` and `skipped` stay strict", () => {
  // unexecuted has a live remedy ("or the coverage actually ran"); skipped means executed === 0, so no
  // clean row on it has any foundation. Neither may be talked out of firing by a disclosure row.
  const unexecuted = [{ axis: "primary-sweep", state: "unexecuted", missing: ["primary-sweep:exact:venzy"], deferred: [] }];
  const disclosed = { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / qid `primary-sweep:exact:venzy` did not run", reason: "named verbatim" };
  const vU = findUnexecutedCleanClaims([VENZY_CLEANS[0], disclosed], unexecuted);
  assert.equal(vU.length, 1);
  assert.equal(vU[0].token, "coverage_clean_unexecuted:primary-sweep", "disclosure must NOT excuse a slice that could still be run");

  const skipped = [{ axis: "primary-sweep", state: "skipped", missing: [], deferred: [] }];
  const vS = findUnexecutedCleanClaims([VENZY_CLEANS[0], disclosed], skipped);
  assert.equal(vS.length, 1);
  assert.equal(vS[0].token, "coverage_clean_skipped:primary-sweep", "nothing on the axis ran — a clean has no foundation to rest on");
});

test("the ARCHIVED-RUN reader still normalises a bolded `**deferred**` status", () => {
  // The live digest bolded its non-clean statuses. deleted every gate's use of this parser, but it
  // survives as the reader for archived runs (loadCoverageLedger's fallback, and 64 corpus files), so the
  // normalisation still has to hold — an absence of coverage rows on an archived run is not a pass.
  const md = [
    "## Coverage ledger",
    "",
    "| Coverage unit | Status | Reason |",
    "|---|---|---|",
    "| primary-sweep / exact-in-class-live: VENZY (cl. 5+44, US/EU/UK/AU) | confirmed-clean | enumerated to has_more:false |",
    `| ${VENZY_DISCLOSURE.unit} | **deferred** | ${VENZY_DISCLOSURE.reason} |`,
  ].join("\n");
  const { rows } = parseCoverageLedgerFullSync(md);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.status === "deferred"), "the bolded status normalises to the bare token");
  assert.ok(rows.some((r) => r.status === "confirmed-clean"));
});

// ── — a declared kernel block is not an exercised one ───────────────────────────────────────
//
// The consistency sweep above passes for all six providers, including one whose own source says its
// kernel block is PROVISIONAL and unreached. Nothing stated that limit, so the green read as coverage.
// This asserts the boundary BY VALUE: which cores actually construct the shared kernel, and which only
// describe what they would pass it. When signa is wired, this test fails and names itself as
// the thing to update — which is the point. A limit nobody has to notice is a limit nobody maintains.

test("#1027 the kernel seam is DECLARED by every provider and EXERCISED by a named subset", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  // Read the core, do not import it — importing runs module-level credential and network setup for
  // vendors this test has no business touching, and the question here is purely "does this file
  // construct the kernel".
  const CORES = {
    corsearch: "providers/corsearch/src/core.js",
    clarivate: "providers/clarivate/src/core.js",
    signa: "providers/signa/src/core.js",
    euipo: "providers/euipo/src/core.js",
    "uspto-local": "providers/uspto-local/src/core.js",
  };
  const CALLS_KERNEL = /\bmakeEnumerate\s*\(/;

  const exercised = [];
  for (const [id, rel] of Object.entries(CORES)) {
    let src;
    try { src = readFileSync(join(ROOT, rel), "utf8"); }
    catch { assert.fail(`${id}: ${rel} is unreadable — an absent core must not read as "not exercised"`); }
    if (CALLS_KERNEL.test(src)) exercised.push(id);
  }

  // BY VALUE, not by count. A count survives one provider gaining the kernel while another loses it.
  // ADDED SIGNA, which is what this assertion was written to catch. It failed by name on the
  // wiring commit and told the author exactly what to update — the behaviour a value-pinned guard is
  // for, as against a count that would merely have said "5 !== 4".
  assert.deepEqual(exercised.sort(), ["clarivate", "corsearch", "euipo", "signa", "uspto-local"],
    "the set of cores that construct the shared enumerate kernel has changed — update this list and "
    + "say in the PR which provider gained or lost the kernel, and why");

  // The complement, kept as an assertion rather than dropped: free-tier is a COMPOSITE and constructs
  // no kernel of its own — it routes to members that do. A day when it appears here is a day someone
  // gave the composite its own executor, which would be two sources of truth for one search.
  assert.ok(!exercised.includes("free-tier"),
    "the composite must not construct its own kernel — it routes to members that do");

  // And every provider — exercised or not — still DECLARES the block. That is what the sweep above
  // checks; naming it here is what keeps the two readings apart.
  for (const id of PROVIDERS) {
    assert.ok(capabilitiesFor(id).kernel, `${id}: declares a kernel seam block`);
  }
});
