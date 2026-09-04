// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// CN scope honesty at plain prelim. The zh candidate
// lane is a Depth 5 (prelim-jx) PAID feature that must NOT run at plain prelim; this branch adds
// HONESTY, not searching: (a) one deterministic reader-visible coverage row when the scope touches the
// zh-lane family and the lane did not run (the injectDeferralCoverage posture), and (b) a note-only
// recommendation at level resolution. CRITICAL doctrine pinned here: the row is `coverage-limited`,
// the DISCLOSED ACCEPTED LIMIT — decideRegisterGap clamps on `deferred` ONLY, so the row can NEVER
// flip a verdict. All fixtures use invented marks/customers (no client data in git).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { decideRegisterGap } from "../coverage-ledger.mjs";
import { zhScopeDepthNotes, LANGUAGE_LANES } from "../jx-lanes.mjs";
// THE REAL RESOLVER, and the real offering. The tests below used to hand-feed `{ level: "prelim" }` —
// see the note over the resolution-time block.
import { resolveSearchPolicy } from "../search-policy.mjs";
import { PRODUCT_IDS, PRODUCTS, productName, NATIVE_LANGUAGE_REMEDY } from "../products.mjs";
import { decideZhScopeHonesty, injectZhScopeCoverage, zhLaneRanOnRun, ZH_SCOPE_COVERAGE_AREA, ZH_SCOPE_COVERAGE_NOTE,
  scriptScopeDisclosure, decideScriptScopeHonesty, scriptLaneRanOnRun, injectScriptScopeCoverage } from "../pipeline.mjs";

// ── the pure decision ───────────────────────────────────────────────────────────────────────────────

test("decideZhScopeHonesty: a CN-scope run whose lane did not run gets the row (exact reading, coverage-limited)", () => {
  const row = decideZhScopeHonesty({ scope: ["CN", "US"], laneRan: false });
  assert.ok(row, "CN in scope + lane absent ⇒ row");
  assert.equal(row.state, "coverage-limited", "a disclosed accepted limit — never the clamping `deferred`");
  assert.equal(row.area, ZH_SCOPE_COVERAGE_AREA);
  assert.equal(row.note, ZH_SCOPE_COVERAGE_NOTE);
  // THE REMEDY NAMES A PRODUCT A CLIENT CAN ORDER. This assertion used to require /Depth 5 \(prelim-jx\)/
  // — an internal product key at a rung of the retired ladder — and so PINNED the defect: a delivered
  // coverage row disclosing a limit and offering, as its remedy, a product deleted.
  assert.ok(row.note.includes(NATIVE_LANGUAGE_REMEDY), "the reader is told where the search can be bought");
  assert.match(row.note, /Multi-country focus search/, "by the offering's own name for it");
});

test("decideZhScopeHonesty: worldwide shapes inject too (an unscoped run sweeps the zh territories by convention)", () => {
  assert.ok(decideZhScopeHonesty({ scope: ["worldwide"] }), "an explicit worldwide token");
  assert.ok(decideZhScopeHonesty({ scope: [] }), "an unscoped run — absent region clause = worldwide (engine convention)");
  assert.ok(decideZhScopeHonesty({ scope: ["HK"] }), "every zh-family member counts, not only CN");
});

test("decideZhScopeHonesty: NO row when scope has no zh jurisdiction, when the lane ran, or when the customer turned the lane off", () => {
  assert.equal(decideZhScopeHonesty({ scope: ["US", "EU"] }), null, "a bounded non-zh scope owes nothing");
  // JP/KR joined JURISDICTION_ADAPTERS with their own lanes (#81); membership in the table is no
  // longer the same question as "does this scope owe the CHINESE-script row". A Japan- or
  // Korea-only report claiming a Chinese-script gap would be disclosing a gap it does not have.
  assert.equal(decideZhScopeHonesty({ scope: ["JP"] }), null, "Japan-only scope owes no Chinese-script row — ja is its own lane");
  assert.equal(decideZhScopeHonesty({ scope: ["KR"] }), null, "Korea-only scope owes no Chinese-script row — ko is its own lane");
  assert.ok(decideZhScopeHonesty({ scope: ["JP", "CN"] }), "but CN alongside JP still owes the row");
  assert.equal(decideZhScopeHonesty({ scope: ["CN"], laneRan: true }), null, "the paid lane ran — nothing to disclose");
  assert.equal(decideZhScopeHonesty({ scope: ["CN"], laneDepthOff: true }), null, "customer config always wins — a declined lane is not re-advertised");
});

