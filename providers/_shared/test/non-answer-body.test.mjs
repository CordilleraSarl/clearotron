// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A PARSEABLE NON-ANSWER IS NOT A COUNTED ZERO — the regression lane for the residuals that survived
// the truncated-200 fix, across every provider.
//
// ── what this guards ─────────────────────────────────────────────────────────────────────────────────
//
// made the cut on "did the bytes parse": a truncated 200 rides out on `parseError` and every tool
// entry point refuses it. The adversarial review then produced the IDENTICAL false clean one JSON
// envelope away: a 200 whose body is
//
//     {"message":"upstream search cluster unavailable"}
//
// is valid JSON — parseError never fires — and the corsearch normalizer's fallback coerced "an object
// with no totalHitCount" to 0. So `{"state":"enumerated","total_hits":0,"records":[]}` shipped again,
// Stage 0.5 counted it, and the count-first rescue dispositioned populated terms `verified-zero`
// ("deterministic true-0, tool-derived"), which the coverage ledger reads as confirmed-clean.
//
// The cut has to be made on SHAPE: a search response is a body that carries the search-response shape
// the endpoint was probed to return (for corsearch: totalHitCount / rows / nextRequest; for clarivate:
// ids{}; for signa: data[]; for euipo: totalElements / trademarks[]). A parseable body that is NOT
// that shape is the provider saying something other than an answer, and it must ride out exactly like
// the unparseable case: an ERROR: refusal → the kernels' existing vocabulary (incomplete / UNKNOWN /
// disposition `error` / slice MISSING). Never a new state, and never a 0.
//
// Every failing case below carries its control in the same breath: a REAL zero (the proper envelope
// with an honest empty count) must keep reading as a clean zero — crying wolf on honest emptiness is
// its own defect.
//
// ── on the payloads below ────────────────────────────────────────────────────────────────────────────
//
// The envelope shapes are the shapes these providers actually answer errors with: corsearch's
// `{"message":…}` (the same key its 4xx/5xx bodies carry — the fault lane's 404/429 use it),
// clarivate's `{"errorMessage":…}` (`{"errorMessage":"ids - Maximum number of ids is
// 100."}`), euipo's RFC-7807 problem (`{type,title,status,detail}` — documented in the client). The
// The clarivate controls are recorded responses: the envelopes and error strings are the API's own.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Redirect the ledgers BEFORE importing any core — both paths are captured at module load.
const TMP = mkdtempSync(join(tmpdir(), "non-answer-body-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const HERE = dirname(fileURLToPath(import.meta.url));
// AUTHORED, NOT CAPTURED. These four are written by us to the API's response shape — a count, an id
// list, a filing-date envelope and a ten-record /text answer. Nothing in them came off a wire: the
// subscription adapters' own replay corpora do not cross into the public tree, and a kernel test that
// reads one would go red the day they leave. What these assertions need is the SHAPE and the record
// count, never the content, so authoring them costs the tests nothing.
const CLARIVATE_FIX = join(HERE, "fixtures");
const clarivateFixtureRaw = (name) => readFileSync(join(CLARIVATE_FIX, `${name}.json`), "utf8");

const { nonAnswerBodyError } = await import("../http-body.mjs");
const { makeCountProbe } = await import("../count.mjs");
const { makeEnumerate } = await import("../enumerate.mjs");
const corsearch = await import("../../corsearch/src/core.js");
const clarivate = await import("../../clarivate/src/core.js");
const signa = await import("../../signa/src/core.js");
const euipo = await import("../../euipo/src/euipo-client.js");

const realFetch = global.fetch;
after(() => { global.fetch = realFetch; });
beforeEach(() => { corsearch.__resetSearchCache?.(); });

const parse = (r) => JSON.parse(typeof r === "string" ? r : (r?.text ?? ""));
const isError = (r) => typeof r?.text === "string" && r.text.startsWith("ERROR");

const resp = (raw, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => "application/json" },
  text: async () => raw,
});
// The review's exact payload: status 200, ok true, a body that PARSES — and answers nothing.
const ENVELOPE = { message: "upstream search cluster unavailable" };
const envelope = () => resp(JSON.stringify(ENVELOPE));

// ══ the helper itself ═══════════════════════════════════════════════════════════════════════════════

