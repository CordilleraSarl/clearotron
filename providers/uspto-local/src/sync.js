// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// sync.js — build and update the local US register from USPTO's bulk data.
//
// ── THE CONTRACT, AND HOW MUCH OF IT IS VERIFIED ─────────────────────────────────────────────────
// The endpoints, the auth header and the product id below are NOT inherited by analogy from another
// provider (see skills/prelim-register/providers/README.md on why that rule exists). They come from
// USPTO's own OpenAPI description of the Open Data Portal, cross-checked against live probes from this
// machine:
//
//   * path existence was probed by STATUS CODE — the gateway answers 401 "Unauthorized" for a route
//     that exists and 403 "Forbidden" for one that does not. /api/v1/datasets/products/search and
//     /api/v1/datasets/products/{id} both return 401; /api/v1/datasets/products returns 403.
//   * the auth header was identified the same way, with a deliberately WRONG key: no header and
//     `Authorization:`/`apiKey:` all give "Unauthorized", while `X-API-KEY:` gives "Forbidden" — the
//     header was read and the value rejected. That is the discriminator, and it needed no real key.
//
// WHAT IS STILL UNVERIFIED, because it needs an account: the RESPONSE BODY. The field names below
// (bulkDataProductBag → productFileBag → fileDataBag → fileDownloadURI) are from the published schema
// and have never been seen from this machine. `filesFromProduct` therefore refuses loudly and prints
// what it actually received rather than returning an empty list — an empty file list would sync
// nothing, report success, and leave an index that answers every query with a confident zero.
//
// ── bulkdata.uspto.gov IS GONE, NOT BLOCKED ──────────────────────────────────────────────────────
// The legacy host every existing open-source parser points at was decommissioned with the old
// Developer Hub. It resolves NOERROR with no address record on our resolver, on 1.1.1.1 and on 8.8.8.8
// alike — so it is retired, not firewalled, and no proxy or allowlist will bring it back. Anything
// that still names it is out of date.

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ingestStream } from "./ingest.js";
import { openIndex, createSchema, putRecords, rebuildFts, setMeta, getMeta } from "./index-store.js";
import { soleXmlEntry, openEntry } from "./zip.js";

export const API_BASE = "https://api.uspto.gov";
export const API_KEY_HEADER = "X-API-KEY";
// ── THE REGISTER IS TWO PRODUCTS, AND PULLING ONLY ONE OF THEM IS A FALSE CLEAN ────────────────────
//
// The API, asked with a real key to list every trademark product, answers:
//
//     TRTYRAP    Annual Applications   1884-04-07 .. 2025-12-31   177 files   22.1 GB
//     TRTDXFAP   Daily Applications    2025-01-01 .. today        590 files   19.4 GB
//
// The dailies do NOT go back. `TRTDXFAP` begins on 2025-01-01 and the office keeps no earlier file in
// it, so an index built from that product alone holds filings from 2025 onward and NOTHING before —
// about a century and a half of the US register missing, out of a source whose whole purpose is to
// answer "is anyone already using this mark".
//
// This shipped. `windowFor` already asked for 1884-01-01 on a full pull, so the INTENT was right; the
// request simply went to a product that has nothing that old, the API returned what it had, and every
// downstream check passed. That is what makes it the dangerous shape rather than a bug that announces
// itself: the sync reports success, `assertIndexReady` sees rows, the freshness clock reads today, and
// a US clearance returns a confident clean negative over a register that was never searched. Doctrine
// rule 2, arrived at through an omission instead of a claim.
//
// So a FULL pull takes the backfile and the dailies. An INCREMENTAL pull takes the dailies only, which
// is correct and is why the split is by window rather than by a flag: once the backfile is in, the
// annual product has nothing to add that the dailies do not carry.
//
/** Trademark Full Text XML (No Images) — Daily Applications. 2025-01-01 onward; NOT the backfile. */
export const PRODUCT_ID = "TRTDXFAP";
/** Trademark Full Text XML (No Images) — Annual Applications. 1884 → last full year. The backfile. */
export const BACKFILE_PRODUCT_ID = "TRTYRAP";
/**
 * Where the backfile starts, and the one date that is NEVER narrowed by a caller's window.
 *
 * The office's first annual part is dated 1884-04-07; this asks from the start of that year so a
 * boundary change at the office cannot silently drop the earliest part. Whether the backfile is
 * COMPLETE is not a question `--since` gets to scope — see filesForWindow.
 */