// ── the clamp doctrine — the row can NEVER flip a verdict ───────────────────────────────────────────

test("decideRegisterGap over a ledger containing the honesty row does NOT clamp (coverage-limited is not `deferred`)", () => {
  const honestyLedgerRow = { axis: "transliteration-numeric", status: "coverage-limited", unit: "transliteration-numeric / CN family", reason: ZH_SCOPE_COVERAGE_NOTE };
  const rows = [
    { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide" },
    honestyLedgerRow,
  ];
  assert.equal(decideRegisterGap(rows).gap, false, "the honesty row is a disclosed accepted limit — no CLEAR→CONDITIONAL floor");
  // the contrast pin: the SAME row as `deferred` WOULD clamp — proving the status choice is what protects the verdict
  assert.equal(decideRegisterGap([{ ...honestyLedgerRow, status: "deferred" }]).gap, true,
    "only `deferred` clamps — which is exactly why the injected row must never carry it");
});

// ── zhLaneRanOnRun — the jx-units gating legs, mirrored ─────────────────────────────────────────────

function mkRun({ laneSidecar = null, units = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cn-scope-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (laneSidecar) writeFileSync(driverDir(dir, "jx-lanes.json"), JSON.stringify(laneSidecar, null, 2));
  if (units) {
    mkdirSync(driverDir(dir, "jx"), { recursive: true });
    writeFileSync(driverDir(dir, "jx", "units.json"), JSON.stringify({ schema: 1, units }, null, 2));
  }
  return dir;
}
// item 8 — THE EVIDENCE MOVED FROM THE ENVIRONMENT TO THE RUN. This used to be the two per-unit
// switches (and before them the retired master). Both are deleted, and the replacement is strictly
// better evidence for a question about what a run DID: a unit record stating done. A box with the arm
// set and the unit never dispatched used to read "ran".
const RAN_GRID = { "serp-grid:zh": { done: true, degraded: false } };
const RAN_READ = { "nativeread:zh": { done: true, degraded: false } };
const JX_ON = {};
const POLICY_JX = { level: "prelim-jx", components: { jxLanes: true } };
const POLICY_PRELIM = { level: "prelim", components: { jxLanes: false } };
const ZH_SIDECAR = { schema: 1, lanes: { zh: { depth: "candidates", jurisdictions: ["CN"] } }, scope: ["CN"] };

test("zhLaneRanOnRun: true only when component + a unit flag + lane flag + frozen zh decision ALL hold", () => {
  // THIS IS NOT A GATE — it decides whether a CLIENT REPORT says the Chinese lane was not searched. Both
  // answers are a statement of fact, so both can be wrong: report "ran" and a real coverage gap is hidden;
  // report "did not run" on a run that did and the report libels its own coverage.
  const ranGrid = mkRun({ laneSidecar: ZH_SIDECAR, units: RAN_GRID });
  assert.equal(zhLaneRanOnRun(ranGrid, { searchPolicy: POLICY_JX, env: JX_ON }), true);
  assert.equal(zhLaneRanOnRun(ranGrid, { searchPolicy: POLICY_PRELIM, env: JX_ON }), false, "plain prelim never ran the lane, whatever is on disk");
  assert.equal(zhLaneRanOnRun(ranGrid, { searchPolicy: POLICY_JX, env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "0" } }), false, "lane killed ⇒ did not run");
  const noSidecar = mkRun({ units: RAN_GRID });
  assert.equal(zhLaneRanOnRun(noSidecar, { searchPolicy: POLICY_JX, env: JX_ON }), false, "no frozen lane decision ⇒ did not run");

  // THE NAIVE REWRITE THIS COMMENT HAS ALWAYS WARNED ABOUT, now asserted rather than described. Dropping
  // the env legs and trusting the SIDECAR would return true here — a frozen lane decision with no unit
  // record is a run that decided to search in Chinese and then did not, and reporting it as "ran"
  // suppresses the disclosure the client is owed. item 8 deleted the env legs and put the unit
  // records in their place precisely so this case still answers false.
  const decidedOnly = mkRun({ laneSidecar: ZH_SIDECAR });
  assert.equal(zhLaneRanOnRun(decidedOnly, { searchPolicy: POLICY_JX, env: JX_ON }), false,
    "a frozen lane decision is not evidence that either unit executed — the row is owed");
  const degraded = mkRun({ laneSidecar: ZH_SIDECAR, units: { "serp-grid:zh": { done: false, degraded: true } } });
  assert.equal(zhLaneRanOnRun(degraded, { searchPolicy: POLICY_JX, env: JX_ON }), false,
    "a unit that recorded a DEGRADE did not run either");

  // EITHER unit running is the lane running: the grid and the native read execute independently, and a
  // run with one done and one absent did search in Chinese.
  assert.equal(zhLaneRanOnRun(ranGrid, { searchPolicy: POLICY_JX, env: JX_ON }), true, "grid alone counts");
  const ranRead = mkRun({ laneSidecar: ZH_SIDECAR, units: RAN_READ });
  assert.equal(zhLaneRanOnRun(ranRead, { searchPolicy: POLICY_JX, env: JX_ON }), true, "native read alone counts");

  // And a RETIRED switch cannot resurrect itself as a control in EITHER direction. `decidedOnly` has a
  // frozen lane decision and no unit record, so the answer is false whatever is set; `ranGrid` has a unit
  // record, so the answer is true whatever is set. A deleted name decides nothing.
  for (const dead of ["CLEAROTRON_JX_LANES", "CLEAROTRON_JX_SERP_GRID", "CLEAROTRON_JX_NATIVEREAD"]) {
    assert.equal(zhLaneRanOnRun(decidedOnly, { searchPolicy: POLICY_JX, env: { [dead]: "1" } }), false,
      `${dead} is deleted and must not make this claim the lane ran`);
    assert.equal(zhLaneRanOnRun(ranGrid, { searchPolicy: POLICY_JX, env: { [dead]: "0" } }), true,
      `${dead} is deleted and must not make this claim the lane did NOT run`);
  }
});

// ── the disk injection — deterministic, idempotent, never clobbering ────────────────────────────────

// an invented-mark findings.json (schema v2: no rated_under_framework needed; coverage alone keeps it valid)
const FINDINGS_DOC = { schema_version: 2, findings: [], coverage: [{ area: "register / US", state: "confirmed-clean", note: "" }] };
const quiet = () => {};

test("injectZhScopeCoverage: injects ONE row for a worldwide/CN-scope plain-prelim run state, idempotently", () => {
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  const args = { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["CN", "US"] }, profile: {}, env: {} };
  injectZhScopeCoverage(P, dir, quiet, args);
  const once = JSON.parse(readFileSync(P.findings, "utf8"));
  const rows = once.coverage.filter((c) => c.area === ZH_SCOPE_COVERAGE_AREA);
  assert.equal(rows.length, 1, "exactly one honesty row");
  assert.equal(rows[0].state, "coverage-limited");
  assert.equal(rows[0].note, ZH_SCOPE_COVERAGE_NOTE);
  // resume/re-entry: a second pass over the same file must not duplicate the row
  injectZhScopeCoverage(P, dir, quiet, args);
  const twice = JSON.parse(readFileSync(P.findings, "utf8"));
  assert.equal(twice.coverage.filter((c) => c.area === ZH_SCOPE_COVERAGE_AREA).length, 1, "idempotent on resume");
  assert.equal(twice.coverage.length, 2, "the pre-existing coverage row is untouched");
});

