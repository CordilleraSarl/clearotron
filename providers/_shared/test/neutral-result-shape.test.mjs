// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — ONE NEUTRAL TOOL, ONE RESULT VOCABULARY, PROVEN BY DRIVING EVERY PROVIDER.
//
// `register_batch_screen` is a neutral tool: the seat calls one name whichever provider is wired. The
// RESULT shape was not neutral, and nothing checked it — the MCP inputSchema constrains what goes in,
// each provider's tests assert its own shape, and the composite's tests used stubs returning whatever
// the composite happened to read. Three providers answered in two vocabularies and the suite was green.
//
// The cost is never an exception: a consumer reads one name, gets `undefined`, `undefined` becomes `[]`
// at the first `?? []`, and batch screen decides which surfaced records are in scope — so an empty list
// reads downstream exactly like "nothing matched". The free tier shipped that from to.
//
// ── why these tests DRIVE the cores rather than assert over fixtures ──────────────────────────────
//
// A declaration nothing drives goes stale and then lies. Fixtures of "what we believe corsearch
// returns" would have passed on the day euipo shipped `screened`, because nobody would have written a
// euipo fixture. So every provider that EXPOSES the tool is called for real — transport stubbed
// (corsearch, clarivate, euipo), a genuine throwaway SQLite index built (uspto-local), and the free
// tier composed over its two real member cores.
//
// ── the false clean these tests must not produce ──────────────────────────────────────────────────
//
// Each provider guards its own transport: a body that is not the shape it probed for comes back as an
// `ERROR:` envelope, not as a result. A shape assertion over an error string passes trivially and
// proves nothing. So every case below asserts, in order: NOT an error envelope · at least one row ·
// then the shape. A zero-row conformance is not evidence.
//
// ── what is NOT here, deliberately ───────────────────────────────────────────────────────────────
//
// No provider or driver code imports result-shape.mjs. The tool result text IS the model's prompt
// surface; a runtime validator that rejected or rewrote a body would change what the seat reads and
// what production reads at the next redeploy. This lane is a gate, and the declaration describes what
// origin/main already returns.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Redirect the ledgers BEFORE importing any core — both paths are captured at module load, and
// clarivate/uspto-local persist record bodies from inside batch screen.
const TMP = mkdtempSync(join(tmpdir(), "neutral-result-shape-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const {
  NEUTRAL_TOOL_RESULT_SHAPE, SCREEN_VERDICTS, BATCH_SCREEN_JOIN_KEY, DEFAULT_JOIN_KEY,
  batchScreenViolations, isToolErrorResult,
} = await import("../result-shape.mjs");
const { screenVerdict, normalizeBrandRow } = await import("../screen.mjs");
const corsearch = await import("../../corsearch/src/core.js");
const clarivate = await import("../../clarivate/src/core.js");
const euipo = await import("../../euipo/src/core.js");
const usptoLocal = await import("../../uspto-local/src/core.js");
const freeTier = await import("../../free-tier/src/core.js");
const indexStore = await import("../../uspto-local/src/index-store.js");

const realFetch = global.fetch;
after(() => { global.fetch = realFetch; });

const parse = (r) => JSON.parse(r.text);
const resp = (raw, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => "application/json" },
  text: async () => raw,
});

/** Assert a tool result is an ANSWER with rows in it, then return it parsed. Called before every
 *  shape assertion — see the header: shape over an `ERROR:` string is a pass that proves nothing. */
function answered(result, label) {
  assert.ok(!isToolErrorResult(result),
    `${label}: the provider refused instead of answering — the stub did not satisfy its own transport `
    + `guard, so nothing below this line would have been tested. It said: ${String(result?.text).slice(0, 300)}`);
  const parsed = parse(result);
  assert.ok(Array.isArray(parsed.rows) && parsed.rows.length >= 1,
    `${label}: drove the provider and got ${Array.isArray(parsed.rows) ? 0 : "no"} rows. A zero-row `
    + `result conforms to every shape and proves none of them.`);
  return parsed;
}

