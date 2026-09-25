// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Per-customer profiles: resolution
// (forwarder-domain only), load-time hard-fails, derived floor/batch arithmetic, the applicant gate
// on self-exclusion, the platform-identity join, and the profile-aware message rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { loadProfiles, resolveProfile, derivedFloor, derivedBatchSize, applicantMatchesProfile, SAFE_GRID_CELLS,
  DENSE_GRID_CELLS, assertAppetitePosture, FIELD_CONSUMERS, KNOWN_PROFILE_KEYS, NEUTRAL_DELIVERY,
  PROJECT_KEYS, CUSTOMER_ONLY_KEYS, loadProjects, resolveEffectiveProfile, validateProfileEdit,
  platformEntryErrors, withRunPlatforms } from "../profiles.mjs";
import { findPlatformIdentityViolations } from "../common-law-receipts.mjs";
import { STAGES, lines } from "../stages.mjs";
import { properNameCandidates, referenceChecks, runLint } from "../predelivery-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAMING_DOMAINS = ["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com", "gog.com", "itch.io"];

function profileDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "profiles-"));
  for (const [name, obj] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(obj));
  return dir;
}
const GENERIC = { name: "House default", matchDomains: [], industry: "gaming", platforms: GAMING_DOMAINS, defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [] };
const ACME = { name: "Acme Industrial", matchDomains: ["acme.example"], industry: "industrial", platforms: ["alibaba.com", "thomasnet.com", "globalspec.com", "made-in-china.com", "directindustry.com"], defaultClasses: [7, 9], defaultJurisdictions: ["EU", "US", "CN"], selfExclusionOwners: ["Acme Industrial", "Acme Holdings"] };

// ---- shipped data files (the regression anchor) ---------------------------------------------------

// The shipped demo account is the regression anchor for a dense grid: its platforms, the floor and batch
// derived from them, and its own classes, territories, self-exclusions and delivery.

test("shipped profile: demo-brand-owner — dense grid (floor 12, batch 1) + its own classes/jurisdictions/self-exclusions", () => {
  const demo = loadProfiles({ force: true, includeDemo: true }).get("demo-brand-owner");
  assert.ok(demo, "demo-brand-owner.json exists");
  assert.equal(demo.platforms.length, 11, "the demo's 11 platforms, as shipped");
  assert.equal(derivedFloor(demo), 12, "11 platforms + 1 web");
  assert.equal(derivedBatchSize(demo), 1, `the dense budget (${DENSE_GRID_CELLS}/12) leaves one variant a batch`);
  assert.deepEqual(demo.matchDomains, ["demo-brand-owner.example"]);
  assert.deepEqual(demo.defaultClasses, [9, 41]);
  assert.deepEqual(demo.defaultJurisdictions, ["EU", "US", "JP"]);
  assert.deepEqual(demo.selfExclusionOwners, ["Demo Brand Owner", "Demo Brand Owner Ltd"]);
  assert.deepEqual(demo.delivery, { email: "summary", privileged: false });
});

test("shipped profile: generic — neutral boilerplate (cross-vertical, dense, no gaming, no industry)", () => {
  const g = loadProfiles({ force: true }).get("generic");
  assert.ok(g, "generic.json exists (the universal fallback)");
  assert.deepEqual(g.platforms, ["amazon.com", "apps.apple.com", "play.google.com"], "cross-vertical default, NOT the gaming grid");
  assert.equal(g.marketplaceDensity, "dense", "amazon/app-store cells are byte-heavy — conservative budget");
  assert.equal(derivedFloor(g), 4, "3 platforms + 1 web");
  assert.equal(derivedBatchSize(g), 4, `dense budget ${DENSE_GRID_CELLS}/4`);
  assert.equal(g.industry, undefined, "no sector assumption for an unprofiled customer");
  assert.deepEqual(g.defaultClasses, [], "no class default");
  assert.deepEqual(g.defaultJurisdictions, [], "no jurisdiction default");
  assert.deepEqual(g.selfExclusionOwners, [], "no exclusion seed");
  // — SILENT ON `privileged`, and the silence is load-bearing. The field is three-state on the
  // report templates: true extends the marking, FALSE IS A DELIBERATE OFF, absent is no opinion and gets
  // the plain "Privileged & Confidential" any legal deliverable carries. This profile is what an unbound
  // run and a customer who said nothing both fall to, and neither instructed us to strip a marking —
  // saying `false` here read as that instruction, and shipped House-default clearances with no line.
  // zephyr and petcary keep their explicit `false`; that is a customer choosing off, which still works.
  assert.deepEqual(g.delivery, { email: "summary" }, "neutral delivery — no table, and NO OPINION on privilege");
  assert.ok(!("privileged" in g.delivery), "absent, not false — the two mean different things now");
});

// ---- resolution (forwarder-domain ONLY) ------------------------------------------------------------

test("resolution: exact domain or dot-suffix → profile; everything else (incl. the applicant name) → generic", () => {
  const profiles = loadProfiles({ dir: profileDir({ generic: GENERIC, acme: ACME }), force: true });
  const r = (job) => resolveProfile(job, { profiles }).key;
  assert.equal(r({ forwarderDomain: "acme.example" }), "acme");
  assert.equal(r({ forwarderDomain: "mail.acme.example" }), "acme");
  assert.equal(r({ forwarderDomain: "notacme.example" }), "generic", "bare suffix must not match (dot-anchored)");
  assert.equal(r({ forwarderDomain: "law-firm.example" }), "generic");
  assert.equal(r({ forwarderDomain: "law-firm.example", customer: "Acme Industrial" }), "generic",
    "the APPLICANT never selects a profile — forwarder only");
  assert.equal(r({}), "generic");
});

test("resolution: the intake AI's explicit profileKey WINS (beats domain); applicant never selects; an unknown key THROWS", () => {
  const profiles = loadProfiles({ dir: profileDir({ generic: GENERIC, acme: ACME }), force: true });
  const r = (job) => resolveProfile(job, { profiles }).key;
  assert.equal(r({ profileKey: "acme" }), "acme", "the AI's resolved key selects the profile (no domain needed)");
  assert.equal(r({ profileKey: "acme", forwarderDomain: "nomatch.example" }), "acme", "explicit key beats the domain hint");
  assert.equal(r({ profileKey: "acme", customer: "Someone Else" }), "acme", "applicant is irrelevant to selection");
  assert.equal(r({ profileKey: "  " }), "generic", "blank key ⇒ fall through");
  assert.equal(r({ profileKey: "", forwarderDomain: "acme.example" }), "acme", "no key ⇒ the domain hint still resolves");
  // 2026-07-19: a named-but-unknown key now THROWS. Falling back to generic silently strips the
  // client's platforms, self-exclusion seed and risk framework — a wrong deliverable, not a degraded
  // one. It is also the exact shape of an intake/driver roster mismatch, which must never be quiet.
  assert.throws(() => r({ profileKey: "ghost" }), /profile_key_unknown:ghost/);
  assert.throws(() => r({ profileKey: "ghost" }), /roster is \[/, "the error names the roster it DID find");
});

// ---- load-time hard-fails --------------------------------------------------------------------------

test("load: missing generic.json, overlapping matchDomains, and stored floors all hard-fail loudly", () => {
  assert.throws(() => loadProfiles({ dir: profileDir({ acme: ACME }), force: true }), /generic\.json is REQUIRED/);
  assert.throws(() => loadProfiles({
    dir: profileDir({ generic: GENERIC, a: { ...ACME, matchDomains: ["x.example"] }, b: { ...ACME, name: "B", matchDomains: ["x.example"] } }),
    force: true,
  }), /matchDomains overlap/);
  assert.throws(() => loadProfiles({
    dir: profileDir({ generic: { ...GENERIC, minCellsPerVariant: 7 } }), force: true,
  }), /DERIVED from platforms/);
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, platforms: "amazon.com" } }), force: true }), /platforms/);
  // …while an EMPTY list is a company that picked no marketplaces, and loads (the owner's ruling of 2026-09-23).
  assert.deepEqual(loadProfiles({ dir: profileDir({ generic: { ...GENERIC, platforms: [] } }), force: true }).get("generic").platforms, []);
});

// ---- derived arithmetic ----------------------------------------------------------------------------

