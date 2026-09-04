// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// AN ABSENT BODY IS NOT A COUNTED ZERO — the regression lane for issue, across every provider.
//
// ── what this guards ─────────────────────────────────────────────────────────────────────────────────
//
// A 200 whose body is truncated (a proxy cut, a connection reset mid-body, a gateway answering 200 with
// an error page) used to be swallowed by three characters of tolerance in every adapter's HTTP helper:
//
//     try { parsed = JSON.parse(raw); } catch (_) { /* non-JSON */ }
//
// `body` stayed null, the failure was never reported, and the normalizer downstream turned null into
// `{ total_hits: 0, results: [] }`. The tool then answered `{"state":"enumerated","total_hits":0,
// "records":[]}` — a confident, well-formed, complete "this mark is free" over a query that never
// landed. `isToolError` was false and the payload parsed, so nothing downstream could catch it. That is
// the most expensive artifact this system can produce: not a run that failed, a run that answered wrong.
//
// ── why the fault lane next door is not enough ───────────────────────────────────────────────────────
//
// The adapter's own fault lane pins the top of the funnel: doEnumerate over a truncated 200 must not
// read `enumerated`. But the fabricated zero was INHERITED, and each inheritor is reached
// by a different call path that lane never walks:
//
//   · doCountHits (Stage 0.5) — contract: "`total` is a number ONLY when ok; never a zero on failure".
//     A fabricated 0 satisfied `ok:true` and shipped as a counted answer.
//   · countFirstRescue — INVARIANT: "a populated term can never be recorded 0". A truncated probe
//     dispositioned a populated term `verified-zero`, described in that kernel as "deterministic true-0,
//     tool-derived". driver/register-plan.mjs counts verified-zero among its RESOLVED dispositions, so
//     the clean-gate passes; driver/crowd-context.mjs turns a zero count into
//     `{ enumerated: true, records: [] }` ("the count IS the enumeration"). The zero does not merely
//     survive to the report — it is PROMOTED into a positively asserted clean.
//   · the other three adapters, which have the same swallow and their own normalizers.
//
// ── on the payloads below ────────────────────────────────────────────────────────────────────────────
//
// The clarivate truncations are byte-prefixes of a response of this shape — a cut of a real shape,
// which is what a truncation is, with every identity in it substituted (; the envelope, the field
// grammar and the byte offsets are the probe's). For the rest the payload's CONTENT is deliberately not
// load-bearing and cannot be:
// the whole subject of this file is a body that does not parse, so there is no content to be faithful
// to. What is faithful is the SHAPE of the failure — status 200, `res.ok` true, JSON that stops
// mid-token — and that is taken from the live shape the fault lane already uses.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Redirect the ledgers BEFORE importing any core — both paths are captured at module load.
const TMP = mkdtempSync(join(tmpdir(), "absent-body-"));
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

const { parseJsonBody, unparsedBodyError } = await import("../http-body.mjs");
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
// The live truncation shape: status 200, ok true, JSON that stops mid-token. Identical to the one the
// corsearch fault lane drives, so the two files describe the same fault.
const CUT = '{"totalHitCount":40,"rows":[{"score":1,';
const truncated = () => resp(CUT);
// A byte-prefix of a probe response — the same cut applied to a genuine artifact's bytes.
const truncatedFixture = (name, bytes) => resp(clarivateFixtureRaw(name).slice(0, bytes));

// ══ the helper itself ═══════════════════════════════════════════════════════════════════════════════

test("the shared parser KEEPS the failure instead of swallowing it", () => {
  const good = parseJsonBody('{"totalHitCount":3,"rows":[]}');
  assert.deepEqual(good.body, { totalHitCount: 3, rows: [] });
  assert.equal(good.parseError, null, "a body that parsed reports no error — the happy path is untouched");

  const cut = parseJsonBody(CUT);
  assert.equal(cut.body, null, "`body` keeps its old value, so every existing r.body?.… reader is unchanged");
  assert.ok(cut.parseError, "…but the failure is now a FACT the caller can act on");
  assert.match(cut.parseError, /bytes read/, "and it carries the byte count — a truncation reads differently from an error page");

  // An EMPTY body is unparseable by design: a zero-byte 200 is a cut connection or a gateway stub.
  // An empty RESULT SET is `{"rows":[]}` — a body, which parses, and which this correctly accepts.
  assert.ok(parseJsonBody("").parseError, "a zero-byte 200 is a failure, not an empty result set");
  assert.equal(parseJsonBody('{"rows":[]}').parseError, null, "an honestly empty result set still parses");

  // The refusal sentence is provider-NEUTRAL: the caller names its own tool, so a reader (or a grep)
  // meets the same failure whichever register is wired in.
  const msg = unparsedBodyError("some_tool", { status: 200, parseError: "Unexpected end of JSON input (38 bytes read)" });
  assert.match(msg, /^ERROR: some_tool/);
  assert.match(msg, /ABSENT body is not an empty one/);
});

