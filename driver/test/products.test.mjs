// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// products.test.mjs — THE OFFERING, row by row.
//
// Three properties carry the rest and are asserted as behaviour rather than as wording:
//
//   1. the product is DERIVED from pipeline + scope and from nothing else, so the same scope names the
//      same product at a door, at the runner and at publish — the identity the whole build turns on;
//   2. naming and JUDGING are separate. Every scope names a product, including scopes no product
//      accepts; the refusal then says which product to ask for instead. A refusal that cannot name the
//      product someone landed on cannot tell them what to order;
//   3. the refusal vocabulary is CLOSED and the sentence is written once. Three doors quote these, and
//      the same request refused in three different sentences is the defect this build exists to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTS, PRODUCT_IDS, REFUSAL_REASONS, NATIVE_LANGUAGE_MODES,
  productFor, productSpec, productName, checkProductScope, CASE_LAW_NOT_A_REQUEST,
  checkNativeLanguage, nativeLanguageMode, maxNamesFor, quoteTerritory,
  NATIVE_LANGUAGE_NOT_A_SUPPRESSION, NATIVE_LANGUAGE_REMEDY,
} from "../products.mjs";

const REASONS = new Set(Object.values(REFUSAL_REASONS));

// Every refusal the module exports as a frozen constant rather than as a check result, read off the
// module namespace so a constant added later is covered without anyone remembering to come back here.
const PRODUCTS_MODULE = await import("../products.mjs");
const CONSTANT_REFUSALS = Object.entries(PRODUCTS_MODULE)
  .filter(([k, v]) => /_(NOT_A_REQUEST|NOT_A_SUPPRESSION)$/.test(k) && v && typeof v === "object" && !Array.isArray(v))
  .map(([, v]) => v);
const KNOCKOUT = "knockout-search";
const GLOBAL = "global-preliminary-search";
const MULTI = "multi-country-focus-search";
const FULL = "full-country-search";

// ── the mapping table, row by row ───────────────────────────────────────────────────────────────────
test("the five rows of the offering: pipeline + scope names the product, and nothing else does", () => {
  // knockout pipeline → Knockout search, at ANY geography. The table gives it "worldwide or a chosen
  // set", so geography does not move it.
  assert.equal(productFor({ pipeline: "knockout", territories: [] }), KNOCKOUT);
  assert.equal(productFor({ pipeline: "knockout", territories: ["United States"] }), KNOCKOUT);
  assert.equal(productFor({ pipeline: "knockout", territories: ["US", "FR", "EU"] }), KNOCKOUT);
  // clearance + worldwide → Global preliminary search
  assert.equal(productFor({ pipeline: "clearance", territories: [] }), GLOBAL);
  // clearance + a region → Multi-country focus search
  assert.equal(productFor({ pipeline: "clearance", territories: ["European Union"] }), MULTI);
  // clearance + 2..N countries → Multi-country focus search
  assert.equal(productFor({ pipeline: "clearance", territories: ["US", "FR"] }), MULTI);
  assert.equal(productFor({ pipeline: "clearance", territories: ["US", "FR", "DE", "JP"] }), MULTI);
  // clearance + exactly one country → Full country search
  assert.equal(productFor({ pipeline: "clearance", territories: ["United States"] }), FULL);
});

test("an empty scope is WORLDWIDE, because that is what the engine searches when nothing narrows it", () => {
  // The resolved scope is what this module is given (resolveEffectiveScope has already walked the
  // request → saved search → project → account ladder). Nothing surviving that ladder IS unrestricted:
  // register-plan sweeps everywhere. So the name follows the work, which is the point of deriving it.
  assert.equal(productFor({ pipeline: "clearance", territories: [] }), GLOBAL);
  assert.equal(productFor({ pipeline: "clearance" }), GLOBAL, "an omitted list is the same answer");
  // a worldwide TOKEN is a mode, not a place, and never counts as a territory
  for (const token of ["Worldwide", "worldwide", "GLOBAL", "all"])
    assert.equal(productFor({ pipeline: "clearance", territories: [token] }), GLOBAL, token);
  // …and it does not turn a real country into two territories when it rides alongside one
  assert.equal(productFor({ pipeline: "clearance", territories: ["Worldwide", "US"] }), FULL);
});