test("a grid batches by the cells it runs, never above the profile's own figure", async () => {
  const { gridBatchFor, SAFE_GRID_CELLS, DENSE_GRID_CELLS } = await import("../profiles.mjs");
  // A company that picked no marketplaces: its own figure is the whole budget in terms (98 over the web cell).
  const none = { platforms: [], batchSize: 98 };
  assert.equal(gridBatchFor(none, 1), 98, "web only: the profile's own figure");
  assert.equal(gridBatchFor(none, 2), 49, "web plus one store the matter chose: half, so the call stays inside the budget");
  assert.ok(gridBatchFor(none, 2) * 2 <= SAFE_GRID_CELLS);
  // A company with stores: its own figure already fits its own cells, so nothing changes for it…
  const three = { platforms: ["a.com", "b.com", "c.com"], batchSize: 24 };
  assert.equal(gridBatchFor(three, 4), 24, "its stores plus web: unchanged");
  assert.equal(gridBatchFor(three, 1), 24, "never ABOVE the profile's figure, even for a web-only closure");
  // …and a dense profile sizes against its smaller budget.
  const dense = { platforms: [], batchSize: 16, marketplaceDensity: "dense" };
  assert.equal(gridBatchFor(dense, 2), DENSE_GRID_CELLS / 2);
  assert.equal(gridBatchFor({ batchSize: 3 }, 10), 3, "a figure already inside the budget stands");
  assert.equal(gridBatchFor(null, 200), 1, "never below one term");
});

test("derived floor/batch scale with the platform list (the Ember Guard truncation guard)", () => {
  assert.equal(derivedFloor(ACME), 6, "5 store + 1 web");
  assert.equal(derivedBatchSize(ACME), 16);
  const ten = { platforms: Array.from({ length: 10 }, (_, i) => `p${i}.example`) };
  assert.equal(derivedFloor(ten), 11);
  assert.equal(derivedBatchSize(ten), 8, "a 10-platform profile must NOT keep 14-variant batches (154 cells would truncate)");
});

// ---- applicant gate (clearance-corruption guard) ---------------------------------------------------

test("applicantMatchesProfile: word-boundary identity, never fuzzy — third-party applicants never inherit exclusions", () => {
  const au = { name: "Demo Brand Owner" };
  assert.equal(applicantMatchesProfile(au, "Demo Brand Owner"), true);
  assert.equal(applicantMatchesProfile(au, "Demo Brand Owner Corporation"), true);
  assert.equal(applicantMatchesProfile(au, "demo brand owner corp."), true);
  assert.equal(applicantMatchesProfile(au, "ACME Interactive"), false);
  assert.equal(applicantMatchesProfile(au, "Demo Brand Owners Ltd"), false, "substring without word boundary must not match");
  assert.equal(applicantMatchesProfile(au, ""), false);
  assert.equal(applicantMatchesProfile(au, undefined), false);
});

// ---- platform-identity join (count proves how many; this proves WHICH) -----------------------------

const MANIFEST = "# Variant manifest\n## Variants\n| variant | axis |\n|---|---|\n| novapulse | primary-sweep |\n";
const ledgerFor = (platforms, term = "novapulse") =>
  JSON.stringify({ cells: platforms.map((p) => ({ term, platform: p, status: "no_hit", results: [] })), extras: {}, gaps: [] });

test("identity join: right count + wrong marketplaces FAILS; dictated set passes; no-entry variants are the count check's business", () => {
  const dictated = ACME.platforms;
  // 7 distinct platforms (count floor satisfied) but they are the GAMING stores — wrong marketplaces.
  const wrong = findPlatformIdentityViolations(MANIFEST, ledgerFor([...GAMING_DOMAINS, "web"]), dictated);
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].variant, "novapulse");
  assert.equal(wrong[0].missing.length, 5, "every dictated domain is missing");
  // the dictated set (plus web) passes
  assert.deepEqual(findPlatformIdentityViolations(MANIFEST, ledgerFor([...dictated, "web"]), dictated), []);
  // a variant with NO ledger entry of its own is skipped here (the count check owns it)
  assert.deepEqual(findPlatformIdentityViolations(MANIFEST, ledgerFor([...dictated, "web"], "otherterm"), dictated), []);
  // no dictated list ⇒ no-op (legacy)
  assert.deepEqual(findPlatformIdentityViolations(MANIFEST, ledgerFor(GAMING_DOMAINS), []), []);
});

// ── A CHANNEL NO HALF RAN IS NOBODY'S ────────────────────────────────────────────────────────────
//
// The grid is split by term into two halves, both carrying the same platforms. On a delivered run half A
// wrote that the repositories were "not in grid mandate, assigned to the parallel half"; half B wrote
// that they were covered indirectly, through general web search. Neither ran them, each said the other
// owned them, and the delivered coverage carried it as a NOTE — so a channel the matter's own ecosystem
// publishes on was never queried and nothing in the report said it was open.
//
// The per-variant join could not see it: a channel nobody reached is partial coverage for EVERY variant,
// and partial coverage is skipped here deliberately so the count ladder's carve-outs do not re-fail. The
// fold is where both halves are in one file, and it is the only place the question has an answer.
test("at the fold, a dictated channel with no receipt from either half is reported once", () => {
  const dictated = ACME.platforms;
  const ran = [...dictated.slice(0, dictated.length - 1), "web"];
  const deferred = ACME.platforms[ACME.platforms.length - 1];

  const out = findPlatformIdentityViolations(MANIFEST, ledgerFor(ran), dictated, { wholeGrid: true });
  const whole = out.filter((v) => v.whole);
  assert.equal(whole.length, 1, "the channel nobody ran was not reported as a channel");
  assert.deepEqual(whole[0].missing, [deferred]);
  assert.equal(whole[0].variant, "*", "it is a fact about the channel, not about one variant");

  // ONCE, whatever the grid's shape: the fact is that nothing in this ledger touched it, so it does not
  // repeat per term. The per-variant rows beside it are the existing join's and are left alone — this
  // adds a reading the join could not reach rather than replacing what it already says.

  // AND A FULL GRID IS SILENT, which is what says this is not simply refusing every ledger.
  assert.deepEqual(findPlatformIdentityViolations(MANIFEST, ledgerFor([...dictated, "web"]), dictated, { wholeGrid: true }), []);
});

test("the unrun channel becomes an OPEN ledger row, and the run still delivers", async () => {
  // THE POINT OF DISCLOSURE, and the correction to my first cut of this: failing the fold would turn a
  // gap the client can see into a clearance that delivers nothing. The ledger already has the state for
  // a slice that could not run — `deferred`, which the deadline envelope re-runs, the verdict floor
  // clamps over, and the report shows where open rows are shown — so the channel lands there as a row
  // in the shape every consumer already reads, and nothing new is drawn anywhere.
  const { openChannelRows } = await import("../common-law-receipts.mjs");
  const dictated = ACME.platforms;
  const deferred = dictated[dictated.length - 1];
  // Keyed as the reader joins them on this machine: "/run/_driver/grid-spec.json" on Linux, with
  // backslashes on Windows.
  const SPEC = driverDir("/run", "grid-spec.json");
  const GRID = join("/run", "common-law-grid.json");
  const files = {
    [SPEC]:JSON.stringify({ terms: ["novapulse"], platforms: [...dictated, "web"] }),
    [GRID]: ledgerFor([...dictated.slice(0, dictated.length - 1), "web"]),
  };
  const io = { exists: (p) => Object.hasOwn(files, p), read: (p) => files[p] };

  const rows = openChannelRows("/run", io);
  assert.equal(rows.length, 1, "the channel nobody ran produced no row");
  assert.equal(rows[0].status, "deferred", "it must use the ledger's own open state, not a new one");
  assert.equal(rows[0].axis, "common-law");
  assert.ok(rows[0].unit.includes(deferred), "the row does not name the channel a reader has to chase");
  assert.match(rows[0].reason, /open — not run/);
  assert.match(rows[0].reason, /not a receipt/, "the reason does not say why a pass's say-so did not count");

  // A FULL GRID PRODUCES NOTHING, which is what keeps this from putting an open row on every run.
  const full = { ...files, [GRID]: ledgerFor([...dictated, "web"]) };
  assert.deepEqual(openChannelRows("/run", { exists: (p) => Object.hasOwn(full, p), read: (p) => full[p] }), []);

  // AND AN UNREADABLE RUN PRODUCES NOTHING RATHER THAN A GAP NOBODY CAN CLOSE: no spec, no merged
  // ledger, or an unparseable one is not evidence that a channel went unrun.
  assert.deepEqual(openChannelRows("/run", { exists: () => false, read: () => "" }), []);
  assert.deepEqual(openChannelRows("/run", { exists: () => true, read: () => "{ not json" }), []);
});