/** The whole check, in the order that matters. */
function conforms(result, label, { minRows = 1 } = {}) {
  const parsed = answered(result, label);
  assert.ok(parsed.rows.length >= minRows, `${label}: expected at least ${minRows} row(s)`);
  const violations = batchScreenViolations(parsed, { label });
  assert.deepEqual(violations, [], `${label}: ${violations.join("\n  ")}`);
  // The identity split's live half: whichever key THIS provider's kernel is configured to join on
  // must be the one THIS provider's rows actually carry. A row that satisfies the neutral contract
  // with the other spelling would still join to nothing.
  const key = BATCH_SCREEN_JOIN_KEY[label] ?? DEFAULT_JOIN_KEY;
  parsed.rows.forEach((row, i) => {
    assert.ok(typeof row[key] === "string" && row[key],
      `${label}: rows[${i}] has no \`${key}\` — the key this provider's own enumerate kernel joins `
      + `screen rows on. The row carries ${Object.keys(row).filter((k) => /uri|record_id|guid/.test(k))
        .join("/") || "no identity at all"} instead, so the join returns undefined for every row and the `
      + `band ships enumerated with null mark text.`);
  });
  return parsed;
}

// ══ the declaration cannot drift from the implementation ════════════════════════════════════════

test("#688 the declared verdict set is exactly what screenVerdict() can produce", () => {
  // Every branch of the classifier, driven — not a copy of the constant. If a sixth verdict is added
  // and this file is not updated, the row check below would accept it silently.
  const produced = new Set([
    screenVerdict({ live_status: "dead" }, [9]),
    screenVerdict({ live_status: "ambiguous" }, [9]),
    screenVerdict({ live_status: "live", all_class: true }, [9]),
    screenVerdict({ live_status: "live", classes: [25] }, [9]),
    screenVerdict({ live_status: "live", classes: [9] }, [9]),
    screenVerdict({ live_status: "live", classes: [9] }, []),
    screenVerdict(null, [9]),
    screenVerdict("not an object", [9]),
  ]);
  assert.deepEqual([...produced].sort(), [...SCREEN_VERDICTS].sort(),
    "SCREEN_VERDICTS must be the closed set the implementation actually emits");
});

test("#688 the checker fails the shapes it exists to fail", () => {
  const good = { rows: [{ uri: "/mark/eu/1", screen_verdict: "surface:in-scope-live" }] };
  assert.deepEqual(batchScreenViolations(good), []);

  // The shape: a different name for the row list. This is the one that cost a live bug.
  assert.match(batchScreenViolations({ results: good.rows })[0], /no `rows` array/);
  assert.match(batchScreenViolations({ results: good.rows })[0], /nothing matched/,
    "the message says what it looks like downstream, not just that a key is missing");
  // The euipo trap: a count under a collection-shaped name, turned into a list.
  assert.match(batchScreenViolations({ ...good, screened: good.rows })[0], /`screened` is an array/);
  // A declared alias that disagrees with the thing it aliases.
  assert.match(batchScreenViolations({ ...good, results: [] })[0], /disagree on how many/);
  // A row the enumerate kernel could not join back to the band. EITHER identity spelling satisfies
  // it — the split is real and reconciled per provider (see BATCH_SCREEN_JOIN_KEY); carrying neither
  // is the failure.
  assert.deepEqual(batchScreenViolations({ rows: [{ record_id: "/mark/eu/1", screen_verdict: "drop:dead" }] }), []);
  assert.match(batchScreenViolations({ rows: [{ screen_verdict: "drop:dead" }] })[0], /carries no identity/);
  assert.match(batchScreenViolations({ rows: [{ uri: "", record_id: "", screen_verdict: "drop:dead" }] })[0],
    /carries no identity/, "an empty string is not an identity");
  assert.match(batchScreenViolations({ rows: [{ uri: "/mark/eu/1", screen_verdict: "maybe" }] })[0],
    /outside the closed set/);
  // not_found is never folded into rows and is never a bare scalar.
  assert.match(batchScreenViolations({ ...good, not_found: 3 })[0], /must be an array/);
  // An empty rows array is CONFORMING — the checker judges shape, not content. That is exactly why
  // every driven case above asserts rows.length >= 1 separately.
  assert.deepEqual(batchScreenViolations({ rows: [] }), [],
    "shape conformance is not evidence of a screen — the driving tests carry that half");
});