export const BACKFILE_FROM = "1884-01-01";
export const API_KEY_ENV = "USPTO_API_KEY";

const iso = (d) => d.slice(0, 10);

/**
 * Pull the file list for a product over a date window.
 *
 * `fetchImpl` is injected so every caller — the CLI, the tests, a future retry wrapper — exercises the
 * same parsing. The tests supply a fetch that never touches the network, which is the only way any of
 * this is verifiable before an account exists.
 */
export async function listProductFiles({ apiKey, from, to, latest = false, productId = PRODUCT_ID,
  base = API_BASE, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) {
    throw new Error(
      `no ${API_KEY_ENV}. The bulk endpoint needs a free USPTO.gov account (with ID.me identity `
      + "verification) and its API key; nothing is billed, the account exists to rate-limit the "
      + "endpoint. Set it, or ingest a file you downloaded by hand with --from-file.");
  }
  const q = new URLSearchParams();
  if (from) q.set("fileDataFromDate", iso(from));
  if (to) q.set("fileDataToDate", iso(to));
  if (latest) q.set("latest", "true");
  q.set("includeFiles", "true");
  const url = `${base}/api/v1/datasets/products/${encodeURIComponent(productId)}?${q}`;

  const res = await fetchImpl(url, { headers: { [API_KEY_HEADER]: apiKey, Accept: "application/json" } });
  if (!res.ok) {
    // The key itself is NEVER echoed, here or anywhere. 403 is the shape a bad key takes on this API.
    throw new Error(`USPTO bulk API ${res.status} for product ${productId}`
      + (res.status === 403 ? ` — the ${API_KEY_ENV} was read and rejected. Check it on the Manage API Key page of your USPTO.gov account.` : "")
      + (res.status === 401 ? ` — no ${API_KEY_HEADER} header reached the API.` : ""));
  }
  return filesFromProduct(await res.json(), { productId });
}

/**
 * Dig the file list out of the product response.
 *
 * SEPARATE AND EXPORTED ON PURPOSE. This is the one part of the contract nobody here has seen a real
 * response for, so it is the one part most likely to be wrong — and it is written so that being wrong
 * is LOUD. An unrecognised shape throws with a summary of what actually arrived; it must never return
 * `[]`, because an empty list is indistinguishable from "the office published nothing today" and would
 * sync nothing while reporting success.
 */