test("the open rows are WIRED at the ledger chokepoint — a row nothing reads is not a disclosure", () => {
  // A pure function nothing calls would leave the gap exactly where it was, and the earlier draft of
  // this change failed the fold instead, which nobody wanted. The chokepoint is the one place every
  // consumer reads the ledger through — the escalation gate, the deadline envelope and the verdict
  // clamp all act on what it returns — so the rows join there, beside the two relabels already applied.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /const relabel = \(rows\) => \[\.\.\.applyTaintDeferred\(coerceToolAbsenceDeferred\(rows\), taintAxes\), \.\.\.openChannelRows\(runDir\)\]/,
    "the coverage chokepoint no longer adds the open-channel rows");
  assert.doesNotMatch(src, /findPlatformIdentityViolations\([^)]*wholeGrid: true/,
    "the fold is failing on an unrun channel again — it is a disclosed gap, not a dead clearance");
});

test("a HALF's own ledger gets no channel verdict — the split is allowed, the silence at the fold is not", () => {
  // Asked for by the caller, and only where both halves are in one file. On a half's own ledger a channel
  // its sibling ran is legitimately absent, so no CHANNEL verdict is drawn there. Whatever the per-variant
  // join says about that same ledger is unchanged and not this arm's business — the default is off, so
  // every existing caller keeps exactly the answers it had.
  const dictated = ACME.platforms;
  const halfOnly = ledgerFor([...dictated.slice(0, dictated.length - 1), "web"]);
  const out = findPlatformIdentityViolations(MANIFEST, halfOnly, dictated);
  assert.deepEqual(out.filter((v) => v.whole), [], "a half was given a channel verdict its sibling owns half of");
});

test("identity join honors the count ladder's carve-outs: partial entries skip; ' / ' families union across keys", () => {
  const dictated = ACME.platforms;
  // a variant the ladder satisfied elsewhere, holding 2 supplementary cells of its own → NOT judged
  assert.deepEqual(findPlatformIdentityViolations(MANIFEST, ledgerFor(dictated.slice(0, 2)), dictated), [],
    "partial own coverage is the count check's business, never an identity fail");
  // a " / "-packed manifest cell whose coverage is SPLIT across the packed key and a bare alternate
  // (the copper-conduit re-keying + a supplementary closure batch) → unioned, no violation
  const packedManifest = "# Variant manifest\n## Variants\n| variant | axis |\n|---|---|\n| alpha / beta | primary-sweep |\n";
  const split = JSON.stringify({
    cells: [
      ...dictated.slice(0, 3).map((p) => ({ term: "alpha / beta", platform: p, status: "no_hit", results: [] })),
      ...dictated.slice(3).map((p) => ({ term: "alpha", platform: p, status: "no_hit", results: [] })),
      { term: "alpha", platform: "web", status: "no_hit", results: [] },
    ], extras: {}, gaps: [],
  });
  assert.deepEqual(findPlatformIdentityViolations(packedManifest, split, dictated), [],
    "the family is ONE manifest cell — union before judging");
});

// ---- message rendering (the dictation block + the byte-identical anchor) ---------------------------

test("common-law message: profile dictates the PLATFORMS block + derived batching; no profile = legacy shape", () => {
  const P = { variantManifest: "/r/variant-manifest.md", matterContext: "/r/matter-context.md", commonLaw: "/r/common-law-findings.md", commonLawGrid: "/r/common-law-grid.json" };
  const gridVariants = Array.from({ length: 20 }, (_, i) => `v${i}`);
  const legacy = STAGES["common-law"].message({ paths: P, gridVariants });
  assert.doesNotMatch(legacy, /PLATFORMS \(/, "no profile → no dictation block (legacy ctx)");
  assert.match(legacy, /≤14 variants/, "legacy batch ceiling");
  const acme = STAGES["common-law"].message({ paths: P, gridVariants, profile: { platforms: ACME.platforms, batchSize: 16 } });
  assert.match(acme, /PLATFORMS \(the grid sweeps EXACTLY these store domains/);
  assert.match(acme, /alibaba\.com, thomasnet\.com/);
  assert.match(acme, /≤16 variants/, "batch ceiling derived from the profile");
});

test("matter-frame message: byte-identical for an empty profile (the anchor); defaults + gated exclusion seed render when present", () => {
  const P = { matterContext: "/r/matter-context.md", inboundRequest: "/r/inbound-request.txt" };
  const job = { markName: "X", classes: [9] };
  const bare = STAGES["matter-frame"].message({ paths: P, job });
  const generic = STAGES["matter-frame"].message({ paths: P, job, profile: { defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [] }, exclusionSeed: [] });
  assert.equal(generic, bare, "empty profile renders the EXACT pre-profile message — the regression anchor");
  const acme = STAGES["matter-frame"].message({
    paths: P, job: { markName: "X", classes: [], customer: "Acme Industrial" },
    profile: { defaultClasses: [7, 9], defaultJurisdictions: ["EU", "US", "CN"] },
    exclusionSeed: ["Acme Industrial", "Acme Holdings"],
  });
  assert.match(acme, /Customer-default classes \(the request names none — apply these\): 7, 9/);
  assert.match(acme, /Customer-default jurisdictions that materially matter \(the request names none — apply these\): EU, US, CN/);
  assert.match(acme, /Affiliate\/self-exclusion seed .*: Acme Industrial, Acme Holdings/);
  // defaults must NOT override requested classes — top-level OR per-mark (the intake's classes-anywhere predicate)
  const withClasses = STAGES["matter-frame"].message({ paths: P, job: { markName: "X", classes: [41] }, profile: { defaultClasses: [7, 9] } });
  assert.doesNotMatch(withClasses, /Customer-default classes/);
  const perMark = STAGES["matter-frame"].message({
    paths: P, job: { marks: [{ name: "X", classes: [9, 41] }], classes: [] }, profile: { defaultClasses: [7, 9] },
  });
  assert.doesNotMatch(perMark, /Customer-default classes/, "marks[].classes counts as named classes");
});

// ---- lint vocabulary union -------------------------------------------------------------------------

test("lint: profile platform DOMAINS suppress orphan flags END TO END — runLint derives the printable name tokens", () => {
  // unit sanity on the primitive
  assert.equal(properNameCandidates("Confirm the THOMASNET listing status").length, 1, "THOMASNET is an entity candidate by default");
  assert.equal(properNameCandidates("Confirm the THOMASNET listing status", new Set(["thomasnet"])).length, 0);
  // end to end through runLint with the REAL contracted shape (store domains, not bare names)
  const reportMd = "---\ntype: clearance-clearance\n---\n# Actions\n### Only you can close these\n- Confirm the THOMASNET listing belongs to the client.\n\n# Marks\n## NOVAPULSE — Owner, EU\n- one: x\n";
  const base = { reportMd, clientSummaryMd: "", recordsByUri: new Map(), searchedNames: ["novapulse"], headerName: "novapulse", ratedNames: ["novapulse"] };
  const without = runLint(base);
  assert.ok(without.failures.some((f) => f.id === "reference-integrity"), "orphan fires without the profile vocabulary");
  const withPlat = runLint({ ...base, extraPlatformNames: ["thomasnet.com"] });
  assert.ok(!withPlat.failures.some((f) => f.id === "reference-integrity"),
    "the DOMAIN-shaped platform ('thomasnet.com') suppresses the THOMASNET orphan — the production path");
  // SAFETY property: a multi-word domain's individual words never become vocabulary — an adverse
  // owner named "CHINA TRADING" must still orphan-flag even when made-in-china.com is a platform.
  const mic = runLint({ ...base, reportMd: reportMd.replace("the THOMASNET listing belongs", "whether CHINA TRADING's claim holds"), extraPlatformNames: ["made-in-china.com"] });
  assert.ok(mic.failures.some((f) => f.id === "reference-integrity"),
    "platform word-fragments must never suppress a real entity orphan");
});

// ---- clearance-productization v1: zephyr onboarding, F7 (deny-unknown + FIELD_CONSUMERS), F8, delivery ----

test("shipped zephyr profile: drinks/sporting grid resolves, neutral delivery, prose appetite, safe batch", () => {
  const profiles = loadProfiles({ force: true });
  const c = profiles.get("zephyr");
  assert.ok(c, "zephyr.json ships");
  // zephyr carries NO matchDomains — it is reached by the intake AI's resolved profileKey, never a domain
  assert.deepEqual(c.matchDomains, []);
  assert.equal(resolveProfile({ profileKey: "zephyr", forwarderDomain: "example.com" }, { profiles }).key, "zephyr",
    "the AI's resolved key routes to zephyr regardless of sender domain");
  assert.ok(c.platforms.length >= 1 && c.platforms.every((p) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(p)), "bare store domains");
  assert.ok(!c.platforms.includes("web"), "the general-web cell is implicit");
  assert.ok(derivedFloor(c) * derivedBatchSize(c) <= SAFE_GRID_CELLS, "batch keeps cells under the truncation ceiling");
  assert.deepEqual(c.delivery, { email: "summary", privileged: false }, "zephyr is neutral-default delivery (no customer table, no P&C)");
  assert.ok(typeof c.riskAppetite === "string" && c.riskAppetite.length > 20, "zephyr carries a prose risk posture");
  assertAppetitePosture(c.riskAppetite);   // and it is genuine prose-posture, not a threshold
});

test("density-aware grid budget: dense ⇒ a much smaller batch; sparse (the default) is byte-unchanged; zephyr is dense", () => {
  // a 7-platform DENSE profile (floor 8) ⇒ DENSE_GRID_CELLS 16 / 8 = 2 cells-worth-of-variants per call
  const DENSE7 = { ...ACME, name: "Dense Seven", platforms: ["amazon.com", "walmart.com", "target.com", "gnc.com", "iherb.com", "vitaminshoppe.com", "bodybuilding.com"], marketplaceDensity: "dense" };
  assert.equal(derivedFloor(DENSE7), 8, "7 store + 1 web");
  assert.equal(DENSE_GRID_CELLS, 16, "the dense cell budget");
  assert.equal(derivedBatchSize(DENSE7), 2, "dense ⇒ DENSE_GRID_CELLS 16 / floor 8 = 2");
  // the SAME shape WITHOUT marketplaceDensity is the sparse default — its batch is the unchanged SAFE_GRID_CELLS/floor (98/8 = 12)
  const { marketplaceDensity, ...SPARSE7 } = DENSE7;
  assert.equal(derivedBatchSize(SPARSE7), 12, "no marketplaceDensity ⇒ the sparse budget, byte-unchanged (98/8)");
  // and the canonical sparse anchor (the 6-platform gaming default) still derives 14 — density never touches it
  assert.equal(derivedBatchSize(GENERIC), 14, "the sparse gaming-default batch (98/7) is the unchanged regression anchor");

  // the REAL shipped zephyr profile is dense, and its frozen derived batch is 2 (the truncation fix)
  const zephyr = loadProfiles({ force: true }).get("zephyr");
  assert.equal(zephyr.marketplaceDensity, "dense", "the shipped zephyr profile is marked dense");
  assert.equal(derivedFloor(zephyr), 8, "zephyr: 7 store + 1 web");
  assert.equal(derivedBatchSize(zephyr), 2, "zephyr's frozen dense batch — each grid call's stdout fits the worker output");

  // an out-of-enum density value hard-fails at load (the explicit-knob guard)
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, marketplaceDensity: "heavy" } }), force: true }), /marketplaceDensity/);
});

