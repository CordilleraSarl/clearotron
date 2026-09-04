// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-rules.test.mjs — the (depth × scope) combination rules, which are server-side truth for three
// doors (runner admission, plan_run, the portal's plan gate). Three properties matter most and are
// asserted as BEHAVIOUR rather than as wording:
//
//   1. the guard measures the effective-scope LADDER — the same ruler both previews report their
//      territories from, so a blocker can never contradict the scope printed beside it. Where the ladder
//      and what decideJxLanes actually reads disagree, that gap is a WARNING, never a certification.
//   2. the advice is actionable: every territory name the message tells a requester to send round-trips
//      through the shared vocabulary bridge back to the routing code it is supposed to name.
//   3. nothing a requester supplied is interpolated raw — these sentences ride reason files, outbox
//      packets and log lines, and a newline in a territory name must not forge a row in any of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClearanceScopeRules, ROUTING_NAMES } from "../scope-rules.mjs";
import { PRODUCT_IDS } from "../products.mjs";
import { JURISDICTION_ADAPTERS } from "../jx-lanes.mjs";
import { resolveEffectiveScope } from "../effective-scope.mjs";
import { validateJob } from "../enqueue-schema.mjs";
import { normalizeTerritory } from "../../providers/_shared/territory-codes.mjs";

// Resolved-policy shapes as resolveSearchPolicy hands them over. `nativeRequested` is the field the jx
// routing rule keys on: an investigation somebody ASKED for and cannot route is a refusal, and the same
// component arriving automatically (a Full country search) is not — refusing there would be refusing a
// shape we chose for them.
const JX = { product: "multi-country-focus-search", stageLabel: "Multi-country focus search", pipeline: "clearance",
  components: { registerProbe: false, jxLanes: true, commonLawGrid: true }, nativeRequested: true };
const PRELIM = { product: "multi-country-focus-search", stageLabel: "Multi-country focus search", pipeline: "clearance",
  components: { registerProbe: false, jxLanes: false, commonLawGrid: true } };
const GLOBAL = { product: "global-preliminary-search", stageLabel: "Global preliminary search", pipeline: "clearance",
  components: { registerProbe: false, jxLanes: false, commonLawGrid: true } };
const FULL_COUNTRY = { product: "full-country-search", stageLabel: "Full country search", pipeline: "clearance",
  components: { registerProbe: false, jxLanes: true, commonLawGrid: true }, nativeRequested: false };
const KNOCKOUT = { product: "knockout-search", stageLabel: "Knockout search", pipeline: "knockout",
  components: { registerProbe: true, jxLanes: false, commonLawGrid: false } };

