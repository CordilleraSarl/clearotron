// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// core.js — the provider surface over the local US index.
//
// WHY THE SHARED KERNELS ARE REUSED RATHER THAN HAND-ROLLED. The obvious read is that
// makeEnumerate / makeCountProbe / makeExecutePlan are remote-API machinery — paging, retries, HTTP
// — and that a local SQLite source should just answer directly. That is wrong on inspection: those
// kernels contain ZERO transport code. Their dependencies are plain async functions returning a tool
// result, and the only node imports anywhere in the kernel set are fs/path in execute-plan, for
// reading the frozen plan and writing the band — which a local provider needs identically.
//
// What hand-rolling would forfeit is not plumbing, it is the COMPLETENESS CONTRACT: the crowd
// ceiling and its `incomplete` descriptor, the count-first per-term rescue (a rare term vanishing
// inside a saturated OR-stack and reading as a verified zero), the per-class rescue, the names
// chunking, the count/search divergence guard, and the never-a-fabricated-zero rules. Every one of
// those failures produces a well-formed band that reads as a completed enumeration. Being local
// makes the queries cheap; it does not make any of those questions go away.
//
// THE AUTH OBJECT IS THE INDEX PATH. Every other provider threads a credential here; this one
// threads `{ dbPath }`. The kernels only pass it through, so the shape is ours to choose.

import { makeEnumerate } from "../../_shared/enumerate.mjs";
import { makeCountProbe } from "../../_shared/count.mjs";
import { makeExecutePlan } from "../../_shared/execute-plan.mjs";
import { makeLedger } from "../../_shared/ledger.mjs";
import { planPredicateParams, CAPABILITY_GAP_MARKER } from "../../_shared/execute-plan.mjs";

import { CAPABILITIES } from "./capabilities.js";
import {
  openIndex, assertIndexReady, search as indexSearch, countHits as indexCount,
  getRecord, freshness, makeRef, PREDICATES, getMeta,
} from "./index-store.js";
import { toBandRow, toNeutralRecord, rowScreen } from "./row.js";

export { CAPABILITIES, makeRef, freshness, PREDICATES };
export const ENUMERATE_NAMES_CHUNK_DEFAULT = CAPABILITIES.kernel.namesChunkDefault;

// One ledger per provider, same as every other. Without it this source's queries are invisible to
// the provider-usage diff and a run reads as having made no register calls at all.
//
// logRecordBody IS NOT OPTIONAL, and forgetting it costs nothing that announces itself. The citation
// fidelity gate compares every registry identifier in the report against the record actually fetched,
// and it finds those records by reading this ledger (registry-fidelity.mjs collectRecordBodies). A
// provider that logs the call but not the BODY leaves the gate with nothing to compare, so it does not
// fail — it stamps the finding `unverified` and appends the "presented unverified" caveat. Every US
// card would carry it, permanently, and no test or exit code would ever say why.
export const { logCall, logRecordBody, tctxOf } = makeLedger("uspto-local");

export const DEFAULT_DB_ENV = "USPTO_LOCAL_DB";

// ── the handle ────────────────────────────────────────────────────────────────────────────────────
// Memoized per path: opening SQLite per query would re-read the header and re-plan every statement,
// and the readonly handle is safe to share across concurrent stages.
const handles = new Map();

