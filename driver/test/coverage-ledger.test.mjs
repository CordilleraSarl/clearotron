// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WS-A machine coverage ledger (the 2026-06-12 three-workstream design): the strict
// JSON parser (token-first throws), the registerFindings machine-vs-legacy dispatch (validator NEVER
// throws), and prose↔JSON gate-decision equivalence over the digest.md fixture rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { parseCoverageLedgerJson, classTokensFromScopeText, normalizeAxis, REGISTER_AXES, COVERAGE_STATUSES, decideAxes, deriveCoverageStatus, deriveFloorKeys, coerceToolAbsenceDeferred } from "../coverage-ledger.mjs";
import { validators } from "../verify.mjs";
import { parseCoverageLedger, parseCoverageLedgerFull, loadCoverageLedger, reopenFetchCeiling } from "../pipeline.mjs";
import { searchedJurisdictionsFromPlan } from "../register-plan.mjs";

// ── item 13 — a searched territory traces to an EXECUTED QUERY ──────────────────────────────────────
//
// The three tests that lived here exercised `extractSearchedJurisdictions`, a two-letter scan over the
// coverage ledger's prose. That function is gone and so are they. The last of the three was mine, and it
// is worth recording why it proved nothing: it paired a unit string with a `scope: "DE"` that
// `renderCoverageLedgerJson` cannot produce from that unit, so the assert "the structured scope decides,
// not the prose beside it" passed against a row no run has ever written. An invented fixture certifies
// whatever shape you imagined. These are built from the real record instead — a plan entry and an
// execution receipt in the exact shape the archived R2 test run carries, with the owner name replaced by
// a synthetic one that keeps the only load-bearing property: the "& Co. KG" suffix.
const REAL_PLAN = {
  schema_version: 1, plan_version: 3, nice_classes: ["5", "44"], regions: ["US", "EM", "GB", "AU"], provider: "corsearch",
  entries: [
    { qid: "primary-sweep:exact:venzy", nice_classes: ["5", "44"], regions: ["US", "EM", "GB", "AU"], axis: "primary-sweep", predicate: "exact", term: "VENZY", expected_kind: "enumerate" },
    { qid: "primary-sweep:wildcard:venz", nice_classes: ["5", "44"], regions: ["US", "EM"], axis: "primary-sweep", predicate: "wildcard", term: "VENZ*", expected_kind: "enumerate" },
    { qid: "incumbent-class:owner:muster", nice_classes: ["5"], regions: ["GB"], axis: "incumbent-class", predicate: "owner", term: "Muster Handels GmbH & Co. KG", expected_kind: "count" },
  ],
};

test("item 13 — only the territories an EXECUTED query names are searched", () => {
  const r = searchedJurisdictionsFromPlan(REAL_PLAN, { executed: [{ qid: "primary-sweep:wildcard:venz", state: "enumerated" }] });
  assert.deepEqual(r.jurisdictions, ["EU", "US"], "the executed entry's own regions, canonicalised (EM → EU)");
  assert.equal(r.resolved, true);
  assert.ok(!r.jurisdictions.includes("GB"),
    "a planned-but-unexecuted entry's territory is NOT searched — that is the whole disclosure this feeds");
});

test("item 13 — an owner name that IS a jurisdiction code no longer marks a territory searched", () => {
  // "Muster Handels GmbH & Co. KG" — a real owner from the archived run. Under the prose
  // scan this contributed KG (Kyrgyzstan). could not have caught it: KG is a real code, so the
  // "unknown token" narrowing passes it straight through. Here the entry's OWN regions decide.
  const r = searchedJurisdictionsFromPlan(REAL_PLAN, { executed: [{ qid: "incumbent-class:owner:muster" }] });
  assert.deepEqual(r.jurisdictions, ["GB"], "the query's declared region, nothing harvested from its term");
  assert.ok(!r.jurisdictions.includes("KG"), "\"Co. KG\" is a company form; reading it as Kyrgyzstan marked a scoped territory searched");
});

test("item 13 — unresolvable means UNSEARCHED, never a fallback to prose", () => {
  for (const [label, plan, exec] of [
    ["no receipt", REAL_PLAN, null],
    ["empty receipt", REAL_PLAN, { executed: [] }],
    ["no plan", null, { executed: [{ qid: "primary-sweep:exact:venzy" }] }],
    ["plan with no entries", { entries: [] }, { executed: [{ qid: "x" }] }],
  ]) {
    const r = searchedJurisdictionsFromPlan(plan, exec);
    assert.deepEqual(r.jurisdictions, [], `${label}: claims nothing`);
    assert.equal(r.resolved, false, `${label}: and says it could not resolve, so the caller discloses`);
  }
});

test("item 13 — the prose derivation is gone and must not come back", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.ok(!/export function extractSearchedJurisdictions/.test(src), "the function is deleted, not merely unused");
  assert.doesNotMatch(src, /matchAll\(\/\b\(EU\|EUTM\|\[A-Z\]\{2\}\)\b\/g\)/,
    "and no two-letter scan over ledger text replaces it");
});

