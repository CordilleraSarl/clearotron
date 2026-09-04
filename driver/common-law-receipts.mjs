// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// common-law-receipts.mjs — the deterministic acceptance gate for the search-as-code marketplace grid.
//
// The grid call executes every (variant × platform) cell as a program and the worker must account for
// every cell with a receipt-carrying row in the findings file's Negative-results matrix (forms: "No
// results" / "No similar listings (N candidates reviewed)" / "Similar listing(s) found — see Findings"
// / "not executed — coverage-limited"). The live 2026-06-10 probes showed exactly why this gate exists:
// an LLM re-transcribing program output silently dropped a full term (7 cells). This module makes the
// completeness rule a control-flow gate, not prose: every manifest variant must have at least
// `minCellsPerVariant` matrix rows. Pure over (manifestContent, findingsContent) so it tests offline.
//
// Row parsing mirrors screen-gate.mjs: walk headings to find the relevant section, then read its
// `|`-delimited data rows.

// 6 mandatory store platforms + the general-web cell. Field-scoped cells are additive (a matter can
// have MORE rows per variant, never fewer).
export const MIN_CELLS_PER_VARIANT = 7;

const norm = (s) => (s || "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();

// A table data row's cells, or null if the line isn't one.
function rowCells(ln) {
  if (!ln.trimStart().startsWith("|")) return null;
  const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
  if (cells.length < 2) return null;
  if (cells.every((c) => /^[-:\s]*$/.test(c))) return null;   // separator row
  return cells;
}

/**
 * The variant terms the manifest commits the grid to search: data rows of sections whose heading
 * contains "variants" (the Variants tables). "Variant applicability" sections (category
 * dispositions, not search terms) are excluded. The term column is resolved from each table's
 * HEADER row — the live prelim-variants format is `| Category | Value | Rationale | Verify? |`
 * (term in "Value"), while older/test manifests use `| Variant | ... |` (term first); default 0
 * when no recognizable header exists.
 */
export function parseManifestVariants(manifestContent) {
  return variantsManifestAudit(manifestContent).variants;
}

/**
 * The same walk, reporting what it SAW as well as what it took. `parseManifestVariants` is a thin wrapper
 * over this, so the two can never disagree about one manifest.
 *
 * — WHY THIS EXISTS. The walk returned `` over a manifest holding 84 variants, and `` is a
 * VALID answer: pipeline.mjs reads zero variants as "this matter needs no grid", drops to the legacy
 * spec-less path, and delivers clean. An empty result has to be able to say WHICH empty it is.
 *
 *   `headings`              how many headings armed the collector
 *   `rowsAfterFirstHeading` table data rows anywhere after the first arming heading — the ones a shape
 *                           change can hide from the walk while leaving them plainly in the file
 *
 * A caller can then separate "no variants were written" (no arming heading, or no rows after it) from
 * "variants were written and I could not reach them" (rows after the heading, zero taken). Only the
 * second is a parse failure, and only the second should be loud. PURE.
 */
export function variantsManifestAudit(manifestContent) {
  const variants = [];
  let inVariants = false;
  let col = null;                                             // per-table term column, from its header
  // — THE DEPTH THAT ARMED THE COLLECTOR. Without it `inVariants` was reset by EVERY heading at ANY
  // level, so a sub-heading INSIDE the Variants section closed it. The 2026-08-15 manifest grouped its
  // variants under seven `####` sub-headings (core, phonetic, visual, transliteration, numeric,
  // composite, other) and the first sat six lines below `### Variants` — so the section shut immediately
  // and 84 written variants were 0 reachable. The 2026-08-14 manifest put its next heading 117 lines
  // later and all 61 were read. Same parser, same heading text, different sub-structure.
  //
  // THE MANIFEST IMPROVED AND THE CONSUMER BROKE. No commit did this: the authoring model reorganised its
  // own output, which it is free to do, and a flat-only reader called the result an empty matter. A
  // parser over model-authored structure has to survive the model structuring it better.
  let armedDepth = 0;
  let headings = 0, rowsAfterFirstHeading = 0, sawArmingHeading = false;
  for (const ln of (manifestContent || "").split("\n")) {
    const h = ln.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const depth = h[1].length, text = h[2];
      col = null;                                             // every table resolves its own term column
      // "Variant applicability" is category dispositions, not search terms. It excludes at ANY depth —
      // that exclusion predates this fix and is deliberately not widened by it.
      if (/applicabilit/i.test(text)) { inVariants = false; armedDepth = 0; continue; }
      if (/variants\b/i.test(text)) { inVariants = true; armedDepth = depth; headings += 1; sawArmingHeading = true; continue; }
      // Same level or shallower ENDS the section. Deeper is a sub-group INSIDE it and the collector stays
      // armed — that is the whole fix.
      if (inVariants && depth <= armedDepth) { inVariants = false; armedDepth = 0; }
      continue;
    }
    if (sawArmingHeading && rowCells(ln)) rowsAfterFirstHeading += 1;
    if (!inVariants) continue;
    const cells = rowCells(ln);
    if (!cells) continue;
    if (col == null) {
      const headerIdx = cells.findIndex((c) => /^(variant|value|term)s?$/i.test(c));
      if (headerIdx >= 0) { col = headerIdx; continue; }      // header row resolves the column
      col = 0;                                                // headerless table — fall through as data
    }
    const v = cells[col];
    if (!v || /^(variant|value|term)s?$/i.test(v)) continue;
    // NOT every Variants-table row is a marketplace search term. The gate's first two live runs
    // (2026-06-10) both hard-failed on phantom demands from rows of these shapes:
    //  - register wildcard family probes (`THIS IS MY \*`, `` `SATIN & *` ``) — any value containing an
    //    asterisk is a register-layer pattern, never a storefront term (live incident: five 0/7 shorts across two attempts);
    //  - multi-mark inheritance annotations (`| (inherit) | — all OAK & EMBER variants from Mark 1 — |`)
    //    — em-dash-wrapped prose / an "(inherit)" category, unsatisfiable as a 7-cell grid row.
    if (/\*/.test(v)) continue;
    if (/^[—–-]\s/.test(v) && /\s[—–-]$/.test(v)) continue;
    if (cells.some((c) => /^\(inherit(?:ed|s)?\)$/i.test(c))) continue;
    if (!variants.some((x) => norm(x) === norm(v))) variants.push(v);
  }
  return { variants, headings, rowsAfterFirstHeading };
}