function resolveDbPath(auth) {
  const p = (typeof auth === "string" ? auth : auth?.dbPath) || process.env[DEFAULT_DB_ENV] || "";
  if (!p) {
    // ── MARKED AS A CAPABILITY GAP AT ITS SOURCE ──────────────────────────────────────────────────
    //
    // An unset index path is not a failure a re-run can close: the same absent variable produces the
    // same refusal every time, and the recovery ladder spends a paid unit per attempt to re-derive it.
    // Without the marker this arrived downstream as an ordinary provider error and was re-run.
    //
    // It also has to be marked HERE rather than by whoever catches it. Every doX in this file wraps a
    // throw with `err(...)`, and the free tier's composite classifies on the text it receives — so a
    // marker added by one consumer is a marker the other consumers do not get. Marking at the throw
    // means every path out of this provider carries it, including ones written later.
    //
    // 's composite backstop caught a THROW and converted it. That backstop never fired against this
    // provider, because four of its five entry points catch their own throw and return a plain error
    // first — and the test that claimed it worked drove a stub that throws, which this does not do.
    throw new Error(
      `${CAPABILITY_GAP_MARKER} [uspto-local] no index path. Set ${DEFAULT_DB_ENV} to the synced US `
      + "register file. This provider searches a local copy of the register; without it there is "
      + "nothing to search and a run must refuse rather than return an empty result.",
    );
  }
  return p;
}

export function openFor(auth) {
  const path = resolveDbPath(auth);
  const cached = handles.get(path);
  if (cached) return cached;
  const db = openIndex(path, { readonly: true });
  // The row-count assertion, not just a table check. A database carrying the schema and no rows
  // answers every query with a well-formed zero — the count agrees with the search, the divergence
  // guard passes, and the slice mints a clean negative over a register nobody downloaded.
  assertIndexReady(db, { path });
  handles.set(path, db);
  return db;
}

/** Tests and the sync CLI reopen the same path after writing; the cache must not outlive that. */
export function resetHandles() {
  for (const db of handles.values()) { try { db.close(); } catch { /* already closed */ } }
  handles.clear();
}

const ok = (payload) => ({ type: "text", text: JSON.stringify(payload, null, 2) });
const err = (text) => ({ type: "text", text: `ERROR: ${text}`, isError: true });

// ── query shaping ────────────────────────────────────────────────────────────────────────────────
//
// The plan speaks predicates and terms; the store speaks the same. `names` is the OR stack, capped
// at capabilities.maxOrWidth by the compiler — this never re-chunks it, because a chunk the planner
// did not dictate would break the qid-to-query join.

// ── TWO VOCABULARIES MEET HERE, AND ONLY ONE OF THEM IS OURS ─────────────────────────────────────
//
// This store speaks `predicate` (exact / wildcardPrefix / …). The rest of the engine speaks
// `match_mode`, because that is the shape corsearch and clarivate take: the frozen plan's executor
// builds every query through `planPredicateParams` → `defaultBuildEntryQuery`, which emits
// `{ match_mode }` and nothing else, and Stage 0.5's count adapter passes `matchMode` straight down.
//
// Reading only `predicate` therefore ignores every plan entry's predicate and falls through to the
// default. Nothing errors. The consequences are graded, and the last is the bad one:
//   * an `exact` entry runs as an unanchored contains — a WIDER band, so no missed conflict, but the
//     count table's "Identical filings" column then reports the same number as "Containing", and two
//     columns that always agree are two columns nobody can use;
//   * a `*TERM` entry runs as infix — again wider, again a band that is not the band the plan froze;
//   * a `phonetic` entry — which capabilities.predicates declares NULL — runs as an unanchored
//     contains and returns `state:"enumerated"`. That is doctrine rule 2 broken exactly as the rule
//     describes it: a weaker query wearing the right answer's clothes, and a clean negative over a
//     search this source cannot perform.
const MATCH_MODE_TO_PREDICATE = Object.freeze({
  exact: "exact",
  default: "wildcardInfix",
  contains: "wildcardInfix",
  starts_with: "wildcardPrefix",
  ends_with: "wildcardSuffix",
  // `phonetic` IS DELIBERATELY ABSENT. Adding it — to anything — is the defect above.
});

/** A client-side refusal the executor must read as a disclosed gap, never as a retryable fault. */
const capabilityGap = (msg) => { throw new Error(`${CAPABILITY_GAP_MARKER} ${msg}`); };

