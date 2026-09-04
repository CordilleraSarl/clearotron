// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// index-store.test.mjs — the local US register's search predicates, and the one that used to lie.
//
// The centrepiece is "wildcardSuffix does not match a mark that merely STARTS with the term". A
// reversed-column FTS prefix query is the standard ends-with trick and it is wrong on its own,
// because FTS5 matches tokens: reversing "ARBORA LABS" yields "SBAL AROBRA", whose token prefix-
// matches the reversed term. The fixture below holds exactly that mark, so the over-match is shown
// rather than asserted. (A false-positive RATE used to be quoted here; it came from a synthetic
// fixture, so it described that fixture's composition and nothing about the register. Struck.)
//
// Break-matrix: delete the `AND text LIKE ?` from wildcardSuffix in index-store.js and
// "wildcardSuffix refuses a mark that only STARTS with the term" goes red. That assertion is the
// whole reason the verification exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openIndex, createSchema, putRecords, rebuildFts, search, countHits, getRecord,
  setMeta, freshness, statusClassOf, reverseText, makeRef, PREDICATES, assertIndexReady,
  STATUS_CODE_SETS,
} from "../src/index-store.js";

function fixture(rows) {
  const dir = mkdtempSync(join(tmpdir(), "uspto-local-"));
  const db = createSchema(openIndex(join(dir, "us.db")));
  putRecords(db, rows);
  rebuildFts(db);
  return { db, cleanup: () => { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

const ROWS = [
  { serial: "80000001", text: "ARBORA", status: "700", classes: ["009"], owner: "Acme SA" },
  { serial: "80000002", text: "ARBORA LABS", status: "700", classes: ["009"], owner: "Acme SA" },
  { serial: "80000003", text: "NOVAARBORA", status: "700", classes: ["042"], owner: "Beta Ltd" },
  { serial: "80000004", text: "NOVA ARBORA", status: "700", classes: ["042"], owner: "Beta Ltd" },
  { serial: "80000005", text: "NOVAARBORAX LABS", status: "700", classes: ["009"], owner: "Gamma AG" },
  { serial: "80000006", text: "UNRELATED", status: "601", classes: ["019"], owner: "Delta Inc" },
];

const marks = (rows) => rows.map((r) => r.mark_text).sort();

test("exact matches the whole mark and nothing that merely contains it", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "exact", term: "ARBORA" })), ["ARBORA"]);
  } finally { cleanup(); }
});

test("wildcardPrefix matches marks that START with the term", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardPrefix", term: "ARBORA" })),
      ["ARBORA", "ARBORA LABS"]);
  } finally { cleanup(); }
});

test("wildcardSuffix refuses a mark that only STARTS with the term", () => {
  // THE REGRESSION. "ARBORA LABS" reverses to "SBAL AROBRA"; its token prefix-matches the reversed
  // term, so FTS alone admits it. The exact LIKE is what throws it out.
  const { db, cleanup } = fixture(ROWS);
  try {
    const got = marks(search(db, { predicate: "wildcardSuffix", term: "ARBORA" }));
    assert.deepEqual(got, ["ARBORA", "NOVA ARBORA", "NOVAARBORA"]);
    assert.ok(!got.includes("ARBORA LABS"),
      "a mark that starts with the term is not a suffix match — the FTS candidate must be verified");
    assert.ok(!got.includes("NOVAARBORAX LABS"), "an infix occurrence is not a suffix match");
  } finally { cleanup(); }
});

test("wildcardInfix matches the term anywhere, including where the anchored predicates refuse", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardInfix", term: "ARBORA" })),
      ["ARBORA", "ARBORA LABS", "NOVA ARBORA", "NOVAARBORA", "NOVAARBORAX LABS"]);
  } finally { cleanup(); }
});

test("a LIKE metacharacter in a mark is a literal, not a wildcard", () => {
  // Unescaped, "%" would match every row and the search would report a confident, enormous, wrong
  // answer — the false-clean's louder twin.
  const { db, cleanup } = fixture([
    { serial: "1", text: "50% PURE", status: "700" },
    { serial: "2", text: "FIFTY PURE", status: "700" },
    { serial: "3", text: "A_B", status: "700" },
    { serial: "4", text: "AXB", status: "700" },
  ]);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardPrefix", term: "50%" })), ["50% PURE"]);
    assert.deepEqual(marks(search(db, { predicate: "exact", term: "A_B" })), ["A_B"]);
    assert.deepEqual(marks(search(db, { predicate: "wildcardInfix", term: "_" })), ["A_B"]);
  } finally { cleanup(); }
});