// ══ corsearch — the inherited paths the fault lane does not reach ════════════════════════════════════

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

test("the Stage 0.5 count probe: a truncated 200 is UNKNOWN, never a counted zero", async () => {
  installCorsearch(() => truncated());
  const c = await corsearch.doCountHits("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s" });
  // The contract on doCountHits, verbatim: "`total` is a number ONLY when ok; never a zero on failure."
  assert.equal(c.ok, false, "a count that could not be taken is not ok");
  assert.equal(c.total, null, "null — a number here would be indistinguishable from 'no filings found'");
  assert.match(String(c.reason), /unparseable|no usable total/i, "and it says why");

  // The control, and the reason this cannot be solved by making the probe pessimistic: a register that
  // genuinely holds nothing must still be able to SAY nothing, and be believed.
  corsearch.__resetSearchCache();
  installCorsearch(() => page(0, 0));
  const honest = await corsearch.doCountHits("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s" });
  assert.deepEqual(honest, { ok: true, total: 0, probe: "cheap", reason: null }, "a REAL zero is untouched");
});

test("the count-first per-term rescue: a term whose probe was cut is `error`, NEVER `verified-zero`", async () => {
  // The stack crowds (page-0 total over the ceiling), which is what triggers the rescue; then every
  // per-term probe comes back truncated. Before the fix each term was probed as 0 and dispositioned
  // verified-zero — "deterministic true-0, tool-derived" — which driver/register-plan.mjs counts among
  // its RESOLVED dispositions, so a stack of populated terms passed the clean-gate with nothing behind it.
  installCorsearch((u) => (nameClausesOf(u) > 1 ? page(9999, 0, "stack") : truncated()));
  const out = parse(await corsearch.doEnumerate("k", { names: ["ALPHA", "BETA"], nice_classes: [9] }, { sessionKey: "s" }));

  assert.equal(out.state, "incomplete", "a stack whose per-term truth could not be taken is not a band");
  for (const t of ["ALPHA", "BETA"]) {
    assert.ok(out.term_counts?.[t], `${t} is accounted for — a term must never vanish`);
    assert.notEqual(out.term_counts[t].disposition, "verified-zero",
      `${t}'s probe FAILED; calling that a verified zero is the false clean this whole issue is about`);
    assert.equal(out.term_counts[t].disposition, "error");
    assert.equal(out.term_counts[t].total_hits, null, "unknown, not 0");
  }
  assert.match(String(out.reason), /2 error/, "the descriptor's tally names the unresolved terms");

  // The control: a genuinely empty term still earns verified-zero, because it was genuinely probed.
  corsearch.__resetSearchCache();
  installCorsearch((u) => (nameClausesOf(u) > 1 ? page(9999, 0, "stack") : page(0, 0)));
  const honest = parse(await corsearch.doEnumerate("k", { names: ["ALPHA", "BETA"], nice_classes: [9] }, { sessionKey: "s" }));
  assert.equal(honest.term_counts.ALPHA.disposition, "verified-zero", "a PROBED zero is still a true zero");
});

test("the count-first per-CLASS rescue inherits the same rule", async () => {
  installCorsearch((u) => (String(u.searchParams.get("query") ?? "").match(/nice-class/g)?.length > 1
    ? page(9999, 0, "stack") : truncated()));
  const out = parse(await corsearch.doEnumerate("k",
    { owner: "MEGACORP", nice_classes: [9, 25] }, { sessionKey: "s" }));
  assert.equal(out.state, "incomplete");
  for (const c of ["9", "25"]) {
    assert.equal(out.class_counts?.[c]?.disposition, "error", `class ${c}'s probe was cut — that is not an empty leg`);
    assert.equal(out.class_counts[c].total_hits, null);
  }
});