function resolvePredicate(params, names) {
  // The store's own vocabulary wins when a caller states it (the MCP tools take `predicate`).
  if (params?.predicate) return params.predicate;
  const mode = params?.match_mode ?? params?.matchMode ?? null;
  if (mode) {
    const mapped = MATCH_MODE_TO_PREDICATE[String(mode)];
    if (!mapped) {
      capabilityGap(
        `the local US index cannot serve match_mode "${mode}". It is a text index over the bulk `
        + "register with no phonetic or fuzzy surface, so this slice was never searched. Disclose it "
        + "as a gap; running it as a contains would return a clean negative for a search this source "
        + "cannot perform.");
    }
    return mapped;
  }
  return params?.owner && !names.length ? "owner" : "wildcardInfix";
}

// ── WILDCARD ANCHORS ARRIVE AS LITERAL CHARACTERS ────────────────────────────────────────────────
// A `wildcard` plan entry anchored at ONE end is de-anchored for us by planPredicateParams (it hands
// back `__term` with the star already stripped). One anchored at BOTH ends is not: corsearch and
// clarivate pass `*` through to a query language that understands it, so the kernel forwards the raw
// pattern. SQLite's LIKE does not — `%*ARBORA*%` matches only marks that literally contain an
// asterisk, which is none of them. Zero rows, no error, `state:"enumerated"`: a false clean, and the
// one failure this whole provider is written to make impossible.
const ANCHORS = /^\*+|\*+$/g;
function deAnchor(term, predicate) {
  const t = String(term ?? "");
  const stripped = t.replace(ANCHORS, "");
  if (stripped.includes("*") || stripped.includes("?")) {
    capabilityGap(
      `the local US index has no wildcard query language, so the pattern "${t}" cannot be expressed. `
      + "Anchored terms are served as prefix/suffix/contains predicates; an INTERNAL wildcard is not "
      + "serveable and a literal search for it would find nothing and read as a clean negative.");
  }
  // A term that was anchored at both ends IS an infix, whatever predicate the caller named.
  return { term: stripped, predicate: t !== stripped && t.startsWith("*") && t.endsWith("*") ? "wildcardInfix" : predicate };
}

function toQuery(params) {
  const rawNames = Array.isArray(params?.names) ? params.names
    : params?.name ? [params.name]
    : params?.term ? [params.term] : [];
  let predicate = resolvePredicate(params, rawNames);
  const names = [];
  for (const n of rawNames) {
    const d = deAnchor(n, predicate);
    predicate = d.predicate;
    names.push(d.term);
  }
  return {
    predicate,
    term: predicate === "owner" && !names.length ? [params.owner] : names,
    // `in_scope_classes` is deliberately NOT read here. It is the SCREENING scope, not a query
    // filter: screenVerdict uses it to mark a record drop:out-of-class, which it can only do if the
    // record was returned in the first place. Filtering the query by it makes the band silently
    // narrower than the band the plan asked for, and the out-of-scope marks a lawyer would have
    // seen listed and dismissed simply never appear.
    classes: params?.classes ?? params?.nice_classes ?? null,
    status: params?.status ?? null,
    owner: predicate === "owner" ? null : (params?.owner ?? null),
  };
}

/**
 * Is there anything to search for at all? Asked BEFORE the predicate is resolved, and deliberately so.
 *
 * `toQuery` now refuses an unserveable predicate by throwing, and this is makeEnumerate's gate — a
 * throw here would surface as a kernel fault with no reason attached, and answering `false` would
 * report "no search element" for a query whose real problem is a capability this source lacks. Two
 * different refusals; only one of them is disclosable as a coverage gap.
 */
export function hasAnyElement(params) {
  const names = Array.isArray(params?.names) ? params.names
    : params?.name ? [params.name]
    : params?.term ? [params.term] : [];
  return Boolean(names.length || params?.owner);
}

// ── the four primitives ──────────────────────────────────────────────────────────────────────────