/**
 * — IS THIS EMPTY AN ANSWER OR A FAILURE?
 *
 * Returns null when the manifest is legitimately variant-less, and a reason string when variants were
 * written and the walk could not reach them. The caller makes it loud; this only decides which it is.
 *
 * The condition is deliberately narrow, because the error direction matters: a false "parse failure"
 * kills a run that had nothing to sweep. It fires ONLY when an arming heading exists AND table rows
 * follow it AND nothing was taken — a combination a genuinely empty matter cannot produce. A manifest
 * with no Variants section, or one whose Variants section holds no rows, returns null and the run
 * proceeds exactly as it does today. PURE.
 */
export function variantsParseFailure(manifestContent) {
  const { variants, headings, rowsAfterFirstHeading } = variantsManifestAudit(manifestContent);
  if (variants.length || !headings || !rowsAfterFirstHeading) return null;
  return `the variant manifest carries a Variants section and ${rowsAfterFirstHeading} table row(s) after it, `
    + `and none parsed as a search term — the manifest's structure is not one this reader understands, `
    + `so its terms cannot be swept (zero variants here would silently become the legacy spec-less path)`;
}

/** Per-variant row counts in the findings file's Negative-results matrix (normalized first cell). */
export function countMatrixCells(findingsContent) {
  const counts = new Map();
  let inMatrix = false;
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inMatrix = /negative results/i.test(h[1]); continue; }
    if (!inMatrix) continue;
    const cells = rowCells(ln);
    if (!cells) continue;
    const v = norm(cells[0]);
    if (!v || v === "variant") continue;                      // header row
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

/**
 * The shared shortfall ladder over a `cellsOf(term) → count` accessor. A variant is satisfied by:
 * its own floor; " / "-packed ALTERNATES each meeting the floor (one manifest cell, two renderings —
 * "丝绸与铁 / 席尔克": each alternate is its own search term with its own grid — the copper-conduit worker
 * keyed the split forms with full receipts while the validator demanded the compound key, 2026-06-12);
 * or WORD-BOUNDARY substring coverage (a fully-receipted variant covers a LONGER variant containing it
 * as a whole-word phrase — "Aurora Legends II: Oak & Ember" ⊃ "Oak & Ember"; a marketplace phrase
 * search for the short form surfaces every listing of the long form. Mid-word containment does NOT
 * count: "venzyy" ⊅ "venzy" — storefront search tokenizes, a doubled-letter variant is its own term).
 */