test("F7 deny-unknown-key: an unrecognised profile key hard-fails at load (no dead knobs)", () => {
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, foobar: 1 } }), force: true }), /unknown key "foobar"/);
  // the DERIVED foot-gun keeps its louder, specific error (deny-unknown must not swallow it)
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, batchSize: 9 } }), force: true }), /DERIVED from platforms/);
});

test("delivery descriptor validation: only { email: table|summary, privileged: bool } is accepted", () => {
  const D = (delivery) => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, delivery } }), force: true });
  assert.doesNotThrow(() => D({ email: "table", privileged: true }));
  assert.doesNotThrow(() => D({ email: "summary", privileged: false }));
  assert.throws(() => D({ email: "fancy" }), /delivery\.email must be/);
  assert.throws(() => D({ privileged: "yes" }), /delivery\.privileged must be a boolean/);
  assert.throws(() => D({ bogus: 1 }), /not a known delivery key/);
});

test("F8 anti-threshold: numeric/threshold appetite is rejected; prose-posture passes", () => {
  for (const bad of ["enforce above 50% similarity", "act on anything at Level C or above", "block Composite 3+ always", "if confusion >= 60%", "use a threshold of concern"])
    assert.throws(() => assertAppetitePosture(bad), /PROSE-POSTURE/, `must reject: ${bad}`);
  for (const ok of ["risk-averse on lookalikes; pragmatic on distant adjacencies", "wants clear go / no-go calls and a path around real blockers"])
    assert.doesNotThrow(() => assertAppetitePosture(ok), `must pass: ${ok}`);
  // a rule-shaped appetite in a profile FILE hard-fails at load
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, riskAppetite: "block anything above Level C" } }), force: true }), /PROSE-POSTURE/);
});

test("F7 FIELD_CONSUMERS: every profile field has a live consumer (no dead knobs); manifest ⇄ KNOWN_PROFILE_KEYS in sync", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const [field, { file, symbol }] of Object.entries(FIELD_CONSUMERS)) {
    const src = readFileSync(join(here, "..", file), "utf8");
    assert.ok(src.includes(symbol), `${field}: FIELD_CONSUMERS claims ${file} consumes it via "${symbol}", but that symbol is absent — dead knob or stale manifest`);
    assert.ok(KNOWN_PROFILE_KEYS.includes(field), `${field} in FIELD_CONSUMERS must be a KNOWN_PROFILE_KEY`);
  }
  for (const k of KNOWN_PROFILE_KEYS) assert.ok(FIELD_CONSUMERS[k], `${k} is a known key but has no FIELD_CONSUMERS entry (would be a dead knob)`);
});