/** Paged search. `limit`/`offset` — see pageParams below; the kernel default emits `page`. */
export async function doSearch(auth, params, tctx) {
  try {
    const db = openFor(auth);
    if (!hasAnyElement(params)) return err("at least one search element is required.");
    const q = toQuery(params);
    const limit = Number(params?.limit ?? 100);
    const offset = Number(params?.offset ?? 0);
    const rows = indexSearch(db, { ...q, limit, offset });
    const total = indexCount(db, q);
    logCall?.(tctx, { tool: "search", predicate: q.predicate, terms: q.term, total });
    return ok({
      total_hits: total,
      count: rows.length,
      has_more: offset + rows.length < total,
      results: rows.map(toBandRow),
    });
  } catch (e) {
    return err(`uspto-local search: ${e.message}`);
  }
}

/**
 * The count dependency — and the seam where a stale index refuses.
 *
 * This is the only honest place for the freshness rule. PHASE3-REQUIREMENTS R5 puts USPTO at 24
 * hours; an index older than that cannot support a clean negative, and `{ok:false, total:null}` is
 * exactly how the kernel is told "the number is UNKNOWN". It becomes an unknown-with-reason at
 * Stage 0.5 and an `incomplete` with the reason inside enumerate — never a zero.
 *
 * An index with no recorded source date refuses on the SAME path: "we cannot establish currency" is
 * not a weaker claim than "we know it is old".
 *
 * ── AND AN INDEX WHOSE BACKFILE IS NOT RECORDED COMPLETE ─────────────────────────────────
 *
 * Currency is not completeness. An index can be synced an hour ago and still be missing a century:
 * the register arrives as TWO products, and the 1884-2025 backfile is the one a dailies-only build
 * leaves out entirely. `backfile_through` is stamped only once every part the office publishes has
 * been ingested — and a part that parses to zero records is deliberately not counted, so a hole in
 * the middle withholds the stamp too.
 *
 * Nothing was reading it. `backfileIsIn` served only the sync's own decision about which products to
 * list, so an index with a known hole answered counts exactly like a complete one, and the only
 * signal was a line the sync printed at build time.
 *
 * THE REFUSAL IS ON THE COUNT, NOT ON SEARCH, and that line is deliberate. Searching an incomplete
 * index is honest — it finds what it holds and claims nothing more. A COUNT is the clean-negative
 * surface: "0 filings" over a register missing its first 140 years is the false clean this whole
 * provider is built to prevent. `--from-file` builds, which cannot know their own completeness, keep
 * working as a search source exactly as documented, and refuse to count exactly as they already did.
 */
export async function doCount(auth, params, tctx) {
  try {
    const db = openFor(auth);
    // Thresholds come from the store's own FRESHNESS_HOURS, not re-typed here — see the two-clock note
    // there for why a single 24h rule on the data date is unsatisfiable against a next-day product.
    const f = freshness(db, { nowIso: new Date().toISOString() });
    if (f.stale === true || f.newestDelta === null) {
      logCall?.(tctx, { tool: "count", refused: "freshness" });
      return { ok: false, total: null, reason: f.reason };
    }
    if (!getMeta(db, "backfile_through")) {
      logCall?.(tctx, { tool: "count", refused: "backfile" });
      return { ok: false, total: null, reason:
        `${CAPABILITY_GAP_MARKER} this US index does not record a complete backfile, so a count over it `
        + `cannot support a clean negative: the register is published as an annual backfile (1884 onward) `
        + `plus dailies, and an index built from the dailies alone — or one whose backfile has a part that `
        + `yielded no records — holds nothing before the dailies' earliest date. Run `
        + `\`node bin/uspto-sync.mjs --full\` to establish it. Searching this index is still honest; `
        + `counting from it is not.` };
    }
    const total = indexCount(db, toQuery(params));
    logCall?.(tctx, { tool: "count", total });
    return { ok: true, total };
  } catch (e) {
    return { ok: false, total: null, reason: `uspto-local count: ${e.message}` };
  }
}