function shortVariants(variants, cellsOf, minCellsPerVariant) {
  const met = (term) => cellsOf(term) >= minCellsPerVariant;
  const metNorms = variants.filter(met).map((v) => norm(v));
  const violations = [];
  for (const variant of variants) {
    if (met(variant)) continue;
    const alternates = variant.split("/").map((s) => s.trim()).filter(Boolean);
    if (alternates.length > 1 && alternates.every((a) => met(a))) continue;
    const tokens = (t) => norm(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const hasTokenPhrase = (long, short) => {
      if (!short.length || short.length >= long.length) return false;
      for (let i = 0; i + short.length <= long.length; i++)
        if (short.every((tk, j) => long[i + j] === tk)) return true;
      return false;
    };
    const vTok = tokens(variant);
    if (metNorms.some((w) => hasTokenPhrase(vTok, tokens(w)))) continue;
    violations.push({ variant, cells: cellsOf(variant), expected: minCellsPerVariant });
  }
  return violations;
}

/**
 * Variants whose grid accounting is short: fewer matrix rows than the platform floor. Empty ⇒ clean.
 * LEGACY path (prose Negative-results matrix) — kept for runs without a machine grid ledger
 * (every archived run; replay-harness verdicts must not flip). New runs validate via
 * findGridLedgerViolations below.
 *
 * @returns {Array<{variant:string, cells:number, expected:number}>}
 */
export function findReceiptViolations(manifestContent, findingsContent, { minCellsPerVariant = MIN_CELLS_PER_VARIANT } = {}) {
  const counts = countMatrixCells(findingsContent);
  const variants = parseManifestVariants(manifestContent);
  return shortVariants(variants, (term) => counts.get(norm(term)) || 0, minCellsPerVariant);
}

// ── MACHINE RECEIPTS (the receipts-gate postmortem ruling, approved 2026-06-12 — the code is its own record) ──
// The grid program already prints one JSON object to stdout ({cells, extras, gaps}); the worker saves
// it VERBATIM to common-law-grid.json (a single object, or a JSON ARRAY of per-batch objects when the
// grid is batched). The gate then does an EXACT JOIN of the dictated manifest keys against the ledger's
// (term × platform) entries — no prose-table interpretation. The markdown Negative-results matrix stays
// as the human-readable judged view, but it is no longer what the gate counts when a ledger exists.

/**
 * Parse the saved grid ledger into per-term DISTINCT-platform counts. Cells and gaps both count as
 * accounted grid entries (a gap is an honest "did not run" — coverage honesty is the ledger row's job).
 * Throws on malformed input (the validator converts that to a fail — a parse miss must never pass).
 */
export function parseGridLedger(ledgerRaw) {
  const parsed = JSON.parse(ledgerRaw);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  const platforms = new Map();   // norm(term) → Set(norm(platform))
  const add = (term, platform) => {
    const t = norm(term);
    if (!t) return;
    if (!platforms.has(t)) platforms.set(t, new Set());
    platforms.get(t).add(norm(platform));
  };
  for (const b of batches) {
    if (!b || typeof b !== "object" || !Array.isArray(b.cells)) throw new Error("batch missing cells[]");
    for (const c of b.cells) {
      if (!c || typeof c.term !== "string" || typeof c.platform !== "string") throw new Error("cell missing term/platform");
      add(c.term, c.platform);
    }
    for (const g of b.gaps ?? []) {
      // gap form per the grid program contract: "<term> | <platform> | <error>"
      if (typeof g === "string") {
        const [term, platform] = g.split("|").map((s) => s.trim());
        if (term && platform) add(term, platform);
      } else if (g && typeof g.term === "string" && typeof g.platform === "string") {
        add(g.term, g.platform);
      }
    }
  }
  return platforms;
}

/**
 * Count the recorded CONNOTATION / meaning queries in a grid ledger's `extras.pr_risk[]` (across batches).
 * This is the searched-not-asserted receipt: a recorded query (even with empty results) proves the meaning
 * search RAN; a missing query does not. Counts non-empty `query` strings only (so `[]` / `[{}]` read as 0).
 * Never throws — the grid-ledger parse is gated upstream (grid_ledger_unparseable), and a validator that
 * consumes this must stay bare-safe; an unparseable ledger reads as 0 recorded queries. PURE.
 */
export function parsePrRiskQueries(ledgerRaw) {
  let parsed;
  try { parsed = JSON.parse(ledgerRaw); } catch { return 0; }
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  let n = 0;
  for (const b of batches) {
    const pr = b?.extras?.pr_risk;
    if (!Array.isArray(pr)) continue;
    for (const e of pr) if (e && typeof e.query === "string" && e.query.trim()) n++;
  }
  return n;
}

/**
 * Machine-path shortfall: dictated manifest keys exact-joined against the grid ledger's distinct
 * (term × platform) entries. Same satisfaction ladder as the legacy path (alternates, word-boundary
 * substring coverage). Throws on an unparseable ledger.
 *
 * @returns {Array<{variant:string, cells:number, expected:number}>}
 */
export function findGridLedgerViolations(manifestOrTerms, ledgerRaw, { minCellsPerVariant = MIN_CELLS_PER_VARIANT } = {}) {
  const platforms = parseGridLedger(ledgerRaw);
  // Dictated path (preferred): the driver hands the EXACT term list it ran (grid-spec.json) as an array —
  // no prose inference, so the validator can never demand a key the grid did not run (kills the
  // manifest-inference class). Legacy path: parse the markdown manifest (archived runs / offline tests).
  const variants = Array.isArray(manifestOrTerms) ? manifestOrTerms : parseManifestVariants(manifestOrTerms);
  return shortVariants(variants, (term) => platforms.get(norm(term))?.size || 0, minCellsPerVariant);
}

// ── WS-B: platform-identity join (per-customer profiles) ────────────────────────────────────────────────
// The count floor proves HOW MANY distinct platforms each variant accounted for — never WHICH. With a
// dictated per-customer platform list, a worker on gaming habit could sweep the wrong marketplaces and
// still hit the count. For every manifest variant (or " / " alternate) that owns a ledger entry of its
// own, every dictated platform must be accounted (cells ∪ gaps — the same accounting as the count
// check). Variants with NO entry of their own (covered via the alternates/word-boundary ladder, or
// wholly missing) are the count check's business, not this one's. Throws on an unparseable ledger
// (same contract as findGridLedgerViolations).
//
// @returns {Array<{variant:string, missing:string[]}>}
export function findPlatformIdentityViolations(manifestOrTerms, ledgerRaw, dictatedPlatforms = []) {
  if (!dictatedPlatforms.length) return [];
  const map = parseGridLedger(ledgerRaw);
  const want = dictatedPlatforms.map(norm);
  const out = [];
  const variants = Array.isArray(manifestOrTerms) ? manifestOrTerms : parseManifestVariants(manifestOrTerms);
  for (const variant of variants) {
    // UNION the " / " family's accounted platforms before judging: workers legitimately re-key
    // between the packed and split forms (copper-conduit, 2026-06-12) and a supplementary closure
    // batch may key a bare alternate — the family is ONE manifest cell, exactly as the count
    // ladder treats it.
    const family = [...new Set([variant, ...variant.split("/").map((s) => s.trim()).filter(Boolean)])];
    const have = new Set();
    for (const t of family) for (const pl of map.get(norm(t)) ?? []) have.add(pl);
    if (!have.size) continue;                 // no entry at all — the count check's business
    // partial coverage (a variant the count ladder satisfied via word-boundary containment, with a
    // few supplementary cells of its own) is ALSO the count check's business — identity judges only
    // entries that plausibly attempted the full dictated grid, else the ladder's carve-outs re-fail
    // here on shapes the gate deliberately accepts.
    if (have.size < want.length) continue;
    const missing = want.filter((w) => !have.has(w));
    if (missing.length) out.push({ variant, missing });
  }
  return out;
}

// ── V4-4: coverage closure — machine-closable gaps ──────────────────────────────────────────────────────

/**
 * Coverage-limited grid cells → [{variant, platform, error?}]. With a machine grid ledger present
 * (the substrate, the preferred source) the ledger's gaps ARE the coverage-limited cells —
 * each carrying the grid program's own error string. Without one (inherited/legacy artifacts), parse
 * the sanctioned prose vocabulary ("not executed — coverage-limited") from the Negative-results matrix.
 */
export function findCoverageLimitedCells(findingsContent, ledgerRaw = null) {
  if (ledgerRaw != null) {
    const parsed = JSON.parse(ledgerRaw);
    const batches = Array.isArray(parsed) ? parsed : [parsed];
    const cells = [];
    for (const b of batches) {
      for (const g of b?.gaps ?? []) {
        if (typeof g === "string") {
          const [variant, platform, ...err] = g.split("|").map((s) => s.trim());
          if (variant && platform) cells.push({ variant, platform, error: err.join(" | ") });
        } else if (g && typeof g.term === "string" && typeof g.platform === "string") {
          cells.push({ variant: g.term, platform: g.platform, error: String(g.error ?? "") });
        }
      }
    }
    return cells;
  }
  const cells = [];
  let inMatrix = false;
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inMatrix = /negative results/i.test(h[1]); continue; }
    if (!inMatrix) continue;
    const row = rowCells(ln);
    if (!row || row.length < 3) continue;
    const [variant, platform, result] = row;
    if (!variant || norm(variant) === "variant") continue;
    if (/not executed/i.test(result) && /coverage-limited/i.test(result)) cells.push({ variant, platform });
  }
  return cells;
}

// A mechanical error string of a FAILED CALL — the exception-repr / HTTP-status shapes the grid program
// writes into gaps and the ledger. A bare prose "platform outage" claim deliberately does NOT match:
// closable until proven otherwise (V4-4 item 2's fail-safe direction).
const MECHANICAL_ERROR_RE = /\b[A-Za-z]+(?:Error|Exception)\b|HTTP\s*\d{3}|\bE(?:CONN\w*|TIMEDOUT|AI_AGAIN)\b|status[ =:]+\d{3}|traceback/i;