test("injectZhScopeCoverage: NOT injected when the lane ran, and NOT injected when scope has no zh jurisdiction", () => {
  // lane ran: prelim-jx policy + a frozen zh decision + a unit record stating done ( item 8 —
  // the record IS the evidence now; the frozen decision alone is a run that decided and did not do it)
  const ran = mkRun({ laneSidecar: ZH_SIDECAR, units: RAN_GRID });
  const ranP = { findings: join(ran, "findings.json") };
  writeFileSync(ranP.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  injectZhScopeCoverage(ranP, ran, quiet, { searchPolicy: POLICY_JX, job: { jurisdictions: ["CN"] }, profile: {}, env: JX_ON });
  assert.equal(JSON.parse(readFileSync(ranP.findings, "utf8")).coverage.some((c) => c.area === ZH_SCOPE_COVERAGE_AREA), false,
    "the lane ran — nothing to disclose");
  // no zh scope: a bounded US/EU prelim
  const us = mkRun();
  const usP = { findings: join(us, "findings.json") };
  writeFileSync(usP.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  injectZhScopeCoverage(usP, us, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["US", "EU"] }, profile: {}, env: {} });
  assert.equal(JSON.parse(readFileSync(usP.findings, "utf8")).coverage.some((c) => c.area === ZH_SCOPE_COVERAGE_AREA), false,
    "no zh jurisdiction in scope — no row");
});

