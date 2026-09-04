// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `--since` MUST NOT NARROW THE THING THAT ESTABLISHES COMPLETENESS.
//
// Third iteration of one bug, and this is the shape that survived the first two fixes.
//
//   1. `--since` on a fresh index built a dailies-only register. Fixed by gating on `hasBackfile`
//      rather than on whether the window was incremental.
//   2. The completeness stamp measured the batch handed to `syncIndex`, so a run given one backfile
//      part ingested it and declared the register whole. Fixed by measuring against `backfileNames`,
//      the caller's product listing.
//   3. THE LISTING ITSELF WAS NARROWED BY THE WINDOW. `filesForWindow` asked the ANNUAL product for
//      `from: w.from`, so `--since 2024-06-01` against a fresh index listed the 2025 part and nothing
//      else. Non-empty, so the CLI's zero-backfile refusal never fired. It ingested, and `wanted.every(
//      n => ingested.has(n))` was satisfied — over a set of one — so `backfile_through` was stamped.
//
// What that leaves on disk: an index holding nothing before 2025, permanently recorded as complete.
// `backfileIsIn` reads true forever after, so every later run takes dailies only and can never repair
// it. Rows are non-zero, `newest_delta` is stamped, freshness reads green, `assertIndexReady` passes,
// and the count answers. A US clearance for a mark filed in 1993 comes back a confident clean negative
// over a register that does not contain 1993.
//
// Probed against origin/main @ 01bd332 with a stub office that filters by data date the way the real
// one does: `--since 2024-06-01` listed 1 of 4 annual parts.
//
// THE RULE. `--since` narrows what is NEW. It can never narrow what makes the register WHOLE. Those
// are different questions and only one of them is the caller's to scope.

import { test } from "node:test";
import assert from "node:assert/strict";

import { filesForWindow, BACKFILE_PRODUCT_ID, PRODUCT_ID, BACKFILE_FROM } from "../src/sync.js";

/** The office as it actually behaves: a listing returns only files whose data date is in the window. */
const ANNUAL = [
  { name: "apc1884.zip", dataDate: "1884-04-07" },
  { name: "apc1990.zip", dataDate: "1990-01-01" },
  { name: "apc2024.zip", dataDate: "2024-01-01" },
  { name: "apc2025.zip", dataDate: "2025-01-01" },
];
const DAILY = [{ name: "d2026-08-01.zip", dataDate: "2026-08-01" }];

const listImpl = async ({ from, to, productId }) =>
  (productId === BACKFILE_PRODUCT_ID ? ANNUAL : DAILY)
    .filter((f) => f.dataDate >= from && (!to || f.dataDate <= to));

const backfileNamesFrom = (files) =>
  files.filter((f) => f.productId === BACKFILE_PRODUCT_ID).map((f) => f.name);

test("a `--since` inside the backfile's range still lists the WHOLE backfile", async () => {
  const files = await filesForWindow({
    apiKey: "k", window: { from: "2024-06-01", to: "2026-08-11", incremental: true }, listImpl });
  assert.deepEqual(backfileNamesFrom(files), ANNUAL.map((f) => f.name),
    "anything short of the full list makes the completeness stamp measure a subset and certify a "
    + "partial register as whole — permanently, because backfileIsIn then short-circuits every later run");
});

test("…and the dailies ARE still narrowed by it, or `--since` would mean nothing", async () => {
  const files = await filesForWindow({
    apiKey: "k", window: { from: "2026-08-05", to: "2026-08-11", incremental: true }, listImpl });
  assert.deepEqual(files.filter((f) => f.productId === PRODUCT_ID), [],
    "the 2026-08-01 daily is outside 2026-08-05→ and must not be re-listed. The fix is asymmetric on "
    + "purpose: the caller scopes what is new, never what is complete");
});

test("with the backfile already in, the annual product is not listed at all", async () => {
  // The ordinary nightly path, and it must stay cheap. `hasBackfile` short-circuits before any of the
  // above, so this change costs a wired box nothing.
  let askedFor = [];
  const spy = async (a) => { askedFor.push(a.productId); return listImpl(a); };
  const files = await filesForWindow({
    apiKey: "k", window: { from: "2026-08-01", to: "2026-08-11", incremental: true },
    hasBackfile: true, listImpl: spy });
  assert.deepEqual(askedFor, [PRODUCT_ID], "one listing, dailies only");
  assert.deepEqual(backfileNamesFrom(files), []);
});

test("a FULL pull is unchanged — it already asked from the epoch", async () => {
  const files = await filesForWindow({
    apiKey: "k", window: { from: BACKFILE_FROM, to: "2026-08-11", incremental: false }, listImpl });
  assert.deepEqual(backfileNamesFrom(files), ANNUAL.map((f) => f.name));
  assert.equal(files[0].productId, BACKFILE_PRODUCT_ID, "backfile first, so an interrupted build has the old half");
});

test("the backfile start is a constant, not a window the caller can pass in", async () => {
  // The whole defect was a caller's date reaching this listing. Pinning the constant is what stops the
  // next `from: w.from` from looking reasonable.
  assert.equal(BACKFILE_FROM, "1884-01-01");
  let seen = null;
  await filesForWindow({ apiKey: "k", window: { from: "2020-01-01", to: "2026-01-01" },
    listImpl: async (a) => { if (a.productId === BACKFILE_PRODUCT_ID) seen = a.from; return listImpl(a); } });
  assert.equal(seen, BACKFILE_FROM,
    "the annual product is asked from the epoch whatever the caller's window says");
});

// ── THE REFUSAL THIS FIX WOULD OTHERWISE HAVE REMOVED ───────────────────────────────────────────────
//
// The CLI refuses to run when the index records no backfile, and tells the operator to run `--full`.
// That refusal used to rest on the listing being EMPTY — true only because the window narrowed it.
// Widening the listing above would have turned a loud refusal into an unattended 22 GB download from
// a nightly cron, and a disk that fills halfway through leaves exactly the partial index the guard
// exists to prevent. Asserted on the source: booting the CLI means an API key and a network.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("an index with no recorded backfile is repaired by an explicit --full and by nothing else", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bin", "uspto-sync.mjs"), "utf8");
  const guard = src.slice(src.indexOf("if (!backfileIsIn(dbPath)"), src.indexOf("for (const f of listed)"));
  assert.ok(guard.length > 0, "the guard was not found — this census is measuring nothing");
  assert.match(guard, /w\.incremental \|\| !perProduct\.get\(BACKFILE_PRODUCT_ID\)/,
    "the refusal must fire on ANY incremental run against a backfile-less index, not only when the "
    + "listing came back empty — which is now never, because filesForWindow lists the whole backfile");
  assert.match(guard, /--full/, "and it must name the command that repairs it");
});