/**
 * Partition coverage-limited cells into {exempt, closable}: a cell is exempt ONLY when its own gap
 * error string (machine ledger path) or a Coverage-ledger row covering it (prose path: the row's
 * unit/reason mentions the cell's platform or variant) carries a mechanical error. Everything else
 * is closable.
 */
export function partitionClosableCells(findingsContent, cells) {
  const mechanicalRows = [];
  let inLedger = false;
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inLedger = /coverage ledger/i.test(h[1]); continue; }
    if (!inLedger) continue;
    const row = rowCells(ln);
    if (!row || row.length < 2) continue;
    if (MECHANICAL_ERROR_RE.test(ln)) mechanicalRows.push(norm(row.join(" ")));
  }
  const exempt = [], closable = [];
  for (const c of cells) {
    const covered = (c.error && MECHANICAL_ERROR_RE.test(c.error))
      || mechanicalRows.some((r) => r.includes(norm(c.platform)) || r.includes(norm(c.variant)));
    (covered ? exempt : closable).push(c);
  }
  return { exempt, closable };
}

// ── A1 SPLIT (perf, 2026-07-12): two concurrent half-grid members over one dictated grid ────────────────
// Common-law is the gather critical path (14–31 min single-member); the split runs the SAME dictated grid
// as TWO concurrent gather members over disjoint halves of the term×platform matrix and merges the two
// plugin-written ledgers in CODE, so downstream (the receipts gate, the connotation gate, the platform-
// identity join, coverage closure) keeps reading ONE canonical common-law-grid.json.
//
// THE PARTITION FUNCTION (load-bearing — followup routing derives cell ownership from it): a cell
// (term × platform) is owned by the half that owns its TERM, and terms are partitioned by INDEX PARITY
// over the canonical grid-spec's own terms array — even indices → half "a", odd → half "b".
//   - By-term (never by-platform): the grid-spec format is a terms×platforms cross-product, and the
//     per-variant count/identity joins (findGridLedgerViolations / findPlatformIdentityViolations) need
//     every platform of a term accounted in ONE ledger — splitting a term's platforms across halves
//     would false-fail both halves.
//   - Interleaved (never first-half/second-half): manifest term order clusters related forms (core
//     first, transliterations last), so parity balances the heavy/light terms across the halves.
//   - Deterministic in the spec's term order: the canonical _driver/grid-spec.json is the single input,
//     so a fresh process, a resume, and a repair-routing decision all derive the same partition; the
//     half-spec sidecars on disk are the durable receipt of it.
export const GRID_HALVES = ["a", "b"];

// — THE MEANING SWEEP IS NOT PARTITIONED. ONE HALF OWNS ALL OF IT.
//
// Terms split because a term × platform cell is judged on its own. A meaning RECEIPT is not:
// findConnotationViolations' recurrence floor (RECURRENT_MIN, connotation-search.mjs) promotes a recorded
// result to a citation obligation on how many DISTINCT queries surfaced it — a property of the WHOLE
// sweep, not of any one query. Under an index-parity partition that floor is SUPERADDITIVE: a result
// surfacing on two of half a's queries and two of half b's owes a citation at NEITHER half (2 < 4) and
// owes one at the merge (4 >= 4). Both halves pass their own validator, the merge rejects the combined
// grid, and the run goes terminal AFTER the full paid gather — with no reader anywhere who could have
// seen the pattern from the receipts it held. That is the VENZY terminal: 950 seconds of half-work plus a
// successful retry, discarded, on the round's wall-clock comparison run.
//
// Single-seat ownership makes the merged obligation set the owning half's obligation set BY
// CONSTRUCTION, and the containment is provable rather than lucky:
//   · merged extras.pr_risk === the owning half's pr_risk — the sibling's spec carries zero queries, so
//     the plugin's own hasConn gate writes it no meaning receipts at all;
//   · the merged document ⊇ the owning half's document — mergeCommonLawFindings is concatenation, and
//     more lines can only satisfy more citation joins, never fewer.
// So merged violations ⊆ owning-half violations. Nothing is deferred, which is why nothing can be
// dropped: an absence stays a finding without any new bookkeeping to carry it.
//
// The bonus is larger than the fix. The recurrence failure now surfaces at the HALF stage, inside the
// corrective ladder, where the connotation tokens are warm-retry eligible and correctionHint
// already names the receipt. It stops being a merge-gate surprise with one bounded remedy round.
//
// — THE SWEEP GETS ITS OWN SEAT. It stays whole; it stops riding a grid.
//
// Single-seat ownership was always right and the seat was always the wrong one. Measured across 14
// preserved clearance runs, the half that owned the sweep refused its FIRST attempt on 13 of 14, and
// the sibling that owned none refused on 3. The obvious reading — the owning half is overloaded — is
// refuted by its own numbers: per attempt it is only ~11% longer at the median, and on three runs it
// spent LESS wall than its sibling and still ruled zero of 61 rows (228s against 428s on one). A seat
// that finishes early and rules nothing is not a seat running out of capacity. It is a seat asked to
// do two unlike jobs in one turn, finishing the one it can see the end of.
//
// So the remedy is not a lighter grid for that half — that would rebalance the wall and leave the
// 13-of-14 refusal exactly where it is. It is a seat whose whole dispatch IS the meaning work:
//
//   · both GRID halves now carry zero meaning queries, so `connotation_no_ruling` — the gate that
//     fired on 13 of 14 first attempts — cannot fire on a grid half at all;
//   · the sweep is still NOT PARTITIONED, so every word of the  block above still holds. The
//     containment argument is unchanged and in fact tighter: merged extras.pr_risk === this seat's
//     pr_risk, because BOTH siblings' specs now carry zero queries rather than one of them;
//   · the grid stays split evenly at parity, so nothing about splitGridTerms or halfOfTerm moves.
//
// It is also more faithful to than the arrangement it replaces. ruled the sweep indivisible;
// under the old constant it was indivisible but tied to a seat that also owned half a grid. Now it is
// indivisible and alone.
//
// The seat id is NOT a grid half, and that is load-bearing: halfOfTerm, splitGridTerms and the closure
// cell balancer are all term-keyed, and this seat owns no terms. It never appears in GRID_HALVES.
export const MEANING_SEAT = "m";