test("injectZhScopeCoverage: never-kill — a corrupt findings.json is left byte-identical", () => {
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, "{ not json");
  injectZhScopeCoverage(P, dir, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["CN"] }, profile: {}, env: {} });
  assert.equal(readFileSync(P.findings, "utf8"), "{ not json", "any defect leaves findings.json untouched");
});

// ── (b) the resolution-time note — a note only, never a gate ────────────────────────────────────────
//
// THESE TESTS WERE GREEN OVER A DEAD BRANCH FOR THE WHOLE, and how they managed it is the point.
//
// `zhScopeDepthNotes` opened with `resolvedPolicy.level !== "prelim"`. `resolveSearchPolicy` returns
// `level` = THE PRODUCT ID for all four searches, so that leg was false on every live run and the
// recommendation returned [] for every one of them — with both callers live (pipeline.mjs, runner.mjs)
// and 3,754 driver tests passing. The tests passed because they built the policy BY HAND, as
// `{ level: "prelim", components: {...} }`: a literal nothing in the engine has produced since the
// depth ladder was retired. A fixture that invents its input certifies the bug.
//
// So the policies below come out of `resolveSearchPolicy` itself, from a job and a profile, exactly as
// both callers get theirs. And the expectation table is keyed by PRODUCT_IDS rather than listing the
// interesting ones, so a fifth product fails this file until somebody decides what it owes a CN scope.

/** A resolved policy for one product, from the REAL resolver — never a literal. `territories` is the
 *  resolved scope, which is what the resolver reads to decide the product and its components. */
const policyFor_ = (product, territories, extra = {}) => {
  const job = { markName: "NOVAPULSE", classes: [9], product, jurisdictions: territories, ...extra };
  const resolved = resolveSearchPolicy(job, { profile: null, recipes: null, territories });
  assert.equal(resolved.clarify, undefined, `${product} over ${territories.join("/")} did not resolve: ${resolved.clarify}`);
  assert.equal(resolved.product, product, `${product} resolved as ${resolved.product}`);
  return { job, resolved };
};

// WHAT EACH PRODUCT OWES A CN-NAMED SCOPE, from the offering. The note recommends the native-language
// investigation, so it is owed exactly where the product does not already carry it — and the geography
// each product accepts decides whether a CN scope is even expressible on it.
//
//   knockout-search             CN + another country is legal; no investigation ⇒ NOTE
//   global-preliminary-search   worldwide and nothing else; a named CN scope is not orderable, and the
//                               worldwide shape deliberately does not nag at intake ⇒ no note
//                               (the delivery-time coverage row covers it — see the block above)
//   multi-country-focus-search  CN + another country; investigation OFFERED and not bought ⇒ NOTE
//   full-country-search         CN alone; investigation AUTOMATIC ⇒ no note
const CN_SCOPE_EXPECTATION = {
  "knockout-search": { territories: ["CN", "FR"], note: true },
  "global-preliminary-search": { territories: [], note: false },
  "multi-country-focus-search": { territories: ["CN", "JP"], note: true },
  "full-country-search": { territories: ["CN"], note: false },
};