// ══ corsearch — bulk-endpoint, transport stubbed ════════════════════════════════════════════════

test("#688 corsearch conforms, driven through its real brand-json path", async () => {
  const URIS = ["/mark/us/1001", "/mark/us/1002", "/mark/us/1003"];
  const BODIES = {
    "/mark/us/1001": { status: "Valid", classes: [9], name: "ARBORA", batchId: "b1", sourceId: "s1" },
    "/mark/us/1002": { status: "Expired", classes: [9], name: "ARBORA LABS" },
    "/mark/us/1003": { status: "Unknown", classes: [25], name: "NOVAARBORA" },
  };
  global.fetch = async (url, init = {}) => {
    assert.match(String(url), /brand-json/, "the screen must go through brand-json, not the search path");
    const uris = [...new URLSearchParams(init.body || "").getAll("uri")];
    return resp(JSON.stringify(uris.map((uri) => ({ uri, ...BODIES[uri] }))));
  };
  const out = await corsearch.doBatchScreen("cookie", { uris: URIS, in_scope_classes: [9] },
    { sessionKey: "s", kind: "test" });
  const parsed = conforms(out, "corsearch", { minRows: 3 });
  // The provider's own plumbing strip still happens — proof this went through normalizeBrandRow and
  // not some shortcut the stub accidentally satisfied.
  assert.equal(parsed.rows[0].batchId, undefined, "brand-json plumbing is stripped");
  assert.equal(parsed.rows.find((r) => r.uri === "/mark/us/1002").screen_verdict, "drop:dead");
  assert.equal(parsed.rows.find((r) => r.uri === "/mark/us/1003").screen_verdict, "deepfetch:ambiguous");
});

// ══ clarivate — billed-record-fetch, transport stubbed ══════════════════════════════════════════

test("#688 clarivate conforms, driven through its real /text path", async () => {
  const RECS = [
    { id: "g1", markVerbalElementText: "ARBORA", niceClasses: [9], markCurrentStatusCode: "Registered",
      registrationOfficeCode: "US" },
    { id: "g2", markVerbalElementText: "ARBORA LABS", niceClasses: [9], markCurrentStatusCode: "Expired",
      registrationOfficeCode: "US" },
  ];
  global.fetch = async (url) => {
    assert.match(String(url), /\/text/, "the screen must go through /text");
    return resp(JSON.stringify({ trademarks: RECS }));
  };
  const out = await clarivate.doBatchScreen("key", "https://api.example/compumark-content/api/v1",
    { uris: ["/mark/us/g1", "/mark/us/g2"], in_scope_classes: [9], test_mode: true }, { kind: "test" });
  const parsed = conforms(out, "clarivate", { minRows: 2 });
  assert.ok(parsed.rows.every((r) => typeof r.mark_text === "string" && r.mark_text),
    "the billed record fetch IS the screen here — a row with no mark text means the hydrate did not land");
});

// ══ euipo — transport stubbed, and the `screened` count is the declared trap ═════════════════════