export function filesFromProduct(body, { productId = PRODUCT_ID } = {}) {
  const products = body?.bulkDataProductBag;
  if (!Array.isArray(products)) {
    throw new Error(
      `the USPTO product response for ${productId} has no bulkDataProductBag array — the API shape has `
      + `changed or this is not a product response. Keys received: ${Object.keys(body ?? {}).join(", ") || "none"}. `
      + "Refusing rather than syncing zero files, which would look like a successful no-op.");
  }
  const product = products.find((p) => p?.productIdentifier === productId) ?? products[0];
  if (!product) {
    throw new Error(
      `the USPTO response carried no product for ${productId}. Refusing rather than syncing zero files, `
      + "which would look like a successful no-op.");
  }
  // ── NO FILES IN THIS WINDOW IS AN ANSWER, NOT A BROKEN CONTRACT ─────────────────────────────────
  //
  // Asking TRTYRAP (the 1884-2025 backfile) for a window inside the current month returns
  // the product object with productFileTotalQuantity 177 and NO productFileBag at all. The office is
  // saying "nothing of mine falls in your window". That is the normal shape for any window past a
  // product's productToDate.
  //
  // Treating it as a shape error threw on every ordinary incremental sync of an index whose backfile was
  // not yet stamped — and threw with "the API shape has changed", sending the reader to look at USPTO
  // rather than at their own index. The throw stays for a response that genuinely does not parse; an
  // ABSENT file bag now returns [], and the caller decides what an empty list means for what it asked.
  const bag = product.productFileBag?.fileDataBag;
  if (bag === undefined) return [];
  if (!Array.isArray(bag)) {
    throw new Error(
      `product ${productId} came back with a productFileBag.fileDataBag that is not an array `
      + `(${typeof bag}). Product keys: ${Object.keys(product).join(", ") || "none"}. Refusing rather `
      + "than syncing zero files.");
  }
  return bag
    .filter((f) => f?.fileDownloadURI && f?.fileName)
    .map((f) => ({
      name: String(f.fileName),
      url: String(f.fileDownloadURI),
      size: Number(f.fileSize) || null,
      // fileDataFromDate is the DATA's date — what the file covers. fileReleaseDate is when it was
      // published. Freshness is a claim about the register, so it is the data date that matters.
      dataDate: f.fileDataFromDate ? iso(String(f.fileDataFromDate)) : null,
      releasedAt: f.fileReleaseDate ?? f.fileLastModifiedDateTime ?? null,
    }))
    .sort((a, b) => String(a.dataDate ?? "").localeCompare(String(b.dataDate ?? "")));
}