test("industry is a LIVE consumer: matter-frame sector context; absent ⇒ byte-identical anchor (F7 resolution)", () => {
  const P = { matterContext: "/r/matter-context.md", inboundRequest: "/r/inbound-request.txt" };
  const job = { markName: "X", classes: [9] };
  const withInd = STAGES["matter-frame"].message({ paths: P, job, profile: { industry: "functional beverages", defaultClasses: [], defaultJurisdictions: [] } });
  assert.match(withInd, /Customer industry \(context for sector framing/);
  assert.match(withInd, /functional beverages/);
  const bare = STAGES["matter-frame"].message({ paths: P, job });
  const empty = STAGES["matter-frame"].message({ paths: P, job, profile: { defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [] }, exclusionSeed: [] });
  assert.equal(empty, bare, "no industry ⇒ byte-identical pre-profile anchor preserved");
});

test("F8 appetite is a LIVE consumer in delivery curation (report-overview), NEVER in synthesis (the rating)", () => {
  const P = { narrative: "/r/n.md", registerFindings: "/r/rf.md", commonLaw: "/r/cl.md", placement: "/r/p.md", seniorEyeReview: "/r/le.md", matterContext: "/r/mc.md", report: "/r/report.md", findings: "/r/findings.json", variantManifest: "/r/vm.md" };
  const appetite = "pragmatic; wants clear go / no-go calls";
  const rs = STAGES["report-overview"].message({ paths: P, job: {}, profile: { riskAppetite: appetite } });
  assert.match(rs, /CUSTOMER RISK POSTURE/);
  assert.match(rs, /emphasis only/);
  assert.match(rs, /pragmatic; wants clear go/);
  // D1: synthesis (where Level/Composite are set) must NEVER receive appetite — preferences never move the rating.
  const syn = STAGES["synthesis"].message({ paths: P, job: {}, profile: { riskAppetite: appetite } });
  assert.doesNotMatch(syn, /CUSTOMER RISK POSTURE/);
  assert.doesNotMatch(syn, /pragmatic; wants clear go/);
});

// The LIVE framework read is profile-driven via frameworkFor/workedExamplesFor INSIDE message() — the static
// `skillReads:` PROPERTY on each stage is declarative-only (no runtime consumer) and names the firm-neutral
// DEFAULT. This test locks the live behaviour so nobody "reconciles" that apparent mismatch by pointing
// message() at the static default and silently breaking per-customer framework selection.
test("framework selection is profile-driven in the live message (synthesis + report-overview); absent ⇒ firm-neutral default", () => {
  const P = { narrative: "/r/n.md", registerFindings: "/r/rf.md", commonLaw: "/r/cl.md", placement: "/r/p.md", seniorEyeReview: "/r/le.md", matterContext: "/r/mc.md", report: "/r/report.md", reportOverview: "/r/ro.md", findings: "/r/findings.json", variantManifest: "/r/vm.md" };
  const customerProfile = { frameworkPath: "skills/clearance-search/risk-framework-demo.md", workedExamplesPath: "skills/clearance-search/worked-examples-demo.md" };
  for (const stage of ["synthesis", "report-overview"]) {
    const withCustomer = STAGES[stage].message({ paths: P, job: {}, profile: customerProfile });
    assert.match(withCustomer, /risk-framework-demo\.md/, `${stage}: a profile framework must be read in the live message`);
    const bare = STAGES[stage].message({ paths: P, job: {}, profile: {} });
    assert.match(bare, /skills\/clearance-search\/risk-framework\.md/, `${stage}: no profile framework ⇒ the firm-neutral default`);
    assert.doesNotMatch(bare, /risk-framework-demo\.md/, `${stage}: a profile-less run must NOT read a per-customer framework`);
  }
  // worked-examples is the synthesis depth target and is likewise profile-driven (default ⇒ worked-examples.md).
  const synCustomer = STAGES["synthesis"].message({ paths: P, job: {}, profile: customerProfile });
  assert.match(synCustomer, /worked-examples-demo\.md/);
  const synBare = STAGES["synthesis"].message({ paths: P, job: {}, profile: {} });
  assert.match(synBare, /skills\/clearance-search\/worked-examples\.md/);
  assert.doesNotMatch(synBare, /worked-examples-demo\.md/);
});

// The delivery safety-net: an UNBOUND run (no account resolved) falls to the generic profile, whose
// delivery is the NEUTRAL overlay — so it can never be presented as a customer-FRAMED deliverable (no
// Demo Brand Owner table, no Privileged header). A run BOUND to a customer keeps that customer's
// overlay. The stronger W-3 client-export gate is a separate refusal, in driver/publish/index.mjs.
test("delivery safety-net: an unbound run resolves to generic and is never customer-framed; a bound run keeps its overlay", () => {
  const dir = profileDir({
    generic: { name: "House default", platforms: ["amazon.com"] },            // no delivery ⇒ NEUTRAL applies
    acme: { name: "Acme", matchDomains: ["acme.example"], platforms: ["amazon.com"], delivery: { email: "table", privileged: true } },
  });
  const profiles = loadProfiles({ dir, force: true });
  const unbound = resolveProfile({}, { profiles });                            // no key, no domain → generic
  assert.equal(unbound.key, "generic");
  const deliv = unbound.delivery ?? NEUTRAL_DELIVERY;                          // attachProfile freezes this default
  assert.notEqual(deliv.email, "table", "an unbound run must not get the customer review table");
  assert.notEqual(deliv.privileged, true, "an unbound run must not get the Privileged & Confidential header");
  // a BOUND run (forwarder domain matches) keeps its customer-framed overlay — the safety-net only neutralises unbound
  assert.equal(resolveProfile({ forwarderDomain: "acme.example" }, { profiles }).delivery.email, "table");
});

test("shipped petcary profile: worldwide animal-health grid (drug registers + pet-pharma marketplaces), dense, neutral, context pack", () => {
  const profiles = loadProfiles({ force: true });
  const p = profiles.get("petcary");
  assert.ok(p, "petcary.json ships");
  assert.deepEqual(p.matchDomains, [], "reached by the intake AI's resolved key, never a forwarder domain");
  assert.equal(resolveProfile({ profileKey: "petcary", forwarderDomain: "example.com" }, { profiles }).key, "petcary");
  assert.deepEqual(p.defaultClasses, [5, 10, 42, 44], "animal pharma/supplements (5), devices (10), AI health (42), vet services (44)");
  assert.deepEqual(p.defaultJurisdictions, ["US", "EU", "UK", "AU"], "worldwide seed mirroring FDA/EMA/VMD/APVMA register coverage");
  // a NAMED profile sweeps platforms[] verbatim — so petcary lists the animal-drug REGISTERS itself (the auto
  // health-channel routing only fires for the generic fallback), alongside the pet-pharmacy storefronts.
  for (const d of ["animaldrugsatfda.fda.gov", "ema.europa.eu", "vmd.defra.gov.uk", "chewy.com", "amazon.com", "zooplus.com"])
    assert.ok(p.platforms.includes(d), `petcary sweeps ${d}`);
  assert.ok(!p.platforms.some((d) => d === "fda.gov"), "bare fda.gov dropped (low-signal vs the searchable register subhost)");
  assert.ok(!p.platforms.includes("web"), "the general-web cell (covers cl.42/44 services) is implicit");
  assert.equal(p.marketplaceDensity, "dense", "heavy pet-pharma marketplaces ⇒ dense, or the verbatim stdout truncates");
  assert.equal(derivedFloor(p), 7, "6 platforms + 1 web");
  assert.equal(derivedBatchSize(p), 2, "dense batch keeps each grid call's stdout under the truncation ceiling");
  assert.deepEqual(p.delivery, { email: "summary", privileged: false }, "neutral-default delivery for the baseline");
  assert.equal(p.frameworkPath ?? null, null, "baseline uses the firm-neutral default framework (none invented)");
  assert.ok(typeof p.contextPack === "string" && p.contextPack.length > 200, "the baseline context pack loaded + passed assertContextPackShape");
});

// ============ spec 62 — per-project configuration (customer → project → matter) ============

// A profiles dir with a projects/<customer>/<slug>.json subtree (+ optional sibling .context.md).
function withProjects(customers, projects = {}, contexts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "profiles62-"));
  for (const [name, obj] of Object.entries(customers)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(obj));
  for (const [fq, obj] of Object.entries(projects)) {
    const [ck, slug] = fq.split("/");
    mkdirSync(join(dir, "projects", ck), { recursive: true });
    writeFileSync(join(dir, "projects", ck, `${slug}.json`), JSON.stringify(obj));
  }
  for (const [fq, md] of Object.entries(contexts)) {
    const [ck, slug] = fq.split("/");
    mkdirSync(join(dir, "projects", ck), { recursive: true });
    writeFileSync(join(dir, "projects", ck, `${slug}.context.md`), md);
  }
  return dir;
}
const DEMO_PLATFORMS = ["g2.com", "capterra.com", "aquatechtrade.com", "wateronline.com", "udemy.com", "apps.apple.com", "play.google.com"];
const CUSTOMER = { name: "Demo Brand Owner Ltd", matchDomains: ["demo-brand-owner.example"], platforms: DEMO_PLATFORMS,
  marketplaceDensity: "sparse", defaultClasses: [9, 41, 42], defaultJurisdictions: ["EU", "US", "JP"],
  selfExclusionOwners: ["Demo Brand Owner"], delivery: { email: "summary", privileged: true }, industry: "tech",
  riskAppetite: "conservative posture", frameworkPath: "skills/clearance-search/risk-framework-demo.md" };

test("spec 62 + search spine: the key split partitions KNOWN_PROFILE_KEYS exactly (8 project + 10 customer-only = 18)", () => {
  // `demoData` joined CUSTOMER_ONLY, and the level was the decision rather than a
  // formality: a project overlay marking a real customer's run as demo would refuse legitimate work, and
  // an overlay UN-marking a demo customer would put fiction through the runner's admission wall. The
  // second direction is the dangerous one, and it is why this key cannot be overlayable in either sense.
  //
  // The literal lists below are the point of this arm — a new field must be TYPED HERE to pass, so it
  // cannot join the schema without somebody choosing its level on purpose.
  assert.deepEqual([...PROJECT_KEYS].sort(),
    ["defaultClasses", "defaultJurisdictions", "defaultProduct", "delivery", "industry", "marketplaceDensity", "platforms", "riskAppetite"]);
  assert.deepEqual([...CUSTOMER_ONLY_KEYS].sort(),
    ["allowedRecipes", "demoData", "frameworkPath", "jxPolicy", "matchDomains", "name", "runCaps", "selfExclusionOwners", "testFixture", "workedExamplesPath"]);
  const union = new Set([...PROJECT_KEYS, ...CUSTOMER_ONLY_KEYS]);
  assert.equal(union.size, PROJECT_KEYS.length + CUSTOMER_ONLY_KEYS.length, "the two lists are disjoint");
  assert.deepEqual([...union].sort(), [...KNOWN_PROFILE_KEYS].sort(), "union === KNOWN_PROFILE_KEYS (every field picks a level)");
});