export async function doRecordFetch(auth, params, tctx) {
  try {
    const db = openFor(auth);
    const serial = String(params?.id ?? params?.uri ?? params?.record_id ?? "").split("/").pop();
    if (!serial) return err("record fetch needs a serial number or a /mark/us/<serial> uri.");
    const rec = getRecord(db, serial);
    logCall?.(tctx, { tool: "record_fetch", serial, found: Boolean(rec) });
    if (!rec) return err(`no US record ${serial} in this index.`);
    const neutral = toNeutralRecord(rec);
    // The fidelity gate's evidence. Keyed on `uri`, which is what collectRecordBodies indexes by.
    if (neutral.uri) logRecordBody({ ...tctx, kind: "record_fetch" }, neutral.uri, neutral);
    return ok(neutral);
  } catch (e) {
    return err(`uspto-local record_fetch: ${e.message}`);
  }
}

/** Screening rides the search row — status, classes and owner are all stored, so nothing is billed. */
export async function doBatchScreen(auth, params, tctx) {
  try {
    const db = openFor(auth);
    const uris = Array.isArray(params?.uris) ? params.uris : [];
    const inScope = params?.in_scope_classes ?? [];
    const found = uris.map((u) => getRecord(db, String(u).split("/").pop())).filter(Boolean);
    // Persist here as well as in record_fetch, which clarivate also does and corsearch does not. On a
    // REMOTE provider that is a judgement call about ledger weight; here the full record has already
    // been read off local disk to build the screen row, so it is free — and it means a record surfaced
    // from the band can be cited without the fidelity gate having to caveat it for want of a body.
    for (const r of found) {
      const neutral = toNeutralRecord(r);
      if (neutral.uri) logRecordBody({ ...tctx, kind: "batch_screen" }, neutral.uri, neutral);
    }
    const rows = found.map((r) => rowScreen(r, inScope));
    logCall?.(tctx, { tool: "batch_screen", asked: uris.length, found: rows.length });
    return ok({ rows });
  } catch (e) {
    return err(`uspto-local batch_screen: ${e.message}`);
  }
}

// ── the kernels ──────────────────────────────────────────────────────────────────────────────────

// makeEnumerate returns { enumerate, countFirstRescue, classSplitRescue } — an object, unlike the
// other two kernels, which return the callable directly.
const { enumerate: enumerateKernel } = makeEnumerate({
  search: doSearch,
  count: doCount,                    // REQUIRED: countProbe is "endpoint"
  rowScreen,                         // REQUIRED: screenSource is "search-row"
  hasAnyElement,                     // the kernel default is () => true, which would enumerate the register
  // The kernel default emits { limit, page }; this store takes { limit, offset }. Inheriting the
  // default silently re-returns page 0 for every page — a band that dedupes to one page and reports
  // itself enumerated.
  pageParams: (page, pageSize) => ({ limit: pageSize, offset: page * pageSize }),
  capabilities: CAPABILITIES.kernel, // spread, never re-typed, so no literal can drift
  recordIdOf: (rec) => rec?.record_id,
  recordKeyOf: (rec) => rec?.record_id ?? rec?.uri,
  screenJoinKey: (row) => row?.record_id ?? row?.uri,
});

export const doEnumerate = (auth, params, tctx) => enumerateKernel(auth, params, tctx);

const countKernel = makeCountProbe({
  search: doSearch,
  count: doCount,
  capabilities: CAPABILITIES,
});

export const doCountHits = (auth, params, tctx) => countKernel(auth, params, tctx);

const executePlanKernel = makeExecutePlan({
  search: doSearch,
  enumerate: doEnumerate,
  predicateParams: planPredicateParams,
  // The FULL contract, not the kernel block: the script-form and owner×term refusals read it, and
  // they read an absent contract differently — script form defers, which is the safe direction.
  capabilities: CAPABILITIES,
});

export const doExecutePlan = (auth, params, tctx) => executePlanKernel(auth, params, tctx);
