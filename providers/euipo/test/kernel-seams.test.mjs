// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The seams between this core and the shared kernels. OFFLINE — `fetch` is stubbed, so no
// credential and no network are involved.
//
// Everything here is in the FAILS-SILENTLY class. None of it throws when wrong: the band comes back
// well-formed, every stage reports success, and the defect surfaces as a short band or a permanent
// "presented unverified" caveat that no exit code explains.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The ledger captures its paths at MODULE LOAD, so they must be set before the core is imported.
const LEDGER_DIR = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "euipo-ledger-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(LEDGER_DIR, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(LEDGER_DIR, "records.jsonl");
process.env.EUIPO_CLIENT_ID = "test-client-id";
process.env.EUIPO_CLIENT_SECRET = "test-client-secret";
process.env.EUIPO_ENVIRONMENT = "sandbox";

const { doSearch, doRecordFetch, doEnumerate, doCountHits, PAGE_SIZE_MIN, SIZE_FALLBACK_AGREES, CAPABILITIES } = await import("../src/core.js");

const AUTH = { clientId: "test-client-id", clientSecret: "test-client-secret", environment: "sandbox" };
const TCTX = { kind: "test", agentId: "t", sessionKey: null, sessionId: null };

let realFetch, requests;

const item = (n, over = {}) => ({
  applicationNumber: String(n).padStart(9, "0"),
  wordMarkSpecification: { verbalElement: "ALPHA" },
  markFeature: "WORD", markKind: "INDIVIDUAL", markBasis: "EU_TRADEMARK",
  niceClasses: [9], status: "REGISTERED",
  applicants: [{ office: "EM", identifier: "1", name: "ACME GmbH" }],
  applicationDate: "2020-01-01", registrationDate: "2020-06-01",
  ...over,
});

/** Stub the API. `corpus` rows are served page by page, honouring whatever paging params arrive. */
function stubApi(corpus, { detail = null } = {}) {
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    requests.push({ url: u, params: Object.fromEntries(u.searchParams), init });
    if (u.pathname.endsWith("/oidc/accessToken")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 });
    }
    // detail record
    const m = /\/trademarks\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const rec = detail ?? corpus.find((r) => r.applicationNumber === decodeURIComponent(m[1]));
      return rec
        ? new Response(JSON.stringify(rec), { status: 200 })
        : new Response(JSON.stringify({ title: "Not Found", status: 404 }), { status: 404 });
    }
    // search — THE SEAM UNDER TEST. Reads `size` and `page`; a request that sends neither gets the
    // whole corpus on page 0, which is exactly how the wrong pageParams looks like it works.
    const size = Number(u.searchParams.get("size") ?? corpus.length);
    const page = Number(u.searchParams.get("page") ?? 0);
    const slice = corpus.slice(page * size, page * size + size);
    return new Response(JSON.stringify({
      trademarks: slice, totalElements: corpus.length,
      totalPages: Math.ceil(corpus.length / size), size, page,
    }), { status: 200 });
  };
}

beforeEach(() => { realFetch = globalThis.fetch; requests = []; });
afterEach(() => { globalThis.fetch = realFetch; });

const parse = (r) => JSON.parse(r.text);
const searchReqs = () => requests.filter((r) => !r.url.pathname.includes("accessToken") && !/\/trademarks\/[^/]+$/.test(r.url.pathname));

// ── pageParams: `{size, page}`, NOT the kernel default `{limit, page}` ────────────────────────────

test("every search sends `size`, and never `limit`", () => {
  // The kernel default emits `{limit, page}`. This API has no `limit`: it would be ignored, `size`
  // would sit at the server default, and because `page` still works the band comes back well-formed
  // and SHORT. Nothing anywhere reports a problem.
  stubApi([item(1)]);
  return doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX).then(() => {
    const r = searchReqs()[0];
    assert.ok("size" in r.params, `no size on the request: ${JSON.stringify(r.params)}`);
    assert.ok(!("limit" in r.params), "a `limit` param reached the wire — this API has no such knob");
  });
});

test("`size` is never below the API's floor of 10", async () => {
  // Below 10 EVERY request 400s, whatever the query — and a 400 on a request whose query you are
  // testing reads exactly like "the query is unsupported".
  stubApi([item(1)]);
  await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact", size: 1 }, TCTX);
  assert.ok(Number(searchReqs()[0].params.size) >= PAGE_SIZE_MIN, `size=${searchReqs()[0].params.size}`);
});