test("zhScopeDepthNotes: driven from the REAL resolver, every product in the offering answers a CN scope", () => {
  assert.deepEqual(Object.keys(CN_SCOPE_EXPECTATION).sort(), [...PRODUCT_IDS].sort(),
    "every product needs a stated expectation here — a fifth one is a decision, not a default");
  for (const [product, { territories, note }] of Object.entries(CN_SCOPE_EXPECTATION)) {
    const { job, resolved } = policyFor_(product, territories);
    const notes = zhScopeDepthNotes(job, resolved, {});
    assert.equal(notes.length, note ? 1 : 0,
      `${product} over [${territories.join(", ")}]: expected ${note ? "a note" : "no note"}, got ${JSON.stringify(notes)}`);
    if (note) {
      assert.match(notes[0], /CN/, `${product}: the note names the territory that earned it`);
      assert.ok(notes[0].includes(NATIVE_LANGUAGE_REMEDY), `${product}: the note names where the investigation is sold`);
      assert.match(notes[0], /Recommendation only/i, "the note states its own non-gating contract");
    }
  }
});

test("zhScopeDepthNotes: the note names NO retired product key and NO rung of the depth ladder", () => {
  // It named both — "a plain prelim (Depth 4) … the \"prelim-jx\" level (Depth 5)" — for a run log a
  // person reads. The same vocabulary reached a CLIENT report through the coverage row above, which is
  // why this is asserted on both and not only there.
  const { job, resolved } = policyFor_("knockout-search", ["CN", "FR"]);
  const [note] = zhScopeDepthNotes(job, resolved, {});
  assert.doesNotMatch(note, /Depth \s*\d/, "a rung of the retired ladder survived in the recommendation");
  assert.doesNotMatch(note, /\bprelim\b|prelim-jx|prelim-register-only|knockout-register/, "a retired level key survived");
  for (const id of PRODUCT_IDS) assert.ok(!note.includes(id), `an internal product id reached the note: ${id}`);
  for (const p of PRODUCTS) assert.ok(NATIVE_LANGUAGE_REMEDY.includes(p.name) === (p.nativeLanguage !== "absent"),
    `${p.name}: the remedy names exactly the products that carry the investigation`);
});

test("zhScopeDepthNotes: the investigation BOUGHT silences it — that is the only leg left", () => {
  // The `level` leg is gone; `components.jxLanes` is the whole gate, and it is the honest question.
  const bought = policyFor_("multi-country-focus-search", ["CN", "JP"], { nativeLanguage: true });
  assert.equal(bought.resolved.components.jxLanes, true, "the toggle bought the lane");
  assert.equal(zhScopeDepthNotes(bought.job, bought.resolved, {}).length, 0, "nothing left to recommend");
  // A recipe on a product that does not offer the toggle cannot buy it either way — assert the gate reads
  // the COMPONENT, whatever put it there.
  const { job, resolved } = policyFor_("knockout-search", ["CN", "FR"]);
  assert.equal(zhScopeDepthNotes(job, { ...resolved, components: { ...resolved.components, jxLanes: true } }, {}).length, 0);
});

test("zhScopeDepthNotes: absent with no zh scope, on a worldwide run, or where the customer turned the lane off", () => {
  const { job, resolved } = policyFor_("knockout-search", ["US", "FR"]);
  assert.equal(zhScopeDepthNotes(job, resolved, {}).length, 0, "no zh jurisdiction named");
  const ww = policyFor_("global-preliminary-search", []);
  assert.equal(zhScopeDepthNotes(ww.job, ww.resolved, {}).length, 0, "unscoped/worldwide does not nag at intake (the delivery row covers it)");
  const cn = policyFor_("knockout-search", ["CN", "FR"]);
  assert.equal(zhScopeDepthNotes(cn.job, cn.resolved, { jxPolicy: { laneDepth: { zh: "off" } } }).length, 0, "customer config always wins");
  // profile-default scope counts too — the same precedence the lane itself uses.
  const viaProfile = policyFor_("knockout-search", ["HK", "FR"]);
  assert.equal(zhScopeDepthNotes({ markName: "NOVAPULSE" }, viaProfile.resolved, { defaultJurisdictions: ["HK"] }).length, 1,
    "an account's own territories name the scope when the request does not");
});