test("spec 62 sparse validation: an overlay REJECTS each customer-only key (identity + rating authority stay whole-customer)", () => {
  for (const k of CUSTOMER_ONLY_KEYS) {
    const val = k === "name" ? "X"
      : (k === "matchDomains" || k === "selfExclusionOwners") ? ["x"]
      : k === "allowedRecipes" ? ["clearotron"]
      : k === "jxPolicy" ? { providerStance: "default" }
      : k === "runCaps" ? { maxQueued: 3 }
      : "skills/clearance-search/x.md";
    const v = validateProfileEdit("projects/demo-brand-owner/p", { [k]: val }, "", { sparse: true });
    assert.equal(v.ok, false, `${k} must be rejected on an overlay`);
    assert.match(v.errors.join(" "), /customer-only/, `${k} error cites customer-only`);
  }
});

test("spec 62 sparse: PROJECT_KEYS optional but fully guarded when present; projectName allowed; F8/D1 guards fire", () => {
  assert.ok(validateProfileEdit("projects/m/p", { defaultClasses: [9] }, "", { sparse: true }).ok, "deltas-only: platforms may be omitted");
  assert.ok(validateProfileEdit("projects/m/p", { projectName: "Japan and Korea app launch", industry: "gaming" }, "", { sparse: true }).ok, "projectName is the one extra allowed key");
  assert.equal(validateProfileEdit("projects/m/p", { platforms: ["web"] }, "", { sparse: true }).ok, false, "present platforms keep every foot-gun guard");
  assert.equal(validateProfileEdit("projects/m/p", { riskAppetite: "block anything above Level C" }, "", { sparse: true }).ok, false, "F8 threshold-shape rejected on an overlay");
  assert.equal(validateProfileEdit("projects/m/p", { industry: "gaming" }, "always rate lookalikes as High", { sparse: true }).ok, false, "D1 rule-shape rejected in an overlay context pack");
  assert.equal(validateProfileEdit("m", { industry: "gaming" }, "").ok, false, "a WHOLE-profile validation still requires name + platforms");
});

test("spec 62 loadProjects: attaches projectName + context; projectName defaults to the slug; unknown customer hard-fails", () => {
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/launch": { projectName: "Japan and Korea app launch", platforms: ["rakuten.co.jp", "kakaku.com", "line.me"], defaultClasses: [9, 42] },
      "demo-brand-owner/cloud": { industry: "cloud services" } },
    { "demo-brand-owner/launch": "# ctx\nApp-store launch landscape." },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const ov = projects.get("demo-brand-owner/launch");
  assert.equal(ov.projectName, "Japan and Korea app launch");
  assert.equal(ov.customerKey, "demo-brand-owner");
  assert.equal(ov.projectKey, "launch");
  assert.ok(ov.contextPack.includes("App-store launch"), "sibling .context.md attached");
  assert.equal(projects.get("demo-brand-owner/cloud").projectName, "cloud", "projectName defaults to the slug");

  const bad = withProjects({ generic: GENERIC }, { "ghost/p": { platforms: ["amazon.com"] } });
  assert.throws(() => loadProjects({ dir: bad, profiles: loadProfiles({ dir: bad, force: true }), force: true }),
    /no customer profile "ghost"/, "a project under a customer with no profile is an authoring error");
});

test("spec 62 resolveEffectiveProfile: per-field merge + origins; identity + framework stay whole-customer; derived floor follows resolved platforms", () => {
  const projectPlatforms = ["rakuten.co.jp", "kakaku.com", "naver.com", "coupang.com", "line.me", "amazon.co.jp", "udemy.com", "apps.apple.com", "play.google.com"];
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/launch": { projectName: "Japan and Korea app launch", platforms: projectPlatforms, defaultClasses: [9, 42], industry: "consumer mobile app" } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const { profile, projectKey, projectName, origins } = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "launch" }, { profiles, projects });
  assert.equal(profile.key, "demo-brand-owner", "resolved customer key is unchanged (a project never becomes the customer)");
  assert.equal(profile.name, "Demo Brand Owner Ltd", "identity / self-exclusion anchor stays whole-customer");
  assert.equal(profile.frameworkPath, "skills/clearance-search/risk-framework-demo.md", "customer-only framework untouched by the overlay");
  assert.deepEqual(profile.defaultClasses, [9, 42], "project overrides classes");
  assert.deepEqual(profile.defaultJurisdictions, ["EU", "US", "JP"], "unset-by-project field inherited from the customer");
  assert.equal(projectKey, "launch");
  assert.equal(projectName, "Japan and Korea app launch");
  assert.equal(origins.platforms, "customer+project");
  assert.equal(origins.industry, "project");
  assert.equal(origins.defaultClasses, "project");
  assert.equal(origins.defaultJurisdictions, "customer");
  assert.equal(origins.marketplaceDensity, "customer");
  // platforms UNION: the customer's client-mandated storefronts survive the overlay, the project's retail
  // marketplaces are added. 7 customer ∪ 9 project, 3 shared ⇒ 13 distinct.
  for (const p of CUSTOMER.platforms) assert.ok(profile.platforms.includes(p), `client-mandated ${p} survives the project overlay`);
  for (const p of projectPlatforms) assert.ok(profile.platforms.includes(p), `project-added ${p} is searched`);
  assert.equal(profile.platforms.length, new Set([...CUSTOMER.platforms, ...projectPlatforms]).size, "union, deduped");
  assert.equal(derivedFloor(profile), profile.platforms.length + 1, "floor follows the UNIONED platform set + web");
  assert.equal(derivedBatchSize(profile), Math.max(1, Math.floor(SAFE_GRID_CELLS / (profile.platforms.length + 1))), "batch follows the resolved union floor");

  // house origin: neither customer nor project sets a field ⇒ code applies its own default
  const dir2 = withProjects(
    { generic: GENERIC, acmeco: { ...ACME, name: "AcmeCo", matchDomains: ["acmeco.example"] } },
    { "acmeco/retail": { platforms: ["amazon.com", "walmart.com"] } },
  );
  const pf2 = loadProfiles({ dir: dir2, force: true });
  const pj2 = loadProjects({ dir: dir2, profiles: pf2, force: true });
  const r2 = resolveEffectiveProfile({ profileKey: "acmeco", projectKey: "retail" }, { profiles: pf2, projects: pj2 });
  assert.equal(r2.origins.platforms, "customer+project", "platforms UNION — the customer's are a floor the project adds to");
  assert.deepEqual(r2.profile.platforms, [...ACME.platforms, "amazon.com", "walmart.com"], "customer's industrial marketplaces kept, project's retail added");
  assert.equal(r2.origins.delivery, "house", "neither level sets delivery ⇒ house default");
  assert.equal(r2.origins.riskAppetite, "house");

  // no projectKey ⇒ customer profile unchanged, origins null (freeze then stays byte-identical to pre-62)
  const bare = resolveEffectiveProfile({ profileKey: "demo-brand-owner" }, { profiles, projects });
  assert.equal(bare.projectKey, null);
  assert.equal(bare.origins, null);
  assert.equal(bare.profile.key, "demo-brand-owner");

  // an unknown projectKey ⇒ falls back to the customer profile (intake's validateJob clarifies it first)
  const ghost = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "nope" }, { profiles, projects });
  assert.equal(ghost.projectKey, null, "unknown project ⇒ deleted-mid-flight safe fallback to the customer profile");
});

// ---- archive: a project overlay retires with a flag, never a delete (the saved-search concept, one level up) ----

test("archive: `archived` is overlay META — lifted out of the field set, present only when true", () => {
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/retired": { archived: true, projectName: "Retired", platforms: ["amazon.com"] },
      "demo-brand-owner/live": { projectName: "Live", platforms: ["walmart.com"] },
      "demo-brand-owner/explicit-false": { archived: false, projectName: "Explicitly live", platforms: ["ebay.com"] } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });

  assert.equal(projects.get("demo-brand-owner/retired").archived, true, "the flag survives load as meta");
  // PRESENT ONLY WHEN TRUE. This is the contract the un-archive semantics rest on: the editor seeds its
  // draft from the loaded overlay, so an always-present `archived:false` would ride every partial save
  // back and there would be no way to tell "left alone" from "deliberately un-archived".
  assert.ok(!("archived" in projects.get("demo-brand-owner/live")), "absent ⇒ the key is not on the loaded overlay");
  assert.ok(!("archived" in projects.get("demo-brand-owner/explicit-false")), "archived:false ⇒ the key is not on the loaded overlay either");
  // lifted OUT of the field set, so it cannot be mistaken for a settings value — and the rest of the
  // overlay still merges normally around it.
  assert.deepEqual(projects.get("demo-brand-owner/retired").platforms, ["amazon.com"], "an archived overlay still carries its settings");
});