test("enumerate WALKS THE PAGES — a wrong pageParams re-returns page 0 forever", async () => {
  // The failure this pins: with `{limit, page}` the stub (and the real API) ignores the unknown key,
  // every page comes back identical, the kernel dedupes them to one page's worth and reports
  // state:"enumerated". A confident, complete-looking band holding a fraction of the register.
  // The corpus MUST exceed capabilities.kernel.pageSize (100) or nothing pages and the test passes
  // vacuously — which it did on the first cut, at 45 records.
  const corpus = Array.from({ length: 250 }, (_, i) => item(i + 1));
  stubApi(corpus);
  const out = parse(await doEnumerate(AUTH, { names: ["ALPHA"], match_mode: "exact", in_scope_classes: [9] }, TCTX));
  assert.equal(out.state, "enumerated");
  assert.equal(out.total_hits, 250);
  assert.equal(out.count, 250, "the band is short — paging did not advance");
  const pages = searchReqs().map((r) => Number(r.params.page));
  assert.ok(pages.length > 1, `only ${pages.length} page(s) requested for a 250-record band`);
  assert.ok(new Set(pages).size === pages.length, `the same page was requested twice: ${pages.join(",")}`);
});

test("every enumerated record carries a screen verdict", async () => {
  stubApi(Array.from({ length: 12 }, (_, i) => item(i + 1)));
  const out = parse(await doEnumerate(AUTH, { names: ["ALPHA"], match_mode: "exact", in_scope_classes: [9] }, TCTX));
  assert.equal(out.records.length, 12);
  for (const r of out.records) {
    assert.equal(typeof r.screen?.screen_verdict, "string", `no verdict on ${r.record_id}`);
  }
});

// ── the count probe's `cheapCountParams` ──────────────────────────────────────────────────────────

test("the count probe asks for the SMALLEST legal page, not a full one", async () => {
  // Pinned at EQUALS, not >=. The >= form passed with the override deleted (clampSize falls back to
  // 100), so it tested nothing — the break matrix caught that. This is a cost invariant, not a
  // correctness one: without it every count-first probe drags 100 full records back to read one
  // integer off the envelope, and that rescue fires per term AND per class.
  stubApi([item(1), item(2)]);
  const c = await doCountHits(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  assert.equal(c.ok, true);
  assert.equal(c.total, 2);
  assert.equal(Number(searchReqs()[0].params.size), PAGE_SIZE_MIN,
    "the count probe is fetching a full page to read one integer");
  assert.ok(!("fields" in searchReqs()[0].params));
});

test("clampSize's fallback IS the kernel page size — two defaults that must never drift", async () => {
  // `doSearch` owns the wire `size`, and the kernel decides how far to advance `page`. While the two
  // numbers agree, either can be read as the page size. If one moved alone, the kernel would step by
  // one size while the API returned another, and every page would overlap or skip — silently.
  assert.equal(SIZE_FALLBACK_AGREES, CAPABILITIES.kernel.pageSize);
  const corpus = Array.from({ length: 250 }, (_, i) => item(i + 1));
  stubApi(corpus);
  await doEnumerate(AUTH, { names: ["ALPHA"], match_mode: "exact", in_scope_classes: [9] }, TCTX);
  const sizes = new Set(searchReqs().map((r) => Number(r.params.size)));
  assert.deepEqual([...sizes], [CAPABILITIES.kernel.pageSize],
    `enumerate paged at more than one size: ${[...sizes].join(", ")}`);
});

test("a count that could not be taken is NULL, never 0", async () => {
  globalThis.fetch = async (url) => (String(url).includes("accessToken")
    ? new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 })
    : new Response(JSON.stringify({ title: "Bad Request", status: 400 }), { status: 400 }));
  const c = await doCountHits(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  assert.equal(c.ok, false);
  assert.equal(c.total, null, "a failed count produced a number");
});

// ── THE BODY LEDGER — the citation-fidelity gate reads THIS, not the call log ─────────────────────