// ── — the writer is LANE-GENERAL, not zh-hardcoded ─────────────────────────────────────────────
//
// LANGUAGE_LANES defines zh, ja and ko. The disclosure above was written for zh alone, so a Japan- or
// Korea-scoped run at plain prelim said NOTHING about the Japanese/Korean-script equivalents it had
// not searched — and silence there is indistinguishable from "there was nothing to search". Same
// absence-reads-as-a-pass class as the remedy-term half.
//
// SERP_LANES stays zh-only ON PURPOSE (jx-lanes.mjs says so) and is untouched. These tests cover
// the candidate-lane coverage row and nothing else.
//
// NO END-TO-END ja/ko EVIDENCE EXISTS BELOW THIS LINE. No scheduled E2E scenario instructs JP or KR,
// so none of this is proof the lanes ran on a real matter — it is proof the writer is lane-general.

test("#248 scriptScopeDisclosure: the zh vocabulary is DERIVED, and reproduces the frozen constants byte-for-byte", () => {
  const zh = scriptScopeDisclosure("zh");
  assert.equal(zh.area, ZH_SCOPE_COVERAGE_AREA, "derived from LANGUAGE_LANES.label + JURISDICTION_ADAPTERS");
  assert.equal(zh.note, ZH_SCOPE_COVERAGE_NOTE);
  assert.deepEqual(zh.territories, ["CN", "HK", "TW", "MO"]);
  assert.equal(scriptScopeDisclosure("nope"), null, "a lane with no spec has no disclosure");
});

test("#248 scriptScopeDisclosure: EVERY lane in LANGUAGE_LANES gets a distinct area, note and territory list", () => {
  const lanes = Object.keys(LANGUAGE_LANES);
  assert.deepEqual(lanes.sort(), ["ja", "ko", "zh"], "the three candidate lanes");
  const seen = new Set();
  for (const lane of lanes) {
    const d = scriptScopeDisclosure(lane);
    assert.ok(d, `${lane} has a disclosure`);
    assert.ok(d.area && d.note && d.territories.length, `${lane}: area, note and territories all present`);
    assert.ok(d.note.includes(NATIVE_LANGUAGE_REMEDY), `${lane}: the reader is told where the search can be bought`);
    assert.equal(seen.has(d.area), false, `${lane}: its own area, never a sibling's`);
    seen.add(d.area);
  }
  assert.match(scriptScopeDisclosure("ja").area, /Japanese-script register equivalents \(JP\)/);
  assert.match(scriptScopeDisclosure("ko").area, /Korean-script register equivalents \(KR\)/);
});

test("#248 decideScriptScopeHonesty: each lane fires on ITS OWN territories and on nobody else's", () => {
  const cases = [["zh", "CN"], ["ja", "JP"], ["ko", "KR"]];
  for (const [lane, terr] of cases) {
    assert.ok(decideScriptScopeHonesty({ lane, scope: [terr] }), `${lane} fires on ${terr}`);
    assert.ok(decideScriptScopeHonesty({ lane, scope: [] }), `${lane} fires on an unscoped/worldwide run`);
    assert.equal(decideScriptScopeHonesty({ lane, scope: ["US", "EU"] }), null, `${lane} owes nothing on a US/EU scope`);
    assert.equal(decideScriptScopeHonesty({ lane, scope: [terr], laneRan: true }), null, `${lane} ran — nothing to disclose`);
    assert.equal(decideScriptScopeHonesty({ lane, scope: [terr], laneDepthOff: true }), null, `${lane} declined by config — never re-advertised`);
    for (const [other, otherTerr] of cases) {
      if (other === lane) continue;
      assert.equal(decideScriptScopeHonesty({ lane, scope: [otherTerr] }), null,
        `a ${otherTerr}-only scope owes no ${lane} row — disclosing a gap it does not have`);
    }
  }
});