/** Download one product file to disk. Written to a `.part` and renamed, so a torn download is never ingested. */
export async function downloadFile(file, destDir, { apiKey, fetchImpl = globalThis.fetch } = {}) {
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, file.name);
  const part = `${dest}.part`;
  const res = await fetchImpl(file.url, { headers: { [API_KEY_HEADER]: apiKey }, redirect: "follow" });
  if (!res.ok) throw new Error(`download ${file.name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  // The size check is the torn-download guard. A truncated zip usually fails in the reader, but a
  // truncation that lands on a record boundary parses cleanly and simply holds fewer marks.
  if (file.size) {
    const { size } = await stat(part);
    if (size !== file.size) {
      await unlink(part).catch(() => {});
      throw new Error(`download ${file.name}: got ${size} bytes, the API said ${file.size}. Refusing a partial file — a truncated register reads as a smaller one.`);
    }
  }
  await rename(part, dest);
  return dest;
}

/**
 * Ingest one archive or raw XML file into an index.
 *
 * @returns {Promise<{records:number}>}
 */
export async function ingestFile(db, path, { batchSize = 2000, onProgress = null } = {}) {
  const source = /\.zip$/i.test(path)
    ? await openEntry(path, await soleXmlEntry(path))
    : (await import("node:fs")).createReadStream(path);

  let total = 0;
  const count = await ingestStream(source, {
    batchSize,
    onBatch: (rows) => {
      putRecords(db, rows);
      total += rows.length;
      onProgress?.(total);
    },
  });
  return { records: count ?? total };
}

/**
 * The whole job: open (or create) the index, ingest each file in date order, then rebuild the search
 * index and stamp the metadata.
 *
 * THE ORDER MATTERS AND THE STAMP IS LAST. `newest_delta` is what the provider's freshness check reads,
 * and writing it before the data is in would mark a half-built index current. The FTS rebuild likewise
 * comes after every insert: a search index that is missing the rows just added does not error, it
 * simply does not find them — which is a clean negative over marks that are sitting in the table.
 *
 * `onPhase("ingest"|"fts")` fires as each of those two ends. It exists for: the FTS rebuild runs
 * INSIDE this function, so a caller watching disk from outside can see the total but cannot tell which
 * phase set it. Called after the phase, never before, so the reading it triggers describes work that
 * has actually happened.
 */
export async function syncIndex({ dbPath, files, ingest = ingestFile, onFile = null, onIngested = null, onPhase = null, backfileNames = null, ignoreIngested = false } = {}) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = createSchema(openIndex(dbPath));
  try {
    let ingested = 0;
    // Files that parsed to NOTHING. Tracked rather than ignored — see the loop below.
    const empty = [];
    // ONE REPRESENTATION, NORMALISED ON READ. The stored value is a full ISO instant, because that is
    // what the provider's freshness check compares against; the working value here is a bare date,
    // because that is what the API reports and what compares correctly against it. Mixing the two is
    // silent in the direction that matters — a date string never sorts above the ISO instant of the
    // same day, so an index synced twice would keep re-reporting the OLDER date and slide toward stale
    // while being perfectly up to date. (It also throws on the re-stamp, which is how this was found.)
    let newest = iso(getMeta(db, "newest_delta") ?? "") || null;

    // ── RESUME ──────────────────────────────────────────────────────────────────────────────────────
    //
    // A full build is 767 files over ~41 GB and most of a day. Without this, a kill, an HTTP failure or
    // a reboot at hour 20 re-downloads all of it: downloadFile fetches unconditionally and the archives
    // are dropped as they are ingested, so nothing on disk records progress. It was paid once already.
    //
    // The record is per FILE NAME and is persisted after each one, so the cost of an interruption is the
    // file in flight rather than the build.
    //
    // `newest_delta` is deliberately NOT written here — it stays at the end of the loop. That is the
    // property that makes an interrupted build SAFE rather than merely resumable: a partial index has
    // rows but no date, and the provider refuses to count rather than answering over part of the
    // register. Measured on a real interrupted build: 2,484,370 rows, no date, refuses. Move the stamp
    // in here for convenience and a killed build starts reading as a current one.
    // `ignoreIngested` is what makes --full mean what it says. Without it the resume record silently
    // won every time: --full set the window, nothing cleared the record, and the skip below fired on
    // every file — so `uspto-sync --full` re-ingested NOTHING, re-stamped synced_at, newest_delta and
    // backfile_through, and reported success. The operator's one escape hatch from a bad index became
    // the thing that certified it. The record is still WRITTEN on a full run, so a --full that dies
    // halfway can itself be resumed.
    const alreadyIngested = new Set(ignoreIngested ? [] : (() => {
      try { return JSON.parse(getMeta(db, "ingested_files") ?? "[]"); } catch { return []; }
    })());
    let skipped = 0;

    for (const f of files) {
      if (alreadyIngested.has(f.name)) { skipped++; continue; }
      // AWAITED, and that is what lets a caller fetch the archive HERE rather than up front. The full
      // build is ~41 GB of archives across two products; downloading them all before ingesting any
      // needs that much disk at once, and the box has 49 GB. Resolving each file as its turn comes,
      // and dropping it in `onIngested` below, holds the peak at one archive plus the index.
      //
      // `f.path` is therefore read AFTER the hook, never before.
      await onFile?.(f);
      const { records } = await ingest(db, f.path, {});
      ingested += records;
      // ── A FILE'S DATE ONLY COUNTS IF THE FILE CONTRIBUTED RECORDS ────────────────────────────────
      // Advancing the date unconditionally is how a sync starts lying. A delta that parses to zero —
      // the office changed the DTD, the archive held a different product, the XML is a stub — is not
      // an error anywhere: it downloads, it opens, it inflates, it parses, it yields nothing. Move
      // `newest_delta` forward from it and BOTH freshness clocks go green, because the data clock
      // reads exactly the value the broken sync just advanced. The index then answers counts with
      // total confidence over a register that stopped updating, which is the precise failure the
      // data-lag clock in index-store.js exists to catch — and it would be catching nothing.
      //
      // The safe direction is obvious once stated: refusing to advance can only make the index read
      // STALER than it is, and a stale index refuses rather than over-claims. So a zero-record file
      // moves nothing and is reported.
      if (!records) { empty.push(f.name ?? f.path); continue; }
      if (f.dataDate && (!newest || f.dataDate > newest)) newest = f.dataDate;
      // The archive is no longer needed: its records are in the index and its date has been applied.
      // Handing that fact to the caller rather than unlinking here keeps this function filesystem-free
      // apart from the index itself — so --from-file never deletes a file the operator supplied.
      alreadyIngested.add(f.name);
      setMeta(db, "ingested_files", JSON.stringify([...alreadyIngested]));
      await onIngested?.(f);
    }
    // ── the stamp, and why it is measured against the CALLER'S full listing ────────────────────────
    //
    // Written only once EVERY backfile file the product publishes is in. The first cut measured
    // completeness against `files` — the batch handed to THIS call — so a run that was given one
    // backfile part, or a run interrupted after one, ingested it, found "every backfile file I was
    // given is in", and stamped the index complete. A partial register that then reads as whole, which
    // is the bug this whole branch exists to remove, reintroduced by the guard against it.
    //
    // `backfileNames` is the full list from the product listing, so the question asked is "is the
    // BACKFILE in", not "did I finish my batch".
    const wanted = Array.isArray(backfileNames) ? backfileNames.filter(Boolean) : [];
    if (wanted.length && wanted.every((n) => alreadyIngested.has(n))) {
      setMeta(db, "backfile_through", new Date().toISOString());
    }
    await onPhase?.("ingest");
    // BLOCKS THE EVENT LOOP FOR THE WHOLE REBUILD — node:sqlite is synchronous, and this is one
    // transaction over every row in the index. Nothing on this thread runs again until it commits,
    // which is why 's disk sampler is a worker thread rather than a timer.
    rebuildFts(db);
    await onPhase?.("fts");
    const rows = db.prepare("SELECT count(*) AS n FROM mark").get().n;
    setMeta(db, "records", String(rows));
    // An index whose source date we cannot establish must NOT claim one. The provider's count refuses
    // on a null `newest_delta` exactly as it refuses on a stale one, and that is the honest behaviour:
    // "we cannot establish currency" is not a weaker claim than "we know it is old".
    if (newest) setMeta(db, "newest_delta", new Date(`${newest}T00:00:00.000Z`).toISOString());
    setMeta(db, "synced_at", new Date().toISOString());
    return { ingested, rows, newestDelta: newest, empty, skipped };
  } finally {
    db.close();
  }
}

/** The window to ask the API for: everything since the index's own newest data date, else a full pull. */
export function windowFor(dbPath, { fullFrom = "1884-01-01", now = new Date() } = {}) {
  let newest = null;
  try {
    const db = openIndex(dbPath, { readonly: true });
    try { newest = getMeta(db, "newest_delta"); } finally { db.close(); }
  } catch { /* no index yet — a full pull is correct */ }
  return { from: newest ? iso(newest) : fullFrom, to: iso(now.toISOString()), incremental: Boolean(newest) };
}

/**
 * Every file a window needs, across BOTH products, backfile first.
 *
 * A full pull (no index yet, or `--full`) takes the annual backfile AND the dailies. An incremental one
 * takes the dailies only: the backfile ends at the last complete year, so once it is in there is
 * nothing in the annual product the dailies do not already carry, and re-listing it every night would
 * re-download 22 GB to learn that.
 *
 * BACKFILE FIRST, and the order is load-bearing rather than tidy. The two products OVERLAP for the
 * current year, so the same serial can arrive twice; putRecords upserts by serial, so whichever is
 * ingested LAST wins. The dailies are the later and truer statement of a filing's status, so they must
 * land on top. Reverse this and a mark that was refused in March gets its status overwritten by the
 * annual file's older snapshot of the same record — a live-looking mark that is dead, or a dead-looking
 * one that is live, with nothing anywhere reporting a conflict.
 *
 * RETURNS A FLAT LIST, in ingest order, each entry carrying `productId` so the caller can say which
 * product a file came from. The count is the point of that: "590 files" and "767 files" are the
 * difference between a register that starts in 2025 and one that starts in 1884, and the only place a
 * reader can see which they are getting is this list.
 */
/**
 * Is the 1884-> backfile actually in this index?
 *
 * Read from the index rather than inferred from a flag or a date, because every inference tried so far
 * has been wrong in the direction that builds a partial register and calls it done. Returns false for a
 * missing or unreadable index, which is correct: no index means the backfile is not in it.
 */
/**
 * The file names this index has already ingested, for callers that must not re-charge them.
 *
 * Empty for a missing or unreadable index, which is the safe direction: charging for a file that turns
 * out to be already ingested only over-estimates, while assuming one is done when it is not would skip
 * it. Same read as syncIndex's own resume record, so the two cannot disagree about what is done.
 */
export function ingestedFileNames(dbPath) {
  try {
    const db = openIndex(dbPath, { readonly: true });
    try { return new Set(JSON.parse(getMeta(db, "ingested_files") ?? "[]")); } finally { db.close(); }
  } catch { return new Set(); }
}

export function backfileIsIn(dbPath) {
  try {
    const db = openIndex(dbPath, { readonly: true });
    try { return Boolean(getMeta(db, "backfile_through")); } finally { db.close(); }
  } catch { return false; }
}

export async function filesForWindow({ apiKey, window: w, hasBackfile = false, listImpl = listProductFiles } = {}) {
  const dailies = await listImpl({ apiKey, from: w.from, to: w.to, productId: PRODUCT_ID });
  // GATED ON WHETHER THE BACKFILE IS ACTUALLY IN, not on whether this window happens to be incremental.
  //
  // Deriving it from the window was the same omission one layer up. `--since` sets incremental:true
  // WITHOUT asking whether an index exists, so `uspto-sync --since 2026-01-01` against a fresh index
  // built a 2026-only register, stamped newest_delta, and every default run afterwards was incremental —
  // the backfile never arrived. It opens, reports rows, and the freshness clock reads today.
  //
  // `hasBackfile` comes from the index's own `backfile_through` meta, written only after every listed
  // backfile file has been ingested. So an interrupted build, a --since, and any future caller all get
  // the right answer without each having to know the rule.
  if (hasBackfile) return dailies.map((f) => ({ ...f, productId: PRODUCT_ID }));
  // THE BACKFILE IS LISTED OVER ITS OWN RANGE, NEVER OVER THE CALLER'S WINDOW — third iteration of
  // this bug, and the one that survived the previous two.
  //
  // It used to pass `from: w.from`, on the reading that "--since should still mean what it says". It
  // does, for the dailies. Applied to the ANNUAL product it means something else entirely: the office
  // returns only the annual parts whose data date falls inside the window, so
  // `uspto-sync --since 2024-06-01` against a fresh index listed two parts out of ~142 — non-empty, so
  // the CLI's zero-backfile refusal never fired — ingested both, and syncIndex then found that every
  // name in `backfileNames` was in and STAMPED `backfile_through`. An index holding nothing before
  // 2024, permanently recorded as complete: `backfileIsIn` reads true forever after, every later run
  // takes dailies only, freshness reads green, and a US clearance for a 1993 mark comes back a
  // confident clean negative.
  //
  // The completeness question is not scoped by the caller's window and cannot be. `--since` narrows
  // what is NEW; it can never narrow what makes the register WHOLE. So when the backfile is not in,
  // the whole backfile is listed and the stamp measures the set it claims to measure — which is what
  // syncIndex's own comment at the stamp already says it does.
  //
  // The cost is honest and bounded: a `--since` against a fresh index now downloads the backfile,
  // because there is no such thing as a complete US register without it. Against an index whose
  // backfile IS in, `hasBackfile` short-circuits above and nothing changes.
  const backfile = await listImpl({ apiKey, from: BACKFILE_FROM, to: w.to, productId: BACKFILE_PRODUCT_ID });
  return [
    ...backfile.map((f) => ({ ...f, productId: BACKFILE_PRODUCT_ID })),
    ...dailies.map((f) => ({ ...f, productId: PRODUCT_ID })),
  ];
}
