#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE NUMBERS ON AND WERE NOT REPRODUCIBLE, AND ONE OF THEM GOVERNS LIVE BEHAVIOUR.
//
// Both issues carried a latency table. Nothing that produced it was committed, so no reader could
// re-run it, and the tables extrapolated from a 1M-row fixture to the register's size by MULTIPLYING
// BY 12.7. That is wrong by construction for four of the six predicates: `exact` reads a btree,
// `wildcardPrefix` and `wildcardSuffix` narrow through FTS5 first, and `owner` narrows through the
// owner FTS. An index probe does not scale with table size the way a full scan does, so the one
// predicate the extrapolation nearly fits — the unanchored contains — is the only one it fits.
//
// Worse, they were measured through hand-written SQL rather than through `doSearch`, and BEFORE two
// correctness fixes that changed what those queries meant (`cfbc0cf`, Nice classes compared in two
// spellings so filtered queries matched nothing; `dceff43`, every plan entry falling through to an
// unanchored contains). A query that matches nothing is fast. That is how the numbers got there.
//
// So this harness exists to be RE-RUN, and it makes three commitments the old numbers could not:
//
//   1. IT DRIVES `doSearch`. Not SQL. The point is to measure what the engine runs, and both fixes
//      above live between those two layers.
//   2. EVERY TIMING CARRIES ITS `total_hits`. A predicate that is fast because it matched nothing is
//      the exact failure that produced the numbers being replaced, and it is invisible in a latency
//      column. Zero-hit probes are printed as MEASURES NOTHING and are never quoted as a result.
//   3. IT IS DETERMINISTIC. No Math.random, no clock-seeded sampling: terms come from fixed rowid
//      offsets spread across the table, so two runs on the same index compare.
//
// USAGE
//   node providers/uspto-local/bench/bench.mjs --db /path/to/uspto-local.sqlite
//   node providers/uspto-local/bench/bench.mjs --synthetic 1000000 --out /tmp/bench.sqlite
//
// `--db` against a real ingested register is the instrument that settles the open questions, and it
// is the one to quote. `--synthetic` exists so anyone with the repo can run this without a 41.5 GB
// download and an ID.me account — it answers questions about SPEED AND FILE SIZE, where row volume
// and text shape are what matter and whether the text is a real mark is not. It cannot answer a
// correctness question, and this harness never claims one.
//
// WHAT IT MEASURES
//   * the six predicates, each with its hit count
//   * the OR-width curve (1 / 25 / 100 / 400), which is what `capabilities.maxOrWidth` is set from
//   * on-disk size and row count
//
// WHAT IT DOES NOT MEASURE. Build time — that belongs to `bin/uspto-sync.mjs`, which prints it, and
// timing an ingest from here would mean re-running one. And the goods-and-services variant: it is
// the option we rejected, so the ~8.7 GB figure quoted for it on both issues is struck rather than
// re-derived. The recommendation never rested on the exact number.

import { statSync } from "node:fs";
import { argv, exit, stdout } from "node:process";

import { doSearch } from "../src/core.js";
import { openIndex, createSchema, putRecords, rebuildFts, setMeta,
  getMeta, assertFtsBuilt, PREDICATES } from "../src/index-store.js";
import { isEntrypoint } from "../../../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

// ── arguments ───────────────────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { db: null, synthetic: null, out: null, repeats: 5, widths: [1, 25, 100, 400], limit: 100 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === "--db") out.db = next();
    else if (a === "--synthetic") out.synthetic = Number(next());
    else if (a === "--out") out.out = next();
    else if (a === "--repeats") out.repeats = Number(next());
    else if (a === "--limit") out.limit = Number(next());
    else if (a === "--widths") out.widths = next().split(",").map(Number).filter((n) => n > 0);
    else if (a === "--help" || a === "-h") out.help = true;
    else { throw new Error(`unknown argument ${a}. Run with --help.`); }
  }
  return out;
}

const HELP = `usage:
  bench.mjs --db <path>                  bench an index you already built (quote THIS one)
  bench.mjs --synthetic <rows> [--out p] build a fixture of <rows> and bench that

  --repeats N   timed runs per probe, median reported (default 5, plus one discarded warm-up)
  --widths a,b  OR-stack widths for the maxOrWidth curve (default 1,25,100,400)
  --limit N     page size passed to doSearch (default 100)
`;