test("#248 scriptLaneRanOnRun: zh keeps its unit legs; ja/ko run when the FOLD accepted candidates", () => {
  const JAKO = { schema: 1, lanes: { ja: { depth: "candidates" }, ko: { depth: "candidates" } },
    fold: { lanes: { ja: { accepted: [{ term: "ノヴァ" }] }, ko: { accepted: [] } } } };
  const dir = mkRun({ laneSidecar: JAKO });
  // ja: a frozen decision AND an accepted fold ⇒ the lane ran
  assert.equal(scriptLaneRanOnRun(dir, "ja", { searchPolicy: POLICY_JX, env: {} }), true);
  // ko: a frozen decision but an EMPTY fold ⇒ nothing was searched ⇒ the row is owed
  assert.equal(scriptLaneRanOnRun(dir, "ko", { searchPolicy: POLICY_JX, env: {} }), false,
    "a lane decision with an empty fold searched nothing — an absence is a finding");
  // the per-lane env kill applies to every lane, by name
  assert.equal(scriptLaneRanOnRun(dir, "ja", { searchPolicy: POLICY_JX, env: { CLEAROTRON_NATIVE_LANGUAGE_JA: "0" } }), false);
  // plain prelim never ran any lane, whatever is on disk
  assert.equal(scriptLaneRanOnRun(dir, "ja", { searchPolicy: POLICY_PRELIM, env: {} }), false);
  // zh keeps its own rule, and item 8 changed what that rule READS rather than what it means: one
  // of the two units having executed. The evidence is now the unit record instead of the arm that used
  // to gate it — which makes this branch the same SHAPE as the ja/ko one above (a record of work done),
  // where before it was the odd one out (a record of configuration).
  const zhRan = mkRun({ laneSidecar: ZH_SIDECAR, units: RAN_GRID });
  assert.equal(scriptLaneRanOnRun(zhRan, "zh", { searchPolicy: POLICY_JX, env: {} }), true);
  const zhDecidedOnly = mkRun({ laneSidecar: ZH_SIDECAR });
  assert.equal(scriptLaneRanOnRun(zhDecidedOnly, "zh", { searchPolicy: POLICY_JX, env: {} }), false,
    "no unit record ⇒ the zh deepening never ran, whatever the frozen decision says");
  assert.equal(zhLaneRanOnRun(zhRan, { searchPolicy: POLICY_JX, env: {} }), true, "the zh-bound alias still answers identically");
});

test("#248 injectScriptScopeCoverage: a JP+KR plain-prelim run gets the ja AND ko rows — and neither eats the other", () => {
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  const args = { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["JP", "KR"] }, profile: {}, env: {} };
  injectScriptScopeCoverage(P, dir, quiet, args);
  const cov = JSON.parse(readFileSync(P.findings, "utf8")).coverage;
  const areas = cov.map((c) => c.area);
  assert.ok(areas.includes(scriptScopeDisclosure("ja").area), "the Japanese-script row landed");
  assert.ok(areas.includes(scriptScopeDisclosure("ko").area), "the Korean-script row landed");
  assert.equal(areas.includes(ZH_SCOPE_COVERAGE_AREA), false, "no Chinese-script row — CN is not in scope");
  assert.ok(cov.every((c) => c.state !== "deferred"), "every injected row is coverage-limited — never a verdict clamp");
  // idempotent on resume, per lane
  injectScriptScopeCoverage(P, dir, quiet, args);
  const twice = JSON.parse(readFileSync(P.findings, "utf8")).coverage;
  assert.equal(twice.length, cov.length, "a second pass duplicates nothing");
});

test("#248 the row-eater: a CN+JP scope must not lose the ja row to the zh row's own remedy clause", () => {
  // The old suppression treated ANY coverage row carrying the recommendation vocabulary as covering the
  // disclosure. Harmless with one lane; with two, the zh row lands first and carries that vocabulary in
  // its own remedy clause — which is still true now the clause reads "the native-language investigation"
  // instead of "(prelim-jx)". The per-lane MARKER is what keeps the ja row alive, and it is what this
  // asserts: the token match alone would eat it either way.
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["CN", "JP"] }, profile: {}, env: {} });
  const areas = JSON.parse(readFileSync(P.findings, "utf8")).coverage.map((c) => c.area);
  assert.ok(areas.includes(ZH_SCOPE_COVERAGE_AREA), "the Chinese-script row");
  assert.ok(areas.includes(scriptScopeDisclosure("ja").area), "AND the Japanese-script row — both scopes are real");
  assert.equal(areas.includes(scriptScopeDisclosure("ko").area), false, "KR is not in scope — no Korean row");
});