// Every seat the split dispatches: the two grid halves plus the meaning seat. Loops that are about
// TERMS/CELLS use GRID_HALVES; loops that are about SEATS (dispatch, quarantine, merge, audit) use
// this. Reading the wrong one is the silent failure this pair of names exists to prevent.
export const GRID_SEATS = [...GRID_HALVES, MEANING_SEAT];

/** Partition the dictated terms into the two halves (see the partition contract above). PURE. */
export function splitGridTerms(terms) {
  const halves = { a: [], b: [] };
  (terms ?? []).forEach((t, i) => halves[i % 2 === 0 ? "a" : "b"].push(t));
  return halves;
}

/**
 * The half that OWNS a term under the partition — "a" | "b", or null when the term matches neither
 * half (a caller should then treat the work as spanning both). Matching mirrors the satisfaction
 * ladder's tolerance: normalized equality against a half's terms, or membership in a " / "-packed
 * family (workers legitimately re-key a packed cell to a bare alternate — copper-conduit). PURE.
 */
// ── item 25 — BALANCE THE REOPEN, and only the reopen ────────────────────────────────────────────────
//
// The premise that was rejected, and rightly: an N-worker term queue. It would destroy the pure-function
// partition halfOfTerm gives us — every followup finds its work by asking which half owns a term — and
// replace it with durable per-worker state, in the same batch that is repairing the corrective lane's
// determinism. And the FRESH gather is only 1.4x apart; the 857s-vs-100s figure is from the REOPEN. So
// the imbalance is a reopen phenomenon and it gets fixed where it lives.
//
// The reopen already knows exactly which cells it is re-running. So it partitions THAT set evenly at
// dispatch and records the partition, instead of routing each cell through halfOfTerm and discovering
// that every closable cell happens to belong to one half.
//
// DETERMINISTIC, and that is the whole point of doing it this way: the cells are sorted by their own key
// and dealt round-robin, so the same closable set produces the same partition on every run and on a
// resume. Nothing durable is written and halfOfTerm is untouched — a followup can still find its work,
// because the followup DICTATES its cells by name rather than re-deriving them.
//
// A half that is not usable (no session, or quarantined) takes no cells; if none is usable the caller
// still gets the unassignable list back and ships them as the genuine limitation, exactly as before.
// PURE.
export function balanceClosureCells(cells, usableHalves, keyOf) {
  const assigned = Object.fromEntries((usableHalves ?? []).map((h) => [h, []]));
  const halves = (usableHalves ?? []).filter(Boolean);
  if (!halves.length) return { assigned, unassigned: [...(cells ?? [])] };
  const ordered = [...(cells ?? [])].sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
  ordered.forEach((c, i) => assigned[halves[i % halves.length]].push(c));
  return { assigned, unassigned: [] };
}

export function halfOfTerm(halfTerms, term) {
  const t = norm(term);
  if (!t) return null;
  for (const h of GRID_HALVES) {
    for (const owned of halfTerms?.[h] ?? []) {
      if (norm(owned) === t) return h;
      if (owned.split("/").map((s) => norm(s)).filter(Boolean).includes(t)) return h;
    }
  }
  return null;
}

/**
 * Term scope each USABLE half must cover on a whole-grid channel/source sweep. A live half covers its
 * OWN partition terms; a half with no usable session this process (quarantined/skipped/dead) has its
 * terms RE-ROUTED to a usable sibling — mirroring the cell re-route: any live common-law session can
 * run a dictated supplementary search, and the merge unions by term|platform regardless of which
 * half's ledger carries it. This is the never-thinner guarantee for channel sweeps: the unsplit
 * member sweeps EVERY manifest variant, so the split must dictate every term to SOME live session or
 * the caller must disclose a deferral — never sweep half the variants and call the omission closed.
 * Returns {} when no half is usable (the caller then defers/discloses). PURE.
 */
export function routeHalfTermScopes(halfTerms, usableHalves) {
  const usable = (usableHalves ?? []).filter((h) => GRID_HALVES.includes(h));
  if (!usable.length) return {};
  const out = Object.fromEntries(usable.map((h) => [h, [...(halfTerms?.[h] ?? [])]]));
  for (const h of GRID_HALVES) {
    if (usable.includes(h)) continue;
    out[usable[0]].push(...(halfTerms?.[h] ?? []));   // orphaned half → first usable sibling
  }
  return out;
}

/**
 * Dictated connotation/meaning queries the merged ledger did NOT record. The canonical connotation
 * gate (findConnotationViolations) is COUNT-based — any one recorded query satisfies it — so under
 * the split it cannot see a quarantined half's dictated queries silently vanishing (the surviving
 * half's receipts keep the count > 0: the fabricated-clearance false-clean shape, meaning-read asserted over
 * searches that never ran). This is the per-query identity join the merge gate runs instead: every
 * query the FULL spec dictates must appear (normalized) in the merged extras.pr_risk[] — the plugin
 * records each dictated query verbatim, so a miss means the query never executed. PURE.
 */
export function findDroppedConnotationQueries(spec, mergedGrid) {
  const dictated = spec?.connotation?.queries ?? [];
  const recorded = new Set();
  for (const e of Array.isArray(mergedGrid?.extras?.pr_risk) ? mergedGrid.extras.pr_risk : [])
    if (e && typeof e.query === "string" && e.query.trim()) recorded.add(norm(e.query));
  return dictated.filter((q) => !recorded.has(norm(q)));
}

/**
 * Of the dictated meaning queries that produced no receipt, which ones did the plugin HONESTLY REPORT as
 * having thrown?
 *
 * The plugin's program contract (providers/perplexity/src/core.js) wraps each connotation query
 * individually: "on an exception append `<query> | connotation | <repr(exception)>` to gaps and CONTINUE".
 * mergeGrids' non-spec union branch then carries that row through the merge verbatim, because
 * "connotation" is not a spec platform and so survives the term × platform recompute.
 *
 * So a missing receipt has two very different causes, and they were indistinguishable:
 *   - the query THREW and said so       — a gap row exists, naming the query and the error
 *   - the query VANISHED without trace  — nothing anywhere; the plugin's own contract was not honoured
 *
 * The second is a genuine plugin defect. The first is, on the evidence available at the merge gate, most
 * likely weather — one web request failing inside a plugin that otherwise completed both halves.
 *
 * NEITHER is a pass. A meaning check that did not complete cannot back a clean reputational read, which is
 * the gang-slang-near-miss false-clean class the per-query join exists to prevent — so an errored query
 * still fails the gate. What changes is only how many attempts it gets before that failure is permanent.
 * Deliberately NOT counted as searched: laundering an honest error into a clean receipt would be a worse
 * defect than the one being fixed.
 */