// judgment-relocation (2026-06-23): the findDominantFloorRow / findFloorShapeGaps tests were REMOVED with
// those functions (the interim NOVAPULSE search-shape gate). Sufficiency on the dangerous band is now judgment's
// call (synthesis coverage_judgment over the COMPLETE named band), not a driver re-parse of the prose ledger.

// ---- deriveFloorKeys: the stemmer guard + carry-BOTH (reviewer point 3 — a mis-stem can't lose coverage) --

test("deriveFloorKeys: carries BOTH the root and the full token; guards a garbage/over-short/unrelated stem", () => {
  // the lynchpin case — BIOVELTRIN's dominant element is VELTRIN, the formative root is VELTRI (catches VELTRI*).
  // The root has to be a STEM OF the dominant element — the case below proves an unrelated one is dropped — so
  // when the cluster-12 completion renamed the element, the root had to follow it or this stopped being the
  // lynchpin case and became a second copy of the unrelated-root case.
  assert.deepEqual(deriveFloorKeys({ dominantEl: "VELTRIN", root: "VELTRI" }), ["veltrin", "veltri"]);
  // root == dominant (no separable affix, e.g. NOVAPULSE) → just the one key, no dupe
  assert.deepEqual(deriveFloorKeys({ dominantEl: "NOVAPULSE", root: "NOVAPULSE" }), ["novapulse"]);
  // no root supplied → full token alone (today's behaviour; the root only ever WIDENS)
  assert.deepEqual(deriveFloorKeys({ dominantEl: "LUMENGARDE" }), ["lumengarde"]);
  // an UNRELATED root is dropped → full token still stands (a bad strip never loses coverage we have today)
  assert.deepEqual(deriveFloorKeys({ dominantEl: "VELTRIN", root: "ACME" }), ["veltrin"]);
  // an over-SHORT root (< 3) is dropped → full token alone
  assert.deepEqual(deriveFloorKeys({ dominantEl: "VELTRIN", root: "de" }), ["veltrin"]);
  // a shared-stem root that is a prefix is accepted (DELPHINUS family → root DELPHIN)
  assert.deepEqual(deriveFloorKeys({ dominantEl: "DELPHINUS", root: "DELPHIN" }), ["delphinus", "delphin"]);
});

// judgment-relocation (2026-06-23): the findFloorShapeGaps test section (the (a) missing-band / (b) per-class /
// (c) sampled / (d) open-name-list search-shape invariants — the interim NOVAPULSE gates) was REMOVED with the
// function. The completeness contract now lives in the funnel (named-band.mjs: enumerated OR incomplete) and the
// sufficiency decision in judgment (synthesis coverage_judgment over the COMPLETE band), driven by the pipeline's
// command/halt lifecycle — not in a driver re-parse of the prose Coverage ledger.

// ---- fixtures ------------------------------------------------------------------------------------

// The canonical prose table, verbatim from skills/prelim-register/digest.md:86-92 — including the
// SUFFIXED status row (the shape that must classify in prose but is banned as a bare JSON token).
const PROSE_LEDGER = `### Coverage ledger (orchestrator: feeds synthesis coverage-honesty + skeptic audit)

| Coverage unit | Status | Reason |
|---|---|---|
| primary-sweep / worldwide | confirmed-clean | full sweep paged to has_more:false |
| primary-sweep / NZ (material) | deferred | scoped sub-query not run: <reason> — NOT searched |
| transliteration-numeric / PH (material) | confirmed-clean | scoped sub-query ran to completion |
| transliteration-numeric / extra script group | coverage-limited | yielded to ring-fenced jurisdiction budget |
| saturation-probe / <element> element-solo | coverage-limited (count-only, saturated) | count-only context probe (2,416 live) — enumerates nothing; validates saturation, does not clear it |
`;

// The JSON mirror of the same table per the dictation: bare statuses, qualifiers moved into reason.
const JSON_LEDGER = [
  { axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "full sweep paged to has_more:false" },
  { axis: "primary-sweep", scope: "NZ (material)", status: "deferred", reason: "scoped sub-query not run: <reason> — NOT searched" },
  { axis: "transliteration-numeric", scope: "PH (material)", status: "confirmed-clean", reason: "scoped sub-query ran to completion" },
  { axis: "transliteration-numeric", scope: "extra script group", status: "coverage-limited", reason: "yielded to ring-fenced jurisdiction budget" },
  { axis: "saturation-probe", scope: "<element> element-solo", status: "coverage-limited", reason: "(count-only, saturated) count-only context probe (2,416 live)" },
];