// ── the synthetic fixture, whose shape is stated here and printed in the output ─────────────────
//
// FTS5 and the LIKE fallbacks both behave on the SHAPE of the text, so a fixture of distinct random
// strings measures a register that does not exist. Real marks share prefixes (every AMERICAN…),
// suffixes (…CORP, …TECH) and infixes, and an anchored predicate over text that shares nothing
// returns one row in microseconds and looks free. These stems exist to make the anchored predicates
// do work.

const STEMS = ["AMERICAN", "GLOBAL", "PACIFIC", "SUMMIT", "PIONEER", "ATLAS", "NORTHERN", "VERTEX",
  "AURORA", "CASCADE", "MERIDIAN", "SENTINEL", "HARBOR", "CRIMSON", "ORCHID", "QUARRY"];
const TAILS = ["CORP", "TECH", "LABS", "WORKS", "GROUP", "SYSTEMS", "PARTNERS", "HOLDINGS",
  "BRANDS", "FOODS", "MEDIA", "HEALTH"];
const MIDS = ["ARBORA", "LUMEN", "NOVA", "CIRRUS", "TERRA", "VELUM", "SOLARA", "QUANTA"];
const OWNERS = ["ACME INDUSTRIES INC", "NORTHWIND TRADING LLC", "GLIMBEX HOLDINGS SA",
  "PACIFIC RIM FOODS CO", "VERTEX LABORATORIES GMBH"];
const STATUSES = ["700", "800", "606", "820", "900", "000"];

const ROW_SHAPE = `every 7th row is <STEM> <MID> <TAIL> (shares a prefix AND a suffix with thousands
  of others), every 3rd is <STEM><n>, the rest are <MID><n> <TAIL>. ${STEMS.length} prefixes,
  ${TAILS.length} suffixes, ${MIDS.length} infixes, ${OWNERS.length} owners, ${STATUSES.length}
  status codes cycled positionally. Mark text runs 8-34 characters.`;

function* syntheticRows(n) {
  for (let i = 0; i < n; i++) {
    const stem = STEMS[i % STEMS.length];
    const tail = TAILS[i % TAILS.length];
    const mid = MIDS[i % MIDS.length];
    const text = i % 7 === 0 ? `${stem} ${mid} ${tail}`
      : i % 3 === 0 ? `${stem}${i}`
      : `${mid}${i} ${tail}`;
    yield {
      serial: `7${String(i).padStart(7, "0")}`,
      regno: i % 4 === 0 ? String(4000000 + i) : null,
      text,
      owner: OWNERS[i % OWNERS.length],
      owner_country: i % 5 === 0 ? "DE" : "US",
      status: STATUSES[i % STATUSES.length],
      classes: [String((i % 45) + 1), String(((i * 7) % 45) + 1)],
      filed: `20${String(10 + (i % 15)).padStart(2, "0")}-01-01`,
      regd: null, expiry: null, gs: null,
    };
  }
}

function buildSynthetic(path, rows) {
  const db = openIndex(path, { create: true });
  createSchema(db);
  const BATCH = 50_000;
  let done = 0;
  const started = now();
  let batch = [];
  for (const r of syntheticRows(rows)) {
    batch.push(r);
    if (batch.length === BATCH) {
      db.exec("BEGIN"); putRecords(db, batch); db.exec("COMMIT");
      done += batch.length; batch = [];
      stdout.write(`\r  generating… ${done}/${rows}`);
    }
  }
  if (batch.length) { db.exec("BEGIN"); putRecords(db, batch); db.exec("COMMIT"); done += batch.length; }
  stdout.write(`\r  generating… ${done}/${rows} — rebuilding FTS\n`);
  rebuildFts(db);
  // The fixture must pass the SAME readiness gates a synced index does, or the harness measures a
  // shape the engine would refuse to search.
  setMeta(db, "synced_at", new Date().toISOString());
  setMeta(db, "source_date", new Date().toISOString().slice(0, 10));
  setMeta(db, "backfile_through", "synthetic-fixture");
  db.close();
  return (now() - started) / 1000;
}

// ── sampling terms out of whatever index we were given ──────────────────────────────────────────
//
// A real index and a synthetic one are both sampled the same way: at FIXED rowid offsets spread
// evenly across the table. Deterministic, so two runs compare — the property the numbers being
// replaced did not have — and spread, so the terms are not all from one ingest batch (the backfile
// loads oldest-first, and 1884 marks are not shaped like 2025 marks).