export function findErroredConnotationQueries(spec, mergedGrid) {
  const missing = new Set(findDroppedConnotationQueries(spec, mergedGrid).map(norm));
  if (!missing.size) return [];
  const errored = [];
  for (const g of Array.isArray(mergedGrid?.gaps) ? mergedGrid.gaps : []) {
    if (!g || String(g.platform ?? "").toLowerCase() !== "connotation") continue;
    const q = String(g.term ?? "").trim();
    if (q && missing.has(norm(q))) errored.push({ query: q, error: String(g.error ?? "unspecified") });
  }
  return errored;
}

/**
 * Derive the THREE seat specs from the FULL canonical spec. Terms follow splitGridTerms across
 * the two grid halves; the platforms/batch/ledger_required contract is copied VERBATIM (each half runs
 * the full platform list for its terms — see the by-term rationale above).
 *
 * The dictated connotation/meaning queries all go to MEANING_SEAT and BOTH grid halves get none (:
 * the recurrence floor is a property of the whole sweep, so a partitioned sweep can owe an obligation at
 * the merge that neither seat could see). The meaning seat carries NO TERMS — its dispatch is the
 * meaning work and nothing else — so it contributes no cells and no gaps, and every term-keyed
 * function in this module stays a two-half function.
 *
 * Each seat writes its OWN output ledger (opts.outputPaths). PURE.
 */
export function splitGridSpec(spec, { outputPaths = {}, dispositionsPaths = {} } = {}) {
  const terms = splitGridTerms(spec.terms);
  const queries = spec.connotation?.queries ?? [];
  const out = {};
  for (const h of GRID_SEATS) {
    const isMeaning = h === MEANING_SEAT;
    out[h] = {
      ...spec,
      half: h,
      // The meaning seat sweeps no cells. `terms: []` is what makes its dispatch the meaning work and
      // nothing else, and it is why the grid halves keep an untouched 50/50 parity split.
      terms: isMeaning ? [] : terms[h],
      output_path: outputPaths[h] ?? spec.output_path,
      // The disposition_required stamp still rides BOTH halves: it is the receipt-presence arm, and a
      // stray pr_risk block in the non-owning half must still be judged rather than waved through.
      //
      // — `dispositions_path` is DICTATED here, never inferred downstream. The grid tool renders it
      // into the obligations block it hands the seat, and the validator reads the same file; deriving the
      // name in two places is the drift this codebase has paid for twice. Absent ⇒ the tool names
      // no file and the seat is judged on prose alone, which is exactly the pre- behaviour.
      // — the half's OWN form path, ALWAYS set explicitly. The spread above carries the canonical
      // spec's connotation object verbatim, and since the canonical spec started carrying its own
      // dispositions_path a conditional override would let a half INHERIT the canonical path whenever the
      // caller passed none — both halves then writing one file, each overwriting the other's rulings. The
      // key is deleted rather than inherited, so a missing path is a missing path.
      connotation: (() => {
        const c = { ...(spec.connotation ?? {}), queries: isMeaning ? queries : [] };
        if (dispositionsPaths[h]) c.dispositions_path = dispositionsPaths[h];
        else delete c.dispositions_path;
        return c;
      })(),
    };
  }
  return out;
}

/**
 * Merge the two half-grid ledgers into the ONE canonical ledger downstream reads. Inputs are the
 * PARSED half ledgers (a single stdout object or a batch array, exactly as saved; null for a half
 * whose ledger is missing/unreadable — the caller passes the reason via opts.halfErrors[half]).
 *
 *   - cells[]: union across both halves' batches, deduped by norm(term)|norm(platform) — first
 *     occurrence wins (half a, then b; a re-routed repair cell may land in either half's file, so the
 *     union is keyed on the cell, never on which file carried it). A malformed batch (no cells[])
 *     contributes nothing — its cells re-surface as gaps below, never as a silent false-clean.
 *   - gaps[]: RECOMPUTED against the FULL spec — every spec (term × platform) cell absent from the
 *     merged cells[] gets one gap row, carrying (in priority order) the half ledgers' own recorded gap
 *     error, the owning half's failure reason (opts.halfErrors), or a generic unaccounted marker. A
 *     cell present in cells[] never re-reads as a gap (a stale half gap that a supplementary closure
 *     batch has since closed is dropped). This is the never-thinner guarantee: every dictated cell is
 *     accounted as a real cell or an HONEST gap, so a half failure can never yield a ledger that is
 *     thinner but still valid. A half's honestly-recorded gap for a cell OUTSIDE the spec (a re-keyed
 *     variant / an extra swept platform) is UNIONED in too — the spec-only recompute would erase it.
 *   - extras.pr_risk[]: concatenated (a then b), deduped by trimmed query — restores the full dictated
 *     meaning-receipt set from the per-half partitions. Other extras keys: arrays concatenate,
 *     anything else first-defined wins.
 *
 * PURE — the caller owns reading/writing files (atomic) and deciding half failure semantics.
 */