test("archive: resolveEffectiveProfile STILL resolves an archived overlay — the queued-job safety property", () => {
  // Deliberately NOT gated on `archived`. A job admitted before the project was archived has already been
  // scoped to it; silently re-scoping that run to the customer profile at resolve time would change what
  // it searches with nobody told. Archiving controls what NEW work can NAME (the intake roster and the
  // admission clarify), never what an in-flight run resolves to. Because `archived` is meta and is not a
  // PROJECT_KEY, resolution cannot even see it — this test guards that by assertion rather than by trust.
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/launch": { archived: true, projectName: "Japan and Korea app launch", defaultClasses: [9, 42], platforms: ["amazon.com"] } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const r = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "launch" }, { profiles, projects });

  assert.equal(r.projectKey, "launch", "an archived project still resolves for an already-queued job");
  assert.equal(r.projectName, "Japan and Korea app launch");
  assert.equal(r.origins.defaultClasses, "project", "its overlay values still win");
  assert.deepEqual(r.profile.defaultClasses, [9, 42]);
  assert.ok(r.profile.platforms.some((d) => d === "amazon.com"), "and its platforms still union onto the customer floor");
  assert.ok(!("archived" in r.profile), "the flag never reaches the effective profile — it is meta, not a setting");
});

test("archive: the sparse validator allows a boolean `archived` and rejects a non-boolean", () => {
  const ok = withProjects({ generic: GENERIC, "demo-brand-owner": CUSTOMER }, { "demo-brand-owner/proj": { archived: true, platforms: ["amazon.com"] } });
  assert.doesNotThrow(() => loadProjects({ dir: ok, profiles: loadProfiles({ dir: ok, force: true }), force: true }));
  const bad = withProjects({ generic: GENERIC, "demo-brand-owner": CUSTOMER }, { "demo-brand-owner/proj": { archived: "yes", platforms: ["amazon.com"] } });
  assert.throws(
    () => loadProjects({ dir: bad, profiles: loadProfiles({ dir: bad, force: true }), force: true }),
    /archived must be a boolean/,
    "a truthy string is a typo, not a retire — it fails at load like every other shape error",
  );
});

test("spec 62: a project may not reach profile.name — a name-bearing overlay hard-fails at load", () => {
  const dir = withProjects({ generic: GENERIC, "demo-brand-owner": CUSTOMER }, { "demo-brand-owner/evil": { name: "Japan and Korea app launch", platforms: ["amazon.com"] } });
  assert.throws(() => loadProjects({ dir, profiles: loadProfiles({ dir, force: true }), force: true }), /customer-only/);
});

test("spec 62: the shipped japan-and-korea-app-launch overlay loads and merges under demo-brand-owner", () => {
  // the real profiles/ dir (default) — loadProfiles' .json glob ignores the projects/ subdir, so the customer roster is unchanged
  const profiles = loadProfiles({ force: true, includeDemo: true });
  const projects = loadProjects({ profiles, force: true });
  const ov = projects.get("demo-brand-owner/japan-and-korea-app-launch");
  assert.ok(ov, "the shipped overlay is discovered");
  assert.equal(ov.projectName, "Japan and Korea app launch");
  const { profile, origins } = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "japan-and-korea-app-launch" }, { profiles, projects });
  assert.equal(profile.name, "Demo Brand Owner");
  assert.equal(origins.platforms, "customer+project");
  // the shipped case, on real data: the customer's storefronts are a floor the overlay may add to, never replace
  for (const p of profiles.get("demo-brand-owner").platforms)
    assert.ok(profile.platforms.includes(p), `customer platform ${p} survives the shipped overlay`);
  for (const p of ov.platforms) assert.ok(profile.platforms.includes(p), `overlay platform ${p} is added`);
  assert.deepEqual(profile.defaultClasses, [9, 42], "the overlay's own classes replace the customer's");
});

// ---- search-depth spine: defaultProduct / allowedRecipes / jxPolicy ----

const SPINE_BASE = { name: "Spine Co", platforms: ["example.com"] };

test("spine: defaultProduct validates against the closed level registry (a typo hard-fails, never mis-runs)", () => {
  assert.equal(validateProfileEdit("spine", { ...SPINE_BASE, defaultProduct: "knockout-search" }).ok, true);
  const bad = validateProfileEdit("spine", { ...SPINE_BASE, defaultProduct: "stage-0" });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /names no search we offer/);
  // a project overlay MAY set it (depth is machinery, not rating authority) — sparse accepts
  assert.equal(validateProfileEdit("projects/spine/p", { defaultProduct: "knockout-search" }, "", { sparse: true }).ok, true);
});

test("spine: allowedRecipes is a slug list; jxPolicy has closed keys + enums and D1-guarded escalation prose", () => {
  assert.equal(validateProfileEdit("spine", { ...SPINE_BASE, allowedRecipes: ["knockout", "spine/quick"] }).ok, true);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, allowedRecipes: [] }).errors.join(" "), /non-empty array/);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, allowedRecipes: ["Bad Slug"] }).errors.join(" "), /level key or recipe slug/);
  assert.equal(validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { laneDepth: { zh: "full" }, providerStance: "default" } }).ok, true);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { widget: 1 } }).errors.join(" "), /not a known jxPolicy key/);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { laneDepth: { zh: "max" } } }).errors.join(" "), /"off" \| "candidates" \| "full"/);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { laneDepth: { zhx: "full" } } }).errors.join(" "), /2-letter lane code/);
  assert.match(validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { providerStance: "aws" } }).errors.join(" "), /"default" or "azure-only"/);
  // escalation posture is PROSE under the D1 anti-rule guard — a threshold shape is rejected at authoring time
  const ruled = validateProfileEdit("spine", { ...SPINE_BASE, jxPolicy: { escalationPolicy: "escalate when composite >= 3" } });
  assert.equal(ruled.ok, false);
  assert.match(ruled.errors.join(" "), /numeric/i);
});

// ── Client-mandated platforms are a FLOOR, not a default ────────────────────────────────────────────────
// Regression pin for a live account (2026-07-18), shown here on the demo's own lists. The account's 7
// platforms are a client instruction; one of its projects adds its own marketplaces for the surface its
// context pack argues for. Before the union fix the project's list REPLACED the account's and the four
// platforms only the account named went unsearched on every run of that project, with the report still
// reading as clean coverage of the list it was handed.
const CLIENT_PLATFORMS = ["g2.com", "capterra.com", "aquatechtrade.com", "wateronline.com", "udemy.com",
  "apps.apple.com", "play.google.com"];
const PROJECT_PLATFORMS = ["rakuten.co.jp", "kakaku.com", "naver.com", "coupang.com", "line.me", "amazon.co.jp",
  "udemy.com", "apps.apple.com", "play.google.com"];

test("client-mandated platforms survive a project overlay — the live-account case", () => {
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": { ...CUSTOMER, name: "Demo Brand Owner", matchDomains: ["demo-brand-owner.example"], platforms: CLIENT_PLATFORMS } },
    { "demo-brand-owner/japan-and-korea-app-launch": { projectName: "Japan and Korea app launch", platforms: PROJECT_PLATFORMS } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const { profile, origins } = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "japan-and-korea-app-launch" }, { profiles, projects });

  // every platform the CLIENT asked for is searched — this is the instruction the bug revoked
  for (const p of CLIENT_PLATFORMS) assert.ok(profile.platforms.includes(p), `client-mandated ${p} is searched`);
  // the four the overlay used to delete, named explicitly so a regression is unmistakable
  for (const p of ["g2.com", "capterra.com", "aquatechtrade.com", "wateronline.com"])
    assert.ok(profile.platforms.includes(p), `${p} was dropped by the pre-union merge — it must never be again`);
  // the project's own reasoning is preserved too: both lists are wanted, neither replaces the other
  for (const p of PROJECT_PLATFORMS) assert.ok(profile.platforms.includes(p), `project-added ${p} is searched`);
  assert.equal(profile.platforms.length, 13, "7 client ∪ 9 project, 3 shared");
  assert.equal(origins.platforms, "customer+project", "provenance stays visible, never flattened to one side");
});