export function sampleMarks(db, wanted) {
  const total = db.prepare("SELECT count(*) AS n FROM mark").get().n;
  if (!total) return { total, marks: [], owners: [] };

  // BY ROWID, NOT BY OFFSET, and the difference is the whole harness.
  //
  // The obvious spelling is `SELECT … LIMIT 1 OFFSET ?`. SQLite has no way to jump to a row by
  // ordinal, so OFFSET n VISITS n rows and throws them away: 800 samples spread across a 12M-row
  // table is ~5 billion row visits, and the sampler alone runs longer than the benchmark it is
  // setting up. Measured, not reasoned — the first `--db` run against the real index sat at 17
  // minutes having printed nothing, and was killed before it reached a single timing.
  //
  // `rowid >= ?` is an index seek. Same rows, same determinism (fixed positions, no Math.random),
  // milliseconds instead of an afternoon. `>=` rather than `=` so a gap in the rowids — a serial that
  // was replaced, a part that ingested nothing — lands on the next row instead of returning nothing.
  const { lo, hi } = db.prepare("SELECT min(rowid) AS lo, max(rowid) AS hi FROM mark").get();
  const marks = [];
  const owners = [];
  const stmt = db.prepare("SELECT text, owner FROM mark WHERE rowid >= ? ORDER BY rowid LIMIT 1");
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < wanted; i++) {
    const row = stmt.get(lo + Math.floor((i * span) / wanted));
    if (!row) continue;
    if (typeof row.text === "string" && row.text.length >= 6) marks.push(row.text);
    if (typeof row.owner === "string" && row.owner.length >= 6) owners.push(row.owner);
  }
  return { total, marks, owners };
}

/**
 * `wanted` DISTINCT terms for the OR-width curve, at the shortest prefix length that yields them.
 *
 * Repeating a term is the quiet failure here. The scan cost follows the number of LIKE comparisons
 * per row, so a stack of 400 duplicates still times like 400 — but `total_hits` stops moving, and a
 * table whose latency climbs while its hit count sits still reads as "wider queries find nothing"
 * rather than "this harness ran out of vocabulary". Short prefixes collapse first (thousands of US
 * marks begin AMERIC), so the length grows until the terms separate, and the length is printed.
 */
export function distinctStems(marks, wanted) {
  for (const len of [6, 8, 10, 12, 16]) {
    const stems = [...new Set(marks.map((m) => m.slice(0, len)).filter((t) => t.length === len))];
    if (stems.length >= wanted) return { stems, termLen: len };
  }
  return { stems: [...new Set(marks)], termLen: null };
}

/** Length percentiles over the sample — FTS behaviour follows text shape, so a reader needs to see it. */
function lengthProfile(marks) {
  if (!marks.length) return "no marks sampled";
  const lens = marks.map((m) => m.length).sort((a, b) => a - b);
  const at = (p) => lens[Math.min(lens.length - 1, Math.floor((p / 100) * lens.length))];
  return `n=${lens.length}  min ${lens[0]}  p25 ${at(25)}  p50 ${at(50)}  p75 ${at(75)}  p95 ${at(95)}  max ${lens[lens.length - 1]}`;
}

// ── timing ──────────────────────────────────────────────────────────────────────────────────────

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;   // ms, monotonic

/**
 * One probe: warm up once (discarded), then time `repeats` runs and report the median.
 *
 * The warm-up is discarded because the first touch of a 30 GB index pays page-cache misses that no
 * second query pays, and a table mixing one cold number with five warm ones compares nothing. The
 * run says WARM in its header so nobody reads these as first-query latency.
 */