test("the product is counted in PLACES, not in list entries — two spellings of one country are one", () => {
  // A requester who wrote both the name and the code named one country. Counting strings would refuse
  // them a Full country search they described correctly.
  assert.equal(productFor({ pipeline: "clearance", territories: ["US", "United States"] }), FULL);
  assert.equal(productFor({ pipeline: "clearance", territories: ["united states", "USA", "U.S.A."] }), FULL);
  // the same fold on the region side: EM/EUTM/EUIPO are the EUIPO, and it is one region
  assert.equal(productFor({ pipeline: "clearance", territories: ["EU", "EUIPO", "European Union"] }), MULTI);
  // UK and GB are one country, so this stays a Full country search
  assert.equal(productFor({ pipeline: "clearance", territories: ["UK", "GB", "United Kingdom"] }), FULL);
  // and two genuinely different places still count as two
  assert.equal(productFor({ pipeline: "clearance", territories: ["US", "GB"] }), MULTI);
});

test("a REGION alone and an UNRECOGNIZED entry alone both derive to Multi-country focus — and only one is legal", () => {
  // The asymmetry a reader gets wrong. Both are a named set of ONE that is not a country, so neither can
  // be a Full country search and both name Multi-country focus. A region is a legal multi-country
  // geography; a typo is a search with a hole in it, and no product accepts it.
  assert.equal(productFor({ pipeline: "clearance", territories: ["Benelux"] }), MULTI);
  assert.equal(productFor({ pipeline: "clearance", territories: ["QQ"] }), MULTI);
  assert.equal(checkProductScope({ product: MULTI, territories: ["Benelux"] }).ok, true);
  const bad = checkProductScope({ product: MULTI, territories: ["QQ"] });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, REFUSAL_REASONS.TERRITORY_NOT_RECOGNIZED);
});

test("productFor never names a product its own scope is illegal at — except for an entry that names nowhere", () => {
  // The self-consistency that makes derivation trustworthy: judge what you named, and the answer is yes.
  const scopes = [[], ["US"], ["EU"], ["US", "FR"], ["EU", "FR"], ["Worldwide"], ["Benelux", "US", "JP"]];
  for (const pipeline of ["knockout", "clearance"])
    for (const territories of scopes) {
      const product = productFor({ pipeline, territories });
      assert.equal(checkProductScope({ product, territories }).ok, true,
        `${pipeline} ${JSON.stringify(territories)} derived to ${product} and was then refused`);
    }
  // the one exception, and it is the honest one
  for (const pipeline of ["knockout", "clearance"]) {
    const territories = ["Freedonia"];
    const r = checkProductScope({ product: productFor({ pipeline, territories }), territories });
    assert.equal(r.ok, false, pipeline);
    assert.equal(r.reason, REFUSAL_REASONS.TERRITORY_NOT_RECOGNIZED);
  }
});

test("an unknown or absent pipeline names no product — a guess here would be a claim about a run nobody described", () => {
  assert.equal(productFor({ pipeline: null, territories: ["US"] }), null);
  assert.equal(productFor({ pipeline: "", territories: [] }), null);
  assert.equal(productFor({ pipeline: "prelim", territories: [] }), null, "a LEVEL key is not a pipeline");
  assert.equal(productFor({}), null);
  assert.equal(productFor(), null);
  // spelling and padding are tolerated, because resolveSearchPolicy's own values arrive that way
  assert.equal(productFor({ pipeline: "  CLEARANCE " }), GLOBAL);
});