export function mergeGrids(a, b, { spec, halfErrors = {} } = {}) {
  const batchesOf = (parsed) => (parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed]);
  const key = (term, platform) => `${norm(term)}|${norm(platform)}`;
  const halves = [["a", a], ["b", b]];
  // cells: keyed union, first wins
  const cells = [];
  const seen = new Set();
  // recorded per-cell gap errors from either half (string + object gap forms)
  const gapErr = new Map();
  for (const [, parsed] of halves) {
    for (const batch of batchesOf(parsed)) {
      if (!batch || typeof batch !== "object") continue;
      for (const c of Array.isArray(batch.cells) ? batch.cells : []) {
        if (!c || typeof c.term !== "string" || typeof c.platform !== "string") continue;
        const k = key(c.term, c.platform);
        if (seen.has(k)) continue;
        seen.add(k);
        cells.push(c);
      }
      for (const g of Array.isArray(batch.gaps) ? batch.gaps : []) {
        if (typeof g === "string") {
          const [term, platform, ...err] = g.split("|").map((s) => s.trim());
          if (term && platform && !gapErr.has(key(term, platform))) gapErr.set(key(term, platform), { term, platform, error: err.join(" | ") });
        } else if (g && typeof g.term === "string" && typeof g.platform === "string") {
          if (!gapErr.has(key(g.term, g.platform))) gapErr.set(key(g.term, g.platform), { term: g.term, platform: g.platform, error: String(g.error ?? "") });
        }
      }
    }
  }
  // extras: pr_risk concat+dedup by query; other keys arrays-concat / first-wins
  const extras = {};
  for (const [, parsed] of halves) {
    for (const batch of batchesOf(parsed)) {
      for (const [k, v] of Object.entries(batch?.extras ?? {})) {
        if (Array.isArray(v)) extras[k] = [...(Array.isArray(extras[k]) ? extras[k] : []), ...v];
        else if (!(k in extras)) extras[k] = v;
      }
    }
  }
  if (Array.isArray(extras.pr_risk)) {
    const seenQ = new Set();
    extras.pr_risk = extras.pr_risk.filter((e) => {
      const q = typeof e?.query === "string" ? e.query.trim() : null;
      if (!q) return true;                        // query-less entries pass through untouched
      if (seenQ.has(q)) return false;
      seenQ.add(q);
      return true;
    });
  }
  // gaps: recomputed against the FULL spec
  const halfTerms = splitGridTerms(spec?.terms ?? []);
  const gaps = [];
  for (const term of spec?.terms ?? []) {
    for (const platform of spec?.platforms ?? []) {
      if (seen.has(key(term, platform))) continue;
      const owner = halfOfTerm(halfTerms, term);
      const error = gapErr.get(key(term, platform))?.error
        || (owner && halfErrors[owner]) || "cell not accounted by either half-grid";
      gaps.push({ term, platform, error });
    }
  }
  // UNION honestly-recorded NON-SPEC gap rows: a half may record a gap for a cell OUTSIDE the canonical
  // spec (a legitimately re-keyed variant / an extra platform a half swept). The spec-only recompute above
  // never emits those, silently erasing an honestly-recorded coverage gap — union them so an honest gap
  // survives the merge. A cell present in cells[] still wins (a stale gap a supplementary batch has since
  // closed is dropped exactly as for spec cells), and a gap already emitted by the spec loop is not doubled.
  const gappedKeys = new Set(gaps.map((g) => key(g.term, g.platform)));
  for (const [k, g] of gapErr) {
    if (seen.has(k) || gappedKeys.has(k)) continue;
    gaps.push({ term: g.term, platform: g.platform, error: g.error || "cell not accounted by either half-grid" });
  }
  return { cells, extras, gaps };
}

/**
 * Assemble the ONE canonical common-law findings file from the per-half findings the two members
 * wrote. Straight concatenation under a driver banner — the halves are complete findings files in
 * their own right (each passed the half validator's structural checks), and every downstream reader
 * is either an LLM reading prose or a section parser that walks headings (both concatenation-safe).
 * A missing half (quarantined member) contributes an honest driver note instead: its cells are
 * already recorded as gaps in the merged machine ledger, and nothing in the assembled file asserts
 * coverage for them. parts: [{half, content|null, error|null}] in half order. PURE.
 */
export function mergeCommonLawFindings(parts) {
  const chunks = [
    `<!-- driver-assembled: concurrent half-grid sweeps (${parts.map((p) => `half-${p.half}`).join(", ")}) — the machine ledger common-law-grid.json is the merged coverage truth -->`,
  ];
  for (const p of parts) {
    chunks.push(p.content != null
      ? p.content.trimEnd()
      : [
          `## Half-${p.half} sweep unavailable (driver note)`,
          ``,
          `The concurrent half-grid member owning this half's terms did not complete${p.error ? ` (${p.error})` : ""}.`,
          `Its (term × platform) cells are recorded as honest gaps in the machine grid ledger and ride the coverage-closure pass — this file asserts NO coverage for them.`,
        ].join("\n"));
  }
  return chunks.join("\n\n") + "\n";
}