test("a class filter matches a whole class, never a substring of one", () => {
  // Class 9 must not drag in 19 or 90. This is the classic comma-join defect.
  const { db, cleanup } = fixture([
    { serial: "1", text: "ALPHA MARK", status: "700", classes: ["009"] },
    { serial: "2", text: "BETA MARK", status: "700", classes: ["019"] },
    { serial: "3", text: "GAMMA MARK", status: "700", classes: ["090"] },
    { serial: "4", text: "DELTA MARK", status: "700", classes: ["009", "042"] },
  ]);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardInfix", term: "MARK", classes: ["009"] })),
      ["ALPHA MARK", "DELTA MARK"]);
  } finally { cleanup(); }
});

test("status codes are read from the office's own table, not inferred from ranges", () => {
  // THE REGRESSION. An earlier version treated any 8xx code as dead. 800 is REGISTERED AND RENEWED
  // — the most alive a US mark can be — so every renewed US registration would have been dropped
  // from every conflict search as a clean negative. Ranges are not a status vocabulary.
  assert.equal(statusClassOf("800"), "live", "800 = REGISTERED AND RENEWED");
  assert.equal(statusClassOf("801"), "live", "801 = OPPOSITION PAPERS FILED — the case is live");
  assert.equal(statusClassOf("818"), "live", "818 = SU STATEMENT OF USE ACCEPTED");
  assert.equal(statusClassOf("825"), "live");

  // 715 sits inside the cancelled run and is CANCELLED - RESTORED TO PENDENCY: alive again. It is
  // the reason that run is enumerated rather than expressed as a range.
  assert.equal(statusClassOf("714"), "dead");
  assert.equal(statusClassOf("715"), "live", "715 = CANCELLED - RESTORED TO PENDENCY");
  assert.equal(statusClassOf("716"), "dead");

  assert.equal(statusClassOf("700"), "live");
  assert.equal(statusClassOf("601"), "dead");
  assert.equal(statusClassOf("900"), "dead", "900 = EXPIRED");
  assert.equal(statusClassOf("402"), "dead", "4xx = IR cancelled");
  assert.equal(statusClassOf("000"), "unknown");
  assert.equal(statusClassOf("620"), "unknown", "backfile status not recorded is not a status");
  assert.equal(statusClassOf(""), "unknown");
  assert.equal(statusClassOf("123"), "unknown",
    "a code we cannot classify must not be dropped from a conflict search as if it were dead");

  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardInfix", term: "E", status: "dead" })),
      ["UNRELATED"]);
  } finally { cleanup(); }
});

test("countHits reports the whole match count, never the page", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    const page = search(db, { predicate: "wildcardInfix", term: "ARBORA", limit: 2 });
    assert.equal(page.length, 2, "the page is capped");
    assert.equal(countHits(db, { predicate: "wildcardInfix", term: "ARBORA" }), 5,
      "the count is the whole answer — a trimmed page must never become the number");
  } finally { cleanup(); }
});

test("an unsupported predicate throws by name and says what to do instead", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.throws(() => search(db, { predicate: "phonetic", term: "ARBORA" }), (e) => {
      assert.match(e.message, /unsupported predicate "phonetic"/);
      assert.match(e.message, /declared null in capabilities/,
        "the error must point at the contract, so nobody answers it with a weaker search");
      return true;
    });
  } finally { cleanup(); }
});

test("an empty term is refused rather than matching the register", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.throws(() => search(db, { predicate: "wildcardInfix", term: "  " }), /non-empty term/);
  } finally { cleanup(); }
});

test("a record carries the fields a band row is built from, and a citable address", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    const r = getRecord(db, "80000003");
    assert.equal(r.office, "US");
    assert.equal(r.mark_text, "NOVAARBORA");
    assert.equal(r.applicationNumber, "80000003");
    assert.equal(r.statusClass, "live");
    assert.deepEqual(r.niceClasses, ["42"], "classes are canonicalised unpadded — USPTO writes 042, the plan writes 42");
    assert.equal(r.record_id, makeRef("80000003"));
    assert.match(r.resolved_link, /^https:\/\/tsdr\.uspto\.gov\//,
      "a finding must be able to cite an address, not a filename");
    assert.equal(getRecord(db, "does-not-exist"), null);
  } finally { cleanup(); }
});

