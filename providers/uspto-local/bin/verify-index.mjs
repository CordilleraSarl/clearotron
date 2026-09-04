#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ACCEPTANCE, RUN AGAINST A REAL INDEX. `npm run verify:uspto -- <dbPath>`
//
// Written before the first build finished, so the checks were chosen without knowing the answers — a
// harness written after seeing the numbers tends to assert whatever they happened to be.
//
// EVERY CHECK PRINTS ITS OWN EVIDENCE AND NOTHING HERE PRINTS PASS. The harness records; it does not
// judge. Exit 0 means it ran, not that the index is good. A reader decides from the numbers.
//
// IN THE REPO RATHER THAN IN SOMEBODY'S SCRATCH DIRECTORY, deliberately. The index takes six hours to
// build and the agent who verifies it is rarely the one who started it; a verification step that lives
// in a session folder is a verification step that gets re-invented, differently, by whoever comes next.

import { statSync } from "node:fs";
import { argv, env, exit, stdout } from "node:process";

import { openIndex, getMeta, assertFtsBuilt } from "../src/index-store.js";
import { CAPABILITIES } from "../src/capabilities.js";
import * as core from "../src/core.js";

const dbPath = argv[2] || env.USPTO_LOCAL_DB;
if (!dbPath) {
  stdout.write("usage: verify-index.mjs <dbPath>   (or set USPTO_LOCAL_DB)\n"
    + "       npm run verify:uspto -- /var/lib/cordillera/uspto/us.db\n");
  exit(2);
}

const line = (s = "") => stdout.write(s + "\n");
const head = (s) => { line(); line("── " + s + " " + "─".repeat(Math.max(0, 74 - s.length))); };
const ms = () => Number(process.hrtime.bigint() / 1000000n);

// ── 1. what the index actually holds ────────────────────────────────────────────────────────────────

head("the index");
const db = openIndex(dbPath, { readonly: true });
const rows = db.prepare("SELECT count(*) n FROM mark").get().n;
const newest = getMeta(db, "newest_delta");
const backfile = getMeta(db, "backfile_through");
let ingested = 0;
try { ingested = JSON.parse(getMeta(db, "ingested_files") ?? "[]").length; } catch { /* absent */ }

// The sidecars count: an uncheckpointed WAL holds hundreds of MB of the index, and quoting the main
// file alone understates what an operator has to provision.
const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };
const bytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);

line(`rows            : ${rows.toLocaleString("en-US")}`);
line(`on disk         : ${(bytes / 1024 ** 3).toFixed(2)} GB (database + WAL + shm)`);
line(`files ingested  : ${ingested}`);
line(`newest_delta    : ${newest ?? "(NONE — the provider refuses to count; the build did not finish)"}`);
line(`backfile_through: ${backfile ?? "(NONE — the 1884 backfile is not fully in)"}`);

// ASKED WITH THE PRODUCT'S OWN PROBE, NOT WITH A ROW COUNT. The first cut of this harness printed
// `SELECT count(*) FROM mark_fts` and reported 1.9M rows on an index whose FTS was NOT built —
// index-store.js says why in its own comments: on an external-content FTS table that count is answered
// from the content table and returns the same number either way. It is the worthless measure, and
// printing it here would have told a reader the search indexes were fine at exactly the moment they
// were not. Reusing assertFtsBuilt means this harness cannot drift from the check the provider enforces.
let ftsState;
try {
  assertFtsBuilt(db, { path: dbPath, rows });
  ftsState = "BUILT — wildcardPrefix and wildcardSuffix can answer";
} catch (e) {
  ftsState = "NOT BUILT — " + String(e.message).split("\n")[0].slice(0, 120);
}
line(`search indexes  : ${ftsState}`);
if (ftsState.startsWith("NOT BUILT")) {
  line("  -> Correct for a build in progress: the FTS tables are rebuilt ONCE, after the whole file loop.");
  line("     wildcardPrefix and wildcardSuffix would return NOTHING for every term while exact/default/");
  line("     infix answered normally, so the provider refuses outright rather than let four of six");
  line("     predicates carry a clearance.");
}

// ── 2. THE CHECK THAT MATTERS MOST ──────────────────────────────────────────────────────────────────
//
// An index built from the dailies alone starts in 2025, and every other number here looks identical
// either way — row counts, timings, freshness, a record that round-trips. That is exactly how the
// defect shipped: the register arrives as TWO bulk products, and a build that fetched only the daily
// one was complete-looking and missing a century.

head("does it actually reach back before 2025?");
// The column is `filed`. Read from the live schema rather than assumed — the first cut of this harness
// guessed `filing_date` and threw, which is the cheap version of the mistake it exists to catch.
const oldest = db.prepare("SELECT min(filed) d FROM mark WHERE filed IS NOT NULL AND filed != ''").get()?.d;
const byDecade = db.prepare(
  "SELECT substr(filed,1,3) || '0s' AS decade, count(*) n FROM mark "
  + "WHERE filed IS NOT NULL AND filed != '' GROUP BY decade ORDER BY decade").all();