test("record_fetch writes the record BODY to the ledger, not only the call", () => {
  // Forgetting this costs nothing that announces itself. registry-fidelity.mjs finds records by
  // reading the BODY ledger; with only call lines it has nothing to compare, so it does not fail —
  // it stamps the finding `unverified` and appends "presented unverified" to every EU card, forever,
  // with no test and no exit code saying why.
  stubApi([item(1)]);
  return doRecordFetch(AUTH, { record_id: "/mark/eu/000000001" }, TCTX).then(() => {
    const p = process.env.CLEAROTRON_REGISTER_RECORD_LOG;
    assert.ok(existsSync(p), "no body ledger was written at all");
    const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const ours = lines.filter((l) => l.provider === "euipo");
    assert.ok(ours.length > 0, "the body ledger carries no euipo line");
    const last = ours[ours.length - 1];
    assert.equal(last.target, "/mark/eu/000000001", "the body line is not keyed by the cited uri");
    assert.equal(last.body.applicationNumber, "000000001");
    assert.equal(last.body.provider, "euipo");
  });
});

test("the call ledger carries a euipo discriminator on every call", async () => {
  stubApi([item(1)]);
  await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  const lines = readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.provider === "euipo"), "no euipo line in the call ledger — this source is invisible to the provider-usage diff");
});

test("the ledger NEVER carries the credential", async () => {
  stubApi([item(1)]);
  await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  await doRecordFetch(AUTH, { record_id: "/mark/eu/000000001" }, TCTX);
  const all = [process.env.CLEAROTRON_REGISTER_CALL_LOG, process.env.CLEAROTRON_REGISTER_RECORD_LOG]
    .filter(existsSync).map((p) => readFileSync(p, "utf8")).join("");
  assert.ok(!all.includes("test-client-secret"), "the client secret reached the ledger");
  assert.ok(!all.includes("test-client-id"), "the client id reached the ledger");
});

// ── BOTH auth headers ─────────────────────────────────────────────────────────────────────────────

test("every API call carries the Bearer token AND X-IBM-Client-Id", async () => {
  // An IBM API Connect gateway sits in front. Sending only the token 401s every call — a mistake
  // already made once against this API.
  stubApi([item(1)]);
  await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  const r = searchReqs()[0];
  assert.equal(r.init.headers.Authorization, "Bearer tok");
  assert.equal(r.init.headers["X-IBM-Client-Id"], "test-client-id");
});

// ── non-answers never become empty registers ──────────────────────────────────────────────────────

test("a 200 carrying an RFC-7807 problem is refused, not read as an empty register", async () => {
  globalThis.fetch = async (url) => (String(url).includes("accessToken")
    ? new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 })
    : new Response(JSON.stringify({ type: "about:blank", title: "Bad Request", status: 400, detail: "nope" }), { status: 200 }));
  const r = await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  assert.match(r.text, /^ERROR/, `a non-answer rode out as a result: ${r.text.slice(0, 200)}`);
});

test("a truncated 200 is refused, not read as an empty register", async () => {
  globalThis.fetch = async (url) => (String(url).includes("accessToken")
    ? new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }), { status: 200 })
    : new Response('{"trademarks":[{"applicationNum', { status: 200 }));
  const r = await doSearch(AUTH, { names: ["ALPHA"], match_mode: "exact" }, TCTX);
  assert.match(r.text, /^ERROR/);
});

test("a capability gap is returned as an ERROR, never thrown through the kernel", async () => {
  // A throw here aborts the stage. The marker is what turns error:true into error+deferred so the
  // repair ladder stops re-running a deterministic refusal.
  stubApi([item(1)]);
  const r = await doSearch(AUTH, { names: ["ALPHA"], match_mode: "phonetic" }, TCTX);
  assert.match(r.text, /^ERROR/);
  assert.match(r.text, /capability-gap:/);
  assert.equal(searchReqs().length, 0, "a refused slice still hit the wire");
});

test("a record fetch on a 404 does not persist an empty body", async () => {
  stubApi([item(1)]);
  const before = existsSync(process.env.CLEAROTRON_REGISTER_RECORD_LOG)
    ? readFileSync(process.env.CLEAROTRON_REGISTER_RECORD_LOG, "utf8").split("\n").length : 0;
  const r = await doRecordFetch(AUTH, { record_id: "/mark/eu/999999999" }, TCTX);
  assert.match(r.text, /^ERROR/);
  const after = existsSync(process.env.CLEAROTRON_REGISTER_RECORD_LOG)
    ? readFileSync(process.env.CLEAROTRON_REGISTER_RECORD_LOG, "utf8").split("\n").length : 0;
  assert.equal(after, before, "a failed fetch wrote a body line the fidelity gate would read as a record");
});

test.after(() => rmSync(LEDGER_DIR, { recursive: true, force: true }));