test("#688 euipo conforms, and its `screened` stays a COUNT while `rows` carries the screen", async () => {
  const TMS = [
    { applicationNumber: "018000001", markBasis: "EU", wordMarkSpecification: { verbalElement: "ARBORA" },
      niceClasses: [9], status: "REGISTERED" },
    { applicationNumber: "018000002", markBasis: "EU", wordMarkSpecification: { verbalElement: "ARBORA LABS" },
      niceClasses: [9], status: "EXPIRED" },
  ];
  global.fetch = async (url) => (String(url).includes("accessToken")
    ? resp(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : resp(JSON.stringify({ trademarks: TMS, totalElements: TMS.length, page: 0, size: 100, totalPages: 1 })));

  const auth = { clientId: "c", clientSecret: "s", environment: "sandbox" };
  const out = await euipo.doBatchScreen(auth,
    { uris: ["/mark/eu/018000001", "/mark/eu/018000002", "/mark/eu/018999999"], in_scope_classes: [9] },
    { kind: "test" });
  const parsed = conforms(out, "euipo", { minRows: 2 });

  // The declared hazard, asserted rather than renamed: `screened` READS like a collection and IS a
  // count. The pre- composite chain `rows ?? screened ?? results ?? records` resolves this integer
  // as a screening result the moment `rows` is absent. The gate's job is that it can never become a
  // list without failing here.
  assert.equal(typeof parsed.screened, "number");
  assert.equal(parsed.screened, parsed.rows.length);

  // An id the register did not answer is a finding that rides separately — never a short `rows`.
  assert.deepEqual(parsed.not_found, ["018999999"]);
  assert.match(String(parsed.not_found_note), /NOT a screening verdict/);
});

// ══ uspto-local — a real throwaway index, no transport at all ═══════════════════════════════════

function usptoFixture() {
  const dir = mkdtempSync(join(tmpdir(), "neutral-uspto-"));
  const dbPath = join(dir, "us.db");
  const db = indexStore.createSchema(indexStore.openIndex(dbPath));
  indexStore.putRecords(db, [
    { serial: "80000001", text: "ARBORA", status: "700", classes: ["009"], owner: "Acme SA" },
    { serial: "80000002", text: "ARBORA LABS", status: "710", classes: ["009"], owner: "Acme SA" },
    { serial: "80000003", text: "NOVAARBORA", status: "700", classes: ["042"], owner: "Beta Ltd" },
  ]);
  indexStore.rebuildFts(db);
  db.close();
  return { dbPath, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } } };
}

test("#688 uspto-local conforms, driven against a real index", async () => {
  const { dbPath, cleanup } = usptoFixture();
  try {
    const out = await usptoLocal.doBatchScreen({ dbPath },
      { uris: ["/mark/us/80000001", "/mark/us/80000002", "/mark/us/80000003"], in_scope_classes: [9] },
      { kind: "test" });
    const parsed = conforms(out, "uspto-local", { minRows: 3 });
    assert.ok(parsed.rows.every((r) => typeof r.mark_text === "string" && r.mark_text),
      "the local index is the content source; null mark text here means the row build is broken");
  } finally { cleanup(); }
});

// ══ free-tier — the composite, over its two REAL member cores ═══════════════════════════════════

test("#688 the free tier conforms, composed over both real members", async () => {
  const { dbPath, cleanup } = usptoFixture();
  freeTier._resetMemberCores();   // real cores, not the merge-arithmetic stubs
  const TMS = [{ applicationNumber: "018000001", markBasis: "EU",
    wordMarkSpecification: { verbalElement: "ARBORA" }, niceClasses: [9], status: "REGISTERED" }];
  global.fetch = async (url) => (String(url).includes("accessToken")
    ? resp(JSON.stringify({ access_token: "t", expires_in: 3600 }))
    : resp(JSON.stringify({ trademarks: TMS, totalElements: 1, page: 0, size: 100, totalPages: 1 })));
  try {
    const out = await freeTier.doBatchScreen(
      { dbPath, clientId: "c", clientSecret: "s", environment: "sandbox" },
      { uris: ["/mark/eu/018000001", "/mark/us/80000001", "/mark/us/80000002"], in_scope_classes: [9] },
      { kind: "test" });
    const parsed = conforms(out, "free-tier", { minRows: 3 });
    assert.deepEqual([...parsed.members].sort(), ["euipo", "uspto-local"],
      "both members answered — a one-member pass would be half a tier reported as a whole one");
    // The alias free-tier keeps for its old readers must stay the same list, not a second opinion.
    assert.deepEqual(parsed.results, parsed.rows);
  } finally { freeTier._resetMemberCores(); cleanup(); }
});