line(`oldest filed date: ${oldest ?? "(none recorded)"}`);
for (const d of byDecade.slice(0, 20)) line(`  ${d.decade}  ${d.n.toLocaleString("en-US")}`);
const pre2020s = byDecade.filter((d) => d.decade < "2020s").reduce((n, d) => n + d.n, 0);
line(`filings before the 2020s: ${pre2020s.toLocaleString("en-US")}`);
line(pre2020s > 0
  ? "  -> the backfile is in. A US search can see marks older than 2025."
  : "  -> NOTHING before the 2020s. This index cannot support a clean negative on any older mark.");

// ── 3. every declared predicate answers, and is timed ───────────────────────────────────────────────
//
// count(*) beside every timing: a predicate that is fast because it matched NOTHING is the failure that
// produced the numbers this replaces, and it is invisible in a latency column.

head("per-predicate latency and hit count");
const TERM = env.PROBE_TERM || "DELTA";   // a real, common US mark word
const PREDICATES = ["exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix"];
line(`probe term: ${TERM}   (set PROBE_TERM to change it)`);
line("");
line("predicate        declared                                    ms     hits");
for (const p of PREDICATES) {
  const declared = CAPABILITIES.predicates[p];
  if (!declared) { line(`${p.padEnd(16)} null (unsupported — disclosed, never searched)`); continue; }
  const t0 = ms();
  const r = await core.doSearch({ dbPath }, { name: TERM, predicate: p, limit: 5 }, { kind: "verify" });
  const took = ms() - t0;
  let hits = "ERR";
  try { hits = JSON.parse(r.text).total_hits; } catch { hits = String(r.text).slice(0, 60); }
  line(`${p.padEnd(16)} ${String(declared).slice(0, 42).padEnd(43)} ${String(took).padStart(5)}  ${String(hits).padStart(8)}`
    + (hits === 0 ? "   <- MEASURES NOTHING" : ""));
}
line("");
line("A predicate that is fast because it matched NOTHING is the failure that produced the latency table");
line("this replaces. If a row says MEASURES NOTHING, its timing is not a result — pick a PROBE_TERM that");
line("is actually in the index before quoting any of these.");
line("");
line("These are ONE probe each, warm or cold as they fall. For a measurement anyone can quote, run the");
line("benchmark instead: npm run bench:uspto -- --db <dbPath>");

// ── 4. the count, and the two gates it has to pass ──────────────────────────────────────────────────

head("count, and the freshness + completeness gates");
const c = await core.doCountHits({ dbPath }, { name: TERM, matchMode: "contains" }, { kind: "verify" });
line(`doCountHits: ok=${c?.ok} total=${c?.total} probe=${c?.probe ?? "-"}`);
if (!c?.ok) line(`  reason: ${String(c?.reason ?? "").slice(0, 300)}`);
line("");
line("TWO refusals guard this number, and they are different questions:");
line("  · FRESHNESS  — newest_delta inside 24h. A count from a stale index is not a clean negative.");
line("  · COMPLETENESS — backfile_through recorded. Currency is not completeness: an index synced an");
line("    hour ago can still be missing a century. Search still answers on an incomplete index and is");
line("    honest about what it found; counting from one is not.");
line("A refusal here with either reason is the CORRECT behaviour for an index that has not finished.");

// ── 5. a record round-trips ─────────────────────────────────────────────────────────────────────────

head("a record, end to end");
const one = await core.doSearch({ dbPath }, { name: TERM, predicate: "exact", limit: 1 }, { kind: "verify" });
let rec = null;
try { rec = JSON.parse(one.text).results?.[0]; } catch { /* no rows */ }
if (!rec) {
  line("no exact hit for the probe term — set PROBE_TERM to a mark you know is registered");
} else {
  line(`record_id : ${rec.record_id}`);
  line(`mark      : ${rec.mark_text ?? rec.mark ?? rec.text ?? "(field absent)"}`);
  line(`status    : ${rec.status ?? "(field absent)"}`);
  line(`classes   : ${JSON.stringify(rec.nice_classes ?? rec.classes ?? null)}`);
  line(`owner     : ${rec.owner ?? "(field absent)"}`);
  const f = await core.doRecordFetch({ dbPath }, { record_id: rec.record_id }, { kind: "verify" });
  line(`record_fetch: ${String(f?.text ?? "").startsWith("ERROR")
    ? "ERROR " + String(f.text).slice(0, 120) : "returned a record"}`);
  line("");
  line("Cross-check this serial against TSDR by hand before anyone calls the record CORRECT. The index");
  line("agreeing with itself is not evidence that it agrees with the register — and the five questions");
  line("#547 lists as needing real data (response body shape, ownerCountry, the status date, the true");
  line("delta cadence, nativeScriptIndex) are settled by reading records, not by counting them.");
}
db.close();
line();