test("the refusal sentence names the missing shape AND quotes what the provider actually said", () => {
  const msg = nonAnswerBodyError("some_tool", { status: 200, body: ENVELOPE }, "a search response (no totalHitCount, no rows, no nextRequest)");
  assert.match(msg, /^ERROR: some_tool/, "the ERROR: prefix is what the shared kernels key on — same inheritance as the unparseable case");
  assert.match(msg, /parsed but is NOT a search response/);
  assert.match(msg, /upstream search cluster unavailable/, "the envelope's own message travels with the refusal");
  assert.match(msg, /never be read as zero hits/);
});

// ══ RESIDUAL 1 — corsearch: the error-envelope false clean ═══════════════════════════════════════════

function installCorsearch(searchResponder) {
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/brand-json")) {
      return resp(JSON.stringify([...new URLSearchParams(init.body || "").getAll("uri")]
        .map((uri) => ({ uri, status: "Valid", classes: [9] }))));
    }
    return searchResponder(u);
  };
}
const nameClausesOf = (u) => [...String(u.searchParams.get("query") ?? "").matchAll(/name%3A|name:/g)].length;
const page = (total, rows = 0, tag = "r") => resp(JSON.stringify({
  totalHitCount: total, took: 1, nextRequest: null,
  rows: Array.from({ length: rows }, (_, i) => ({ score: 1, document: { uri: `/mark/ch/${tag}-${i}`, name: `${tag}${i}` } })),
}));

test("R1: the shape predicate discriminates on the search-response shape, not on parseability", () => {
  // The three marks of an answer, each sufficient alone (the real page carries all three or the
  // first two; a count-only page-0 carries totalHitCount with empty rows).
  assert.equal(corsearch.isSearchResponseBody({ totalHitCount: 0, rows: [], nextRequest: null }), true, "the honest empty page IS an answer");
  assert.equal(corsearch.isSearchResponseBody({ totalHitCount: 412, rows: [] }), true);
  assert.equal(corsearch.isSearchResponseBody({ rows: [] }), true, "rows without a count is still the provider answering with rows");
  assert.equal(corsearch.isSearchResponseBody(ENVELOPE), false, "an error envelope is valid JSON and NOT an answer");
  assert.equal(corsearch.isSearchResponseBody(null), false);
  assert.equal(corsearch.isSearchResponseBody([]), false);
});

test("R1: doSearch refuses a 200 whose parseable body is not a search response", async () => {
  installCorsearch(() => envelope());
  const out = await corsearch.doSearch("k", { name: "ACME" }, { sessionKey: "s-r1-search" });
  assert.ok(isError(out), "an envelope is a refusal, not total_hits 0");
  assert.match(out.text, /parsed but is NOT a search response/);
  assert.match(out.text, /upstream search cluster unavailable/);
});

test("R1: the normalizer's second lock — a non-answer body normalizes to total_hits NULL, never 0", () => {
  const out = corsearch.normalizeSearchResponse(ENVELOPE, "name:`ACME`", "default");
  assert.equal(out.total_hits, null, "unknown, not a minted zero — for any future caller that normalizes directly");
  // …and the honest empty page is untouched, byte-for-byte the old happy path.
  const honest = corsearch.normalizeSearchResponse({ totalHitCount: 0, rows: [], nextRequest: null, took: 1 }, "name:`ACME`", "default");
  assert.equal(honest.total_hits, 0);
  assert.deepEqual(honest.results, []);
});

test("R1: Stage 0.5 — an envelope answer is UNKNOWN, never a counted zero (and a real zero still counts)", async () => {
  installCorsearch(() => envelope());
  const c = await corsearch.doCountHits("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-r1-count" });
  assert.equal(c.ok, false, "the provider did not answer, so nothing was counted");
  assert.equal(c.total, null, "null — a 0 here would read as 'no filings found'");
  assert.match(String(c.reason), /NOT a search response|upstream search cluster/i);

  corsearch.__resetSearchCache();
  installCorsearch(() => page(0, 0));
  const honest = await corsearch.doCountHits("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-r1-count" });
  assert.deepEqual(honest, { ok: true, total: 0, probe: "cheap", reason: null }, "a REAL zero is untouched");
});

test("R1: doEnumerate over an envelope is incomplete-with-a-why, never state:enumerated/0", async () => {
  installCorsearch(() => envelope());
  const out = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-r1-enum" }));
  assert.equal(out.state, "incomplete", "there is no band here to have exhausted");
  assert.match(String(out.reason), /provider error/i, "the token execute-plan's providerErrored() keys on → error:true → MISSING");
  assert.match(String(out.reason), /NOT a search response/i);
});

