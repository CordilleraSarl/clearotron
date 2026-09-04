// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// sync.test.mjs — building the index, and the one part of the API contract nobody has seen for real.
//
// `fetch` is injected throughout, so none of this touches the network and none of it needs the USPTO
// account. That is not only convenience: the response SHAPE is the part of this integration that has
// never been observed from this machine (the endpoints and the auth header were probed live and are
// settled; the body was not). Everything here is therefore written so that being wrong about the shape
// is LOUD — the tests below assert the refusals, not just the happy path.
//
// The failure this whole file guards: a sync that finds nothing, says nothing, and leaves an index that
// answers every US query with a confident zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_KEY_HEADER, PRODUCT_ID, BACKFILE_PRODUCT_ID, filesForWindow, backfileIsIn, ingestedFileNames, filesFromProduct, listProductFiles, downloadFile, syncIndex, windowFor,
} from "../src/sync.js";
import { openIndex, getMeta, setMeta, search, countHits } from "../src/index-store.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// The provider cores append to the SHARED register ledger, whose path is read at module load. Point it
// at a scratch file before anything imports them: unset, these tests write into the pre- telemetry directory,
// which on the test box is a file other users' runs are reading.
const LEDGER = mkdtempSync(join(tmpdir(), "uspto-ledger-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(LEDGER, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(LEDGER, "records.jsonl");
test.after(() => { try { rmSync(LEDGER, { recursive: true, force: true }); } catch { /* gone */ } });

// The published schema's shape: bulkDataProductBag[] → productFileBag.fileDataBag[].
const PRODUCT_BODY = {
  count: 1,
  bulkDataProductBag: [{
    productIdentifier: PRODUCT_ID,
    productTitleText: "Trademark Full Text XML (No Images) - Daily Applications",
    productFrequencyText: "DAILY",
    productFileBag: {
      count: 2,
      fileDataBag: [
        { fileName: "apc260808.zip", fileSize: 432, fileDataFromDate: "2026-08-08",
          fileReleaseDate: "2026-08-09 03:12:00",
          fileDownloadURI: `https://api.uspto.gov/api/v1/datasets/products/files/${PRODUCT_ID}/apc260808.zip` },
        { fileName: "apc260807.zip", fileSize: 400, fileDataFromDate: "2026-08-07",
          fileReleaseDate: "2026-08-08 03:11:00",
          fileDownloadURI: `https://api.uspto.gov/api/v1/datasets/products/files/${PRODUCT_ID}/apc260807.zip` },
      ],
    },
  }],
};

const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("the file list comes back oldest-first, with the DATA date rather than the release date", async () => {
  let seenUrl = null; let seenHeaders = null;
  const files = await listProductFiles({
    apiKey: "a-key", from: "2026-08-01", to: "2026-08-09",
    fetchImpl: async (url, opts) => { seenUrl = url; seenHeaders = opts.headers; return jsonRes(PRODUCT_BODY); },
  });
  assert.match(seenUrl, new RegExp(`/api/v1/datasets/products/${PRODUCT_ID}\\?`));
  assert.match(seenUrl, /fileDataFromDate=2026-08-01/);
  assert.match(seenUrl, /fileDataToDate=2026-08-09/);
  assert.equal(seenHeaders[API_KEY_HEADER], "a-key", "the key rides the header the API actually reads");

  // Oldest first: the deltas must be applied in order, or a later correction is overwritten by the
  // earlier record it was correcting.
  assert.deepEqual(files.map((f) => f.dataDate), ["2026-08-07", "2026-08-08"]);
  // The DATA date, not the release date — freshness is a claim about the register, not about when the
  // office got round to publishing.
  assert.equal(files[1].dataDate, "2026-08-08");
  assert.notEqual(files[1].dataDate, "2026-08-09");
});

test("an unrecognised response shape THROWS rather than returning no files", async () => {
  // THE SILENT ONE. An empty list is indistinguishable from "the office published nothing today": the
  // sync would report success, change nothing, and leave whatever index was already there.
  assert.throws(() => filesFromProduct({ results: [] }), /no bulkDataProductBag/);
  // and the message must carry what DID arrive, or the next person has to reproduce it to find out
  assert.throws(() => filesFromProduct({ results: [], count: 0 }), /Keys received: results, count/);

  // ── NARROWED RATHER THAN RELAXED ────────────────────────────────────────────────────────────────
  //
  // This test used to assert that a product carrying NO productFileBag throws. That is exactly what
  // USPTO returns for a window containing none of a product's files — the 1884-2025
  // backfile asked about a 2026 window comes back with productFileTotalQuantity 177 and no file bag at
  // all. The assertion encoded an assumption the office disproved, and the cost was that every ordinary
  // incremental sync of an index whose backfile was not yet recorded threw "the API shape has changed",
  // sending the reader to look at USPTO for a fault in their own index.
  //
  // The danger the assertion guarded is real and has NOT been dropped — it moved to where the caller
  // knows what it asked for. filesFromProduct cannot tell "no files in your window" from "nothing was
  // published"; the CLI can, and refuses by name (see the backfile guard and the empty-listing exit).
  assert.deepEqual(filesFromProduct({ bulkDataProductBag: [{ productIdentifier: PRODUCT_ID }] }), [],
    "an absent file bag is the office saying the window holds none of its files");
});

test("a missing key is refused before the request, naming what to get and where", async () => {
  await assert.rejects(() => listProductFiles({ from: "2026-08-01" }), /USPTO_API_KEY/);
  await assert.rejects(() => listProductFiles({ from: "2026-08-01" }), /--from-file/);
});

test("a rejected key is reported as a rejected key, and never echoed", async () => {
  // 403 is what this API returns for a key it read and did not like — established by probing with a
  // deliberately wrong value. Distinguishing it from 401 (no header arrived) is the difference between
  // "your key is wrong" and "your key never got there".
  const attempt = (status) => listProductFiles({
    apiKey: "sk-secret-value", from: "2026-08-01", fetchImpl: async () => jsonRes({ message: "no" }, status),
  });
  await assert.rejects(attempt(403), (e) => {
    assert.match(e.message, /read and rejected/);
    assert.ok(!e.message.includes("sk-secret-value"), "the key must never appear in an error");
    return true;
  });
  await assert.rejects(attempt(401), /no X-API-KEY header reached/);
});

test("a download whose size disagrees with the API is discarded, not ingested", async () => {
  // A torn download that lands on a record boundary parses perfectly and simply holds fewer marks.
  const dir = mkdtempSync(join(tmpdir(), "uspto-dl-"));
  try {
    const body = readFileSync(join(FIX, "daily-deflate.zip"));
    const fetchImpl = async () => ({
      ok: true, status: 200,
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); c.close(); } }),
    });
    await assert.rejects(
      () => downloadFile({ name: "apc260808.zip", url: "https://x/y", size: body.length + 99 }, dir, { apiKey: "k", fetchImpl }),
      /Refusing a partial file/);
    assert.ok(!existsSync(join(dir, "apc260808.zip")), "nothing is left behind for a later run to ingest");
    assert.ok(!existsSync(join(dir, "apc260808.zip.part")), "the partial is cleaned up too");

    // and the honest case still lands
    const p = await downloadFile({ name: "apc260808.zip", url: "https://x/y", size: body.length }, dir, { apiKey: "k", fetchImpl });
    assert.ok(existsSync(p));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("syncIndex builds a searchable index and stamps its DATA date last", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-"));
  const dbPath = join(dir, "nested", "us.db");
  try {
    const r = await syncIndex({
      dbPath,
      files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc260808.zip", dataDate: "2026-08-08" }],
    });
    assert.equal(r.ingested, 2);
    assert.equal(r.rows, 2);
    assert.equal(r.newestDelta, "2026-08-08");

    const db = openIndex(dbPath, { readonly: true });
    try {
      // The FTS rebuild has to happen AFTER the inserts. A search index missing the rows just added
      // does not error — it just does not find them, which is a clean negative over marks that are
      // sitting in the table two lines away.
      assert.equal(search(db, { predicate: "wildcardPrefix", term: "ARBORA" }).length, 1);
      assert.equal(search(db, { predicate: "wildcardSuffix", term: "ARBORA" }).length, 1, "the reversed index was rebuilt too");
      assert.equal(countHits(db, { predicate: "wildcardInfix", term: "ARBORA" }), 2);
      assert.equal(getMeta(db, "records"), "2");
      assert.match(getMeta(db, "newest_delta"), /^2026-08-08T/);
      assert.ok(getMeta(db, "synced_at"), "the run's own time is recorded separately from the data's");
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a hand-supplied file with no known data date leaves the index UNDATED, on purpose", async () => {
  // --from-file cannot know what the archive covers. Stamping today's date would make a five-year-old
  // download claim to be current, and the provider's freshness check would wave every count through.
  // An undated index refuses to count instead — which is the honest answer and looks like a bug to
  // anyone who has not been told, hence the CLI saying so out loud.
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-"));
  const dbPath = join(dir, "us.db");
  try {
    const r = await syncIndex({ dbPath, files: [{ path: join(FIX, "daily-deflate.zip"), name: "x.zip", dataDate: null }] });
    assert.equal(r.newestDelta, null);
    const db = openIndex(dbPath, { readonly: true });
    try {
      assert.equal(getMeta(db, "newest_delta"), null, "no date is recorded rather than a made-up one");
      assert.equal(getMeta(db, "records"), "2", "the records are there — it is only the currency that is unknown");
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a second sync over the same index is incremental and does not duplicate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-"));
  const dbPath = join(dir, "us.db");
  try {
    const file = { path: join(FIX, "daily-deflate.zip"), name: "apc260808.zip", dataDate: "2026-08-08" };
    await syncIndex({ dbPath, files: [file] });

    // The window for the NEXT run starts at what the index already holds, not at the beginning of time.
    const w = windowFor(dbPath);
    assert.equal(w.incremental, true);
    assert.equal(w.from, "2026-08-08");

    // Re-ingesting the same file must UPDATE its rows, not add a second copy. USPTO deltas re-state a
    // mark whenever anything about it changes, so duplicate serials would be the normal case, not an
    // edge one — and a doubled band reads as two conflicting rights where there is one.
    const again = await syncIndex({ dbPath, files: [file] });
    assert.equal(again.rows, 2, "the same serials update in place");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("A FRESHLY SYNCED INDEX ANSWERS — the seam two green files each missed", async () => {
  // THE ONE THAT MADE THE PROVIDER DEAD ON ARRIVAL, and neither file's tests could see it.
  // core-kernel.test.mjs injected `newest_delta: now()` — a value no real sync can produce. This file
  // asserted the stamp's format and never asked the index a question. Both green; the provider refused
  // every count in production.
  //
  // USPTO publishes the daily file for data date D on D+1, so the FRESHEST an index can ever be is
  // holding yesterday's data, synced seconds ago. If that cannot count, nothing can.
  const dir = mkdtempSync(join(tmpdir(), "uspto-fresh-"));
  const dbPath = join(dir, "us.db");
  try {
    const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
    // The subject here is FRESHNESS, so the index must be COMPLETE — otherwise this asserts that a
    // dailies-only index can count, which is the defect rather than the property being tested. The
    // fixture is one daily file, so the backfile is declared by name and satisfied by that same ingest.
    await syncIndex({ dbPath,
      files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc.zip", dataDate: yesterday }],
      backfileNames: ["apc.zip"] });

    const core = await import("../src/core.js");
    core.resetHandles();
    const c = await core.doCount({ dbPath }, { name: "ARBORA", match_mode: "default" });
    assert.equal(c.ok, true, `a maximally fresh index must be able to count. Got: ${c.reason}`);
    assert.equal(c.total, 2);
    core.resetHandles();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a sync that has not run in days refuses, and says which clock stopped", async () => {
  // The other side of the same rule. R5's threshold is on the SYNC, so this is the one that must bite:
  // an index nobody has refreshed cannot support a clean negative however recent its data looks.
  const dir = mkdtempSync(join(tmpdir(), "uspto-fresh-"));
  const dbPath = join(dir, "us.db");
  try {
    const today = new Date().toISOString().slice(0, 10);
    await syncIndex({ dbPath, files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc.zip", dataDate: today }] });
    const db = openIndex(dbPath);
    try { setMeta(db, "synced_at", new Date(Date.now() - 72 * 3_600_000).toISOString()); } finally { db.close(); }

    const core = await import("../src/core.js");
    core.resetHandles();
    const c = await core.doCount({ dbPath }, { name: "ARBORA", match_mode: "default" });
    assert.equal(c.ok, false);
    assert.equal(c.total, null, "UNKNOWN is null — never 0");
    assert.match(c.reason, /last successful sync/, "the reason names the clock that stopped: re-run the sync");
    assert.match(c.reason, /never a clean negative/);
    core.resetHandles();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a sync that keeps succeeding while applying nothing is caught by the OTHER clock", async () => {
  // The silent one. Syncs run on schedule and succeed, so the sync clock is green — but the newest file
  // applied is weeks back, because the office stopped publishing or every delta is being dropped. A
  // single sync-lag rule would wave this through forever.
  const dir = mkdtempSync(join(tmpdir(), "uspto-fresh-"));
  const dbPath = join(dir, "us.db");
  try {
    const longAgo = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString().slice(0, 10);
    await syncIndex({ dbPath, files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc.zip", dataDate: longAgo }] });

    const core = await import("../src/core.js");
    core.resetHandles();
    const c = await core.doCount({ dbPath }, { name: "ARBORA", match_mode: "default" });
    assert.equal(c.ok, false);
    assert.equal(c.total, null);
    assert.match(c.reason, /sync is current but/, "the reason distinguishes it: the sync is not the problem");
    core.resetHandles();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a delta that parses to NOTHING does not move the index's date", async () => {
  // THE QUIETEST FAILURE IN THE SYNC PATH, and the one the freshness clocks cannot catch on their own.
  // A file that yields zero records errors nowhere: it downloads, opens, inflates and parses fine. If
  // its date is applied anyway, `newest_delta` moves forward and BOTH clocks read green — the data
  // clock reads exactly the value the broken sync just wrote. The index then answers counts with total
  // confidence over a register that stopped updating.
  //
  // Causes that are not hypothetical: the office revises the DTD, the product id starts resolving to a
  // different dataset, a file is published as a stub.
  const dir = mkdtempSync(join(tmpdir(), "uspto-empty-"));
  const dbPath = join(dir, "us.db");
  try {
    const good = { path: join(FIX, "daily-deflate.zip"), name: "apc-good.zip", dataDate: "2026-08-01" };
    const first = await syncIndex({ dbPath, files: [good] });
    assert.equal(first.newestDelta, "2026-08-01");
    assert.deepEqual(first.empty, []);

    // A later, NEWER file that parses to nothing. no-xml.zip cannot even yield an XML entry, so this
    // routes through ingestFile's own failure; use a stub the scanner accepts and finds no records in.
    const stub = join(dir, "stub.xml");
    writeFileSync(stub, "<trademark-applications-daily></trademark-applications-daily>");
    const second = await syncIndex({ dbPath, files: [{ path: stub, name: "apc-empty.zip", dataDate: "2026-08-08" }] });

    assert.equal(second.ingested, 0);
    assert.deepEqual(second.empty, ["apc-empty.zip"], "the empty file is NAMED, not silently skipped");
    assert.equal(second.newestDelta, "2026-08-01",
      "the date must NOT advance to a file that contributed nothing — doing so makes both freshness "
      + "clocks green over a register that stopped updating");

    const db = openIndex(dbPath, { readonly: true });
    try {
      assert.match(getMeta(db, "newest_delta"), /^2026-08-01T/, "and it is not advanced on disk either");
      assert.ok(getMeta(db, "synced_at"), "the sync itself DID run, and that is recorded honestly");
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a mixed batch applies the dates of the files that had records, and only those", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-empty-"));
  const dbPath = join(dir, "us.db");
  try {
    const stub = join(dir, "stub.xml");
    writeFileSync(stub, "<trademark-applications-daily></trademark-applications-daily>");
    const r = await syncIndex({ dbPath, files: [
      { path: join(FIX, "daily-deflate.zip"), name: "good.zip", dataDate: "2026-08-05" },
      { path: stub, name: "empty.zip", dataDate: "2026-08-09" },
    ] });
    assert.equal(r.newestDelta, "2026-08-05", "the newest file with records wins, not the newest file");
    assert.deepEqual(r.empty, ["empty.zip"]);
    assert.equal(r.rows, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("windowFor asks for everything when there is no index yet", () => {
  const w = windowFor(join(tmpdir(), "definitely-not-here", "us.db"));
  assert.equal(w.incremental, false);
  assert.ok(w.from < "1900-01-01", "a full pull reaches back before the register's first filing");
});

// ── · THE REGISTER IS TWO PRODUCTS ─────────────────────────────────────────────────────────────
//
// WHAT SHIPPED. The sync pulled TRTDXFAP — "Daily Applications" — and nothing else. Probed live on
// 2026-08-11 with a real key, that product runs 2025-01-01 → today. The backfile is a SEPARATE product,
// TRTYRAP, 1884-04-07 → last full year, 177 files, 22.1 GB.
//
// So the index held filings from 2025 onward and nothing before: roughly a century and a half of the US
// register absent, from the one source whose entire job is to say whether a mark is already taken.
//
// WHY IT WAS INVISIBLE. `windowFor` already asked for 1884-01-01 on a full pull, so the intent read
// correctly at the call site. The request went to a product with nothing that old, the API returned
// exactly what it had, and every check downstream passed: the sync reported success, assertIndexReady
// saw rows, the freshness clock read today. The only symptom available was a clean negative on a mark
// that has been registered since 1974.
//
// These tests are therefore about COMPOSITION and ORDER, not about any single call working.

test("a full pull takes the backfile AND the dailies — a register, not a recent slice", async () => {
  const asked = [];
  const files = await filesForWindow({
    apiKey: "k", window: { from: "1884-01-01", to: "2026-08-11", incremental: false },
    listImpl: async ({ productId }) => { asked.push(productId); return [{ name: `${productId}.zip`, url: "u", dataDate: "2026-01-01" }]; },
  });
  assert.deepEqual(asked, [PRODUCT_ID, BACKFILE_PRODUCT_ID], "both products are listed");
  assert.equal(files.length, 2);
  assert.equal(files[0].productId, BACKFILE_PRODUCT_ID, "BACKFILE FIRST — see below");
  assert.equal(files[1].productId, PRODUCT_ID);
});

test("the backfile is ingested FIRST, so the dailies overwrite it and not the reverse", async () => {
  // The two products overlap on the current year and putRecords upserts by serial, so the LAST write
  // wins. The dailies are the later and truer statement of a filing's status. Reverse the order and the
  // annual file's older snapshot lands on top: a mark refused in March reads live again, or a live one
  // reads dead, and nothing anywhere reports a conflict — the index is simply wrong and confident.
  const files = await filesForWindow({
    apiKey: "k", window: { from: "1884-01-01", to: "2026-08-11", incremental: false },
    listImpl: async ({ productId }) => [{ name: `${productId}-a.zip`, url: "u" }, { name: `${productId}-b.zip`, url: "u" }],
  });
  const order = files.map((f) => f.productId);
  assert.deepEqual(order, [BACKFILE_PRODUCT_ID, BACKFILE_PRODUCT_ID, PRODUCT_ID, PRODUCT_ID],
    "every backfile entry precedes every daily entry");
});

test("once the backfile IS in, later pulls take the dailies only", async () => {
  const asked = [];
  const files = await filesForWindow({
    apiKey: "k", window: { from: "2026-08-01", to: "2026-08-11", incremental: true }, hasBackfile: true,
    listImpl: async ({ productId }) => { asked.push(productId); return [{ name: `${productId}.zip`, url: "u" }]; },
  });
  assert.deepEqual(asked, [PRODUCT_ID], "re-listing 22 GB of annual files every night to learn nothing");
  assert.equal(files.length, 1);
  assert.equal(files[0].productId, PRODUCT_ID);
});

test("every file carries the product it came from, so a reader can see WHICH register they built", async () => {
  const files = await filesForWindow({
    apiKey: "k", window: { from: "1884-01-01", to: "2026-08-11", incremental: false },
    listImpl: async ({ productId }) => [{ name: `${productId}.zip`, url: "u" }],
  });
  assert.ok(files.every((f) => typeof f.productId === "string" && f.productId));
  // "590 files" read as complete for as long as nobody knew a second product existed. The per-product
  // count in the CLI is what makes 767-vs-590 legible, and it can only exist if this field does.
});

// ── the download → ingest → drop loop, which is what makes 41 GB fit in 49 GB ───────────────────────

test("syncIndex resolves each file's path through onFile, so a caller can fetch it just in time", async () => {
  const order = [];
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-hooks-"));
  try {
    const res = await syncIndex({
      dbPath: join(dir, "i.sqlite"),
      files: [{ name: "one.zip", dataDate: "2026-01-01" }, { name: "two.zip", dataDate: "2026-01-02" }],
      onFile: async (f) => { order.push(`download:${f.name}`); f.path = `/nowhere/${f.name}`; },
      onIngested: async (f) => { order.push(`drop:${f.name}`); },
      ingest: async (_db, path) => { order.push(`ingest:${path}`); return { records: 1 }; },
    });
    assert.equal(res.ingested, 2);
    // Strictly interleaved. Download-all-then-ingest-all needs 41 GB of archives at once against 49 GB
    // free, and a full disk fails as "artifact absent" rather than as a disk error.
    assert.deepEqual(order, [
      "download:one.zip", "ingest:/nowhere/one.zip", "drop:one.zip",
      "download:two.zip", "ingest:/nowhere/two.zip", "drop:two.zip",
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("onFile is AWAITED — a promise left unawaited ingests a path that is not there yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-await-"));
  try {
    let seen = null;
    await syncIndex({
      dbPath: join(dir, "i.sqlite"),
      files: [{ name: "one.zip", dataDate: "2026-01-01" }],
      // Resolves on a later tick, exactly as a real download does.
      onFile: async (f) => { await new Promise((r) => setTimeout(r, 5)); f.path = "/resolved/one.zip"; },
      ingest: async (_db, path) => { seen = path; return { records: 1 }; },
    });
    assert.equal(seen, "/resolved/one.zip",
      "an unawaited hook hands ingest an undefined path — and the ENOENT names a file nobody typed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#840 onPhase fires after the ingest loop and again after the FTS rebuild, in that order", async () => {
  // The rebuild happens INSIDE syncIndex and blocks the caller's thread throughout, so a caller
  // watching disk from outside can see the total but not which phase set it. These two hooks are the
  // only place the log can attribute it. Ordering is asserted against the INDEX's own state rather than
  // against the call sequence: a hook that fires in the right order but after the work it names would
  // pass a sequence check and mislabel the peak.
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-phase-"));
  const dbPath = join(dir, "i.sqlite");
  const ftsHitsAt = {};
  try {
    const phases = [];
    await syncIndex({
      dbPath,
      files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc260808.zip", dataDate: "2026-08-08" }],
      onPhase: async (phase) => {
        phases.push(phase);
        const db = openIndex(dbPath, { readonly: true });
        try { ftsHitsAt[phase] = search(db, { predicate: "wildcardPrefix", term: "ARBORA" }).length; } finally { db.close(); }
      },
    });
    assert.deepEqual(phases, ["ingest", "fts"]);
    assert.equal(ftsHitsAt.ingest, 0, "the ingest phase hook ran BEFORE the FTS rebuild — the index cannot answer a prefix query yet");
    assert.equal(ftsHitsAt.fts, 1, "the fts phase hook ran AFTER the rebuild");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#840 syncIndex works with no onPhase hook at all", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-sync-nophase-"));
  try {
    const r = await syncIndex({
      dbPath: join(dir, "i.sqlite"),
      files: [{ path: join(FIX, "daily-deflate.zip"), name: "apc260808.zip", dataDate: "2026-08-08" }],
    });
    assert.equal(r.rows, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the backfile decision is a FACT ABOUT THE INDEX, not a property of the window ───────────────────
//
// The first cut gated it on `window.incremental`, which is the same omission the backfile bug was, one
// layer up. `--since` sets incremental:true WITHOUT asking whether an index exists, so
// `uspto-sync --since 2026-01-01` against a fresh index built a 2026-only register, stamped
// newest_delta, and every default run afterwards was incremental — the backfile never arrived. It opens,
// reports rows, and the freshness clock reads today. Exactly the shape that shipped.

test("`--since` on a FRESH index still takes the backfile — the hole the window bit left open", async () => {
  const asked = [];
  await filesForWindow({
    // what `--since` produces: incremental true, and nothing has asked whether an index exists
    apiKey: "k", window: { from: "2026-01-01", to: "2026-08-11", incremental: true }, hasBackfile: false,
    listImpl: async ({ productId }) => { asked.push(productId); return [{ name: `${productId}.zip`, url: "u" }]; },
  });
  assert.ok(asked.includes(BACKFILE_PRODUCT_ID),
    "an index with no backfile must pull one whatever the window says, or --since silently builds a "
    + "register that starts at the --since date and nothing ever notices");
});

test("backfileIsIn reads the index, and answers FALSE when there is none", () => {
  // False for missing/unreadable is the correct direction: no index means the backfile is not in it, and
  // the cost of being wrong here is a partial register that looks complete.
  assert.equal(backfileIsIn("/nowhere/definitely-not-an-index.sqlite"), false);
});

test("backfile_through is stamped only when EVERY backfile file is in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-backfile-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    const backfile = [
      { name: "b1.zip", productId: BACKFILE_PRODUCT_ID, dataDate: "2025-12-31", path: "/x/b1" },
      { name: "b2.zip", productId: BACKFILE_PRODUCT_ID, dataDate: "2025-12-31", path: "/x/b2" },
    ];
    const names = backfile.map((f) => f.name);   // the CLI always lists the product WHOLE
    // Only the first one ingests, then the build dies.
    await syncIndex({ dbPath, files: [backfile[0]], backfileNames: names, ingest: async () => ({ records: 1 }) });
    assert.equal(backfileIsIn(dbPath), false,
      "a HALF-done backfile must never read as done — measuring completeness against the BATCH rather "
      + "than the product listing is how a partial register comes to report itself whole");

    await syncIndex({ dbPath, files: backfile, backfileNames: names, ingest: async () => ({ records: 1 }) });
    assert.equal(backfileIsIn(dbPath), true, "…and once every listed part is in, it does");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── resume ──────────────────────────────────────────────────────────────────────────────────────────

test("an interrupted build resumes instead of re-downloading 41 GB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-resume-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    const files = [
      { name: "a.zip", dataDate: "2026-01-01", path: "/x/a" },
      { name: "b.zip", dataDate: "2026-01-02", path: "/x/b" },
      { name: "c.zip", dataDate: "2026-01-03", path: "/x/c" },
    ];
    await syncIndex({ dbPath, files: files.slice(0, 2), ingest: async () => ({ records: 5 }) });

    const fetched = [];
    const second = await syncIndex({
      dbPath, files,
      onFile: async (f) => { fetched.push(f.name); },
      ingest: async () => ({ records: 5 }),
    });
    assert.deepEqual(fetched, ["c.zip"], "only the unfinished file is fetched again");
    assert.equal(second.skipped, 2);
    assert.equal(second.ingested, 5, "and the skipped files are not re-counted into the total");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an interrupted build leaves NO date, so the provider refuses rather than answering partially", async () => {
  // The property resume is built on top of, and the one that must not be traded for convenience.
  // Stamping newest_delta per file would make a killed build read as a current one — rows present,
  // clock green, half the register missing. Measured on the real interrupted build: 2,484,370 rows and
  // no date, and the provider refused to count. That is the correct outcome, not a gap to close.
  const dir = mkdtempSync(join(tmpdir(), "uspto-partial-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    await assert.rejects(() => syncIndex({
      dbPath,
      files: [{ name: "a.zip", dataDate: "2026-01-01", path: "/x/a" }, { name: "b.zip", dataDate: "2026-01-02", path: "/x/b" }],
      ingest: async (_db, path) => { if (path === "/x/b") throw new Error("killed"); return { records: 1 }; },
    }));
    const { openIndex, getMeta } = await import("../src/index-store.js");
    const db = openIndex(dbPath, { readonly: true });
    try {
      assert.ok(db.prepare("SELECT count(*) n FROM mark").get().n >= 0);
      assert.equal(getMeta(db, "newest_delta") ?? null, null,
        "a partial index must carry no data date — that is what makes the provider refuse to count");
      assert.equal(getMeta(db, "backfile_through") ?? null, null);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the three holes the adversarial review of 2026-08-11 found in the resume work ───────────────────
//
// All three are the same family as the defect the resume work was fixing: an index that is not what the
// operator believes, with every visible signal saying it is fine.

test("--full REBUILDS; without that it certifies the index it was asked to replace", async () => {
  // `--full` set the window and nothing cleared the resume record, so the skip fired on every file:
  // nothing was re-ingested, and synced_at, newest_delta and backfile_through were all re-stamped on
  // whatever was already there. The operator's one escape hatch from a bad index blessed it instead.
  const dir = mkdtempSync(join(tmpdir(), "uspto-full-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    const files = [{ name: "a.zip", dataDate: "2026-01-01", path: "/x/a" }, { name: "b.zip", dataDate: "2026-01-02", path: "/x/b" }];
    await syncIndex({ dbPath, files, ingest: async () => ({ records: 3 }) });

    const resumed = await syncIndex({ dbPath, files, ingest: async () => ({ records: 3 }) });
    assert.equal(resumed.ingested, 0, "a default re-run resumes and does nothing — that is correct");
    assert.equal(resumed.skipped, 2);

    const full = await syncIndex({ dbPath, files, ingest: async () => ({ records: 3 }), ignoreIngested: true });
    assert.equal(full.skipped, 0, "--full must ignore the resume record entirely");
    assert.ok(full.ingested > 0, "…and actually re-ingest, or it is a no-op wearing a success message");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a window with no files in it is an ANSWER, not a broken API contract", () => {
  // Probed live: asking the 1884-2025 backfile for a 2026 window returns the product object with no
  // productFileBag at all. Treating that as a shape error threw on every ordinary incremental sync of an
  // index whose backfile was not yet recorded — and threw with "the API shape has changed", sending the
  // reader to look at USPTO rather than at their own index.
  const body = { bulkDataProductBag: [{ productIdentifier: BACKFILE_PRODUCT_ID, productFileTotalQuantity: 177 }] };
  assert.deepEqual(filesFromProduct(body, { productId: BACKFILE_PRODUCT_ID }), [],
    "an absent file bag means no files in this window");
});

test("…but a response that genuinely does not parse still throws", () => {
  // The original strictness is the point and must survive: an empty list returned for a BROKEN response
  // would sync nothing and report success.
  assert.throws(() => filesFromProduct({}, { productId: PRODUCT_ID }), /bulkDataProductBag/);
  assert.throws(() => filesFromProduct({ bulkDataProductBag: [] }, { productId: PRODUCT_ID }), /no product/);
  assert.throws(
    () => filesFromProduct({ bulkDataProductBag: [{ productIdentifier: PRODUCT_ID, productFileBag: { fileDataBag: "nope" } }] }, { productId: PRODUCT_ID }),
    /not an array/);
});

test("ingestedFileNames reads the same record syncIndex writes, so the two cannot disagree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-names-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    assert.deepEqual([...ingestedFileNames(dbPath)], [], "a missing index has ingested nothing");
    await syncIndex({ dbPath, files: [{ name: "a.zip", dataDate: "2026-01-01", path: "/x/a" }], ingest: async () => ({ records: 1 }) });
    assert.deepEqual([...ingestedFileNames(dbPath)], ["a.zip"]);
    // The disk pre-check subtracts these. Charging for them refuses the very resume it exists to enable:
    // a build killed at 95% would be told it needs the whole build's room to fetch the last few files.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a backfile part that yields ZERO records withholds the completeness stamp", async () => {
  // The hole that reads as complete. A part downloads, passes the size check, inflates, parses cleanly
  // — and yields nothing, because its XML predates the DTD the parser handles. Every step succeeded.
  //
  // What stops it is the `continue` on an empty parse: the file's date is not applied AND its name is
  // never added to the ingested record, so `backfile_through` cannot be satisfied. Verified by break
  // matrix — removing that `continue` marks the hole ingested and stamps the index complete.
  const dir = mkdtempSync(join(tmpdir(), "uspto-hole-"));
  const dbPath = join(dir, "i.sqlite");
  try {
    const backfile = [
      { name: "b1.zip", productId: BACKFILE_PRODUCT_ID, dataDate: "2025-12-31", path: "/x/b1" },
      { name: "b2.zip", productId: BACKFILE_PRODUCT_ID, dataDate: "2025-12-31", path: "/x/b2" },
    ];
    const res = await syncIndex({ dbPath, files: backfile, backfileNames: backfile.map((f) => f.name),
      ingest: async (_db, p) => ({ records: p === "/x/b2" ? 0 : 5 }) });

    assert.deepEqual(res.empty, ["b2.zip"], "the empty part is REPORTED, not passed over");
    assert.equal(backfileIsIn(dbPath), false,
      "a backfile with a hole in it must not read as complete — every downstream check passes on it, "
      + "and the only symptom is a clean negative on whatever those records held");
    const { openIndex, getMeta } = await import("../src/index-store.js");
    const db = openIndex(dbPath, { readonly: true });
    try {
      assert.deepEqual(JSON.parse(getMeta(db, "ingested_files")), ["b1.zip"],
        "…and the hole is not recorded as done, so a re-run attempts it again");
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