const PAD = (s, n = 260) => (s.length >= n ? s : s + "\n" + "lorem ipsum ".repeat(Math.ceil((n - s.length) / 12)));
// A register-findings body that passes the registerFindings PROSE checks (findings heading +
// Coverage ledger heading + a status row + length).
const FINDINGS_MD = PAD(`# Register findings\n\n## Findings — Mark: X\n\n| URI | Mark |\n|---|---|\n| /m/1 | Y |\n\n${PROSE_LEDGER}`);

// ---- strict parser -------------------------------------------------------------------------------

test("parse: valid mirror → rows with lowercased axis + reconstructed unit (verbatim scope, ⭐ kept)", () => {
  const rows = parseCoverageLedgerJson(JSON.stringify([
    { axis: "Primary-Sweep", scope: "exact-phrase storefront sweep ⭐", status: "coverage-limited", reason: "not executed" },
    { axis: "saturation-probe", scope: "", status: "confirmed-clean", reason: "" },
  ]));
  assert.equal(rows[0].axis, "primary-sweep");
  assert.equal(rows[0].unit, "primary-sweep / exact-phrase storefront sweep ⭐");
  assert.equal(rows[1].unit, "saturation-probe", "scope-less row → unit = bare axis, no separator");
});

test("throws token-FIRST on every defect class (the corrective-hint contract)", () => {
  const t = (raw, opts, token) =>
    assert.throws(() => parseCoverageLedgerJson(raw, opts), (e) => e.message.startsWith(token),
      `${token} must lead the message for: ${String(raw).slice(0, 60)}`);
  t("not json {", undefined, "coverage_ledger_unparseable");
  t(JSON.stringify({ rows: [] }), undefined, "coverage_ledger_unparseable");           // not an array
  t(JSON.stringify([null]), undefined, "coverage_ledger_unparseable");                 // null row
  t(JSON.stringify([]), undefined, "coverage_ledger_empty");
  t(JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "", extra: 1 }]), undefined, "coverage_key_unknown:extra");
  t(JSON.stringify([{ axis: "satuartion-probe", scope: "x", status: "deferred", reason: "" }]), undefined, "coverage_axis_invalid:satuartion-probe");
  t(JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "coverage-limited (count-only, saturated)", reason: "" }]), undefined, "coverage_status_invalid:coverage-limited (count-only");
  t(JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "" }]),
    { activeAxes: ["primary-sweep", "saturation-probe"] }, "coverage_axis_missing:saturation-probe");
});

// ---- B: normalize-then-validate the coverage axis (the three field-observed prose leaks) ----------

test("normalizeAxis: repairs markdown / qualifier / transposition; leaves a genuinely-unknown token alone", () => {
  assert.equal(normalizeAxis("**primary-sweep**"), "primary-sweep", "markdown bold stripped");
  assert.equal(normalizeAxis("`saturation-probe`"), "saturation-probe", "inline-code backticks stripped");
  assert.equal(normalizeAxis("primary-sweep (material)"), "primary-sweep", "trailing (qualifier) dropped");
  // axis/scope TRANSPOSED — the jurisdiction was written first; the axis token is elsewhere in the cell.
  assert.equal(normalizeAxis("ch (matter-context materially-matters jurisdiction)", "ch (matter-context materially-matters jurisdiction) / primary-sweep"), "primary-sweep");
  // BIOVELTRIN 2026-06-19 backstop — a material-jurisdiction RECONCILIATION cell with NO axis anywhere (bare
  // jurisdiction code) coerces to primary-sweep (the per-jurisdiction sweep axis), instead of dying as `ch`.
  assert.equal(normalizeAxis("ch"), "primary-sweep", "bare jurisdiction code → primary-sweep (recovers the axis-absent reconciliation row)");
  assert.equal(normalizeAxis("CH (material)", "CH (material) / VELTRI* region:CH"), "primary-sweep", "the actual BIOVELTRIN failing cell recovers");
  assert.equal(normalizeAxis("eu"), "primary-sweep");
  // genuinely unknown → returned cleaned, so the strict validator STILL rejects it (no invented axis). The
  // backstop is NARROW: only a bare 2-letter code; a `digest` cross-check label or a typo still fails.
  assert.equal(normalizeAxis("digest"), "digest");
  assert.equal(normalizeAxis("satuartion-probe"), "satuartion-probe");
});

test("#5a reopenFetchCeiling: wall-fitting default (spec-49 J2); env override; junk/≤0 → default (no accidental tiny cap)", () => {
  // T1 (J2): 150, not 500 — 500 detail-fetches cannot fit the 1500s stage wall and drove the
  // 48% reopen-timeout class; a bounded WRITTEN band beats an exhaustive one killed mid-fetch.
  assert.equal(reopenFetchCeiling(undefined), 150, "unset → wall-fitting default");
  assert.equal(reopenFetchCeiling(""), 150, "empty → default");
  assert.equal(reopenFetchCeiling("800"), 800, "valid override honored (deep closure stays possible)");
  assert.equal(reopenFetchCeiling("1200"), 1200, "deeper closure allowed");
  assert.equal(reopenFetchCeiling("0"), 150, "0 is nonsensical → default (never silently caps the pass to nothing)");
  assert.equal(reopenFetchCeiling("-5"), 150, "negative → default");
  assert.equal(reopenFetchCeiling("abc"), 150, "junk → default");
  assert.equal(reopenFetchCeiling("250.9"), 250, "floored to an integer");
});