// ══ THE ANTI-STALENESS ASSERTION ════════════════════════════════════════════════════════════════
//
// Everything above proves five providers conform TODAY. This is the part that keeps it true: the set
// of providers driven above must equal the set whose MCP server actually exposes `register_batch_screen`.
// A sixth provider added tomorrow fails here until it is driven, instead of joining the neutral tool
// with an undriven vocabulary — which is exactly how euipo's `screened` arrived.

const DRIVEN = ["corsearch", "clarivate", "euipo", "uspto-local", "free-tier"];

test("#688 every provider exposing register_batch_screen is driven above — no silent skips", () => {
  const dir = join(ROOT, "driver", "engine", "mcp");
  const exposing = readdirSync(dir)
    .filter((f) => f.endsWith("-server.mjs"))
    .filter((f) => readFileSync(join(dir, f), "utf8").includes('name: "register_batch_screen"'))
    .map((f) => f.replace(/-server\.mjs$/, ""));
  assert.ok(exposing.length >= 5, `only ${exposing.length} server(s) matched — the grep itself has gone stale`);
  assert.deepEqual([...exposing].sort(), [...DRIVEN].sort(),
    "a provider exposing the neutral tool but not driven here would be free to answer in its own "
    + "vocabulary, which is the whole of #688. Drive it, or stop exposing the tool.");
});

test("#688 a provider with no batch-screen tool declares the absence rather than being skipped", async () => {
  // signa exposes no `register_batch_screen` and exports no `doBatchScreen`. That is legitimate — but
  // an absence is a finding, so it is asserted on both halves rather than left to the sweep above to
  // pass over. The two must agree: a server exposing the tool over a core that lacks it would throw at
  // the first call, and a core with the function that no server exposes is dead code the seat can
  // never reach.
  const signa = await import("../../signa/src/core.js");
  assert.equal(typeof signa.doBatchScreen, "undefined", "signa exports no batch screen");
  const src = readFileSync(join(ROOT, "driver", "engine", "mcp", "signa-server.mjs"), "utf8");
  assert.ok(!src.includes("register_batch_screen"), "…and its server exposes none");
  const { CAPABILITIES } = await import("../../signa/src/capabilities.js");
  assert.equal(CAPABILITIES.screenSource, "search-row",
    "the declared reason: the search row IS the screen here, so there is nothing to batch");
});

// ══ THE SECOND SPLIT, FOUND BY THIS GATE ════════════════════════════════════════════════════════
//
// The row's IDENTITY key has two spellings too: corsearch and clarivate emit `uri`, euipo,
// uspto-local and the free tier emit `record_id`. Same family as the list name, one level down.
//
// It has never bitten, and the reason is worth writing down because it is not "someone checked":
// each provider declares its own `screenJoinKey` to makeEnumerate, AND the two whose rows say
// `record_id` declare `screenSource: "search-row"`, so the kernel's join path never runs for them.
// Two independent accidents. The day either changes — a provider moved to a bulk endpoint, or a
// join key edited to match a sibling — the join silently returns undefined for every row and the
// band ships `state:"enumerated"` with null mark text. This is the test that fails first.