test("#248 a synthesis-authored Stage-1.5 row still defers — but only for ITS OWN lane", () => {
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: [
    { area: "register / JP", state: "coverage-limited", note: `Japanese-script equivalents: ${NATIVE_LANGUAGE_REMEDY}` },
  ] }, null, 2));
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["JP", "KR"] }, profile: {}, env: {} });
  const areas = JSON.parse(readFileSync(P.findings, "utf8")).coverage.map((c) => c.area);
  assert.equal(areas.includes(scriptScopeDisclosure("ja").area), false, "synthesis already disclosed the ja lane — not duplicated");
  assert.ok(areas.includes(scriptScopeDisclosure("ko").area), "but the ko lane is still owed its own row");
});

test("#248 the RETIRED vocabulary still defers, because a resumed run's synthesis wrote it", () => {
  // Deliberately kept, and this is the leg that says why: a run resumed from before carries a
  // synthesis row phrased "available at Depth 5 (prelim-jx)". Dropping the old token would put a second,
  // duplicate disclosure into a report that already makes the same one — a regression visible only on the
  // resumes nobody re-runs, which is the class of defect that goes unnoticed longest.
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: [
    { area: "register / JP", state: "coverage-limited", note: "Japanese-script equivalents are available at Depth 5 (prelim-jx)" },
  ] }, null, 2));
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["JP"] }, profile: {}, env: {} });
  const areas = JSON.parse(readFileSync(P.findings, "utf8")).coverage.map((c) => c.area);
  assert.equal(areas.includes(scriptScopeDisclosure("ja").area), false,
    "the pre-#467 wording no longer defers — a resumed run would carry the disclosure twice");
});

test("#248 never-kill survives the generalisation — a corrupt findings.json is left byte-identical", () => {
  const dir = mkRun();
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, "{ not json");
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: POLICY_PRELIM, job: { jurisdictions: ["JP", "CN"] }, profile: {}, env: {} });
  assert.equal(readFileSync(P.findings, "utf8"), "{ not json");
});

// ── THE LEAK SCAN THAT DID NOT COVER THIS SURFACE ───────────────────────────────────────────────────
//
// products.test.mjs scans every refusal sentence products.mjs can produce for internal product ids,
// retired level keys and "Depth N" — because those are strings a REQUESTER reads. The coverage rows
// below are strings a CLIENT reads, in a delivered report, and NOTHING scanned them. That absence is how
// `not searched at this level — available at Depth 5 (prelim-jx)` shipped into client prose and survived
// two rounds: it was never wrong by any check that existed.
//
// So the scan extends here, to the disclosure vocabulary, over EVERY lane rather than the one that was
// looked at. An id or a rung reaching a report fails on the commit that writes it.

test("no lane's client-facing disclosure carries an internal key, a component name, or a rung of the ladder", () => {
  const strings = [ZH_SCOPE_COVERAGE_AREA, ZH_SCOPE_COVERAGE_NOTE, NATIVE_LANGUAGE_REMEDY];
  for (const lane of Object.keys(LANGUAGE_LANES)) {
    const d = scriptScopeDisclosure(lane);
    assert.ok(d, `${lane} has a disclosure`);
    strings.push(d.area, d.note);
  }
  for (const m of strings) {
    for (const id of PRODUCT_IDS) assert.ok(!m.includes(id), `a product id reached a client report: ${id} in "${m}"`);
    assert.doesNotMatch(m, /Depth \s*\d/, `a rung of the retired ladder reached a client report: "${m}"`);
    assert.doesNotMatch(m, /\bprelim\b|prelim-jx|prelim-register-only|knockout-register/, `a retired level key reached a client report: "${m}"`);
    assert.doesNotMatch(m, /jxLanes|registerProbe|commonLawGrid|maxMarks|stageLabel/, `an internal component name reached a client report: "${m}"`);
    assert.doesNotMatch(m, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached a client report: "${m}"`);
  }
  // AND THE ROW AS BUILT, not only its parts — the note is assembled from two sources and either could
  // reintroduce the vocabulary the other dropped.
  const row = decideZhScopeHonesty({ scope: ["CN"], laneRan: false });
  assert.doesNotMatch(`${row.area} ${row.note}`, /Depth \s*\d|prelim-jx/);
});