test("an index whose search indexes were never built REFUSES, rather than half-answering", async () => {
  // THE WORST SHAPE THIS PROVIDER CAN TAKE. The FTS tables are external-content — the rows live in
  // `mark` and rebuildFts populates the index in a SEPARATE statement. A sync killed in between (a
  // crash, a full disk, a SIGTERM) leaves an index that passes every health check anyone would think
  // to write and answers FOUR of its six predicates correctly. The two that narrow through FTS return
  // nothing, for every term, forever — and those two are how NOVARBORA is caught when clearing
  // ARBORA.
  const dir = mkdtempSync(join(tmpdir(), "uspto-fts-"));
  try {
    const db = createSchema(openIndex(join(dir, "half.db")));
    try {
      putRecords(db, [
        { serial: "1", text: "ARBORA", status: "700", classes: ["009"], owner: "ARBORA HOLDINGS SA" },
        { serial: "2", text: "NOVARBORA", status: "700", classes: ["009"], owner: "NOVA SA" },
      ]);
      setMeta(db, "records", "2");
      // rebuildFts deliberately NOT called.

      // First: prove the damage is real and silent, so the refusal below is not guarding a phantom.
      assert.equal(countHits(db, { predicate: "exact", term: "ARBORA" }), 1, "exact is unaffected");
      assert.equal(countHits(db, { predicate: "wildcardInfix", term: "ARBORA" }), 2, "infix is unaffected");
      assert.equal(countHits(db, { predicate: "wildcardPrefix", term: "ARBORA" }), 0,
        "prefix answers ZERO over rows that are present — no error, no warning");
      assert.equal(countHits(db, { predicate: "wildcardSuffix", term: "ARBORA" }), 0,
        "and so does suffix");

      // Then: the gate must not let that index serve.
      assert.throws(() => assertIndexReady(db, { path: "half.db" }), (e) => {
        assert.match(e.message, /never built/);
        assert.match(e.message, /mark_fts/);
        assert.match(e.message, /mark_rfts/, "BOTH indexes are named — they are built separately and fail separately");
        assert.match(e.message, /clean negative/);
        return true;
      });

      // And once built, it serves.
      rebuildFts(db);
      assert.equal(assertIndexReady(db, { path: "half.db" }), 2);
      assert.equal(countHits(db, { predicate: "wildcardSuffix", term: "ARBORA" }), 2);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("only ONE of the two search indexes built is still a refusal", async () => {
  // They are populated by separate statements, so they fail separately. The reversed one is the less
  // likely to be noticed: only wildcardSuffix reads it, so a forward-only rebuild leaves prefix
  // working and suffix silently empty — which reads as "no marks end with this", the exact false
  // clean the whole reversed-column design exists to make possible.
  const dir = mkdtempSync(join(tmpdir(), "uspto-fts-"));
  try {
    const db = createSchema(openIndex(join(dir, "fwd.db")));
    try {
      putRecords(db, [{ serial: "1", text: "ARBORA LABS", status: "700", classes: ["009"], owner: "X SA" }]);
      setMeta(db, "records", "1");
      db.exec("INSERT INTO mark_fts(mark_fts) VALUES('rebuild')");   // forward only
      assert.throws(() => assertIndexReady(db, { path: "fwd.db" }), /mark_rfts/);
      assert.doesNotThrow(() => {
        db.exec("INSERT INTO mark_rfts(mark_rfts) VALUES('rebuild')");
        assertIndexReady(db, { path: "fwd.db" });
      });
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the declared OR-width stays under SQLite's own hard ceiling", async () => {
  // A REGRESSION GUARD ON A REAL LIMIT, not a performance opinion. register-plan.mjs splits every
  // OR-stack to capabilities.maxOrWidth and the store is forbidden from re-chunking (a chunk the
  // planner did not dictate breaks the qid-to-query join). So whatever is declared IS what reaches
  // SQLite, and past a certain width SQLite refuses to compile the statement at all.
  //
  // The ceiling is a property of the engine — no register data was needed to find it and none would
  // move it. The four LIKE-disjunction predicates die at width 1000 on SQLITE_MAX_EXPR_DEPTH; `exact`
  // compiles to an IN-list and survives far further. Raising the declaration past 999 would not be
  // slow, it would throw on every wide entry in production.
  const { CAPABILITIES } = await import("../src/capabilities.js");
  const SQLITE_EXPR_DEPTH_CEILING = 1000;
  assert.ok(CAPABILITIES.maxOrWidth < SQLITE_EXPR_DEPTH_CEILING,
    `maxOrWidth ${CAPABILITIES.maxOrWidth} is at or past SQLite's expression-depth ceiling `
    + `(${SQLITE_EXPR_DEPTH_CEILING}) — every OR-stack at that width would fail to compile`);

  const { db, cleanup } = fixture(ROWS);
  try {
    // The declared width really does run, on every predicate — including the four that die first.
    const terms = Array.from({ length: CAPABILITIES.maxOrWidth }, (_, i) => `TERM${i}`);
    for (const predicate of Object.keys(CAPABILITIES.predicates)) {
      if (!CAPABILITIES.predicates[predicate]) continue;   // a declared null is a disclosed gap
      assert.doesNotThrow(() => search(db, { predicate, term: terms, limit: 1 }),
        `predicate ${predicate} cannot serve an OR-stack at the declared maxOrWidth`);
    }
    // And the ceiling is where it is claimed to be, so the constant above is not folklore.
    const past = Array.from({ length: SQLITE_EXPR_DEPTH_CEILING }, (_, i) => `TERM${i}`);
    assert.throws(() => search(db, { predicate: "wildcardInfix", term: past }), /Expression tree is too large/);
  } finally { cleanup(); }
});

test("freshness states what it knows, and says so plainly when it knows nothing", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    const blind = freshness(db);
    assert.equal(blind.newestDelta, null);
    assert.equal(blind.stale, null, "unknown currency is not the same claim as fresh");
    assert.match(blind.reason, /currency cannot be established/);

    setMeta(db, "newest_delta", "2026-08-01T00:00:00Z");
    setMeta(db, "records", "6");
    // A data date with no record of a sync is still "we cannot establish currency": knowing what the
    // data covers says nothing about whether we have asked the office since.
    const unsynced = freshness(db, { nowIso: "2026-08-01T06:00:00Z" });
    assert.equal(unsynced.stale, null);
    assert.match(unsynced.reason, /no successful sync/);

    setMeta(db, "synced_at", "2026-08-01T05:00:00Z");
    const fresh = freshness(db, { nowIso: "2026-08-01T06:00:00Z" });
    assert.equal(fresh.stale, false);
    assert.equal(fresh.reason, null);
    assert.equal(fresh.records, 6);
  } finally { cleanup(); }
});

test("the two freshness clocks are separate, and each names its own failure", () => {
  // R5 is titled "Maximum Acceptable SYNC LAG", and measuring the DATA age against its 24 hours instead
  // made the provider refuse every count: USPTO publishes date D on D+1, so the freshest possible index
  // is already ~27h old. The clocks are split, and they mean different things to whoever reads the
  // reason — one says re-run the sync, the other says the sync is running and applying nothing.
  const { db, cleanup } = fixture(ROWS);
  const NOW = "2026-08-08T12:00:00Z";
  try {
    setMeta(db, "records", "6");

    // Yesterday's data, synced an hour ago: the freshest a next-day product can ever be. Must pass.
    setMeta(db, "newest_delta", "2026-08-07T00:00:00Z");
    setMeta(db, "synced_at", "2026-08-08T11:00:00Z");
    const best = freshness(db, { nowIso: NOW });
    assert.equal(best.stale, false, `the freshest an index can be must not read as stale: ${best.reason}`);

    // Data still recent, but nobody has synced in three days.
    setMeta(db, "synced_at", "2026-08-05T12:00:00Z");
    const noSync = freshness(db, { nowIso: NOW });
    assert.equal(noSync.stale, true);
    assert.match(noSync.reason, /last successful sync/);
    assert.match(noSync.reason, /never a clean negative/);

    // Syncs running on schedule, data a month back — succeeding while applying nothing.
    setMeta(db, "synced_at", "2026-08-08T11:00:00Z");
    setMeta(db, "newest_delta", "2026-07-08T00:00:00Z");
    const drift = freshness(db, { nowIso: NOW });
    assert.equal(drift.stale, true);
    assert.match(drift.reason, /sync is current but/);
    assert.match(drift.reason, /never a clean negative/);

    // A weekend: Friday's data is the newest until Tuesday. Inside the allowance, on purpose.
    setMeta(db, "newest_delta", "2026-08-05T00:00:00Z");
    assert.equal(freshness(db, { nowIso: NOW }).stale, false, "a business-day product's weekend gap is not staleness");
  } finally { cleanup(); }
});

test("mark text is folded to upper case so the FTS index and the LIKE agree", () => {
  const { db, cleanup } = fixture([{ serial: "1", text: "lowercase mark", status: "700" }]);
  try {
    assert.deepEqual(marks(search(db, { predicate: "exact", term: "LOWERCASE MARK" })), ["LOWERCASE MARK"]);
    assert.deepEqual(marks(search(db, { predicate: "exact", term: "lowercase mark" })), ["LOWERCASE MARK"]);
  } finally { cleanup(); }
});

test("a mark with FTS punctuation is searchable rather than a MATCH syntax error", () => {
  // "AT&T" is not an exotic mark. An unquoted FTS5 term containing punctuation is a syntax error,
  // which would surface as a crashed slice rather than a result.
  const { db, cleanup } = fixture([
    { serial: "1", text: "AT&T WIRELESS", status: "700" },
    { serial: "2", text: "PLAIN", status: "700" },
  ]);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardPrefix", term: "AT&T" })), ["AT&T WIRELESS"]);
  } finally { cleanup(); }
});

test("reverseText round-trips, including outside the basic plane", () => {
  assert.equal(reverseText("ARBORA"), "AROBRA");
  assert.equal(reverseText(reverseText("NOVA ARBORA")), "NOVA ARBORA");
  assert.equal(reverseText("🦉AB"), "BA🦉", "an astral codepoint must not be split into surrogates");
});

test("EVERY declared predicate actually executes", () => {
  // This assertion exists because its weaker ancestor shipped a bug. It used to pin PREDICATES as a
  // sorted list of strings and never call any of them — so `owner` sat in the declared list with no
  // case in the switch, fell through to `default:`, and threw
  //   unsupported predicate "owner". Known: exact, …, owner
  // an error naming the predicate it was refusing as one it supported. The list-pin passed green
  // throughout. A declaration nothing exercises is not a contract, it is a comment.
  const { db, cleanup } = fixture(ROWS);
  try {
    for (const predicate of PREDICATES) {
      assert.doesNotThrow(() => search(db, { predicate, term: "ARBORA" }),
        `declared predicate "${predicate}" does not execute`);
      assert.doesNotThrow(() => countHits(db, { predicate, term: "ARBORA" }),
        `declared predicate "${predicate}" cannot be counted`);
    }
  } finally { cleanup(); }
});

test("the owner predicate searches owners, not mark text", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "owner", term: "Beta" })),
      ["NOVA ARBORA", "NOVAARBORA"]);
    assert.deepEqual(search(db, { predicate: "owner", term: "ARBORA" }), [],
      "a mark name is not an owner name");
  } finally { cleanup(); }
});