test("#3 normalizeAxis: an axis-less DIGEST owner/cross-check row recovers to its owning axis (anti-fail-open kept)", () => {
  // owner / watchlist / incumbent / stealth-filer sweep written as `digest …` → incumbent-class
  assert.equal(normalizeAxis("digest", "digest / owner-sweep: ACME Corp watchlist"), "incumbent-class", "owner sweep → incumbent-class");
  assert.equal(normalizeAxis("digest", "digest / watchlist-owner cross: Globex"), "incumbent-class", "watchlist-owner → incumbent-class");
  assert.equal(normalizeAxis("digest", "digest / stealth-filer dispatch"), "incumbent-class", "stealth-filer → incumbent-class");
  // cross-check / cross-class merch / Option-D closure written as `digest …` → primary-sweep
  assert.equal(normalizeAxis("digest", "digest / cross-class merch sweep cl.25"), "primary-sweep", "cross-class merch → primary-sweep");
  assert.equal(normalizeAxis("digest", "digest / cross-check: VELTRI in cl.42"), "primary-sweep", "cross-check → primary-sweep");
  assert.equal(normalizeAxis("digest", "digest / Option-D closure"), "primary-sweep", "Option-D → primary-sweep");
  // an owner signal on a bare-jurisdiction cell wins over the 2-letter→primary-sweep backstop
  assert.equal(normalizeAxis("ch", "ch / owner-sweep: ACME"), "incumbent-class", "owner sweep beats the bare-jurisdiction backstop");
  // anti-fail-open: a bare digest / a typo with NO sweep signal STILL fails the strict validator
  assert.equal(normalizeAxis("digest", "digest / VELTRI region:CH"), "digest", "no recognizable sweep signal ⇒ unchanged (still rejected)");
  assert.equal(normalizeAxis("digest"), "digest", "bare digest unchanged");
});

test("#1 keystone: coerceToolAbsenceDeferred relabels a could-not-reach coverage-limited row → deferred (escalation-worthy)", () => {
  const rows = [
    { axis: "primary-sweep", status: "coverage-limited", reason: "provider error — fetch failed for the EU sweep" },
    { axis: "incumbent-class", status: "coverage-limited", reason: "tool not on the allowlist — could not query the register" },
    { axis: "transliteration-numeric", status: "coverage-limited", reason: "could not reach the provider endpoint (connection refused)" },
  ];
  const out = coerceToolAbsenceDeferred(rows);
  assert.deepEqual(out.map((r) => r.status), ["deferred", "deferred", "deferred"], "each unreachable-data row is relabeled");
  // the escalation gate (skip-if-every-owned-row-is-coverage-limited) now sees deferred → it escalates, not skips
  assert.equal(deriveCoverageStatus(out).complete, false, "relabeled rows still clamp the verdict (material gaps)");
});

test("#1 keystone: a genuine saturation/volume coverage-limited row is UNTOUCHED (no over-coercion)", () => {
  const rows = [
    { axis: "primary-sweep", status: "coverage-limited", reason: "50 of 1041 exact-in-class-live candidates screened (saturated crowd sampled, not enumerated)" },
    { axis: "transliteration-numeric", status: "coverage-limited", reason: "yielded to the ring-fenced jurisdiction budget" },
    { axis: "primary-sweep", status: "coverage-limited", reason: "thin provider data — could not reach completeness within the pagination cap" },
    { axis: "saturation-probe", status: "coverage-limited", reason: "count-only context probe (2,416 live)" },
    { axis: "primary-sweep", status: "confirmed-clean", reason: "tool unavailable" }, // not coverage-limited → never coerced
    { axis: "primary-sweep", status: "deferred", reason: "scoped sub-query not run" },
  ];
  const out = coerceToolAbsenceDeferred(rows);
  assert.deepEqual(out.map((r) => r.status),
    ["coverage-limited", "coverage-limited", "coverage-limited", "coverage-limited", "confirmed-clean", "deferred"],
    "saturation/volume/pagination limits + non-coverage-limited rows are all left as-is ('could not reach completeness' must NOT trip)");
});

// judgment-relocation (2026-06-23): the Part B coerceMeaningExactFalseClean tests (the CJK meaning-axis
// broad→narrow false-clean relabel) were REMOVED with the function. A saturated meaning token is now ENUMERATED
// to completion by the funnel (the class-scoped contains band) or handed up as an `incomplete` crowd descriptor;
// the lawyer reads the COMPLETE band and decides — no driver-side regex relabel of a clean.