const errs = (o) => checkClearanceScopeRules(o).errors;
const warns = (o) => checkClearanceScopeRules(o).warnings;
const FULL = { id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a", ref: "TMP9001", markName: "QUEUE PROBE", classes: [9] };

// ── the native-language ROUTING rule ────────────────────────────────────────────────────────────────
//
// Gated on `nativeRequested`, not on the component. Somebody TICKED the toggle on a Multi-country focus
// search and the scope routes nothing: they bought a lane that will not run. The same component arriving
// automatically (a Full country search over a country with no adapter) is not a refusal — refusing there
// would be refusing a shape we chose for them.
test("native-language routing: an investigation somebody ASKED for refuses a scope it cannot route on", () => {
  const fr = errs({ job: { jurisdictions: ["France", "Germany"] }, profile: null, resolved: JX });
  assert.equal(fr.length, 1, JSON.stringify(fr));
  assert.match(fr[0], /native-script deepening routes on territory/);
  assert.match(fr[0], /scope \("France", "Germany"\)/,
    "QUOTED AS WRITTEN. It used to echo the canonical codes (\"FR\", \"DE\") — the codes are what ROUTE, and a "
    + "requester who typed \"France\" was sent hunting for a value they never used (products.mjs:141). The lane "
    + "lookup still runs on the codes; only the sentence changed.");
  assert.match(fr[0], /run the standard preliminary without the deepening/, "the message offers the runnable alternative");
  // display names bridge to codes: the portal composer submits "China", the adapter table keys on CN
  assert.deepEqual(errs({ job: { jurisdictions: ["China", "France"] }, profile: null, resolved: JX }), []);
  assert.deepEqual(errs({ job: { jurisdictions: ["US", "Japan"] }, profile: null, resolved: JX }), []);
  // the profile's default territories are the scope a request that names none actually runs at
  assert.deepEqual(errs({ job: {}, profile: { defaultJurisdictions: ["CN", "FR"] }, resolved: JX }), []);
  assert.equal(errs({ job: { jurisdictions: ["FR", "DE"] }, profile: { defaultJurisdictions: ["CN", "JP"] }, resolved: JX }).length, 1,
    "instructed scope WINS over the profile default — the same precedence decideJxLanes applies");
  // THE AUTOMATIC ARM NEVER REFUSES. A Full country search over a country with no adapter routes
  // nothing, and nobody asked for it — a refusal there is one we inflicted on ourselves.
  assert.deepEqual(errs({ job: { jurisdictions: ["Brazil"] }, profile: null, resolved: FULL_COUNTRY }), []);
  // no jxLanes component ⇒ nothing to route
  assert.deepEqual(errs({ job: { jurisdictions: ["France", "Germany"] }, profile: null, resolved: PRELIM }), []);
  assert.deepEqual(errs({ job: {}, profile: null, resolved: KNOCKOUT }), []);
  assert.deepEqual(errs({ job: {}, profile: null, resolved: null }), [], "nothing resolved ⇒ nothing to judge");
  assert.deepEqual(checkClearanceScopeRules(), { errors: [], warnings: [] }, "callable with nothing at all");
});

test("the guard and the previews resolve scope through ONE ladder — a saved search's territories are not refused", () => {
  // The recipe shape: resolveSearchPolicy hands back recipeScope, and resolveEffectiveScope reads it. So
  // does this guard, deliberately — plan_run reports "territories: China (from the saved search)" from
  // that ladder, and a blocker in the SAME payload saying the scope has no routing territory is the
  // two-rulers failure this codebase already rejected for validateJob.
  const resolved = { ...JX, recipe: { key: "aurora/quarterly" }, recipeScope: { jurisdictions: ["China", "France"] } };
  assert.deepEqual(resolveEffectiveScope({}, null, resolved).jurisdictions, ["China", "France"],
    "the ladder reads the recipe — and the guard measures the same ladder");
  // …and it is not merely un-refused: foldRecipeScope writes the saved search's territories into the job
  // before decideJxLanes reads it (audit N3), so the lane genuinely fires. Nothing to warn about either.
  assert.deepEqual(checkClearanceScopeRules({ job: {}, profile: null, resolved }), { errors: [], warnings: [] },
    "no false refusal — and no warning telling this requester to name a territory the fold already names");
  // naming it on the REQUEST is the same run by the other route
  assert.deepEqual(checkClearanceScopeRules({ job: { jurisdictions: ["China", "France"] }, profile: null, resolved }),
    { errors: [], warnings: [] });
  // and the ladder feeds the PRODUCT rule too: a recipe carrying two territories on a one-country
  // product is a two-country Full country search, and the refusal counts what the ladder resolved.
  const two = { ...FULL_COUNTRY, recipe: { key: "aurora/quarterly" }, recipeScope: { jurisdictions: ["United States", "France"] } };
  const d1 = errs({ job: {}, profile: null, resolved: two });
  assert.equal(d1.length, 1, JSON.stringify(d1));
  assert.match(d1[0], /this request names 2 \("United States", "France"\)/,
    "the ladder's OWN entries reach the product rule — the wall quotes what the saved search stored, which is "
    + "what the door would have quoted for the same request. The COUNT is unaffected: canonicalize dedups on "
    + "code and products.mjs tally dedups on territoryKey, which is the same identity.");
});

test("a lane the ACCOUNT switched off is a warning, not a refusal — the requester has nothing to change", () => {
  // decideJxLanes has a second skip the adapter table cannot see: jxPolicy.laneDepth.<lane> = "off".
  // Telling this requester to "add one of China (CN) …" would be wrong advice — China is already in scope.
  const scoped = { jurisdictions: ["China", "France"] };
  const off = checkClearanceScopeRules({ job: scoped, profile: { jxPolicy: { laneDepth: { zh: "off" } } }, resolved: JX });
  assert.deepEqual(off.errors, [], "the scope routes; refusing it would blame the requester for the account's own setting");
  assert.equal(off.warnings.length, 1, JSON.stringify(off.warnings));
  assert.match(off.warnings[0], /this account has that deepening switched off/);
  assert.doesNotMatch(off.warnings[0], /add one of China/, "the territory is already in scope — that advice would be wrong");
  // the same account reached through a saved search's scope, which the fold turns into the run's own
  const viaRecipe = checkClearanceScopeRules({ job: {}, profile: { jxPolicy: { laneDepth: { zh: "off" } } },
    resolved: { ...JX, recipeScope: scoped } });
  assert.equal(viaRecipe.warnings.length, 1, "the lane is off whichever rung put the territory in scope");
  // a lane that IS on says nothing at all
  assert.deepEqual(checkClearanceScopeRules({ job: scoped, profile: { jxPolicy: { laneDepth: { ja: "off" } } }, resolved: JX }),
    { errors: [], warnings: [] });
});

test("an unreadable profile suspends only what it made unknowable — the wall still counts what the request names", () => {
  // resolveProfile THROWS for a named-but-unknown key (the roster-blindness incident). Skipping the rules
  // wholesale there admitted a three-country deep dive at the door whose own comment calls it the only
  // place they cannot be bypassed.
  const unreadable = { job: { jurisdictions: ["US", "FR", "JP"] }, profile: null, resolved: FULL_COUNTRY, profileReadable: false };
  assert.equal(errs(unreadable).length, 1, "the job named every territory — the profile was irrelevant to the count");
  // but a claim about defaults nobody could read is never made
  assert.deepEqual(errs({ job: {}, profile: null, resolved: FULL_COUNTRY, profileReadable: false }), [],
    "no zero-form refusal about an account's territories the resolver could not read");
  assert.deepEqual(errs({ job: {}, profile: null, resolved: JX, profileReadable: false }), []);
  // a request that legitimately has no profile is a different thing: its empty scope IS what it would run
  assert.equal(errs({ job: {}, profile: null, resolved: FULL_COUNTRY }).length, 1);
});

// ── THE PRODUCT against the scope it will actually run at ───────────────────────────────────────────
// The rule the doors enforce is "does this product accept this scope?" (products.mjs). It replaced
// `caseLaw && scope.length !== 1`, a proxy for "one country" that was wrong three ways — a region
// counted as one, a typo counted as one, and the knockout pipeline was exempt.
test("the product's own geography rule bites on the RESOLVED scope, and names what to order instead", () => {
  const none = errs({ job: {}, profile: null, resolved: FULL_COUNTRY });
  assert.equal(none.length, 1, JSON.stringify(none));
  assert.match(none[0], /reads exactly one country/);
  assert.match(none[0], /resolves to no territory \(worldwide\)/);
  assert.match(none[0], /order a Global preliminary search to search worldwide/,
    "the refusal names the product that DOES accept this scope");
  const two = errs({ job: { jurisdictions: ["US", "France"] }, profile: null, resolved: FULL_COUNTRY });
  assert.equal(two.length, 1);
  assert.match(two[0], /this request names 2 \("US", "France"\)/,
    "it counts what it measured and quotes what the requester WROTE — the door refuses this request in exactly "
    + "these words, and the wall used to answer \"US\", \"FR\" for the same two territories");
  assert.match(two[0], /order a Multi-country focus search over them/);
  // exactly one country — instructed or inherited — IS the runnable shape
  assert.deepEqual(errs({ job: { jurisdictions: ["United States"] }, profile: null, resolved: FULL_COUNTRY }), []);
  assert.deepEqual(errs({ job: {}, profile: { defaultJurisdictions: ["US"] }, resolved: FULL_COUNTRY }), []);
  // an account whose defaults are broad does not get a silent multi-country deep dive
  assert.equal(errs({ job: {}, profile: { defaultJurisdictions: ["NZ", "PH", "IN"] }, resolved: FULL_COUNTRY }).length, 1,
    "profile defaults ARE the territories the deep dive would read");
  // duplicate spellings are one country, not two — counted as places, not as list entries
  assert.deepEqual(errs({ job: { jurisdictions: ["US", "United States"] }, profile: null, resolved: FULL_COUNTRY }), []);
});

test("every product is judged, and a KNOCKOUT is no longer exempt from anything", () => {
  // THE EXEMPTION THAT WENT. The old rule skipped the knockout pipeline because decideCaseLaw never read
  // the lever there. A knockout accepts any geography, so it refuses nothing here — but it is JUDGED,
  // and an entry that names nowhere is refused on it exactly as on every other product.
  assert.deepEqual(errs({ job: { jurisdictions: ["US", "FR", "EU"] }, profile: null, resolved: KNOCKOUT }), []);
  assert.equal(errs({ job: { jurisdictions: ["Freedonia"] }, profile: null, resolved: KNOCKOUT }).length, 1,
    "a typo names nowhere, on a quick screen as anywhere else");
  // A Global preliminary search accepts NO narrowing — the shape that sold "everywhere" and ran seven.
  const narrowed = errs({ job: { jurisdictions: ["US"] }, profile: null, resolved: GLOBAL });
  assert.equal(narrowed.length, 1);
  assert.match(narrowed[0], /is worldwide and accepts no narrowing/);
  assert.match(narrowed[0], /order a Full country search over them/);
  assert.deepEqual(errs({ job: {}, profile: null, resolved: GLOBAL }), []);
  // A Multi-country focus search accepts neither worldwide nor exactly one.
  assert.match(errs({ job: {}, profile: null, resolved: PRELIM })[0], /resolves to no territory \(worldwide\)/);
  assert.match(errs({ job: { jurisdictions: ["France"] }, profile: null, resolved: PRELIM })[0], /names one country/);
  assert.deepEqual(errs({ job: { jurisdictions: ["France", "Germany"] }, profile: null, resolved: PRELIM }), []);
});

test("both rules can fire on one request, and each says its own thing", () => {
  const out = errs({ job: { jurisdictions: ["France"] }, profile: null, resolved: { ...JX, product: "full-country-search" } });
  assert.equal(out.length, 1, JSON.stringify(out));
  const both = errs({ job: {}, profile: null, resolved: JX });
  assert.equal(both.length, 2, JSON.stringify(both));
  assert.equal(both.filter((e) => /routes on territory/.test(e)).length, 1);
  assert.equal(both.filter((e) => /reads a region, or two or more countries/.test(e)).length, 1);
});

// ── the worldwide token, across the pair of guards ──────────────────────────────────────────────────
test("the worldwide token never counts as a territory — on ANY rung of the ladder", () => {
  // validateJob clears the token off a JOB at the door, and the portal carries that normalization back
  // onto the real job. The other two rungs never pass through it: a saved search's scope and an account's
  // defaultJurisdictions are free-text lines a staff editor writes. So the drop happens here as well —
  // otherwise "Worldwide" reads as one territory and a worldwide deep dive is waved through as compliant.
  const raw = { ...FULL, jurisdictions: ["Worldwide"] };
  const before = errs({ job: { ...raw }, profile: null, resolved: FULL_COUNTRY });
  assert.equal(before.length, 1, "the token is dropped whether or not intake got to it first");
  assert.match(before[0], /no territory \(worldwide\)/);
  const job = { ...raw };
  assert.equal(validateJob(job).ok, true);
  const out = errs({ job, profile: null, resolved: FULL_COUNTRY });
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.match(out[0], /no territory \(worldwide\)/);
  // an account whose DEFAULT territories say "Worldwide" gets the same answer, in every spelling
  for (const token of ["Worldwide", "worldwide", "GLOBAL", "all"]) {
    assert.equal(errs({ job: {}, profile: { defaultJurisdictions: [token] }, resolved: FULL_COUNTRY }).length, 1,
      `${token} in an account's defaults is not a country to deep-dive`);
    assert.equal(errs({ job: {}, profile: { defaultJurisdictions: [token] }, resolved: JX }).length, 2,
      `${token} routes no native-script lane either, and names no territory for the product`);
  }
  // …and a real territory beside the token still wins, on the ladder as at the door
  assert.deepEqual(errs({ job: {}, profile: { defaultJurisdictions: ["Worldwide", "US"] }, resolved: FULL_COUNTRY }), []);
  // A REQUESTED worldwide no longer falls through to the account's defaults — it WINS over them.
  const overDefaults = errs({ job, profile: { defaultJurisdictions: ["US"] }, resolved: FULL_COUNTRY });
  assert.equal(overDefaults.length, 1, JSON.stringify(overDefaults));
  assert.match(overDefaults[0], /no territory \(worldwide\)/);
});

// ── the product is counted in COUNTRIES, not in list entries ────────────────────────────────────────
test("a REGION is not one country — the hole that admitted a 27-state deep dive as compliant", () => {
  // ["European Union"] canonicalizes to ["EU"]: one entry, and `scope.length === 1` was satisfied. The
  // case-law and opposition reading that makes a deep dive deep is per-country practice; there is no
  // single precedent of the EUIPO's member states.
  for (const region of ["European Union", "EU", "EUIPO", "Benelux", "ARIPO", "Madrid"]) {
    const out = errs({ job: { jurisdictions: [region] }, profile: null, resolved: FULL_COUNTRY });
    assert.equal(out.length, 1, `${region} must not read as one country: ${JSON.stringify(out)}`);
    assert.match(out[0], /reads exactly one country/);
    assert.match(out[0], /is a regional filing system covering many countries, not one country/);
    assert.match(out[0], /Name one of its countries, or order a Multi-country focus search over the region/);
  }
  // the same rule from the account's defaults, which is the rung nothing validates
  assert.equal(errs({ job: {}, profile: { defaultJurisdictions: ["European Union"] }, resolved: FULL_COUNTRY }).length, 1);
  // a region ALONGSIDE a country is a multi-territory request, and the REGION is what makes it wrong
  const mixed = errs({ job: { jurisdictions: ["EU", "France"] }, profile: null, resolved: FULL_COUNTRY });
  assert.equal(mixed.length, 1);
  assert.match(mixed[0], /"EU" is a regional filing system/);
  // two regions read as plural
  assert.match(errs({ job: { jurisdictions: ["EU", "Benelux"] }, profile: null, resolved: FULL_COUNTRY })[0],
    /"EU", "Benelux" are regional filing systems covering many countries, not one country/);
  // and one real country is still the runnable shape
  assert.deepEqual(errs({ job: { jurisdictions: ["Germany"] }, profile: null, resolved: FULL_COUNTRY }), []);
  // A REGION IS A LEGAL SCOPE for the product that takes one — the tier is a fact, not a verdict.
  assert.deepEqual(errs({ job: { jurisdictions: ["European Union"] }, profile: null, resolved: PRELIM }), []);
});

test("an unrecognized territory is not a country either — a typo names nowhere", () => {
  // normalizeTerritory passes ANY two-letter input through uppercased, so "QQ" looked exactly like a
  // country code. A deep dive admitted over it would search nothing and report confidently about it.
  for (const bogus of ["QQ", "Freedonia"]) {
    const out = errs({ job: { jurisdictions: [bogus] }, profile: null, resolved: FULL_COUNTRY });
    assert.equal(out.length, 1, `${bogus} must not read as one country: ${JSON.stringify(out)}`);
    assert.match(out[0], /names no country or region this engine recognizes/);
  }
  // a real country plus a typo is refused on the TYPO — a search with a hole in it, not a longer list
  assert.match(errs({ job: { jurisdictions: ["France", "QQ"] }, profile: null, resolved: FULL_COUNTRY })[0],
    /names no country or region this engine recognizes/);
});

test("worldwide WINS over the account's default territories — it is not a gap for them to fill", () => {
  // The shape that sold "everywhere" and ran seven countries: an account with default territories, and a
  // request whose worldwide instruction had nowhere to live. The stamp is where it lives now, and the
  // ladder short-circuits on it before the account rung is ever reached.
  const seven = { defaultJurisdictions: ["NZ", "PH", "IN", "RU", "ID", "ZA", "TR"] };
  const out = errs({ job: { geography: { mode: "worldwide", origin: "request" } }, profile: seven, resolved: FULL_COUNTRY });
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.match(out[0], /no territory \(worldwide\)/, "measured as worldwide, not as the account's seven");
  // the SAME account, with the requester silent instead — the account's defaults do apply, and the
  // refusal counts seven. Two different requests, two different answers: the point of the stamp.
  const silent = errs({ job: { geography: { mode: "account-default", origin: "account-default" } }, profile: seven, resolved: FULL_COUNTRY });
  assert.equal(silent.length, 1);
  assert.match(silent[0], /this request names 7/);
  // and a worldwide request routes no native-script lane, whatever the account's defaults say
  assert.ok(errs({ job: { geography: { mode: "worldwide", origin: "request" } }, profile: { defaultJurisdictions: ["CN", "FR"] }, resolved: JX })
    .some((e) => /routes on territory/.test(e)));
});

test("a requester-supplied territory cannot forge a row in a reason file, an outbox packet or a log line", () => {
  // The doctrine resolveSearchPolicy states for selectors, applied to territories: these messages ride
  // .failed.reason files and outbox packets verbatim (runner.mjs failAtIntake). validateJob only refuses
  // entries whose TRIMMED length is outside 2–40, so an interior newline passes the door.
  const forged = "FR\n[runner] cl-1 -> done";
  const job = { ...FULL, jurisdictions: ["US", forged] };
  assert.equal(validateJob(job).ok, true, "intake accepts it — which is exactly why the echo has to hold");
  const out = errs({ job, profile: null, resolved: FULL_COUNTRY });
  assert.equal(out.length, 1);
  assert.equal(out[0].includes("\n"), false, `a newline reached a message that rides a log line: ${JSON.stringify(out[0])}`);
  assert.match(out[0], /\\n/, "the newline is shown as an escape, so the requester still sees what they sent");
  // profile defaults are validated as an array and nothing more, so the same holds for that rung — and an
  // oversized entry is clamped rather than becoming an oversized refusal
  const long = errs({ job: {}, profile: { defaultJurisdictions: ["X".repeat(500), "Y".repeat(500)] }, resolved: FULL_COUNTRY });
  assert.equal(long.length, 1);
  assert.ok(long[0].length < 400, `an unbounded profile entry became an unbounded refusal (${long[0].length} chars)`);
});

// ── the two properties every client-facing sentence has to have ─────────────────────────────────────
test("no message names a switch, a variable or an internal level key", () => {
  const all = [
    ...errs({ job: { jurisdictions: ["France", "Germany"] }, profile: null, resolved: JX }),
    ...errs({ job: {}, profile: null, resolved: FULL_COUNTRY }),
    ...errs({ job: { jurisdictions: ["US", "FR"] }, profile: null, resolved: FULL_COUNTRY }),
    // the warnings ride the same doors (plan_run.warnings, the portal's plan response, runner notes)
    ...warns({ job: { jurisdictions: ["China", "France"] }, profile: { jxPolicy: { laneDepth: { zh: "off" } } }, resolved: JX }),
  ];
  assert.equal(all.length, 4, JSON.stringify(all));
  for (const m of all) {
    assert.doesNotMatch(m, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached a requester: ${m}`);
    assert.doesNotMatch(m, /jxLanes|registerProbe|commonLawGrid|laneDepth|jxPolicy/, `an internal component name reached a requester: ${m}`);
    // bare `prelim` belongs in this list as much as its siblings do: it is a ORDERABLE_PRODUCTS key, and the
    // portal renders these lines verbatim to a client who has only ever been shown the STAGE label. The
    // sibling assertion in portal-service.test.mjs omitted it too, so both claimed a property neither
    // checked (review 2026-07-27). \bprelim\b does not match "preliminary", which is the words we use.
    assert.doesNotMatch(m, /\bprelim\b|prelim-jx|prelim-register-only|knockout-register/, `an internal level key reached a requester: ${m}`);
    // THE PRODUCT IDS, DERIVED FROM THE REGISTRY AND NOT TYPED OUT. The line above is a literal list of
    // TODAY's level keys, which is exactly the shape that keeps passing while a NEW key leaks: the scan
    // has to grow with the vocabulary or it certifies the thing it was written to catch. The ids are the
    // names hyphen-joined, so "Full country search" is safe and `full-country-search` is not.
    for (const id of PRODUCT_IDS) assert.ok(!m.includes(id), `a product id reached a requester: ${id} in ${m}`);
  }
});

test("ROUTING_NAMES covers every adapter jurisdiction, and every name it prints is one the bridge accepts", () => {
  const codes = Object.keys(JURISDICTION_ADAPTERS);
  assert.deepEqual(Object.keys(ROUTING_NAMES), codes, "a new adapter jurisdiction must arrive with a display name");
  for (const code of codes) {
    const name = ROUTING_NAMES[code];
    assert.ok(name && name !== code, `adapter ${code} has no display name — the message would tell a requester to send "${code}"`);
    assert.match(name, /^[A-Z][a-z]/, `${code} → ${name} is not a display name`);
    // THE actionability test: what we tell someone to put in jurisdictions must canonicalize back to the
    // routing code, or the advice sends them round the loop again.
    assert.equal(normalizeTerritory(name), code, `${name} does not resolve to ${code} through the shared vocabulary`);
  }
  assert.deepEqual(Object.values(ROUTING_NAMES), ["China", "Hong Kong", "Taiwan", "Macau", "Japan", "South Korea"],
    "first spelling in the vocabulary wins — Macao/Korea are aliases, not the names we print");
  const msg = errs({ job: {}, profile: null, resolved: JX })[0];
  for (const code of codes) assert.ok(msg.includes(`${ROUTING_NAMES[code]} (${code})`), `${code} missing from the routing list`);
});