test("owner and mark predicates intersect in ONE query", () => {
  // The evidence for capabilities.ownerTermIntersection: true. If this ever needed two calls the
  // capability would be a false declaration and the planner would build a query the executor
  // cannot honour.
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.deepEqual(marks(search(db, { predicate: "wildcardInfix", term: "ARBORA", owner: "Beta" })),
      ["NOVA ARBORA", "NOVAARBORA"]);
    assert.deepEqual(search(db, { predicate: "exact", term: "ARBORA", owner: "Beta" }), [],
      "the intersection must be an AND, never a union");
  } finally { cleanup(); }
});

test("an index with the schema but no rows REFUSES rather than answering zero", () => {
  // The most dangerous artifact this provider could produce. An empty index answers every query
  // with a well-formed zero: the count agrees with the search, the divergence guard passes, the
  // ceiling passes, and the slice mints a positively asserted clean negative over a register
  // nobody downloaded. Nothing errors, and the report says "no US conflicts".
  const dir = mkdtempSync(join(tmpdir(), "uspto-local-empty-"));
  const db = createSchema(openIndex(join(dir, "us.db")));
  try {
    assert.equal(countHits(db, { predicate: "wildcardInfix", term: "ARBORA" }), 0,
      "the raw count is a truthful zero — which is exactly why it must never be reached unguarded");
    assert.throws(() => assertIndexReady(db, { path: "us.db" }), (e) => {
      assert.match(e.message, /schema but no records/);
      assert.match(e.message, /never a clean negative/);
      return true;
    });
  } finally { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} }
});

test("the three status sets are disjoint, so no code can mean two things", () => {
  const { dead, live, unknown } = STATUS_CODE_SETS;
  const overlaps = [];
  for (const c of dead) { if (live.has(c)) overlaps.push(`${c} dead+live`); if (unknown.has(c)) overlaps.push(`${c} dead+unknown`); }
  for (const c of live) { if (unknown.has(c)) overlaps.push(`${c} live+unknown`); }
  assert.deepEqual(overlaps, [], "a status code in two sets resolves by set order, silently");
  // Every enumerated code classifies back to its own set — catches a code added to a set but
  // shadowed by an earlier branch.
  for (const c of dead) assert.equal(statusClassOf(c), "dead", `${c}`);
  for (const c of live) assert.equal(statusClassOf(c), "live", `${c}`);
  for (const c of unknown) assert.equal(statusClassOf(c), "unknown", `${c}`);
});

test("assertIndexReady passes on a built index and returns the row count", () => {
  const { db, cleanup } = fixture(ROWS);
  try {
    assert.equal(assertIndexReady(db), ROWS.length);
  } finally { cleanup(); }
});