test("B: the three malformed prose unit-cells round-trip to VALID machine ledger (no coverage_axis_invalid)", () => {
  const PROSE = `### Coverage ledger
| Coverage unit | Status | Reason |
|---|---|---|
| **primary-sweep** / worldwide | confirmed-clean | full sweep paged to has_more:false |
| ch (matter-context materially-matters jurisdiction) / primary-sweep | deferred | scoped sub-query not run |
| saturation-probe (count-only) / VELTRI | coverage-limited | 2,416 live |
| digest / owner-sweep: ACME watchlist | confirmed-clean | owner portfolio swept |
| digest / cross-class merch sweep cl.25 | coverage-limited | merch band sampled |
`;
  // — asserted on the PARSER directly. renderCoverageLedgerJson was the vehicle for this before, and
  // it is deleted: the prose→JSON direction is gone, the driver-written coverage form is the source, and
  // parseCoverageLedgerFull survives only as the ARCHIVED-RUN reader. That reader is what still has to
  // coerce these five axis cells, and it is what this pins.
  const rows = parseCoverageLedgerFull(PROSE).rows;
  assert.deepEqual(rows.map((r) => r.axis), ["primary-sweep", "primary-sweep", "saturation-probe", "incumbent-class", "primary-sweep"],
    "every axis coerced to a canonical token at the parse boundary (incl. #3 digest owner→incumbent-class / cross-class merch→primary-sweep)");
});

test("B: normalization does NOT loosen the guard — an unknown axis in the saved JSON still fails token-first", () => {
  assert.throws(() => parseCoverageLedgerJson(JSON.stringify([{ axis: "digest", scope: "", status: "deferred", reason: "" }])),
    (e) => e.message.startsWith("coverage_axis_invalid:digest"), "genuinely-unknown axis still rejected with the original token");
});

test("completeness: activeAxes=null skips it; full active set over the canonical mirror passes", () => {
  const partial = JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "" }]);
  assert.equal(parseCoverageLedgerJson(partial, { activeAxes: null }).length, 1);
  // the canonical mirror covers primary-sweep / transliteration-numeric / saturation-probe — those
  // three as activeAxes pass; adding incumbent-class (no row) throws.
  const raw = JSON.stringify(JSON_LEDGER);
  assert.ok(parseCoverageLedgerJson(raw, { activeAxes: ["primary-sweep", "transliteration-numeric", "saturation-probe"] }).length === 5);
  assert.throws(() => parseCoverageLedgerJson(raw, { activeAxes: REGISTER_AXES }), /coverage_axis_missing:incumbent-class/);
});

test("vocabulary: REGISTER_AXES + COVERAGE_STATUSES + decideAxes moved here intact (stages re-exports)", async () => {
  assert.deepEqual(REGISTER_AXES, ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"]);
  assert.deepEqual(COVERAGE_STATUSES, ["confirmed-clean", "coverage-limited", "deferred"]);
  assert.deepEqual(decideAxes("").sort(), [...REGISTER_AXES].sort());
  const ST = await import("../stages.mjs");
  assert.equal(ST.REGISTER_AXES, REGISTER_AXES, "stages.mjs re-export is the SAME binding");
  assert.equal(ST.decideAxes, decideAxes);
});

// ---- prose ↔ JSON equivalence (the gates must not change their decisions) ------------------------

test("equivalence: prose parse and JSON mirror agree on {axis,status} and on unit for '/'-rows", () => {
  const prose = parseCoverageLedger(FINDINGS_MD);
  const json = parseCoverageLedgerJson(JSON.stringify(JSON_LEDGER));
  const key = (r) => `${r.axis}|${r.status}|${r.unit}`;
  assert.deepEqual(json.map(key).sort(), prose.map(key).sort(),
    "identical gate-visible rows — incl. the suffixed prose status classifying to the bare token");
});

// The `equivalence: findFloorBreaches gives the same verdict on prose rows and JSON rows` arm is RETIRED
// with the ⭐ floor. It proved the prose and JSON ledger readers agreed by running both through
// the breach detector — a real property, checked through a mechanism that no longer exists. The readers'
// equivalence is still covered by the parse arms above, which compare their ROWS directly rather than
// through a consumer.

// ----: THE PROSE→JSON DIRECTION IS DELETED ---------------------------------------------------
//
// Map #3's `renderCoverageLedgerJson` derived the machine ledger FROM the model's `## Coverage ledger`
// table. That was an improvement — the model stopped authoring the JSON — which left the real source of
// truth where it was: a markdown table the model wrote, and which every coverage gate then read. Under
// the DRIVER-WRITTEN coverage form is the source and both the table and the JSON are renders of it
// (coverage-form.renderCoverageLedgerJsonFromForm, pinned in coverage-form.test.mjs). Its three tests
// went with it; the round-trip they protected — a derived JSON must re-parse cleanly through
// parseCoverageLedgerJson or the gates degrade for a whole run — is asserted there instead.
//
// parseCoverageLedgerFull SURVIVES with exactly one job: reading an ARCHIVED run's table. Every test
// below is about that reader.

test("parseCoverageLedgerFull reports the rows the prose parser DROPS (feeds the fallback flag)", () => {
  const md = `## Coverage ledger\n| Coverage unit | Status | Reason |\n|---|---|---|\n| primary-sweep / x | deferred | ok row |\n| mystery unit | TBD?? | unclassifiable status |\n`;
  const { rows, dropped, offEnum } = parseCoverageLedgerFull(md);
  assert.equal(rows.length, 1);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /mystery unit/);
  assert.equal(offEnum.length, 0, "an unknown-axis junk line is dropped-only, never off-enum");
});