async function probe(label, auth, params, repeats) {
  const runOnce = async () => {
    const t0 = now();
    const r = await doSearch(auth, params, { kind: "bench" });
    const ms = now() - t0;
    if (r?.isError) return { ms, error: String(r.text).slice(0, 160) };
    const parsed = JSON.parse(r.text);
    return { ms, hits: parsed.total_hits, returned: parsed.count };
  };
  const warm = await runOnce();
  if (warm.error) return { label, error: warm.error };
  const times = [];
  for (let i = 0; i < repeats; i++) times.push((await runOnce()).ms);
  times.sort((a, b) => a - b);
  return {
    label,
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
    hits: warm.hits,
    returned: warm.returned,
  };
}

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`);

/** A timing whose probe matched nothing is not a result. Say so in the cell, not in a footnote. */
export const hitsCell = (r) => (r.error ? `**ERROR**` : r.hits === 0 ? `**0 — MEASURES NOTHING**` : String(r.hits));

function table(rows, firstCol) {
  const out = [`| ${firstCol} | median | min | max | total_hits | returned |`,
    "|---|---:|---:|---:|---:|---:|"];
  for (const r of rows) {
    out.push(r.error
      ? `| ${r.label} | — | — | — | **ERROR** | ${r.error} |`
      : `| ${r.label} | ${fmt(r.median)} | ${fmt(r.min)} | ${fmt(r.max)} | ${hitsCell(r)} | ${r.returned} |`);
  }
  return out.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (opts.help || (!opts.db && !opts.synthetic)) { stdout.write(HELP); return 0; }

  let dbPath = opts.db;
  let buildSeconds = null;
  let fixture = `real index at ${dbPath}`;

  if (opts.synthetic) {
    dbPath = opts.out ?? `./bench-${opts.synthetic}.sqlite`;
    stdout.write(`building a synthetic fixture of ${opts.synthetic} rows at ${dbPath}\n`);
    buildSeconds = buildSynthetic(dbPath, opts.synthetic);
    fixture = `SYNTHETIC, ${opts.synthetic} rows — speed and size only, never a correctness claim`;
  }

  const db = openIndex(dbPath, { readonly: true });
  // At least as many marks as the widest OR stack, or the wide rows reuse terms: the per-row LIKE
  // count — which is what the cost follows — stays honest, but `total_hits` stops moving and the
  // table reads as though a wider query found no more. Sample enough that every term is distinct.
  const { total, marks, owners } = sampleMarks(db, Math.max(200, ...opts.widths) * 2);

  // An index whose FTS was never built answers `wildcardPrefix` and `wildcardSuffix` from an empty
  // shadow table — zero rows, no error, and two of the six columns silently become free. This is
  // the store's own MATCH probe, not `count(*) FROM mark_fts`, which on an external-content table is
  // answered from `mark` and returns the same number built or not.
  let ftsBuilt = true;
  let ftsWhy = "";
  try { assertFtsBuilt(db, { path: dbPath, rows: total }); }
  catch (e) { ftsBuilt = false; ftsWhy = e.message; }

  const backfile = getMeta(db, "backfile_through");
  const synced = getMeta(db, "synced_at");
  const newest = getMeta(db, "newest_delta");
  db.close();

  if (!total) {
    stdout.write(`\nthe index at ${dbPath} holds NO ROWS. Nothing here can be measured.\n`);
    return 1;
  }
  if (!marks.length) {
    stdout.write(`\nsampled ${total} rows and found no mark text to build terms from.\n`);
    return 1;
  }

  // Terms derived from marks that are actually in this index, so every predicate has something to
  // find. A prefix taken from a real mark; a suffix from its tail; an infix from its middle.
  const pick = (i) => marks[Math.min(marks.length - 1, i)];
  const exactTerm = pick(0);
  const prefixTerm = pick(1).slice(0, 4);
  const suffixTerm = pick(2).slice(-4);
  const infixTerm = pick(3).slice(2, 6);
  const ownerTerm = (owners[0] ?? "").split(/\s+/)[0] || "ACME";

  const auth = { dbPath };
  // The sidecars count. A WAL that has not been checkpointed holds hundreds of MB of the index, and
  // quoting the main file alone understates what an operator has to provision — which is the whole
  // reason the size is in this report.
  const sizeOf = (p) => { try { return statSync(p).size; } catch { return 0; } };
  const bytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);

  stdout.write(`\nsampling done. Probing ${PREDICATES.length} predicates, warm, `
    + `median of ${opts.repeats}…\n`);

  const predicateRows = [];
  for (const [label, params] of [
    [`exact — \`${exactTerm}\``, { predicate: "exact", names: [exactTerm] }],
    [`default (contains) — \`${infixTerm}\``, { predicate: "default", names: [infixTerm] }],
    [`wildcardInfix — \`${infixTerm}\``, { predicate: "wildcardInfix", names: [infixTerm] }],
    [`wildcardPrefix — \`${prefixTerm}\``, { predicate: "wildcardPrefix", names: [prefixTerm] }],
    [`wildcardSuffix — \`${suffixTerm}\``, { predicate: "wildcardSuffix", names: [suffixTerm] }],
    [`owner — \`${ownerTerm}\``, { predicate: "owner", owner: ownerTerm }],
  ]) {
    const r = await probe(label, auth, { ...params, limit: opts.limit }, opts.repeats);
    predicateRows.push(r);
    stdout.write(`  ${r.error ? "ERROR" : fmt(r.median).padStart(9)}  ${label}\n`);
  }

  // ── the OR-width curve, which is the only number here that changes shipped behaviour ──────────
  //
  // `capabilities.maxOrWidth` is what register-plan.mjs splits every OR-stack to. Too high and a
  // query throws or crawls; too low and one plan entry becomes many, each a separate search. The
  // ceiling is SQLite's expression depth and is hard; this curve is where the cost turns, and it is
  // the number to set from. Widths that ERROR are the ceiling itself and are reported as such.
  stdout.write(`\nOR-width curve at ${opts.widths.join(", ")}…\n`);
  const widthRows = [];
  const { stems, termLen } = distinctStems(marks, Math.max(...opts.widths));
  stdout.write(`  terms: ${stems.length} distinct, ${termLen ?? "full-mark"} characters each\n`);
  for (const w of opts.widths) {
    const names = stems.slice(0, w);
    if (names.length < w) {
      stdout.write(`  SKIPPED width ${w} — only ${names.length} distinct terms in the sample, so this `
        + `row would repeat terms and report a hit count that stopped moving.\n`);
      widthRows.push({ label: `width ${w}`, error: `only ${names.length} distinct terms available` });
      continue;
    }
    const r = await probe(`width ${w}`, auth, { predicate: "wildcardInfix", names, limit: opts.limit }, opts.repeats);
    widthRows.push(r);
    stdout.write(`  ${r.error ? "ERROR" : fmt(r.median).padStart(9)}  width ${w}\n`);
  }

  const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;
  const cmd = opts.synthetic
    ? `node providers/uspto-local/bench/bench.mjs --synthetic ${opts.synthetic}`
    : `node providers/uspto-local/bench/bench.mjs --db ${dbPath}`;

  stdout.write(`
## uspto-local — measured

**Fixture.** ${fixture}
**Rows.** ${total.toLocaleString("en-US")}
**On disk.** ${gb(bytes)} (${bytes.toLocaleString("en-US")} bytes)
**Index state.** backfile_through=${backfile ?? "ABSENT"} · synced_at=${synced ?? "ABSENT"} · newest_delta=${newest ?? "ABSENT"}
**FTS.** ${ftsBuilt ? "built (MATCH probe)" : `NOT BUILT — ${ftsWhy.slice(0, 200)}`}
**Reproduce.** \`${cmd}\`
**Conditions.** warm (one discarded run per probe), median of ${opts.repeats}, page size ${opts.limit}, driven through \`doSearch\`.
${buildSeconds === null ? "" : `**Fixture build.** ${buildSeconds.toFixed(1)} s\n`}${opts.synthetic ? `**Row shape.** ${ROW_SHAPE}\n` : ""}**Mark length.** ${lengthProfile(marks)}
${backfile ? "" : `
> This index does not record a complete backfile, so \`count_hits\` refuses on it by design (#547).
> Search still answers — these timings are real — but they are timings over a PARTIAL register.
`}${ftsBuilt ? "" : `
> **The FTS shadow tables are not built.** wildcardPrefix and wildcardSuffix narrow through them, so
> their rows below are measuring an empty index, not a fast one. Do not quote them.
`}
### predicates