test("a cut brand-json chunk is a screen ERROR, not a chunk with nothing to say", async () => {
  // Before: a truncated 200 contributed zero rows and pushed NOTHING into errors[], so a failed chunk
  // was indistinguishable from records the provider had no screening facts for. The kernel's
  // contentFromScreen seam decides on errors[], so on a guid-only provider that is a band of nameless
  // ids reported as fully screened.
  global.fetch = async () => truncated();
  const out = await corsearch.doBatchScreen("k", { uris: ["/mark/ch/a"], in_scope_classes: [9] }, { sessionKey: "s" });
  assert.ok(isError(out), "no rows and a failed chunk is an error, not an empty screen");
  assert.match(out.text, /unparseable/i);
});

test("a cut record body is refused rather than persisted as a record with no facts", async () => {
  global.fetch = async () => truncated();
  const out = await corsearch.doRecordFetch("k", { record_id: "/mark/ch/abc" }, { sessionKey: "s" });
  assert.ok(isError(out), "half a record is not a record");
  assert.match(out.text, /ABSENT body/);
});

test("a cut phoneme expansion does not read as 'this word has no sound-alikes'", async () => {
  global.fetch = async () => truncated();
  const out = await corsearch.doExpandPhoneme("k", { word: "ACME" }, { sessionKey: "s" });
  assert.ok(isError(out), "an empty variant list would silently NARROW every phonetic sweep built on it");
});

// ══ the kernels, independently of any adapter ════════════════════════════════════════════════════════