// ── D1 fail-closed: an off-enum Status on a KNOWN axis row is surfaced, never silently dropped ─────
test("D1 parseCoverageLedgerFull: a known-axis row with an off-enum status lands in offEnum[]; junk and suffixed rows do not", () => {
  const md = [
    "## Coverage ledger",
    "| Coverage unit | Status | Reason |",
    "|---|---|---|",
    "| primary-sweep / EU | complete | swept |",                                              // KNOWN axis, off-enum status
    "| saturation-probe / element | coverage-limited (count-only, saturated) | probe |",     // suffixed enum → classifies as a row
    "| mystery unit | TBD?? | junk — not a real axis row |",                                  // unknown axis → dropped-only
  ].join("\n");
  const { rows, dropped, offEnum } = parseCoverageLedgerFull(md);
  assert.equal(rows.length, 1, "the suffixed enum row still classifies");
  assert.equal(offEnum.length, 1);
  assert.deepEqual(offEnum[0], { axis: "primary-sweep", unit: "primary-sweep / EU", status: "complete" });
  assert.equal(dropped.length, 2, "the off-enum row still reaches dropped[] (the prose-fallback surface)");
});

test("D1 registerFindings: an off-enum status on a known axis fails coverage_status_offenum ONLY under the driver's coverage-enum sentinel (it used to vanish)", () => {
  const prose = PAD([
    "## Findings — Mark: X", "",
    "### Coverage ledger",
    "| Coverage unit | Status | Reason |",
    "|---|---|---|",
    "| primary-sweep / worldwide | confirmed-clean | full sweep |",
    "| transliteration-numeric / PH | complete | swept |",   // off-enum on a KNOWN axis — silently dropped before D1
  ].join("\n"));
  // fresh run — the driver armed _driver/coverage-enum.json before dispatching the digest → fail token-first
  const dir = runDirWith({ findings: prose, enumSentinel: true });
  const v = validate(dir, prose);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^coverage_status_offenum:complete/);
  assert.match(v.reason, /transliteration-numeric/);
  // ARCHIVED run (no sentinel — the receipt-PRESENCE key): the SAME off-enum prose keeps its ok verdict.
  // Load-bearing D1 invariant pin: 27 of 64 corpus register-findings.md files carry off-enum shapes
  // ("N/A", "confirmed", "✅", "not-searched (immaterial by design)") — an unkeyed gate mass-flips the
  // replay harness to NO-GO, and coverage_status_offenum is a cold re-run per live hit besides.
  const archived = runDirWith({ findings: prose });
  assert.equal(validate(archived, prose).ok, true, "no sentinel → replay verdict never flips");
  // the same ledger with the row honestly labelled passes under the sentinel too
  const clean = prose.replace("| transliteration-numeric / PH | complete | swept |", "| transliteration-numeric / PH | confirmed-clean | swept |");
  const dir2 = runDirWith({ findings: clean, enumSentinel: true });
  assert.equal(validate(dir2, clean).ok, true);
});

// ---- registerFindings dispatch (machine-vs-legacy; validator must NEVER throw) --------------------

function runDirWith({ json = null, manifest = null, findings = FINDINGS_MD, enumSentinel = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "covledger-"));
  writeFileSync(join(dir, "register-findings.md"), findings);
  if (json != null) writeFileSync(join(dir, "register-coverage-ledger.json"), json);
  if (manifest != null) writeFileSync(join(dir, "variant-manifest.md"), manifest);
  if (enumSentinel) {   // D1 — the driver's per-digest-pass receipt arming the off-enum status gate
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(driverDir(dir, "coverage-enum.json"), JSON.stringify({ statuses: COVERAGE_STATUSES }));
  }
  return dir;
}
const validate = (dir, findings = FINDINGS_MD) => validators.registerFindings(join(dir, "register-findings.md"), findings);

// A findings body whose prose ledger has exactly ONE classifiable row (mirror-matches a partial JSON).
const FINDINGS_MIN = PAD(`# Register findings\n\n## Findings — Mark: X\n\n| URI | Mark |\n|---|---|\n| /m/1 | Y |\n\n### Coverage ledger\n| Coverage unit | Status | Reason |\n|---|---|---|\n| primary-sweep / x | deferred | not run |\n`);