test("#688 each provider's declared join key is the identity its own rows carry", () => {
  const CONFIGURED = {
    corsearch: null,
    clarivate: /screenJoinKey: \(row\) => row\?\.uri/,
    euipo: /screenJoinKey: \(row\) => row\?\.record_id/,
    "uspto-local": /screenJoinKey: \(row\) => row\?\.record_id \?\? row\?\.uri/,
  };
  for (const [id, re] of Object.entries(CONFIGURED)) {
    const src = readFileSync(join(ROOT, "providers", id, "src", "core.js"), "utf8");
    if (re === null) {
      assert.ok(!src.includes("screenJoinKey"),
        `${id} is declared to inherit the kernel default — if it now passes one, BATCH_SCREEN_JOIN_KEY is stale`);
      assert.equal(BATCH_SCREEN_JOIN_KEY[id], null);
    } else {
      assert.match(src, re, `${id}: the declaration in result-shape.mjs must match the real configuration`);
      assert.ok(new RegExp(`row\\?\\.${BATCH_SCREEN_JOIN_KEY[id]}`).test(src));
    }
  }
  const kernel = readFileSync(join(ROOT, "providers", "_shared", "enumerate.mjs"), "utf8");
  assert.match(kernel, new RegExp(`screenJoinKey = \\(row\\) => row\\?\\.${DEFAULT_JOIN_KEY}`),
    "the kernel default is what the providers passing nothing inherit");
});

test("#688 the two spellings are BOTH live — this is a split, not a legacy alias", () => {
  // Stated as an assertion so nobody 'tidies' one spelling away believing the other is unused. The
  // free tier merges its members' rows verbatim into one list, so a mixed-spelling member pair would
  // produce a list where a single reader can join only half the rows.
  assert.equal(BATCH_SCREEN_JOIN_KEY.clarivate, "uri");
  assert.equal(BATCH_SCREEN_JOIN_KEY.euipo, "record_id");
  const members = new Set(["euipo", "uspto-local"].map((m) => BATCH_SCREEN_JOIN_KEY[m]));
  assert.equal(members.size, 1,
    `the free tier's members must agree on one identity spelling — its composite rows are theirs, `
    + `unmodified, so two spellings in one list means half of it joins to nothing. Members answer in: `
    + `${[...members].join(", ")}`);
  assert.equal([...members][0], BATCH_SCREEN_JOIN_KEY["free-tier"]);
});

// ══ THE AUDIT ASKED FOR — search and enumerate ═════════════════════════════════════════════
//
// "Whether the other neutral tools have the same split. I only looked at batch screen."
//
// Answer, read off origin/main and pinned here so it stays true:
//   register_search    — NO split. Every implementation answers `results[]`.
//   register_enumerate — a split WITHIN the tool, not across providers: the list's name follows
//                        `state` (`records[]` when enumerated, `sample[]` when incomplete).

test("#688 audit: register_search has no split — every provider answers `results`", async () => {
  const spec = NEUTRAL_TOOL_RESULT_SHAPE.register_search;
  assert.equal(spec.list, "results");
  // corsearch and clarivate both build their search result through normalizeSearchResponse, so the
  // name is provable on the pure normalizer without standing up transport.
  const cs = corsearch.normalizeSearchResponse(
    { totalHitCount: 1, rows: [{ score: 1, document: { uri: "/mark/us/1", name: "ARBORA" } }], nextRequest: null },
    "name:ARBORA", "default");
  assert.ok(Array.isArray(cs.results) && cs.results.length === 1, "corsearch: results[]");
  assert.equal(cs.results[0][spec.row.identity], "/mark/us/1");
  const cl = clarivate.normalizeSearchResponse({ ids: { US: ["g1"] } }, "ARBORA", "default");
  assert.ok(Array.isArray(cl.results) && cl.results.length === 1, "clarivate: results[]");
  assert.equal(cl.results[0][spec.row.identity], "/mark/us/g1");
  // euipo, uspto-local and free-tier build the key literally. Read it off the source rather than
  // standing up three more transports — the claim is about the NAME, and the name is a literal.
  for (const p of ["euipo", "uspto-local", "free-tier"]) {
    const src = readFileSync(join(ROOT, "providers", p, "src", "core.js"), "utf8");
    assert.match(src, /\n\s*results:/, `${p}: doSearch answers results[]`);
  }
  // And the driver reads exactly that name — the contract is only real if the consumer agrees.
  const cfg = readFileSync(join(ROOT, "driver", "driver.config.mjs"), "utf8");
  assert.match(cfg, /Array\.isArray\(parsed\?\.results\)/,
    "driver.config.mjs reads `results` — if the providers ever renamed it this is where the zero appears");
});