test("the enumerate kernel refuses to mint `enumerated` off a response with no usable total", async () => {
  // The second lock, at the place the verdict is actually minted: on the "cheap" seam the response IS
  // the count, so without a total the ceiling cannot be tested and no completeness claim is available —
  // in either direction. The adapters refuse first; this does not depend on them remembering to.
  const { enumerate } = makeEnumerate({
    search: async () => ({ type: "text", text: JSON.stringify({ results: [], has_more: false }) }),
    screen: async () => ({ type: "text", text: JSON.stringify({ rows: [] }) }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete");
  assert.equal(out.total_hits, null, "unknown — never a fabricated 0");
  assert.match(out.reason, /provider error/i, "framed so execute-plan stamps the slice error:true → MISSING");
});

// ══ the other providers — same swallow, same normalizers, same false clean ═══════════════════════════

test("clarivate: a cut /search and a cut /count both refuse", async () => {
  const KEY = "k";
  const BASE = "https://api.clarivate.com/compumark-content/api/v1";
  const params = { name: "ACME", regions: ["CH"], nice_classes: [9] };

  // /count cut → the probe is not ok, so enumerate never even searches.
  global.fetch = async () => truncatedFixture("clarivate-count", 8);
  const c = await clarivate.doCount(KEY, BASE, params, {});
  assert.equal(c.ok, false);
  assert.equal(c.total, null, "null, not 0");
  assert.match(String(c.reason), /unparseable/i);

  // /count honest, /search cut → the search refuses, so the band is incomplete rather than a band of
  // zero guids stamped enumerated.
  global.fetch = async (url) => (String(url).endsWith("/count")
    ? resp(clarivateFixtureRaw("clarivate-count"))
    : truncatedFixture("clarivate-ids", 40));
  const s = await clarivate.doSearch(KEY, BASE, params, {});
  assert.ok(isError(s), "a cut /search is an error, not an empty ids{}");
  const out = parse(await clarivate.doEnumerate(KEY, BASE, params, {}));
  assert.notEqual(out.state, "enumerated");
  assert.match(String(out.reason), /provider error/i);

  // Control: the WHOLE response still normalizes to its own guid count, unchanged.
  global.fetch = async () => resp(clarivateFixtureRaw("clarivate-ids"));
  const guids = Object.values(JSON.parse(clarivateFixtureRaw("clarivate-ids")).ids).flat().length;
  assert.equal(parse(await clarivate.doSearch(KEY, BASE, params, {})).total_hits, guids,
    "the whole fixture response still normalizes to its own count");
});

test("signa: the provider with NO second net refuses at the source", async () => {
  // The shortest path in the codebase from a cut connection to a clean: with countProbe "none" there is
  // no count to contradict an empty search, so an unparsed 200 normalized to zero rows, has_more false —
  // the page loop simply ENDED and the band walked out enumerated with no error anywhere in its path.
  global.fetch = async () => truncated();
  const out = await signa.doSearch("k", signa.DEFAULT_BASE, { query: "ACME" }, {});
  assert.ok(isError(out), "a cut body is an error, not zero trademarks");
  assert.match(out.text, /ABSENT body/);

  const rec = await signa.doRecordFetch("k", signa.DEFAULT_BASE, { record_id: "/mark/ch/abc" }, {});
  assert.ok(isError(rec), "and half a record is not an all-null record");

  // The normalizer's own second lock: an absent body reports the total UNKNOWN, never 0.
  assert.equal(signa.normalizeSearchResponse(null, "ACME").total_hits, null);

  // ── moved the line between "empty" and "unknown", and moved it the safe way ───────────────
  // `total_hits` used to be `data.length`, so ANY body carrying `data: []` said 0 — including a body
  // with no pagination block at all, which the vendor's schema marks REQUIRED on every response. That
  // shape is a malformed answer, and under `countProbe: "cheap"` the response IS the count, so calling
  // it zero is the false clean this file exists to close, one field further in.
  assert.equal(signa.normalizeSearchResponse({ data: [] }, "ACME").total_hits, null,
    "a body with no pagination block did not answer the count question — UNKNOWN, not zero");
  // …and the honest empty page, which is what the wire actually returns for a band nobody has filed
  // in: an exact 0, from the vendor's own counter.
  const emptyPage = { data: [], has_more: false, search_meta: {}, pagination: { cursor: null, total_count: 0, total_count_approximate: false } };
  assert.equal(signa.normalizeSearchResponse(emptyPage, "ACME").total_hits, 0, "an honest empty page still says 0");
  // The one that must never become a number: a saturated estimate. 10000 is a floor the vendor flags
  // as approximate, and it travels in a column that mints `enumerated` — so it rides out as unknown.
  const approx = { data: [], has_more: true, search_meta: {}, pagination: { cursor: "c", total_count: 10000, total_count_approximate: true } };
  assert.equal(signa.normalizeSearchResponse(approx, "ACME").total_hits, null, "an approximation is not a count");
  assert.equal(signa.normalizeSearchResponse(approx, "ACME").total_floor, 10000, "…but the floor is kept, not discarded");
});

test("euipo: a cut search page does not read as an empty register", async () => {
  global.fetch = async (url) => (String(url).includes("accessToken")
    ? resp(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : truncated());
  const out = await euipo.euipoSearch({ clientId: "c", clientSecret: "s", environment: "sandbox" }, { name: "ACME" });
  assert.ok(isError(out), "`r.body || {}` used to turn this into totalElements:null with results:[]");
  assert.match(out.text, /ABSENT body/);
});

// ══ the whole point, stated once ═════════════════════════════════════════════════════════════════════

test("across every provider: a cut body NEVER produces a zero, and an honest zero is never disturbed", async () => {
  installCorsearch(() => truncated());
  const cut = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s" }));
  assert.equal(cut.state, "incomplete", "never `enumerated` — there is no band here to have exhausted");
  // The zero this descriptor still carries is not a bare one: `provider error` is the token
  // execute-plan's providerErrored() probe keys on, so the slice is stamped error:true and joins
  // MISSING. That is the difference the whole issue turns on — a zero WITH a why.
  assert.match(String(cut.reason), /provider error/i, "the zero carries WHY it is zero");

  corsearch.__resetSearchCache();
  installCorsearch(() => page(0, 0));
  const honest = parse(await corsearch.doEnumerate("k", { name: "ACME", nice_classes: [9] }, { sessionKey: "s" }));
  assert.equal(honest.state, "enumerated", "an honestly empty band still enumerates…");
  assert.equal(honest.total_hits, 0, "…and still says 0, which is now a claim with a probe behind it");
  assert.deepEqual(honest.records, []);
});