test("dispatch: no JSON beside the findings → legacy prose pass (archived runs; replay must not flip)", () => {
  const v = validate(runDirWith());
  assert.equal(v.ok, true);
  assert.notEqual(v.reason, "machine-ledger");
});

test("dispatch: valid JSON + manifest → machine path ok (completeness against decideAxes)", () => {
  // the canonical mirror has no incumbent-class row — use a manifest that does NOT activate it.
  const manifest = "Archetype: coined. translit variants present. non-latin script.";
  assert.deepEqual(decideAxes(manifest).sort(), ["primary-sweep", "saturation-probe", "transliteration-numeric"]);
  const v = validate(runDirWith({ json: JSON.stringify(JSON_LEDGER), manifest }));
  assert.deepEqual(v, { ok: true, reason: "machine-ledger" });
});

test("dispatch: invalid JSON → fail(token), and the validator NEVER throws on any malformed input", () => {
  for (const bad of ["not json {", "[]", JSON.stringify([{ axis: "nope", scope: "", status: "deferred", reason: "" }]),
    JSON.stringify([{ axis: "primary-sweep", scope: "", status: "clean", reason: "" }])]) {
    let v;
    assert.doesNotThrow(() => { v = validate(runDirWith({ json: bad })); });
    assert.equal(v.ok, false, `must fail closed for: ${bad.slice(0, 40)}`);
    assert.match(v.reason, /^coverage_/, `token-first reason for: ${bad.slice(0, 40)}`);
  }
});

test("dispatch: missing active axis fails closed; unreadable manifest skips completeness only", () => {
  const partial = JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "" }]);
  // manifest activates all four axes (markers) → partial mirror fails completeness
  const v1 = validate(runDirWith({ json: partial, manifest: "translit incumbent", findings: FINDINGS_MIN }), FINDINGS_MIN);
  assert.equal(v1.ok, false);
  assert.match(v1.reason, /coverage_axis_missing/);
  // no manifest in reach → completeness skipped (the commonLaw receipt-skip mirror). Map #3: the prose↔JSON
  // mirror cross-check is RETIRED, so a JSON that carries fewer rows than the prose is no longer rejected on
  // that basis (the JSON is code-derived from the SAME prose in production, so this can't happen anyway).
  const v2 = validate(runDirWith({ json: partial, findings: FINDINGS_MIN }), FINDINGS_MIN);
  assert.equal(v2.ok, true);
});

test("dispatch (Map #3): mirror cross-check RETIRED — a JSON with FEWER rows than the prose still passes (no coverage_mirror_missing)", () => {
  // Pre-Map-#3 this failed coverage_mirror_missing (5 prose rows vs 1 JSON row). The JSON is now code-derived
  // from the same prose, so the cross-check could only false-fail; it is gone. Structural validity still holds.
  const partial = JSON.stringify([{ axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "" }]);
  const v = validate(runDirWith({ json: partial }));
  assert.deepEqual(v, { ok: true, reason: "machine-ledger" }, "no mirror cross-check — partial JSON passes structurally");
  assert.doesNotMatch(JSON.stringify(v), /coverage_mirror_missing/);
  // — the second half of this test derived the JSON from the prose and re-validated it. That
  // direction is deleted; the driver renders both the table and the JSON from the coverage form, and the
  // round-trip is pinned on that renderer (coverage-form.test.mjs, "the machine ledger derives FROM the
  // form and round-trips through its own strict parser").
});

test("dispatch: active axes pin to the run's register-units/*.md when present (replay drift immunity)", async () => {
  const { mkdirSync } = await import("node:fs");
  // manifest would activate all 4 axes, but the run only spawned primary-sweep — units win.
  const dir = runDirWith({ json: JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "" }]),
    manifest: "translit incumbent", findings: FINDINGS_MIN });
  mkdirSync(join(dir, "register-units"));
  writeFileSync(join(dir, "register-units", "primary-sweep.md"), "unit");
  assert.equal(validate(dir, FINDINGS_MIN).ok, true, "recorded activation (units) overrides decideAxes");
});

// ---- loadCoverageLedger (the gate-side reader) ----------------------------------------------------

test("loadCoverageLedger: machine when present, prose (with dropped[]) when not, none when neither", () => {
  const machine = runDirWith({ json: JSON.stringify(JSON_LEDGER) });
  assert.equal(loadCoverageLedger(machine).source, "machine");
  assert.equal(loadCoverageLedger(machine).rows.length, 5);
  const prose = runDirWith();
  const pl = loadCoverageLedger(prose);
  assert.equal(pl.source, "prose");
  assert.ok(pl.rows.length >= 5);
  const empty = mkdtempSync(join(tmpdir(), "covledger-"));
  assert.deepEqual(loadCoverageLedger(empty), { rows: [], source: "none", dropped: [] });
});

