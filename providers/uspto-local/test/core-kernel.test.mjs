// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// core-kernel.test.mjs — the provider surface over the shared kernels.
//
// Three of these cover failures that produce a well-formed band and no error at all:
//   * inheriting the kernel's default pageParams, so every page re-returns page 0;
//   * a stale index answering 0 instead of refusing;
//   * an unbuilt index answering 0 for everything.
// All three end as a completed-looking enumeration over a register that was never read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openIndex, createSchema, putRecords, rebuildFts, setMeta,
} from "../src/index-store.js";
import {
  doSearch, doCount, doCountHits, doEnumerate, doRecordFetch, doBatchScreen,
  hasAnyElement, resetHandles,
} from "../src/core.js";

const parse = (r) => JSON.parse(r.text);

// The provider cores append to the SHARED register ledger, whose path is read at module load. Point it
// at a scratch file: unset, these tests write into the pre- telemetry directory, which on the test box is a
// file other users' runs are reading.
const LEDGER = mkdtempSync(join(tmpdir(), "uspto-ledger-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(LEDGER, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(LEDGER, "records.jsonl");
test.after(() => { try { rmSync(LEDGER, { recursive: true, force: true }); } catch { /* gone */ } });

const isoNow = () => new Date().toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
/** The freshest a next-day product can be: the office publishes date D on D+1. */
const yesterday = () => hoursAgo(24);

// `syncedAt` is not decoration. Freshness runs on TWO clocks — the last successful sync (R5's
// "Maximum Acceptable Sync Lag") and the age of the newest data — and an index carrying only the
// second is one no real sync can produce. Defaulting the data date to `now` was exactly that: USPTO
// publishes date D on D+1, so a real index is never dated today, and a fixture that is hid a rule
// which refused every count in production. The default here is now what a healthy sync leaves behind.
// `backfileThrough` defaults to SET, because that is what a healthy sync leaves behind: the register is
// published as an annual backfile plus dailies, and a complete build records that it has both.
// An index without it is a dailies-only build, or one whose backfile has a hole — it can still be
// searched, and it can no longer support a count, which is the clean-negative surface.
function build({ rows, newestDelta = yesterday(), syncedAt = isoNow(), schemaOnly = false,
  backfileThrough = isoNow() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "uspto-core-"));
  const path = join(dir, "us.db");
  const db = createSchema(openIndex(path));
  if (!schemaOnly) {
    putRecords(db, rows);
    rebuildFts(db);
    setMeta(db, "records", String(rows.length));
    if (newestDelta) setMeta(db, "newest_delta", newestDelta);
    if (syncedAt) setMeta(db, "synced_at", syncedAt);
    if (backfileThrough) setMeta(db, "backfile_through", backfileThrough);
  }
  db.close();
  resetHandles();
  return { auth: { dbPath: path }, cleanup: () => { resetHandles(); try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

const many = (n, prefix = "ARBORA") =>
  Array.from({ length: n }, (_, i) => ({
    serial: String(80000000 + i), text: `${prefix}${i} MARK`, status: "700",
    classes: ["009"], owner: `OWNER ${i} SA`,
  }));

test("search reports the whole total and pages without repeating rows", async () => {
  // THE pageParams REGRESSION. The kernel default emits { limit, page }; this store takes
  // { limit, offset }. Inherit the default and page 1 re-returns page 0 — the band dedupes back to
  // one page and still reports itself enumerated.
  const { auth, cleanup } = build({ rows: many(250) });
  try {
    const p0 = parse(await doSearch(auth, { names: ["ARBORA"], predicate: "wildcardInfix", limit: 100, offset: 0 }));
    const p1 = parse(await doSearch(auth, { names: ["ARBORA"], predicate: "wildcardInfix", limit: 100, offset: 100 }));
    assert.equal(p0.total_hits, 250, "the total is the whole answer, not the page");
    assert.equal(p0.results.length, 100);
    assert.equal(p0.has_more, true);
    const ids0 = new Set(p0.results.map((r) => r.record_id));
    const overlap = p1.results.filter((r) => ids0.has(r.record_id));
    assert.equal(overlap.length, 0, "page 1 must not re-return page 0");
  } finally { cleanup(); }
});

test("enumerate completes under the ceiling with every record screened", async () => {
  const { auth, cleanup } = build({ rows: many(120) });
  try {
    const out = parse(await doEnumerate(auth, { names: ["ARBORA"], predicate: "wildcardInfix", in_scope_classes: [9] }));
    assert.equal(out.state, "enumerated");
    assert.equal(out.total_hits, 120);
    assert.equal(out.count, 120);
    // The kernel nests the screened row: { ...record, screen: row }. This is the path
    // supplemental.mjs's preview falls back to, so it is the one that must resolve.
    assert.ok(out.records.every((r) => r.screen?.screen_verdict),
      "every record carries a screening verdict where the kernel puts it");
    assert.ok(out.records.every((r) => r.screen.screen_verdict === "surface:in-scope-live"),
      "in-scope live marks surface rather than being dropped");
    assert.ok(out.records.every((r) => r.record_id?.startsWith("/mark/us/")));
  } finally { cleanup(); }
});

test("a band past the ceiling is a crowd descriptor, not a clean", async () => {
  const { auth, cleanup } = build({ rows: many(700) });
  try {
    const out = parse(await doEnumerate(auth, { names: ["ARBORA"], predicate: "wildcardInfix" }));
    assert.equal(out.state, "incomplete");
    assert.equal(out.total_hits, 700, "the real number rides out, not a truncated one");
    assert.match(out.reason, /CROWD/);
  } finally { cleanup(); }
});

test("a STALE index refuses to count rather than answering zero", async () => {
  // A count over old data reads downstream as a clean negative. R5's threshold is on the SYNC — how
  // long since we asked the office what changed — so that is the clock this drives. (The data-age
  // clock, and why the two are separate, are covered in index-store and sync tests.)
  const { auth, cleanup } = build({ rows: many(5), syncedAt: hoursAgo(72) });
  try {
    const c = await doCount(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.equal(c.ok, false);
    assert.equal(c.total, null, "UNKNOWN is null — never 0");
    assert.match(c.reason, /never a clean negative/);

    const probe = await doCountHits(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.equal(probe.total, null, "the kernel carries the refusal out as unknown");
    assert.notEqual(probe.total, 0);
  } finally { cleanup(); }
});

test("an index with no recorded source date refuses on the same path", async () => {
  // "We cannot establish currency" is not a weaker claim than "we know it is old".
  const { auth, cleanup } = build({ rows: many(5), newestDelta: null });
  try {
    const c = await doCount(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.equal(c.ok, false);
    assert.equal(c.total, null);
    assert.match(c.reason, /currency cannot be established/);
  } finally { cleanup(); }
});

test("a fresh index counts normally", async () => {
  const { auth, cleanup } = build({ rows: many(5) });
  try {
    const c = await doCount(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.equal(c.ok, true);
    assert.equal(c.total, 5);
  } finally { cleanup(); }
});

test("an index that was never built refuses every call instead of answering zero", async () => {
  const { auth, cleanup } = build({ rows: [], schemaOnly: true });
  try {
    const s = await doSearch(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.ok(s.isError, "an unbuilt index is an error, not an empty result set");
    assert.match(s.text, /schema but no records/);
    const c = await doCount(auth, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.equal(c.ok, false);
    assert.equal(c.total, null);
  } finally { cleanup(); }
});

test("a missing index path names the variable rather than failing obscurely", async () => {
  const saved = process.env.USPTO_LOCAL_DB;
  delete process.env.USPTO_LOCAL_DB;
  try {
    const s = await doSearch({}, { names: ["ARBORA"], predicate: "wildcardInfix" });
    assert.ok(s.isError);
    assert.match(s.text, /USPTO_LOCAL_DB/);
    assert.match(s.text, /must refuse rather than return an empty result/);
  } finally { if (saved !== undefined) process.env.USPTO_LOCAL_DB = saved; }
});

test("an elementless search is refused, not answered with the register", async () => {
  // makeEnumerate's default hasAnyElement is () => true. Inheriting it would enumerate everything.
  assert.equal(hasAnyElement({}), false);
  assert.equal(hasAnyElement({ names: [] }), false);
  assert.equal(hasAnyElement({ names: ["ARBORA"] }), true);
  assert.equal(hasAnyElement({ owner: "ACME" }), true);

  const { auth, cleanup } = build({ rows: many(5) });
  try {
    const s = await doSearch(auth, {});
    assert.ok(s.isError);
    assert.match(s.text, /at least one search element/);
  } finally { cleanup(); }
});

test("record fetch resolves a uri or a bare serial, and an absent record is an honest miss", async () => {
  const { auth, cleanup } = build({ rows: many(3) });
  try {
    const byUri = parse(await doRecordFetch(auth, { uri: "/mark/us/80000001" }));
    assert.equal(byUri.applicationNumber, "80000001");
    assert.equal(byUri.office, "US");
    const byId = parse(await doRecordFetch(auth, { id: "80000002" }));
    assert.equal(byId.applicationNumber, "80000002");
    const miss = await doRecordFetch(auth, { id: "99999999" });
    assert.ok(miss.isError, "a record that is not there is a stated miss, never an empty record");
  } finally { cleanup(); }
});

test("batch screen returns screened rows joined on the uris it was given", async () => {
  const { auth, cleanup } = build({ rows: many(4) });
  try {
    const out = parse(await doBatchScreen(auth, {
      uris: ["/mark/us/80000000", "/mark/us/80000001"], in_scope_classes: [9],
    }));
    assert.equal(out.rows.length, 2);
    assert.ok(out.rows.every((r) => r.screen_verdict === "surface:in-scope-live"));
    assert.ok(out.rows.every((r) => r.live_status === "live"));
  } finally { cleanup(); }
});

// ── · CURRENCY IS NOT COMPLETENESS ─────────────────────────────────────────────────────────────
//
// An index can be synced an hour ago and still be missing a century. The register arrives as TWO
// products, and the 1884-2025 backfile is the one a dailies-only build leaves out entirely — the defect
// that shipped. `backfile_through` records that every part the office publishes has been ingested; a
// part that parses to zero records is deliberately not counted, so a hole in the middle withholds it too.
//
// Nothing was reading it. `backfileIsIn` served only the sync's own choice of which products to list, so
// an index with a known hole answered counts exactly like a complete one and the only signal was a line
// printed at build time. Found by adversarial review, 2026-08-11.

test("a count REFUSES on an index that does not record a complete backfile", async () => {
  const { auth, cleanup } = build({ rows: many(5), backfileThrough: null });
  try {
    const c = await doCount(auth, { name: "ARBORA0", match_mode: "default" });
    assert.equal(c.ok, false, "a dailies-only index must not produce a number a clean negative can rest on");
    assert.equal(c.total, null, "and the total is UNKNOWN — never 0, which is the shape of a clean");
    assert.match(c.reason, /backfile/i, "the reason names what is missing");
    assert.match(c.reason, /--full/, "…and how to fix it, or the operator is told only that they are stuck");
  } finally { cleanup(); }
});

test("…and SEARCH still works on it, which is the line this draws", async () => {
  // Deliberate, and the whole reason the refusal is on the count rather than on openFor. Searching an
  // incomplete index is honest — it finds what it holds and claims nothing more. A COUNT is the
  // clean-negative surface: "0 filings" over a register missing its first 140 years is the false clean
  // this provider exists to prevent. `--from-file` builds, which cannot know their own completeness,
  // keep working as a search source exactly as documented.
  const { auth, cleanup } = build({ rows: many(5), backfileThrough: null });
  try {
    const r = await doSearch(auth, { name: "ARBORA0", predicate: "default", limit: 5 }, { kind: "t" });
    assert.ok(!String(r.text).startsWith("ERROR"), "an incomplete index is still a usable search source");
    assert.ok(JSON.parse(r.text).total_hits >= 1);
  } finally { cleanup(); }
});

test("a complete index counts normally — the gate must not refuse a healthy build", async () => {
  const { auth, cleanup } = build({ rows: many(5) });   // backfileThrough defaults to set
  try {
    const c = await doCount(auth, { name: "ARBORA0", match_mode: "default" });
    assert.equal(c.ok, true, `a complete, fresh index must count. Got: ${c.reason}`);
  } finally { cleanup(); }
});