// ── the illegal combinations, each with its reason ──────────────────────────────────────────────────
test("a REGION at Full country search refuses — a region is not a country and cannot be chosen here", () => {
  for (const region of ["European Union", "EU", "EUIPO", "Benelux", "ARIPO", "Madrid"]) {
    const r = checkProductScope({ product: FULL, territories: [region] });
    assert.equal(r.ok, false, region);
    assert.equal(r.reason, REFUSAL_REASONS.REGION_NOT_A_COUNTRY);
    assert.match(r.message, /is a regional filing system covering many countries, not one country/);
    assert.match(r.message, /order a Multi-country focus search over the region/, "the refusal names what to order instead");
  }
  // a region ALONGSIDE a country is still the region's refusal: the fix a requester needs is to drop the
  // region, and being told "you named 2" would send them to drop the country instead
  const mixed = checkProductScope({ product: FULL, territories: ["EU", "France"] });
  assert.equal(mixed.reason, REFUSAL_REASONS.REGION_NOT_A_COUNTRY);
  // two regions read as plural
  assert.match(checkProductScope({ product: FULL, territories: ["EU", "Benelux"] }).message,
    /are regional filing systems covering many countries, not one country/);
});

test("WORLDWIDE at Multi-country focus search refuses — never worldwide", () => {
  const r = checkProductScope({ product: MULTI, territories: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED);
  assert.match(r.message, /no territory \(worldwide\)/);
  assert.match(r.message, /order a Global preliminary search to search worldwide/);
  // the worldwide TOKEN is the same request
  assert.equal(checkProductScope({ product: MULTI, territories: ["Worldwide"] }).reason, REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED);
  // and Full country refuses worldwide for its own reason, in its own words
  const full = checkProductScope({ product: FULL, territories: [] });
  assert.equal(full.reason, REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED);
  assert.match(full.message, /Name ONE country in jurisdictions/);
});

test("EXACTLY ONE COUNTRY at Global preliminary search refuses — worldwide, and no narrowing of any kind", () => {
  const one = checkProductScope({ product: GLOBAL, territories: ["United States"] });
  assert.equal(one.ok, false);
  assert.equal(one.reason, REFUSAL_REASONS.NARROWING_NOT_OFFERED);
  assert.match(one.message, /accepts no narrowing/);
  assert.match(one.message, /order a Full country search over them/, "the alternative is the product that scope IS");
  // any narrowing at all, not just one country: a region, several countries, the lot
  for (const t of [["EU"], ["US", "FR"], ["Benelux", "JP"]]) {
    const r = checkProductScope({ product: GLOBAL, territories: t });
    assert.equal(r.reason, REFUSAL_REASONS.NARROWING_NOT_OFFERED, JSON.stringify(t));
    assert.match(r.message, /order a Multi-country focus search over them/);
  }
  // worldwide is the one thing it takes
  assert.equal(checkProductScope({ product: GLOBAL, territories: [] }).ok, true);
  assert.equal(checkProductScope({ product: GLOBAL, territories: ["Worldwide"] }).ok, true);
});

test("MORE THAN ONE COUNTRY at Full country search refuses — one country at a time", () => {
  const r = checkProductScope({ product: FULL, territories: ["United States", "France"] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL_REASONS.TOO_MANY_COUNTRIES);
  assert.match(r.message, /names 2 \("United States", "France"\)/, "the message quotes what the requester wrote");
  assert.match(r.message, /order a Multi-country focus search over them/);
  // deduped first: one country written twice is not two
  assert.equal(checkProductScope({ product: FULL, territories: ["US", "United States"] }).ok, true);
});

test("EXACTLY ONE COUNTRY at Multi-country focus search refuses — never exactly one", () => {
  const r = checkProductScope({ product: MULTI, territories: ["Japan"] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REFUSAL_REASONS.NOT_ENOUGH_COUNTRIES);
  assert.match(r.message, /names one country \("Japan"\)/);
  assert.match(r.message, /order a Full country search over it/);
  // a region is the other legal shape, and it is one entry
  assert.equal(checkProductScope({ product: MULTI, territories: ["Benelux"] }).ok, true);
  assert.equal(checkProductScope({ product: MULTI, territories: ["US", "JP"] }).ok, true);
  // a region plus a country is a named set of two, and legal
  assert.equal(checkProductScope({ product: MULTI, territories: ["EU", "CH"] }).ok, true);
});

test("a Knockout search takes worldwide or any chosen set — and still refuses an entry that names nowhere", () => {
  for (const t of [[], ["Worldwide"], ["US"], ["US", "FR", "EU"], ["Benelux"]])
    assert.equal(checkProductScope({ product: KNOCKOUT, territories: t }).ok, true, JSON.stringify(t));
  const r = checkProductScope({ product: KNOCKOUT, territories: ["US", "Freedonia"] });
  assert.equal(r.reason, REFUSAL_REASONS.TERRITORY_NOT_RECOGNIZED);
  assert.match(r.message, /use the two-letter country code/, "the refusal says how to fix it");
});

test("an unknown product is not judged — that is the door's own check, not a scope question", () => {
  for (const id of [null, undefined, "", "prelim", "prelim-jx", "nope"]) {
    assert.deepEqual(checkProductScope({ product: id, territories: ["US", "FR"] }), { ok: true, reason: null, message: null }, String(id));
  }
  assert.equal(productSpec("nope"), null);
  assert.equal(productName("nope"), null);
  assert.equal(maxNamesFor("nope"), null);
  assert.equal(nativeLanguageMode("nope"), null);
});

// ── case law ────────────────────────────────────────────────────────────────────────────────────────
test("case law is a PRODUCT, and there is no request field left to refuse", () => {
  // It used to be a job flag with its own refusal function, judged per product and per scope. Under the
  // offering there is nothing to judge: one product carries the reading, no other offers it, and a
  // request that sends the field is refused outright — including `false`, which never suppressed
  // anything and would otherwise be accepted as if it had.
  assert.equal(PRODUCTS.filter((p) => p.caseLaw).length, 1, "exactly one product carries it");
  assert.equal(productSpec(FULL).caseLaw, true);
  for (const id of [KNOCKOUT, GLOBAL, MULTI]) assert.equal(productSpec(id).caseLaw, false, id);
  assert.equal(CASE_LAW_NOT_A_REQUEST.reason, REFUSAL_REASONS.CASE_LAW_NOT_OFFERED);
  assert.match(CASE_LAW_NOT_A_REQUEST.message, /caseLaw is not a request setting/);
  assert.match(CASE_LAW_NOT_A_REQUEST.message, /what a Full country search IS/,
    "the refusal names the product that carries it, so it is one edit away from a working request");
  assert.match(CASE_LAW_NOT_A_REQUEST.message, /"full-country-search"/, "and the id to send");
});

// ── the sibling toggle: `nativeLanguage: false` ─────────────────────────────────────────────────────
test("nativeLanguage: false is a refusal, not a setting — the caseLaw doctrine on the other toggle", () => {
  // It was dropped at all four assembling doors, uniformly — so it broke no parity and nothing caught it,
  // while `caseLaw: false` was refused at all five in this module's own words. The MCP schema declares
  // nativeLanguage a plain boolean, so `false` is a shape an agent WILL send, and on the one product that
  // runs the investigation automatically it reads as "and do not run it".
  assert.equal(NATIVE_LANGUAGE_NOT_A_SUPPRESSION.reason, REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_A_SUPPRESSION);
  assert.match(NATIVE_LANGUAGE_NOT_A_SUPPRESSION.message, /switches nothing off/);
  assert.match(NATIVE_LANGUAGE_NOT_A_SUPPRESSION.message, /Omit nativeLanguage/, "and how to get a search without it");
  // The remedy sentence is shared with two surfaces outside this module (the resolution-time note and the
  // delivered coverage row), and it must name EXACTLY the products that carry the investigation — the row
  // it replaced named `prelim-jx`, which is neither a product nor orderable.
  for (const p of PRODUCTS) {
    assert.equal(NATIVE_LANGUAGE_REMEDY.includes(p.name), p.nativeLanguage !== "absent",
      `${p.name}: the remedy names exactly the products whose native-language mode is offered/automatic`);
  }
  assert.match(NATIVE_LANGUAGE_REMEDY, /offered on a Multi-country focus search/);
  assert.match(NATIVE_LANGUAGE_REMEDY, /automatically on a Full country search/);
});

// ── the native-language investigation ───────────────────────────────────────────────────────────────
test("native language: offered on Multi-country focus, automatic on Full country, absent elsewhere", () => {
  assert.equal(nativeLanguageMode(MULTI), "offered");
  assert.equal(nativeLanguageMode(FULL), "automatic");
  assert.equal(nativeLanguageMode(KNOCKOUT), "absent");
  assert.equal(nativeLanguageMode(GLOBAL), "absent");
  // it is the ONLY toggle in the offering — one product where the client chooses
  assert.equal(PRODUCTS.filter((p) => p.nativeLanguage === "offered").length, 1);
  for (const p of PRODUCTS) assert.ok(NATIVE_LANGUAGE_MODES.includes(p.nativeLanguage), p.id);

  assert.deepEqual(checkNativeLanguage({ product: MULTI }), { ok: true, reason: null, message: null, mode: "offered" });
  assert.deepEqual(checkNativeLanguage({ product: FULL }), { ok: true, reason: null, message: null, mode: "automatic" });
  const no = checkNativeLanguage({ product: GLOBAL });
  assert.equal(no.ok, false);
  assert.equal(no.reason, REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_OFFERED);
  assert.equal(no.mode, "absent");
  assert.match(no.message, /not part of a Global preliminary search/);
  assert.match(no.message, /offered on a Multi-country focus search and runs automatically on a Full country search/,
    "a refusal that does not say where the thing IS available sends the requester round the loop again");
  assert.equal(checkNativeLanguage({ product: null }).mode, null);
});

// ── the name-count limit ────────────────────────────────────────────────────────────────────────────
test("the name-count limit is eight on a Knockout search and one on every clearance", () => {
  assert.equal(maxNamesFor(KNOCKOUT), 8);
  for (const id of [GLOBAL, MULTI, FULL]) assert.equal(maxNamesFor(id), 1, id);
});

// ── the properties every client-facing sentence has to have ─────────────────────────────────────────
const everyMessage = () => {
  const out = [];
  const push = (r) => { if (r && r.ok === false) out.push(r.message); };
  const scopes = [[], ["US"], ["EU"], ["US", "FR"], ["EU", "Benelux"], ["EU", "FR"], ["QQ"], ["Freedonia", "US"]];
  for (const product of PRODUCT_IDS) {
    push(checkNativeLanguage({ product }));
    for (const territories of scopes) {
      push(checkProductScope({ product, territories }));
    }
  }
  // The refusals that are CONSTANTS rather than check results, because none depends on anything about
  // the request: `caseLaw` is not a setting at all, `nativeLanguage: false` asks to switch off something
  // no product runs conditionally, and `searchLevel` names a ladder that no longer exists. All still
  // have to hold every property below.
  //
  // DERIVED from the module's exports, not listed. It was listed, and that is precisely how
  // SEARCH_LEVEL_NOT_A_REQUEST shipped with `reason: undefined` — a mistyped REFUSAL_REASONS key freezes
  // silently, and a hand-kept list here had no reason to mention it.
  for (const c of CONSTANT_REFUSALS) out.push(c.message);
  return out;
};

test("the refusal vocabulary is CLOSED — every reason this module can return is in the exported set", () => {
  const seen = new Set();
  const note = (r) => { if (r && r.ok === false) seen.add(r.reason); };
  const scopes = [[], ["US"], ["EU"], ["US", "FR"], ["EU", "Benelux"], ["QQ"]];
  for (const product of PRODUCT_IDS) {
    note(checkNativeLanguage({ product }));
    for (const territories of scopes) note(checkProductScope({ product, territories }));
  }
  for (const c of CONSTANT_REFUSALS) seen.add(c.reason);
  for (const r of seen) assert.ok(REASONS.has(r), `${r} is not in REFUSAL_REASONS — a free string reached a door`);
  // every declared reason is reachable: a vocabulary entry nothing can produce is a door waiting to
  // branch on a case that never happens
  assert.deepEqual([...REASONS].filter((r) => !seen.has(r)), [], "an unreachable refusal reason");
  // and a refusal always carries BOTH halves — a door joins on the reason and prints the message
  const all = everyMessage();
  assert.ok(all.length >= 10);
  for (const m of all) assert.ok(typeof m === "string" && m.length > 40, `a refusal with no sentence: ${m}`);
});

test("no message names a product ID, a switch, a variable or an internal level key", () => {
  for (const m of everyMessage()) {
    // ONE EXEMPTION, STATED AS A PRINCIPLE RATHER THAN A NAME. A refusal whose remedy is "send the
    // `product` field" may print ids, because there the id IS the fix — `product: "full-country-search"`
    // is the literal value the requester must type, and printing the NAME instead would leave them with
    // a sentence they cannot act on. Every other refusal names the product in words, because in every
    // other refusal the words are the point.
    //
    // Written as a property, not as `m === CASE_LAW_NOT_A_REQUEST.message`, so the next refusal of this
    // kind is covered by the rule instead of by an edit. `searchLevel` was exactly that next refusal.
    const remedyIsTheProductField = /\b(send|order)\s+product\b/i.test(m);
    if (remedyIsTheProductField) {
      assert.ok(PRODUCT_IDS.some((id) => m.includes(id)),
        `a refusal claims the product field is the remedy and names no id to send: ${m}`);
      // the OTHER four checks below still apply to it — only the id ban is lifted
    } else {
      for (const id of PRODUCT_IDS)
        assert.ok(!m.includes(id), `a product id reached a requester: ${id} in ${m}`);
    }
    assert.doesNotMatch(m, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached a requester: ${m}`);
    assert.doesNotMatch(m, /\bprelim\b|prelim-jx|prelim-register-only|knockout-register/, `an internal level key reached a requester: ${m}`);
    assert.doesNotMatch(m, /jxLanes|registerProbe|commonLawGrid|maxMarks|pipeline/, `an internal component name reached a requester: ${m}`);
    assert.doesNotMatch(m, /Depth \d/, "the ladder the offering removes must not survive in its refusals");
  }
});

test("an id can never appear inside its own prose — which is what lets a leak-scan look for it", () => {
  // The ids are the names lowercased and hyphen-joined. A client sentence contains "Knockout search",
  // never "knockout-search", so a scan for the literal id is exact: it catches the key and never the
  // words we mean to say. Free-form ids would make that scan either leaky or full of false positives.
  for (const p of PRODUCTS) {
    assert.equal(p.id, p.name.toLowerCase().replace(/\s+/g, "-"), `${p.id} is not the slug of ${p.name}`);
    assert.ok(!p.name.includes(p.id));
    assert.match(p.name, /^[A-Z]/, "the name is what a client reads");
  }
  assert.deepEqual(PRODUCT_IDS, [KNOCKOUT, GLOBAL, MULTI, FULL], "offering order, lightest first");
  assert.equal(PRODUCTS.length, 4, "four products — a fifth needs an owner ruling, not a row");
  for (const p of PRODUCTS) assert.throws(() => { p.caseLaw = true; }, "the offering is frozen");
});

test("a requester-supplied territory cannot forge a row in a reason file, an outbox packet or a log line", () => {
  // validateJob only bounds the TRIMMED length of an entry, so an interior newline passes the door — and
  // an account's defaultJurisdictions are a free-text lines field validated as an array and nothing more.
  const forged = "FR\n[runner] cl-1 -> done";
  const out = [
    checkProductScope({ product: MULTI, territories: ["US", forged] }).message,
    checkProductScope({ product: FULL, territories: [forged] }).message,
    checkProductScope({ product: GLOBAL, territories: [forged] }).message,
  ];
  for (const m of out) {
    assert.equal(m.includes("\n"), false, `a newline reached a message that rides a log line: ${JSON.stringify(m)}`);
    assert.match(m, /\\n/, "the newline is shown as an escape, so the requester still sees what they sent");
  }
  // an unbounded entry must not become an unbounded refusal
  const long = checkProductScope({ product: FULL, territories: ["X".repeat(500), "Y".repeat(500)] }).message;
  assert.ok(long.length < 400, `an unbounded entry became a ${long.length}-char refusal`);
  assert.equal(quoteTerritory("X".repeat(500)).length, 42, "clamped to 40 characters, then quoted");
  assert.equal(quoteTerritory("FR"), '"FR"');
});

// ── EVERY REFUSAL CONSTANT CARRIES A REAL REASON ──────────────────────────────────────────────────
//
// `REASONS` above checks what the CHECK FUNCTIONS return. Nothing checked the exported refusal
// constants themselves, and the two are not the same surface: a constant is a frozen object written by
// hand, so a typo in the key name yields `reason: undefined` with no error anywhere. That happened while
// adding SEARCH_LEVEL_NOT_A_REQUEST — `REFUSAL_REASONS.UNKNOWN_PRODUCT` does not exist, the object froze
// with an undefined reason, and every test still passed because nothing reads a refusal's reason on that
// path yet. It would have shipped, and the first thing to read it would have got `undefined`.
//
// DERIVED from the module's own exports, so a constant added later is covered without anyone
// remembering to add it here.
test("every exported *_NOT_A_REQUEST / *_NOT_A_SUPPRESSION constant has a reason in REFUSAL_REASONS and a message", async () => {
  const mod = await import("../products.mjs");
  const constants = Object.entries(mod).filter(([k, v]) =>
    /_(NOT_A_REQUEST|NOT_A_SUPPRESSION)$/.test(k) && v && typeof v === "object" && !Array.isArray(v));
  assert.ok(constants.length >= 3,
    `only ${constants.length} refusal constants found — the derivation is not seeing the module's exports`);
  for (const [name, c] of constants) {
    assert.ok(REASONS.has(c.reason),
      `${name}.reason is ${JSON.stringify(c.reason)}, which is not a value of REFUSAL_REASONS — a mistyped key freezes as undefined and says nothing`);
    assert.ok(typeof c.message === "string" && c.message.trim().length > 20,
      `${name}.message must be a sentence a requester can act on; got ${JSON.stringify(c.message)}`);
  }
});

test("searchLevel is REFUSED by name, in every form, and the sentence names its replacement", async () => {
  const { validateJob } = await import("../enqueue-schema.mjs");
  const base = { id: "p", markName: "NOVAPULSE", classes: [9], forwarder: "ops",
    profileKey: "aurora", product: "knockout-search" };
  assert.equal(validateJob({ ...base }).classify, "run", "the control must admit, or the probes prove nothing");
  // Including `null` and the empty string: sending the KEY at all means the caller is on the retired
  // wire. This is the shape closed for deliveryRoute and nativeLanguage:false and left open on the
  // selector itself — accepted, dropped, and the run went out at whatever the SCOPE implied.
  for (const v of ["prelim", "prelim-jx", "knockout", "knockout-register", "prelim-register-only", null, ""]) {
    const r = validateJob({ ...base, searchLevel: v });
    assert.notEqual(r.classify, "run", `searchLevel: ${JSON.stringify(v)} was accepted and silently dropped`);
    assert.ok(r.errors.some((e) => /searchLevel is not a request setting/.test(e)),
      `the refusal must name the field: ${JSON.stringify(r.errors)}`);
    assert.ok(r.errors.some((e) => /\bproduct\b/.test(e) && /knockout-search/.test(e)),
      `and name what to send instead, with the list: ${JSON.stringify(r.errors)}`);
  }
});