// ── copper-lattice: taint relabel + the registerGap clamp decision ─────────────────────────────────────
test("applyTaintDeferred: confirmed-clean on a tainted MATERIAL axis → deferred with the honest reason", async () => {
  const { applyTaintDeferred } = await import("../coverage-ledger.mjs");
  const rows = [
    { axis: "primary-sweep", scope: "", status: "confirmed-clean", reason: "exact clean" },
    { axis: "saturation-probe", scope: "", status: "confirmed-clean", reason: "count-only" },
    { axis: "incumbent-class", scope: "", status: "coverage-limited", reason: "saturated" },
    { axis: "transliteration-numeric", scope: "", status: "confirmed-clean", reason: "clean" },
  ];
  const out = applyTaintDeferred(rows, ["primary-sweep", "saturation-probe"]);
  assert.equal(out[0].status, "deferred", "tainted material clean row downgraded");
  assert.match(out[0].reason, /timeout-tainted pass/);
  assert.equal(out[1].status, "confirmed-clean", "saturation-probe is non-material — never relabelled");
  assert.equal(out[2].status, "coverage-limited", "coverage-limited untouched (accepted limit)");
  assert.equal(out[3].status, "confirmed-clean", "untainted axis untouched");
  assert.deepEqual(applyTaintDeferred(rows, []), rows, "empty taint set is a no-op");
});

test("decideRegisterGap: deferred material rows / taint / material recall each fire; coverage-limited never does", async () => {
  const { decideRegisterGap } = await import("../coverage-ledger.mjs");
  assert.equal(decideRegisterGap([{ axis: "primary-sweep", status: "deferred", unit: "x" }]).gap, true);
  assert.equal(decideRegisterGap([{ axis: "primary-sweep", status: "coverage-limited", unit: "x" }]).gap, false, "an accepted limit is not an unfinished search");
  assert.equal(decideRegisterGap([{ axis: "saturation-probe", status: "deferred", unit: "x" }]).gap, false, "non-material axis never clamps");
  assert.equal(decideRegisterGap([], { taintAxes: ["primary-sweep"] }).gap, true);
  assert.equal(decideRegisterGap([], { taintAxes: ["saturation-probe"] }).gap, false);
  assert.equal(decideRegisterGap([], { recallRegressions: [{ uri: "/mark/us/1", material: true }] }).gap, true);
  assert.equal(decideRegisterGap([]).gap, false);
});

// ── PR compute-don't-author: the OPTIONAL structured classes[] column ─────────────────────────────────
test("classes[]: an archived ledger (no classes key) parses byte-identically; a structured row carries them normalized", async () => {
  const legacy = parseCoverageLedgerJson(JSON.stringify([
    { axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "clean" },
  ]));
  assert.deepEqual(Object.keys(legacy[0]).sort(), ["axis", "reason", "scope", "status", "unit"], "no classes key invented on a legacy row");
  const rows = parseCoverageLedgerJson(JSON.stringify([
    { axis: "primary-sweep", scope: "owner sweep", status: "coverage-limited", reason: "over ceiling", classes: [5, "32"] },
  ]));
  assert.deepEqual(rows[0].classes, ["5", "32"], "numbers and strings normalize to class-number strings");
});

test("classes[]: a malformed classes cell fails token-first (coverage_classes_invalid), like every other cell", () => {
  const t = (classes) =>
    assert.throws(() => parseCoverageLedgerJson(JSON.stringify([{ axis: "primary-sweep", scope: "x", status: "deferred", reason: "", classes }])),
      (e) => e.message.startsWith("coverage_classes_invalid"));
  t("5, 32");            // a string is not an array
  t([{ nice: 5 }]);      // objects are not class tokens
  t(["99"]);             // Nice classes stop at 45
  t([0]);                // and start at 1
});

test("classes[]: derived from the row's own scope by CODE — present only when the scope names a class", () => {
  // — the extractor is unchanged and still the ONE place classes comes from; only its INPUT moved,
  // from a prose cell the model wrote to the coverage form's machine-composed unit. Asserted here on the
  // extractor itself, and end-to-end through the form's renderer in coverage-form.test.mjs.
  assert.deepEqual(classTokensFromScopeText("owner sweep [cl 5,32] over ceiling"), ["5", "32"]);
  assert.deepEqual(classTokensFromScopeText("worldwide clean"), [], "a class-less row keeps the archived four-key shape");
  assert.deepEqual(classTokensFromScopeText("returned 6862 hits in 2024"), [],
    "a bare number is never a class — only an explicit class marker counts");
  const rows = [{ axis: "primary-sweep", scope: "owner sweep [cl 5,32]", status: "coverage-limited", reason: "over ceiling", classes: ["5", "32"] }];
  assert.deepEqual(parseCoverageLedgerJson(JSON.stringify(rows))[0].classes, ["5", "32"],
    "the strict contract accepts them where the renderer emits them");
});