// ══ RESIDUAL 2 — the kernel guards, now LIVE ═════════════════════════════════════════════════════════
//
// Both kernels carry a defense-in-depth check on `Number.isFinite(parsed.total_hits)`, advertised as
// not depending "on every future adapter remembering". Before this round the only countProbe:"cheap"
// adapter ALWAYS emitted a numeric total_hits, so neither guard could ever fire. The corsearch
// normalizer now emits null for a non-answer — these tests drive each guard with the REAL normalizer
// output, proving the guards are live, plus a plain stub for the general non-finite case.

test("R2: the count kernel's isFinite guard FIRES on the real normalizer's non-answer output", async () => {
  // A stub adapter that forgot the doSearch refusal and normalized an envelope directly — exactly the
  // "future adapter" the guard exists for. The payload is the REAL corsearch normalizer's output.
  const normalized = corsearch.normalizeSearchResponse(ENVELOPE, "name:`ACME`", "default");
  assert.equal(normalized.total_hits, null, "precondition: the normalizer emits null for a non-answer");
  const count = makeCountProbe({
    search: async () => ({ type: "text", text: JSON.stringify(normalized) }),
    capabilities: { countProbe: "cheap" },
  });
  const r = await count("auth", { name: "ACME" }, {});
  assert.equal(r.ok, false, "the kernel guard caught what the adapter let through");
  assert.equal(r.total, null);
  assert.match(String(r.reason), /no usable total_hits/);

  // The same guard on a bare non-finite stub — the general case, independent of any normalizer.
  const nonFinite = makeCountProbe({
    search: async () => ({ type: "text", text: JSON.stringify({ total_hits: null, results: [] }) }),
    capabilities: { countProbe: "cheap" },
  });
  const n = await nonFinite("auth", {}, {});
  assert.equal(n.ok, false);
  assert.equal(n.total, null, "a non-finite total_hits is not a count");
});