${table(predicateRows, "predicate")}

### OR-width — what \`capabilities.maxOrWidth\` is set from

${table(widthRows, "width")}

A width that ERRORs is the hard ceiling. Set \`maxOrWidth\` below the knee in this curve, not at it —
and if this run moves the number, bias downward: it splits every plan entry, so a width that is
occasionally too slow costs every run, while a width that is too small costs one extra query.
`);

  const zeroHit = [...predicateRows, ...widthRows].filter((r) => !r.error && r.hits === 0);
  if (zeroHit.length) {
    stdout.write(`\n${zeroHit.length} probe(s) matched NOTHING and measure nothing: `
      + `${zeroHit.map((r) => r.label).join(", ")}. `
      + `That is the failure that produced the numbers this harness replaces — do not quote them.\n`);
  }
  return 0;
}

// Importable. The two guards above — "this probe measured nothing" and "these terms repeat" — are the
// only reason to trust a number this prints, so they are testable rather than only runnable, and a
// test that imports this file must not kick off a benchmark to do it.
//
// NOT COVERED BY A TEST, DELIBERATELY. Removing this guard reddens nothing: under `node --test` the
// file's argv carries no arguments, so main() prints its help and returns 0. The cost of losing it is
// help text in the test output, not a benchmark run — measured, not assumed, when the break matrix
// entry for it came back green. Kept because any OTHER importer (a script, a REPL) would run main.
const invokedDirectly = isEntrypoint(import.meta.url);   // — isEntrypoint answers false on its own when there is no invoked script
if (invokedDirectly) {
  main().then((code) => exit(code), (e) => { stdout.write(`\nbench failed: ${e.stack}\n`); exit(1); });
}