test("a project that states NO platforms still inherits the client's, untouched", () => {
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": { ...CUSTOMER, name: "Demo Brand Owner", matchDomains: ["demo-brand-owner.example"], platforms: CLIENT_PLATFORMS } },
    { "demo-brand-owner/quiet": { projectName: "Quiet project", defaultClasses: [9] } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const { profile, origins } = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "quiet" }, { profiles, projects });
  assert.deepEqual(profile.platforms, CLIENT_PLATFORMS);
  assert.equal(origins.platforms, "customer");
});

test("only `platforms` unions — every other project key still REPLACES", () => {
  const dir = withProjects(
    { generic: GENERIC, "demo-brand-owner": { ...CUSTOMER, name: "Demo Brand Owner", matchDomains: ["demo-brand-owner.example"], platforms: CLIENT_PLATFORMS, defaultClasses: [9, 41], defaultJurisdictions: ["US", "EU"] } },
    { "demo-brand-owner/narrow": { projectName: "Narrow", defaultClasses: [28], defaultJurisdictions: ["JP"] } },
  );
  const profiles = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles, force: true });
  const { profile } = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "narrow" }, { profiles, projects });
  assert.deepEqual(profile.defaultClasses, [28], "classes REPLACE — an engagement legitimately runs different classes");
  assert.deepEqual(profile.defaultJurisdictions, ["JP"], "jurisdictions REPLACE");
});

// ── per-run platforms ─────────────────────────────────────────────────────────────────────────────────
// The rules live in ONE place so a domain that is a foot-gun in a profile is the same foot-gun arriving
// on a request. What differs is only the register the failure is phrased in: a profile load dies, a job
// clarifies.

test("platformEntryErrors is the single source of the domain rules — the same foot-guns, the same words", () => {
  assert.deepEqual(platformEntryErrors(["gnc.com", "iherb.com"]), [], "bare store domains are fine");
  assert.match(platformEntryErrors(["web"])[0], /general-web cell is implicit/);
  assert.match(platformEntryErrors(["not a domain"])[0], /bare store DOMAIN/);
  assert.match(platformEntryErrors(["gnc.com", "GNC.com"])[0], /duplicated/, "case-insensitive: duplicates inflate the floor");
  assert.match(platformEntryErrors([""])[0], /non-empty store-domain string/);
  // A profile load still dies on exactly these, which is what keeps the two doors honest with each other.
  assert.throws(() => loadProfiles({ dir: profileDir({ generic: { ...GENERIC, platforms: ["web"] } }), force: true }), /general-web cell is implicit/);
});

test("withRunPlatforms ADDS to the account's marketplaces and can never take one away", () => {
  const profile = { key: "acme", platforms: ["alibaba.com", "thomasnet.com"] };
  const { profile: widened, added } = withRunPlatforms(profile, ["gnc.com"]);
  assert.deepEqual(added, ["gnc.com"]);
  assert.deepEqual(widened.platforms, ["alibaba.com", "thomasnet.com", "gnc.com"], "the mandate survives; the request rides on top");
  // The floor is what makes the addition real — an extra marketplace that did not raise it would leave
  // the coverage ledger describing a grid the run never had.
  assert.equal(derivedFloor(widened), derivedFloor(profile) + 1);
  assert.ok(derivedBatchSize(widened) <= derivedBatchSize(profile), "a wider grid batches smaller, never larger");
});

test("withRunPlatforms is a no-op when a job adds nothing — the pre-existing freeze stays byte-identical", () => {
  const profile = { key: "acme", platforms: ["alibaba.com"] };
  for (const jobPlatforms of [undefined, null, [], ["alibaba.com"], ["ALIBABA.COM"], "not-an-array"]) {
    const { profile: out, added } = withRunPlatforms(profile, jobPlatforms);
    assert.deepEqual(added, [], `added for ${JSON.stringify(jobPlatforms)}`);
    assert.equal(out, profile, "the SAME object back — no copy, so nothing about the frozen sidecar can shift");
  }
});

test("withRunPlatforms copies rather than mutating — the resolved profile may be cached across runs", () => {
  const profile = { key: "acme", platforms: ["alibaba.com"] };
  const { profile: widened } = withRunPlatforms(profile, ["gnc.com", "gnc.com"]);
  assert.deepEqual(profile.platforms, ["alibaba.com"], "the caller's profile is untouched");
  assert.deepEqual(widened.platforms, ["alibaba.com", "gnc.com"], "and the request's own duplicates collapse");
});

test("config nulls: an explicit null in a project overlay says NOTHING, it does not mask the customer", () => {
  // The sparse validator tests presence with `!= null`, so {"delivery": null} validates; the merge
  // tested `!== undefined`, so it then REPLACED the customer's value with null and stamped
  // origins = "project". platforms:null was worse — it reached the union spread as a TypeError and
  // parked every job for that project behind an opaque "resolution errored" clarify.
  //
  // The invariant: a null-valued overlay key must resolve EXACTLY as an absent one.
  const nulls = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/proj": { projectName: "P", platforms: null, delivery: null, defaultProduct: null, defaultClasses: null } },
  );
  const absent = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/proj": { projectName: "P" } },
  );
  const resolve = (dir) => {
    const profiles = loadProfiles({ dir, force: true });
    const projects = loadProjects({ dir, profiles, force: true });
    return resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "proj" }, { profiles, projects });
  };
  const a = resolve(nulls), b = resolve(absent);
  assert.deepEqual(a.profile, b.profile, "null keys resolve exactly as absent keys do");
  assert.deepEqual(a.origins ?? {}, b.origins ?? {}, "and never claim the project set what it did not");
  assert.ok(Array.isArray(a.profile.platforms) && a.profile.platforms.length, "the client's marketplace mandate survives");
  assert.ok(a.profile.delivery != null, "delivery is not masked to null");

  // a REAL overlay value still replaces, and platforms still union — the fix is about null only
  const real = withProjects(
    { generic: GENERIC, "demo-brand-owner": CUSTOMER },
    { "demo-brand-owner/real-proj": { projectName: "R", platforms: ["etsy.com"], defaultClasses: [25] } },
  );
  const profiles = loadProfiles({ dir: real, force: true });
  const projects = loadProjects({ dir: real, profiles, force: true });
  const r = resolveEffectiveProfile({ profileKey: "demo-brand-owner", projectKey: "real-proj" }, { profiles, projects });
  assert.deepEqual(r.profile.defaultClasses, [25], "a stated class list replaces");
  assert.ok(r.profile.platforms.some((d) => d === "etsy.com"), "the project's own store is added");
  assert.equal(r.origins.platforms, "customer+project", "and the union is recorded honestly");
});

// ── THE REFUSAL NAMES THE RULE THAT FIRED ─────────────────────────────────────────────────────────────
//
// This is the sentence a person reads. The settings panel renders THIS — the server validator's line —
// and not the field contract's wording, so correcting the contract and not this one left the refusal
// telling a reader to do exactly what they had just done: it refused an unknown two-letter code with a
// sentence asking for a two-letter code. Found on a walk of the published build, after the contract half
// had already shipped.
//
// Driven through the validator rather than asserted against a copy of its text, because a copy is what
// let the two halves drift apart in the first place.
test("an unknown territory is refused by a sentence that does not ask for what was just supplied", () => {
  const v = validateProfileEdit("acme", {
    name: "Acme", platforms: ["amazon.com"], defaultJurisdictions: ["XX"],
  }, "");
  assert.equal(v.ok, false, "an unknown territory must still be refused");
  const line = v.errors.find((e) => /territor/i.test(e));
  assert.ok(line, `no territory refusal came back: ${v.errors.join(" | ")}`);

  // The defect, stated as the reader meets it: XX IS a two-letter code, so a refusal asking for one
  // describes the entry's shape rather than the rule, and reads as advice already taken.
  assert.ok(!/or a two-letter code such as/.test(line),
    `the refusal asks for a two-letter code and refused one — it names the shape, not the rule:\n  ${line}`);
  assert.match(line, /codes the engine holds/,
    `the refusal does not say what actually decides it — that the engine must hold the territory:\n  ${line}`);

  // And it still names the offending entry, which is the half a fixed sentence cannot do.
  assert.match(line, /"XX"/, "the refusal no longer names which entry was refused");

  // A territory the engine DOES hold is not refused by any of this.
  const held = validateProfileEdit("acme", {
    name: "Acme", platforms: ["amazon.com"], defaultJurisdictions: ["US", "EU", "France"],
  }, "");
  assert.deepEqual(held.errors.filter((e) => /territor/i.test(e)), [],
    "a country name and codes the engine holds were refused");
});