test("R2: the enumerate kernel's isFinite guard FIRES on the real normalizer's non-answer output", async () => {
  const normalized = corsearch.normalizeSearchResponse(ENVELOPE, "name:`ACME`", "default");
  const { enumerate } = makeEnumerate({
    search: async () => ({ type: "text", text: JSON.stringify(normalized) }),
    screen: async () => ({ type: "text", text: JSON.stringify({ rows: [] }) }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete", "no completeness claim in either direction — not a crowd, above all not a clean");
  assert.equal(out.total_hits, null, "UNKNOWN — never a fabricated 0");
  assert.match(String(out.reason), /no usable total_hits/);
  assert.match(String(out.reason), /provider error/i, "framed so execute-plan stamps the slice error:true → MISSING");
});

// ══ RESIDUAL 3 — the count-first rescues, at the rescue level ════════════════════════════════════════

test("R3: a term whose per-term probe answers an error envelope is `error`, NEVER `verified-zero`", async () => {
  // The stack crowds (page-0 total over the ceiling) → the rescue runs → every per-term probe comes
  // back 200 + envelope. Before the fix each term was probed as 0 and dispositioned verified-zero —
  // "deterministic true-0, tool-derived" — which flows to the coverage ledger as confirmed-clean.
  installCorsearch((u) => (nameClausesOf(u) > 1 ? page(9999, 0, "stack") : envelope()));
  const out = parse(await corsearch.doEnumerate("k", { names: ["ALPHA", "BETA"], nice_classes: [9] }, { sessionKey: "s-r3-term" }));

  assert.equal(out.state, "incomplete", "a stack whose per-term truth could not be taken is not a band");
  for (const t of ["ALPHA", "BETA"]) {
    assert.ok(out.term_counts?.[t], `${t} is accounted for — a term must never vanish`);
    assert.notEqual(out.term_counts[t].disposition, "verified-zero",
      `${t}'s probe was ANSWERED WITH AN ERROR ENVELOPE; calling that a verified zero is the exact false clean this residual is about`);
    assert.equal(out.term_counts[t].disposition, "error");
    assert.equal(out.term_counts[t].total_hits, null, "unknown, not 0");
  }
  assert.match(String(out.reason), /2 error/, "the descriptor's tally names the unresolved terms");

  // The control: a genuinely empty term still earns verified-zero, because it was genuinely probed.
  corsearch.__resetSearchCache();
  installCorsearch((u) => (nameClausesOf(u) > 1 ? page(9999, 0, "stack") : page(0, 0)));
  const honest = parse(await corsearch.doEnumerate("k", { names: ["ALPHA", "BETA"], nice_classes: [9] }, { sessionKey: "s-r3-term" }));
  assert.equal(honest.term_counts.ALPHA.disposition, "verified-zero", "a PROBED zero is still a true zero");
});

test("R3: the per-CLASS rescue inherits the same rule over an envelope", async () => {
  installCorsearch((u) => (String(u.searchParams.get("query") ?? "").match(/nice-class/g)?.length > 1
    ? page(9999, 0, "stack") : envelope()));
  const out = parse(await corsearch.doEnumerate("k",
    { owner: "MEGACORP", nice_classes: [9, 25] }, { sessionKey: "s-r3-class" }));
  assert.equal(out.state, "incomplete");
  for (const c of ["9", "25"]) {
    assert.equal(out.class_counts?.[c]?.disposition, "error", `class ${c}'s probe was an envelope — that is not an empty leg`);
    assert.equal(out.class_counts[c].total_hits, null);
  }
});

// ══ RESIDUAL 4 — the missed sites in the files edited ═══════════════════════════════════════════

test("R4: a corsearch brand-json chunk answering an envelope is a chunk ERROR, not zero silent rows", async () => {
  // Before: a parseable non-array body contributed zero rows and pushed NOTHING into errors[] — a
  // failed chunk indistinguishable from records the provider had no screening facts for, invisible to
  // the kernel's contentFromScreen seam.
  global.fetch = async () => envelope();
  const out = await corsearch.doBatchScreen("k", { uris: ["/mark/ch/a"], in_scope_classes: [9] }, { sessionKey: "s-r4-screen" });
  assert.ok(isError(out), "no rows and a failed chunk is an error, not an empty screen");
  assert.match(out.text, /non-answer body/);
  assert.match(out.text, /upstream search cluster unavailable/);
});

test("R4: clarivate /filingdate — a non-answer can never become a freshness claim of 'nothing to report'", async () => {
  const KEY = "k";
  const BASE = "https://api.clarivate.com/compumark-content/api/v1";
  // Truncated 200 → refuse (this site had NO parseError check at all).
  global.fetch = async () => resp('{"filingDates":[{"registrationOff');
  const cut = await clarivate.doFilingDate(KEY, BASE, { regions: ["CH"] }, {});
  assert.ok(isError(cut), 'a truncated 200 used to return {"count":0,"registers":[]}');
  assert.match(cut.text, /UNPARSEABLE/);
  // Parseable error envelope (this provider's own error shape) → refuse on shape.
  global.fetch = async () => resp(JSON.stringify({ errorMessage: "service temporarily unavailable" }));
  const env = await clarivate.doFilingDate(KEY, BASE, { regions: ["CH"] }, {});
  assert.ok(isError(env));
  assert.match(env.text, /NOT a filing-date response/);
  assert.match(env.text, /service temporarily unavailable/);
  // Control: the REAL captured /filingdate response still answers, unchanged.
  global.fetch = async () => resp(clarivateFixtureRaw("clarivate-filingdate"));
  const real = parse(await clarivate.doFilingDate(KEY, BASE, { regions: ["CH"] }, {}));
  assert.ok(real.count >= 1, "the real captured response still reports per-register freshness");
  assert.ok(real.registers[0].record_last_updated, "with its recordLastUpdated intact");
});

test("R4: clarivate /image — a call that did not land is an error row, never 'this record has no image'", async () => {
  const KEY = "k";
  const BASE = "https://api.clarivate.com/compumark-content/api/v1";
  // Truncated 200 → an error row (it used to become has_image:false via `r.body ?? {}`).
  global.fetch = async () => resp('{"images":[{"contentTy');
  const cut = parse(await clarivate.doImageFetch(KEY, BASE, { record_ids: ["/mark/ch/g1"] }, {}));
  assert.equal(cut.results.length, 1);
  assert.match(String(cut.results[0].error), /unparseable body/);
  assert.match(String(cut.results[0].error), /NOT "no image"/);
  assert.equal(cut.results[0].images, undefined, "no fabricated image summary");
  // Parseable envelope → an error row on shape.
  global.fetch = async () => resp(JSON.stringify({ errorMessage: "image service unavailable" }));
  const env = parse(await clarivate.doImageFetch(KEY, BASE, { record_ids: ["/mark/ch/g1"] }, {}));
  assert.match(String(env.results[0].error), /non-answer body/);
  assert.match(String(env.results[0].error), /image service unavailable/);
});

test("R4: clarivate /text — an envelope is a failed chunk, never ONE fabricated all-null record", async () => {
  const KEY = "k";
  const BASE = "https://api.clarivate.com/compumark-content/api/v1";
  // Before: {"errorMessage":…} fell through `[r.body]` → normalizeRecord → a "record" with every
  // field null, persisted for the citation gate and counted as a returned row.
  global.fetch = async () => resp(JSON.stringify({ errorMessage: "text service unavailable" }));
  const rf = await clarivate.doRecordFetch(KEY, BASE, { record_ids: ["/mark/ch/g1"] }, {});
  assert.ok(isError(rf), "a non-answer chunk with no sibling successes is a tool error");
  assert.match(rf.text, /non-answer body/);
  const bs = await clarivate.doBatchScreen(KEY, BASE, { uris: ["/mark/ch/g1"], in_scope_classes: [9] }, {});
  assert.ok(isError(bs), "the batch screen shares fetchText and inherits the same refusal");
  // Control: the probe-shaped /text response still normalizes to its records, and an
  // all-nonTrademarks answer is an ANSWER with zero trademark rows, not a failure.
  const real = JSON.parse(clarivateFixtureRaw("clarivate-text-10"));
  global.fetch = async () => resp(clarivateFixtureRaw("clarivate-text-10"));
  const ok = parse(await clarivate.doRecordFetch(KEY, BASE, { record_ids: ["/mark/ch/g1"], test_mode: true }, {}));
  assert.equal(ok.count, real.trademarks.length, "the fixture response still yields its own record count");
  global.fetch = async () => resp(JSON.stringify({ trademarks: [], nonTrademarks: [{ id: "g1" }] }));
  const nonTm = parse(await clarivate.doBatchScreen(KEY, BASE, { uris: ["/mark/ch/g1"], in_scope_classes: [9], test_mode: true }, {}));
  assert.equal(nonTm.returned, 0, "zero trademark rows");
  assert.equal(nonTm.errors, undefined, "…and NO chunk error — a provider fact, not a failure");
});

// ══ RESIDUAL 1 APPLIED SIDEWAYS — the clarivate and signa search normalizers ═════════════════════════

test("clarivate: a 200 carrying the provider's own error envelope is a refusal, not an empty ids{}", async () => {
  const KEY = "k";
  const BASE = "https://api.clarivate.com/compumark-content/api/v1";
  const params = { name: "ACME", regions: ["CH"], nice_classes: [9] };
  global.fetch = async () => resp(JSON.stringify({ errorMessage: "search backend unavailable" }));
  const s = await clarivate.doSearch(KEY, BASE, params, {});
  assert.ok(isError(s), "zero guids from an envelope must not read as an answered search");
  assert.match(s.text, /NOT a search response/);
  // The normalizer's second lock.
  assert.equal(clarivate.normalizeSearchResponse({ errorMessage: "x" }, "ACME", "default").total_hits, null);
  assert.equal(clarivate.isSearchResponseBody({ ids: {} }), true, "an empty ids{} is the provider answering: nothing");
  assert.equal(clarivate.isSearchResponseBody({ errorMessage: "x" }), false);
  // Control: the probe-shaped /search response still normalizes to its own guid count.
  global.fetch = async () => resp(clarivateFixtureRaw("clarivate-ids"));
  const guids = Object.values(JSON.parse(clarivateFixtureRaw("clarivate-ids")).ids).flat().length;
  assert.equal(parse(await clarivate.doSearch(KEY, BASE, params, {})).total_hits, guids);
});

test("signa: the provider with NO second net refuses the envelope at the source too", async () => {
  global.fetch = async () => envelope();
  const out = await signa.doSearch("k", signa.DEFAULT_BASE, { query: "ACME" }, {});
  assert.ok(isError(out), "no data[] is not zero trademarks");
  assert.match(out.text, /NOT a search response/);
  assert.match(out.text, /upstream search cluster unavailable/);
  // The normalizer's second lock, and the honest control.
  assert.equal(signa.normalizeSearchResponse(ENVELOPE, "ACME").total_hits, null, "a non-answer is UNKNOWN");
  //: an honest empty page is one carrying the vendor's own exact zero, which is what the wire
  // returns for a band nobody has filed in. A body with `data: []` and no pagination block is not that
  // — pagination is required on every response, and under countProbe "cheap" the response IS the count,
  // so a body that did not answer the count question must not be read as having answered it zero.
  assert.equal(signa.normalizeSearchResponse({ data: [] }, "ACME").total_hits, null,
    "no pagination block ⇒ the count went unanswered, and unanswered is not empty");
  const emptyPage = { data: [], has_more: false, search_meta: {}, pagination: { cursor: null, total_count: 0, total_count_approximate: false } };
  assert.equal(signa.normalizeSearchResponse(emptyPage, "ACME").total_hits, 0, "an honest empty page still says 0");
});

// ══ RESIDUAL 5 — euipo ═══════════════════════════════════════════════════════════════════════════════

test("euipo: an RFC-7807 problem served with a 200 is a refusal, not an empty register page", async () => {
  // This API's documented error shape (see errorText in the client). Parses fine; answers nothing.
  global.fetch = async (url) => (String(url).includes("accessToken")
    ? resp(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : resp(JSON.stringify({ type: "about:blank", title: "Service Unavailable", status: 503, detail: "search backend down" })));
  const out = await euipo.euipoSearch({ clientId: "c", clientSecret: "s", environment: "sandbox" }, { name: "ACME" });
  assert.ok(isError(out), "totalElements:null with results:[] is what a model reads as 'nothing is registered'");
  assert.match(out.text, /NOT a search response/);
  assert.match(out.text, /search backend down/);

  // Control — the spec's TrademarkSearchResponse shape (no sandbox capture exists in-repo; the client
  // is built against the published OpenAPI spec and this is that schema's empty page): an honest empty
  // register page still answers 0.
  global.fetch = async (url) => (String(url).includes("accessToken")
    ? resp(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : resp(JSON.stringify({ totalElements: 0, totalPages: 0, page: 0, size: 25, trademarks: [] })));
  const honest = parse(await euipo.euipoSearch({ clientId: "c", clientSecret: "s", environment: "sandbox" }, { name: "ACME" }));
  assert.equal(honest.total_elements, 0, "an honest zero still reads as a counted zero");
  assert.deepEqual(honest.results, []);
  assert.equal(honest.environment, "sandbox", "#409: the response must name which host answered, sandbox or production");
});

// ══ audit item 5b — counted-but-rowless: a body that PARSES, carries the SHAPE, and still contradicts itself ══
//
// {"totalHitCount":3,"rows":[]} passes every lock above — it parses, and it IS the search-response
// shape — yet it asserts two incompatible things at once: three records exist, and here are none of
// them. On the "cheap" seam the endpoint-only count/search divergence check never ran, so this body
// minted state:"enumerated" with 0 records: a confident clean over a band the provider had just said
// was populated. Under the ceiling every counted row is owed.
test("cheap seam: a counted-but-rowless body is a divergence incomplete, never enumerated/0", async () => {
  installCorsearch(() => page(3, 0));
  const out = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-a5b-rowless" }));
  assert.equal(out.state, "incomplete", "three counted, zero delivered — that is not a completed band");
  assert.match(String(out.reason), /count\/search divergence/);
  assert.match(String(out.reason), /provider error/i,
    "the token execute-plan's providerErrored() keys on → error:true → the slice joins MISSING");
  assert.equal(out.total_hits, 3, "the provider's own count is KEPT as evidence — never erased, never a 0");

  // Control 1: an honestly empty register still answers clean — crying wolf on real emptiness is its own defect.
  corsearch.__resetSearchCache();
  installCorsearch(() => page(0, 0));
  const zero = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-a5b-zero" }));
  assert.equal(zero.state, "enumerated");
  assert.equal(zero.total_hits, 0);

  // Control 2: a body whose rows match its count keeps enumerating exactly as before.
  corsearch.__resetSearchCache();
  installCorsearch(() => page(2, 2));
  const whole = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s-a5b-whole" }));
  assert.equal(whole.state, "enumerated");
  assert.equal(whole.count, 2);
});