test("#688 audit: register_enumerate's list name follows `state` — the split is inside the tool", async () => {
  const spec = NEUTRAL_TOOL_RESULT_SHAPE.register_enumerate;
  assert.deepEqual(spec.listByState, { enumerated: "records", incomplete: "sample" });
  const src = readFileSync(join(ROOT, "providers", "_shared", "enumerate.mjs"), "utf8");
  assert.match(src, /state: "enumerated", total_hits: [\w.]+, count: [\w.]+, records/,
    "the enumerated branch carries records[]");
  assert.match(src, /state: "incomplete", total_hits: [\w.]+, fetched, sample:/,
    "the incomplete branch carries sample[] and NO records — a consumer reading `records` here gets "
    + "undefined, which is the same false clean one state away");
  // The free tier reproduces the pair by hand rather than inheriting the kernel, so it is the one
  // place the two spellings can drift apart. It reads BOTH when consuming a member.
  const ft = readFileSync(join(ROOT, "providers", "free-tier", "src", "core.js"), "utf8");
  assert.match(ft, /parsed\.records \?\? parsed\.sample/,
    "the composite reads both names when merging a member's enumeration");
  assert.match(ft, /state: "incomplete",[^\n]*fetched: [\w.]+, sample:/,
    "…and emits the same pair it consumes");
});

// ══ THE LIVE CONSUMER THIS PROTECTS ═════════════════════════════════════════════════════════════

test("#688 the enumerate kernel joins the band on the screen row's `rows`/`uri` — the pair asserted above", () => {
  // Not a hypothetical consumer: providers/_shared/enumerate.mjs reads `sj.rows` to lift mark text,
  // classes, status and owner onto records that a guid-only provider's search leaves null, and joins
  // them on `row.uri` (`screenJoinKey`'s default). The asymmetry is worth stating where someone will
  // read it:
  //
  //   · contentFromScreen provider (clarivate)          a wrong row name → `incomplete`. SAFE refusal.
  //   · non-contentFromScreen provider (corsearch)      a wrong row name → the lift is skipped and the
  //     band still ships `state:"enumerated"` with null mark_text/classes/status. A FALSE CLEAN.
  //
  // Hardening the kernel is a behaviour change on the engine path and is NOT done here. What
  // is done: the assumption it rests on is now driven for every provider, above, instead of holding by
  // luck. This test pins the two names so the kernel and the declaration cannot drift apart silently.
  const src = readFileSync(join(ROOT, "providers", "_shared", "enumerate.mjs"), "utf8");
  const spec = NEUTRAL_TOOL_RESULT_SHAPE.register_batch_screen;
  assert.match(src, new RegExp(`Array\\.isArray\\(sj\\.${spec.list}\\)`),
    `the kernel reads the declared list name (\`${spec.list}\`)`);
  assert.ok(spec.row.identity.includes(DEFAULT_JOIN_KEY),
    `the kernel's default join key (\`${DEFAULT_JOIN_KEY}\`) must be one of the declared identity spellings`);
  // The normalizer that produces corsearch's rows preserves that identity — the join's other half.
  assert.equal(normalizeBrandRow({ uri: "/mark/us/1", status: "Valid", classes: [9], batchId: "b" }).uri,
    "/mark/us/1");
});