// ── common-law → register cross-check signals (copper-lattice recovery net #3) ─────────────────────────
// A verified-use, same-field common-law hit is register-recheck fuel: Option-D Triggers 1/4
// (phase2-execution.md) said so in prose; this makes the SIGNAL machine-readable so the driver can mint
// the register queries itself (owner sweep / mark-text recheck) instead of hoping the model does.
// Two tolerant sources over the common-law findings prose:
//   1. Negative-results matrix rows whose Result cell reads "Similar listing(s) found — see Findings"
//      (the sanctioned receipt vocabulary above) → { term, platform } — the cell produced findings.
//   2. Findings sections (headings containing "finding"), split into per-mark blocks at deeper
//      headings: a block contributes when it carries an <x>-of-record owner line (developer_of_record /
//      publisher_of_record / seller_of_record / owner_of_record; "not extracted"/unknown skipped) —
//      → { markText: the block heading, owner, url: the block's first http(s) link }.
// Unrecognizable tables/blocks contribute nothing (tolerant — this FEEDS a bounded dispatcher, it never
// gates). PURE.
// ── P2-A (the recall spine) — candidate-cardinality CENSUS: receipt-vocabulary drift, ADVISORY ───────
//
// ROUND-2 REWRITE (review problems 1 and 9). The first cut made this a hard validator arm
// (`grid_hit_denied`) on the premise that a ledger cell with status "hit" and a non-empty
// candidates[] holds real listings, so a "No results" row over it is a false receipt. The premise is
// FALSE against the real ledger, and the arm failed the very run it was derived from:
//
//   • `candidates[]` is RAW, UNJUDGED web-search output — the grid program records up to 8 candidates
//     per cell "without judging similarity" (skills/prelim-common-law/perplexity-prompts.md), and the
//     filtering is explicitly the model's. The real cell `CORAL FREEZE × vitaminshoppe.com` holds three:
//     a BCAA how-to video, a Hawaiian shaved-ice supplement and a Dallas store-locator page. The
//     model's "No results" means "no relevant listing", and no deterministic test can tell that page
//     from a genuine collision — relevance is judgment, so a hard arm cannot own it.
//   • On an evidence run the arm flagged 221 cells and turned
//     validators.commonLaw from {ok:true} to {ok:false} on both lanes. 150 of the 221 were EXACT
//     term matches — the premise failing at scale, not a join to tune. `validators.commonLaw` is the
//     stage's validate fn and the merged-half-grid gate, so that is a stage failure, a corrective
//     ladder, and (identical signature) a terminal — on a run that was correct.
//
// So the contradiction is reported as a COUNT, never a verdict: a census of hit cells received by a
// zero-candidates receipt, emitted on run.jsonl for drift-watching. Completeness of the matrix is
// still hard-gated, by the join that CAN be deterministic — findGridLedgerViolations /
// findPlatformIdentityViolations count the rows each dictated variant×platform owes, and a missing
// cell still fails `grid_join_missing` / `platforms_missing`. What is no longer gated is the WORDING
// a present row chose.
//
// The join bug is fixed independently, because a census nobody can trust is worse than none:
//   • TERM match is EXACT after stripping a trailing annotation ("提基冰沙 (ZH: …)"). It used to be
//     `rowTerm.includes(cellTerm)`, so the row for "CORAL FREEZE" was credited to the cells for "SLUSH"
//     and even "TIK", and the row for "提基冰沙" to the cell for "冰沙" — 71 of the 221.
//   • a platform ROLL-UP row ("Multiple platforms") counts only when the term has no platform-specific
//     row of its own; combined with the substring bug it used to match every platform at once.
// `undisposed` (title containment over raw web-search titles) is GONE: it returned 1,986 rows on the
// delivered run, so it fired on every healthy run and could never be a tripwire — title prose is
// paraphrasable, and a signal that is always on is not a signal. PURE over (ledgerRaw, findingsContent).
const stripAnnotation = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const ROLLUP_RE = /multiple platforms|all platforms/;

export function findGridCandidateOmissions(ledgerRaw, findingsContent) {
  let parsed;
  try { parsed = JSON.parse(ledgerRaw); } catch { return { denied: [] }; }
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  const hitCells = [];
  for (const b of batches) {
    for (const c of (b?.cells ?? [])) {
      if (String(c?.status ?? "").toLowerCase() !== "hit") continue;
      const candidates = (Array.isArray(c.candidates) ? c.candidates : []).filter((x) => x && (x.title || x.url));
      if (candidates.length) hitCells.push({ term: c.term, platform: c.platform, candidates });
    }
  }
  if (!hitCells.length) return { denied: [] };

  // matrix rows: [{term, platform, result}] — the negative-results section only.
  const rows = [];
  let inMatrix = false;
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inMatrix = /negative results/i.test(h[1]); continue; }
    if (!inMatrix) continue;
    const cells = rowCells(ln);
    if (!cells || cells.length < 3) continue;
    if (/^(variant|mark)$/i.test(norm(cells[0]))) continue;
    rows.push({ term: cells[0], platform: cells[1], result: cells.slice(2).join(" | ") });
  }
  const rowsFor = (cell) => {
    const ct = norm(cell.term);
    const cp = norm(cell.platform);
    if (!ct) return [];
    const sameTerm = rows.filter((r) => norm(stripAnnotation(r.term)) === ct);   // EXACT, never substring
    const exact = sameTerm.filter((r) => norm(r.platform) === cp);
    // a roll-up covers this platform only when the term states nothing more specific for it
    return exact.length ? exact : sameTerm.filter((r) => ROLLUP_RE.test(norm(r.platform)));
  };

  const denied = [];
  for (const cell of hitCells) {
    const matched = rowsFor(cell);
    if (matched.some((r) => /similar listing/i.test(r.result))) continue;   // the hit reached Findings
    for (const r of matched) {
      if (/^\s*(\*\*)?no results\b/i.test(r.result)) {
        denied.push({ term: cell.term, platform: cell.platform, candidates: cell.candidates.length, row: `${r.term} | ${r.platform} | ${r.result}`.slice(0, 200) });
        break;                                    // one entry per cell — the cell is the unit
      }
    }
  }
  return { denied };
}

export function findSimilarListingSignals(findingsContent) {
  const signals = [];
  const OWNER_RE = /(?:developer|publisher|seller|owner)(?:\s+|_)of(?:\s+|_)record\W{0,5}([^\n|]+)/i;
  const OWNER_SKIP_RE = /not extracted|unknown|n\/a|none|^[\s—–-]*$/i;
  const URL_RE = /https?:\/\/[^\s)|\]">]+/;
  let inMatrix = false, inFindings = false;
  let block = null;   // { markText, owner, url }
  const flush = () => {
    if (block && block.owner) {
      signals.push({ source: "finding", markText: block.markText || null, owner: block.owner, url: block.url || null, term: null, platform: null });
    }
    block = null;
  };
  for (const ln of (findingsContent || "").split("\n")) {
    const h = ln.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const title = h[2];
      if (h[1].length <= 2) {                      // a top-level section boundary
        flush();
        inMatrix = /negative results/i.test(title);
        inFindings = /\bfindings?\b/i.test(title) && !/negative results/i.test(title);
      } else if (inFindings) {                     // a per-mark block inside the findings section
        flush();
        block = { markText: title.replace(/[*_`]/g, "").trim(), owner: null, url: null };
      }
      continue;
    }
    if (inMatrix) {
      const cells = rowCells(ln);
      if (cells && cells.some((c) => /similar listing/i.test(c))) {
        const term = norm(cells[0]) === "variant" ? null : (cells[0] || null);
        if (term) signals.push({ source: "matrix", term, platform: cells[1] || null, owner: null, markText: null, url: null });
      }
      continue;
    }
    if (inFindings && block) {
      const om = ln.match(OWNER_RE);
      if (om && !block.owner) {
        const owner = om[1].replace(/[*_`]/g, "").trim();
        if (owner && !OWNER_SKIP_RE.test(owner)) block.owner = owner.slice(0, 120);
      }
      const um = ln.match(URL_RE);
      if (um && !block.url) block.url = um[0];
    }
  }
  flush();
  return signals;
}
