// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// commonlaw-carry.mjs —: the RETRIEVAL→FINDINGS trace for the common-law path, and for the jx zh
// grid, which carries the identical shape.
//
// A SIBLING of record-carry.mjs, deliberately not a widening of it. The two paths join on different
// keys — the register on a canonical `/mark` uri, this one on a canonicalised URL — and conflating them
// is how the key decision gets quietly reversed later. The vocabulary is shared; the join is not.
//
// ── the loss this exists to catch ────────────────────────────────────────────────────────────────────
//
// TIKI TWIST and TIKI TROPICS. Both sat in R3's own common-law records and reached no findings list, and
// nothing anywhere said why. `common-law-receipts.mjs`'s `findGridCandidateOmissions` already reports one
// class of this — a hit cell denied by the Negative-results matrix — but it is CELL-granular, and a cell
// carries up to eight candidates. This is the per-candidate half.
//
// ── THE JOIN KEY, settled by measurement rather than preference ──────────────────────────────────────
//
// **The house URL normalizer is rejected on evidence.** `verify-knockout.mjs`'s `normalizeUrl` returns
// host + pathname and DISCARDS THE QUERY. Over the real fixture `common-law-grid-2026-07-29` (42 cells,
// 146 candidates, 143 distinct URLs) it collapses 143 URLs to 139 keys, and one collision merges two
// different products:
//
//   play.google.com/store/apps/details
//     …?id=com.letsgetdigital.app3462x&hl=en_IN  (+ &hl=te, &hl=hi, &hl=ka)
//     …?id=com.zhiliaoapp.musically&hl=en_US     ← a DIFFERENT app
//
// If the second reaches a finding, all four of the first read "carried" and their real drop is invisible.
// And the collision concentrates in exactly the population this trace exists for: a Han-script
// marketplace query returns `?q=…` search URLs, so it cannot tell `s.taobao.com/search?q=冰沙` from
// `?q=沙冰`.
//
// **What is used instead:** the canonicalised URL — host (www-stripped) + %-decoded path + surviving
// query pairs sorted, with presentation params (locale, analytics, storefront routing) stripped — PLUS
// the structural cell key `norm(term)|norm(platform)` as the always-available fallback. On the same
// fixture: 140 keys, and its one remaining collision is the same app in four UI locales, which is
// correct. `canonicalUrlKeyCount` in the test pins both numbers.
//
// ── THE NON-LATIN TRAP IS ANSWERED, NOT AVOIDED ──────────────────────────────────────────────────────
//
// `normalizeJoinText` folds every non-[A-Za-z0-9] run to a space, so it returns the EMPTY STRING for
// 色度, 冰沙, 提基冰沙, ティキスラッシュ and 티키 슬러시. A mark-keyed trace is structurally blind to
// every one of them.
//
// NOTHING HERE TOUCHES IT. A Han-script candidate joins on its ASCII/percent-encoded URL. A Han-script
// cell TERM joins under exact `norm()` equality, which preserves it — `norm` lowercases and collapses
// whitespace and folds nothing else. A candidate with no URL at all inherits its cell's stated verdict
// and is counted BY NAME under `unjoinable_candidates`, never dropped. Keep that property; it is the
// difference between this trace and the one it replaces.
//
// ── the jx slices ────────────────────────────────────────────────────────────────────────────────────
//
// `_driver/jx/zh-grid.json` is written by `jx-units.mjs` in the EXACT `cells[]`+`gaps[]` shape, so the
// same tracer runs over it verbatim. Until item 8 deleted CLEAROTRON_JX_CONSUME the slice could be
// written and read by nothing, and a candidate
// on that slice is `shadow:not-consumed` — structurally incapable of reaching a finding, which is a
// different reason class from a judgment.
//
// THAT CLASS IS FOR THE STATE WE ARE LEAVING. is ruled: the slices are armed because they are live
// in the product. So `consumed` is a parameter, and an armed slice's candidates flow through the
// ORDINARY reason classes rather than a second code path. One tracer, one vocabulary, one switch.
//
// PURE (no node imports), like record-carry.mjs and placement-carry.mjs — the pipeline owns all IO,
// events and enforcement.

export const COMMONLAW_CARRY_SCHEMA_VERSION = 1;

/** How far a candidate got. Ordered; index = distance travelled. */
export const CL_REACH = ["retrieved", "cell-hit", "surfaced", "finding"];

/** The seam a candidate failed to cross. `null` when it reached a finding. */
export const CL_SEAMS = ["grid", "findings"];

/**
 * The stage labels that own the common-law seam. ALL THREE literals, and that is the trap:
 * `parseStageOutcomes` matches by EXACT set membership, and a split run logs `common-law-half:a` /
 * `common-law-half:b` and never `common-law`. Asking for `["common-law"]` finds no events, `completed`
 * stays false, and every candidate on every split run reads `stage-incomplete` — a loud wrong answer on
 * the common path.
 *
 * Confirmed against `origin/main` after (`961d2e5`) landed: that commit changed connotation-query
 * OWNERSHIP and did not touch label construction, so the split labels are unchanged.
 */
export const CL_STAGES = ["common-law", "common-law-half:a", "common-law-half:b"];

/** Lowercase, collapse whitespace. Folds NOTHING else — Han script survives it, which is the point. */
export const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The structural identity of a cell: always available, script-neutral, and unique per grid row. */
export const cellKey = (term, platform) => `${norm(term)}|${norm(platform)}`;

/**
 * Query parameters that do not identify the thing being pointed at.
 *
 * Locale and UI routing — the same product in four languages is ONE product. Analytics and referral —
 * they identify who sent you, never what you arrived at. Storefront routing — the same listing reached
 * through a different shelf.
 *
 * Deliberately an ALLOW-to-drop list rather than a keep-list: an unknown parameter is KEPT, because
 * dropping one that turns out to identify the product is the collision this key exists to prevent, and
 * keeping one that turns out to be noise only ever splits a key, which is visible as a missed join
 * rather than as a silent merge.
 */
const PRESENTATION_PARAMS = new Set([
  "hl", "gl", "lang", "language", "locale", "lr", "ie", "oe", "hl_ir",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "ref", "ref_", "referrer", "referer", "tag", "ascsubtag", "linkcode", "creative", "creativeasin",
  "gclid", "fbclid", "msclkid", "dclid", "igshid", "mc_cid", "mc_eid",
  "psc", "th", "smid", "pd_rd_i", "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pf_rd_p", "pf_rd_r",
  "spm", "scm", "pvid", "algo_pvid", "algo_expid", "sourceType", "src", "from", "share_token",
  "_encoding", "qid", "sr", "keywords", "sprefix", "crid",
]);

/**
 * The join key for a candidate URL, or "" when there is none to make.
 *
 * host (www-stripped, lowercased) + %-decoded path (trailing slash dropped) + the surviving query pairs,
 * sorted. PURE and total: an unparseable URL falls back to a trimmed lowercase string rather than
 * throwing, because a malformed URL is a candidate the run really retrieved and it must still get a row.
 */
export function canonicalUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s.includes("://") ? s : `https://${s}`); }
  catch { return s.toLowerCase(); }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  let path;
  try { path = decodeURIComponent(u.pathname); } catch { path = u.pathname; }
  path = path.replace(/\/+$/, "");
  const pairs = [];
  for (const [k, v] of u.searchParams) {
    if (PRESENTATION_PARAMS.has(k)) continue;
    let dv = v;
    try { dv = decodeURIComponent(v); } catch { /* already decoded, or not decodable */ }
    pairs.push(`${k.toLowerCase()}=${dv}`);
  }
  pairs.sort();
  return `${host}${path}${pairs.length ? `?${pairs.join("&")}` : ""}`;
}

/**
 * Every candidate the grid retrieved, flattened, with both join keys on each row.
 *
 * Handles BOTH top-level shapes — a single object and an array of per-batch objects — because both ship:
 * an un-split run saves the grid program's stdout verbatim, and a split run's `mergeGrids` writes a
 * merged object. Reading only one silently traces half a run.
 *
 * `gaps[]` is heterogeneous by path: the grid program appends STRINGS (`"<term> | <platform> | <error>"`)
 * and the plugin's reconciler and the driver's merge append OBJECTS. Both are read. A gap is not a
 * candidate and never becomes a row here — it is a cell that produced nothing, reported separately, so a
 * reader can tell "searched and found nothing" from "never searched".
 * PURE.
 */
export function parseGridCandidates(gridRaw) {
  let parsed;
  try { parsed = typeof gridRaw === "string" ? JSON.parse(gridRaw) : gridRaw; }
  catch { return { ok: false, reason: "common-law grid is not parseable JSON", candidates: [], cells: [], gaps: [] }; }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "common-law grid is empty", candidates: [], cells: [], gaps: [] };
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  const candidates = [], cells = [], gaps = [];
  for (const b of batches) {
    for (const c of Array.isArray(b?.cells) ? b.cells : []) {
      if (!c || typeof c.term !== "string" || typeof c.platform !== "string") continue;
      const key = cellKey(c.term, c.platform);
      const status = String(c.status ?? "").toLowerCase();
      const list = (Array.isArray(c.candidates) ? c.candidates : []).filter((x) => x && (x.title || x.url));
      cells.push({ cell: key, term: c.term, platform: c.platform, status, candidates: list.length });
      for (const x of list) {
        candidates.push({
          cell: key, term: c.term, platform: c.platform, status,
          title: String(x.title ?? ""), url: String(x.url ?? ""),
          url_key: canonicalUrl(x.url),
        });
      }
    }
    for (const g of Array.isArray(b?.gaps) ? b.gaps : []) {
      if (typeof g === "string") {
        const [term = "", platform = "", ...rest] = g.split("|").map((s) => s.trim());
        gaps.push({ cell: cellKey(term, platform), term, platform, error: rest.join(" | ") });
      } else if (g && typeof g === "object") {
        gaps.push({ cell: cellKey(g.term, g.platform), term: String(g.term ?? ""), platform: String(g.platform ?? ""), error: String(g.error ?? "") });
      }
    }
  }
  return { ok: true, reason: null, candidates, cells, gaps };
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/**
 * Every URL the findings prose names, as canonical keys, plus the Negative-results matrix rows keyed by
 * cell. The two answer different questions: a URL in the findings means THIS candidate surfaced; a
 * matrix row means the cell was ruled on and the ground is on the page.
 *
 * The matrix parse mirrors `findGridCandidateOmissions` — same heading test, same exact-term rule, same
 * roll-up handling — because two matchers over one table drift apart. PURE.
 */
export function parseFindingsSurfaces(findingsText) {
  const text = String(findingsText ?? "");
  const urls = new Map();
  for (const m of text.match(URL_RE) ?? []) {
    const k = canonicalUrl(m.replace(/[.,;:]+$/, ""));
    if (k && !urls.has(k)) urls.set(k, m);
  }
  const rows = [];
  let inMatrix = false;
  for (const ln of text.split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inMatrix = /negative results/i.test(h[1]); continue; }
    if (!inMatrix) continue;
    const cells = ln.includes("|") ? ln.split("|").map((s) => s.trim()).filter((s, i, a) => !(i === 0 && !s) && !(i === a.length - 1 && !s)) : null;
    if (!cells || cells.length < 3) continue;
    if (/^(variant|mark)$/i.test(norm(cells[0]))) continue;
    if (/^-+$/.test(cells[0].replace(/[\s:]/g, ""))) continue;   // the ---|---|--- separator row
    rows.push({ term: cells[0], platform: cells[1], result: cells.slice(2).join(" | ") });
  }
  return { urls, rows, decidable: text.trim().length > 0 };
}

const stripAnnotation = (s) => String(s ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const ROLLUP_RE = /multiple platforms|all platforms/;

/** The Negative-results rows that speak about this cell — exact term, then a roll-up if none is exact. */
function rowsForCell(rows, term, platform) {
  const ct = norm(term), cp = norm(platform);
  if (!ct) return [];
  const sameTerm = rows.filter((r) => norm(stripAnnotation(r.term)) === ct);
  const exact = sameTerm.filter((r) => norm(r.platform) === cp);
  return exact.length ? exact : sameTerm.filter((r) => ROLLUP_RE.test(norm(r.platform)));
}

const clip = (s, n = 300) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/**
 * Classify ONE candidate. FIXED PRECEDENCE, and `stage-incomplete` outranks everything a completed
 * stage could have said — the same rule and the same reason as record-carry.mjs. PURE.
 */
export function classifyCandidate(cand, { surfaces, completed, evidence, consumed = true, slice = "common-law" } = {}) {
  const seat = { cell: cand.cell, term: cand.term, platform: cand.platform, title: cand.title, url: cand.url };

  // FIRST, and ahead of the URL match deliberately. An unconsumed slice is structurally incapable of
  // reaching a finding — nothing reads its grid — so a URL of its that appears in the findings got there
  // down a DIFFERENT path (the common-law grid and the zh grid overlap on the open web). Letting the URL
  // match win would credit a shadow slice with a delivery it cannot make, which is the single most
  // flattering wrong answer this trace could give.
  if (!consumed) {
    return { ...seat, reach: "retrieved", stopped_at: "findings", reason: "shadow:not-consumed",
      reason_source: "step-structural", joined_on: null,
      detail: `${slice} runs as a shadow unit on this instance: it writes its grid and nothing reads it, so no candidate on it can reach a finding. This is a configuration boundary, not a decision about this candidate` };
  }

  if (cand.url_key && surfaces?.urls?.has(cand.url_key)) {
    return { ...seat, reach: "finding", stopped_at: null, reason: null, reason_source: null, joined_on: "url",
      detail: `the findings name this URL` };
  }

  if (!completed) {
    return { ...seat, reach: "retrieved", stopped_at: "grid", reason: "grid:stage-incomplete",
      reason_source: "step-structural", joined_on: null,
      detail: clip(`UPSTREAM ABSENCE, NOT JUDGMENT — ${evidence || "no common-law stage logged ok:true"}, so whatever it left on disk is PARTIAL and a candidate the findings do not name cannot be distinguished between considered-and-not-carried and never reached at all`) };
  }

  if (cand.status !== "hit") {
    return { ...seat, reach: "retrieved", stopped_at: "grid", reason: "grid:cell-no-hit",
      reason_source: "step-structural", joined_on: "cell",
      detail: `the grid recorded this cell as ${cand.status || "(no status)"}, so its candidates were retrieved but the cell itself reports nothing to carry` };
  }

  // The cell was a hit. Did the findings rule on it?
  const ruled = surfaces?.decidable ? rowsForCell(surfaces.rows ?? [], cand.term, cand.platform) : [];
  if (ruled.length) {
    return { ...seat, reach: "cell-hit", stopped_at: "findings", reason: "findings:reasoned-negative",
      reason_source: "step-stated", joined_on: "cell",
      detail: clip(`the findings' Negative-results matrix rules on this cell: ${ruled.map((r) => r.result).join(" · ")}`) };
  }
  if (!surfaces?.decidable) {
    return { ...seat, reach: "cell-hit", stopped_at: "findings", reason: "trace:indeterminate",
      reason_source: "absent", joined_on: null,
      detail: "no common-law findings text was available, so the carry of this candidate cannot be decided in either direction" };
  }
  if (!cand.url_key) {
    // The ruling's requirement: counted BY NAME, never disappeared.
    return { ...seat, reach: "cell-hit", stopped_at: "findings", reason: "findings:unjoinable-no-url",
      reason_source: "absent", joined_on: null,
      detail: "this candidate carries no URL, so it cannot be joined to the findings by the only script-neutral key it could have had; its cell is a hit and the findings neither name it nor rule on its cell" };
  }
  return { ...seat, reach: "cell-hit", stopped_at: "findings", reason: "findings:silent-drop",
    reason_source: "absent", joined_on: null,
    detail: "the grid recorded this cell as a hit and returned this candidate; the findings neither name its URL nor write its cell a Negative-results row" };
}

/**
 * THE TRACE. One row per retrieved common-law (or jx zh) candidate.
 *
 * `outcomes` = parseStageOutcomes(run.jsonl, CL_STAGES) — pass CL_STAGES or every split run reads
 * incomplete. `consumed` false marks the whole slice `shadow:not-consumed`. PURE.
 */
/**
 * Channels the DRIVER orders unconditionally, whatever the profile lists. Not a default and not a
 * fallback: the grid dictation appends the general-web search to every profile's platform list, so this
 * is part of the plan on every run and belongs on the planned side of any comparison.
 */
export const ALWAYS_PLANNED_CHANNELS = Object.freeze(["web"]);

/**
 * — WHAT WAS ORDERED versus WHAT RAN, which no rate in this file could see.
 *
 * The reconciliation rates divide retrieved-by-retrieved and rowed-cells-by-candidate-bearing-cells. A
 * channel that was never searched produces no cell and no candidate, so it enters NEITHER numerator nor
 * denominator: a run that swept 3 of 8 mandatory channels and reconciled all 3 scores identically to one
 * that swept all 8, and the committed floor cannot fire on it. A metric honest about what it measured and
 * silent about what it never looked at.
 *
 * THE PLAN IS NOT IN THE ARTIFACT. `common-law-grid.json`'s top-level keys are `cells`, `extras`, `gaps`
 * — the executed set only. The planned list lives one layer up (the profile's platforms, dictated verbatim
 * into the seat's task message), so it has to be handed in. When it is not, this reports an explicit
 * UNKNOWN rather than omitting the question: a run that cannot state what it was ordered to search must
 * not score clean on coverage, which is the whole defect one level up.
 *
 * ATTEMPTED = platforms named by a cell OR by a gap. A gap is a cell that ran and produced nothing — very
 * much searched. Only a platform in neither was never reached.
 *
 * `web` IS ORDERED BY THE DRIVER, NOT LISTED BY THE PROFILE. The dictation reads "the grid sweeps EXACTLY
 * these store domains for EVERY variant: <profile.platforms> — plus ONE unrestricted general-web search
 * per variant (platform name "web")". So the executed set carries `web` on every run while most profiles
 * never name it, and a naive comparison would report it as an UNPLANNED channel forever — an alarm that
 * fires on correct behaviour is an alarm nobody reads. It is unioned into the plan instead, which also
 * makes the useful direction work: a run whose grid never produced a `web` cell reports `web` as never
 * searched, and the driver did order it.
 * PURE.
 */
export function planVsExecutedChannels(opts) {
  // `= {}` defaults on undefined and NOT on null, and every caller here is a reader of somebody else's
  // artifact. A coverage check that throws on a missing block is a coverage check that does not run.
  const { planned = null, cells = [], gaps = [] } = opts ?? {};
  const executed = new Set();
  for (const c of Array.isArray(cells) ? cells : []) if (c?.platform) executed.add(norm(c.platform));
  // gaps are heterogeneous by path: STRINGS ("<term> | <platform> | <error>") from the grid program and
  // OBJECTS from the reconciler and the driver's merge. Reading only one shape traces half a run.
  for (const g of Array.isArray(gaps) ? gaps : []) {
    if (g && typeof g === "object" && g.platform) { executed.add(norm(g.platform)); continue; }
    const parts = String(g ?? "").split("|");
    if (parts.length >= 2 && parts[1].trim()) executed.add(norm(parts[1]));
  }
  const list = Array.isArray(planned) ? planned.filter((x) => String(x ?? "").trim()) : null;
  if (!list) {
    return { state: "unknown", why: "no planned channel list reached this trace — what was ORDERED is not recorded here, so coverage cannot be scored",
      planned: null, executed: [...executed].sort(), never_searched: null, unplanned: null, rate: null };
  }
  // The always-planned channels ride the plan ONLY when the profile named platforms at all. The dictation
  // block that appends the general-web search is itself conditional on `profile?.platforms?.length` — with
  // no platforms configured, the driver orders no platform sweep and no web search, so unioning `web` into
  // an empty plan would invent a coverage hole out of a profile that ordered nothing.
  const plannedSet = new Set(list.length ? [...list.map(norm), ...ALWAYS_PLANNED_CHANNELS.map(norm)] : []);
  const never = [...plannedSet].filter((x) => !executed.has(x)).sort();
  // A platform swept that nobody planned is not a defect and is not silence either — it is reported so a
  // reader can tell a widened sweep from a mis-keyed plan.
  const extra = [...executed].filter((x) => !plannedSet.has(x)).sort();
  return {
    state: never.length ? "incomplete" : "complete",
    why: null,
    planned: [...plannedSet].sort(),
    executed: [...executed].sort(),
    never_searched: never,
    unplanned: extra,
    rate: plannedSet.size > 0 ? (plannedSet.size - never.length) / plannedSet.size : null,
  };
}

export function traceCommonLawCarry({ gridRaw = null, findingsText = "", outcomes = {}, planned = null,
  consumed = true, slice = "common-law" } = {}) {
  const grid = parseGridCandidates(gridRaw);
  if (!grid.ok) {
    return { schema_version: COMMONLAW_CARRY_SCHEMA_VERSION, computable: false, reason: grid.reason, slice };
  }
  const surfaces = parseFindingsSurfaces(findingsText);

  // ALL THREE labels. A split run logs `common-law-half:a` / `:b` and never `common-law`; a stage that
  // never appears in run.jsonl at all contributes nothing rather than a false `completed`.
  const seen = CL_STAGES.map((s) => outcomes?.[s]).filter(Boolean);
  const completed = seen.some((o) => o?.completed === true);
  const evidence = seen.map((o) => o?.evidence).filter(Boolean).join(" · ");

  const byReason = {}, bySource = {}, byReach = {}, byJoin = {};
  const rows = [];
  for (const cand of grid.candidates) {
    const c = classifyCandidate(cand, { surfaces, completed, evidence, consumed, slice });
    bump(byReach, c.reach);
    bump(byJoin, c.joined_on ?? "(none)");
    if (c.reason) bump(byReason, c.reason);
    if (c.reason_source) bump(bySource, c.reason_source);
    rows.push({ ...c, detail: clip(c.detail) });
  }
  // ── THE CELL ROLLUP — computed HERE because this is where `rows` is in scope ───────────────
  //
  // The ruled reconciliation has two rates. One — the share of retrieved candidates reconciled — falls
  // straight out of `totals` below. The other — the share of candidate-bearing CELLS carrying the
  // negative row the dictation owes them — does not, because this artefact exposes aggregates and never
  // the per-candidate rows. The measurement that found the defect (292 candidate-bearing cells, 39 with
  // a row) came from joining the raw artefacts by hand.
  //
  // So it is computed once, here, and recorded. Deriving it in the gate instead would be the same value
  // computed twice from two readings of the same rows — the defect class this round has now fixed three
  // times over (worstBand, the client-safety transforms, the lane switch).
  //
  // A cell is CARRYING ITS ROW when any candidate in it joined on `cell` with a stated ground — that is
  // exactly `reason_source: "step-stated"` with `joined_on: "cell"`, the pair classifyCandidate writes
  // when the findings' Negative-results matrix rules on the cell. A cell whose only rows are `absent` is
  // a cell nothing accounted for.
  const cellsSeen = new Set(), cellsRowed = new Set();
  for (const r of rows) {
    const k = cellKey(r.term, r.platform);
    if (!k || k === "|") continue;
    cellsSeen.add(k);
    if (r.joined_on === "cell" && r.reason_source === "step-stated") cellsRowed.add(k);
  }

  const unreasoned = rows.filter((r) => r.reason_source === "absent");
  const unjoinable = rows.filter((r) => r.reason === "findings:unjoinable-no-url");
  const upstreamAbsent = rows.filter((r) => /:stage-incomplete$/.test(String(r.reason ?? "")));
  const distinctUrlKeys = new Set(grid.candidates.map((c) => c.url_key).filter(Boolean)).size;

  return {
    schema_version: COMMONLAW_CARRY_SCHEMA_VERSION,
    computable: true,
    unit: "common-law-candidate",
    slice,
    consumed,
    join: {
      key: "canonical-url + cell(norm(term)|norm(platform))",
      why: "the house normalizer discards the query and merged two different products on the real fixture; neither key here touches the text normalizer that returns empty for Han script",
      distinct_url_keys: distinctUrlKeys,
    },
    // Same self-check as record-carry: a trace that cannot tell a healthy run from a dead one is not a
    // trace. The findings naming URLs is the independent evidence that candidates DID surface.
    degenerate: (byReach.finding ?? 0) === 0 && surfaces.urls.size > 0 && consumed && completed,
    findings_urls: surfaces.urls.size,
    stage_outcomes: Object.fromEntries(CL_STAGES.map((s) => [s, outcomes?.[s] ?? null])),
    stage_completed: completed,
    totals: {
      retrieved: rows.length,
      cells: grid.cells.length,
      gaps: grid.gaps.length,
      finding: byReach.finding ?? 0,
      dropped: rows.length - (byReach.finding ?? 0),
      unreasoned: unreasoned.length,
      unjoinable_candidates: unjoinable.length,
      upstream_absent: upstreamAbsent.length,
      // — the cell half of the reconciliation. Candidate-bearing cells, and those carrying the
      // negative row the dictation owes each of them.
      cells_with_candidates: cellsSeen.size,
      // — the ordered set beside the executed one, or an explicit unknown.
      channels: planVsExecutedChannels({ planned, cells: grid.cells, gaps: grid.gaps }),
      cells_with_reasoned_row: cellsRowed.size,
    },
    by_reach: byReach,
    by_reason: byReason,
    by_reason_source: bySource,
    by_joined_on: byJoin,
    // A cell that produced nothing, kept apart from a candidate that was dropped: "searched and found
    // nothing" and "never searched" are different facts and only one of them is about a candidate.
    gaps: grid.gaps,
    // THE DEFECT LIST, and the by-name list the ruling requires.
    unreasoned,
    unjoinable_candidates: unjoinable.map((r) => ({ cell: r.cell, term: r.term, platform: r.platform, title: r.title })),
    rows,
  };
}

// ── the run.jsonl row ─────────────────────────────────────────────────────────────────────────────
// AD-4 house rule: every field on EVERY row, so "nothing unreasoned" (0) and "the trace could not run"
// (null) differ by VALUE, never by field presence.
export const COMMONLAW_CARRY_EVENT_FIELDS = ["retrieved", "cells", "gaps", "finding", "dropped",
  "unreasoned", "unjoinable_candidates", "upstream_absent"];

export function commonLawCarryEvent({ trigger = null, artifact = null, reason = null, slice = "common-law" } = {}) {
  const computable = artifact?.computable === true;
  const vals = computable ? artifact.totals : {};
  const row = { event: "commonlaw-carry", trigger, slice: artifact?.slice ?? slice, computable, reason };
  row.consumed = computable ? artifact.consumed : null;
  row.degenerate = computable ? (artifact.degenerate === true) : null;
  row.stage_completed = computable ? artifact.stage_completed : null;
  for (const k of COMMONLAW_CARRY_EVENT_FIELDS) row[k] = vals[k] ?? null;
  return row;
}

// ── THE RECONCILIATION, AS TWO RATES WITH THEIR ARITHMETIC ATTACHED ───────────────────────
//
// 's measurement: of 2116 retrieved common-law candidates, 1609 carried no ground at all, and 253
// of 292 candidate-bearing cells lacked the negative row the dictation owes each of them. The
// discriminator was never in doubt — 272 rows carry `step-stated` against 1609 `absent`, so the
// instrument distinguishes. Nothing compared it to anything.
//
// RATES, NOT ABSOLUTES, because runs differ in size: a run that retrieves twice as much and reconciles
// the same share has not regressed. Ruled.
//
// EACH RATE SHIPS ITS NUMERATOR AND DENOMINATOR. A bare percentage is a number nobody can check, and a
// floor over an unarithmetic rate is a floor nobody can audit — which is how a ratchet quietly becomes
// decoration. `null` where a rate is undefined (nothing retrieved, no candidate-bearing cell): that is
// not 0, and 0 would read as total failure on a run that simply had nothing to reconcile.
export function reconciliationRates(artifact) {
  const t = artifact?.totals ?? {};
  const retrieved = Number(t.retrieved ?? 0);
  const unreasoned = Number(t.unreasoned ?? 0);
  const cells = Number(t.cells_with_candidates ?? 0);
  const rowed = Number(t.cells_with_reasoned_row ?? 0);
  const rate = (num, den) => (den > 0 ? num / den : null);
  return {
    computable: artifact?.computable === true,
    candidates: { reconciled: Math.max(0, retrieved - unreasoned), retrieved, rate: rate(retrieved - unreasoned, retrieved) },
    cells: { rowed, candidate_bearing: cells, rate: rate(rowed, cells) },
    // — THE THIRD RATE, and the only one whose denominator is what was ORDERED. The two above
    // divide the run by itself: a channel never searched contributes to neither side, so 3-of-8 swept
    // and fully reconciled scores identically to 8-of-8. This one can read below 1, and reads an explicit
    // `unknown` when no plan reached the trace — never a clean 1 by omission.
    //
    // DELIBERATELY NOT IN THE FLOOR BELOW. A coverage rate below 1 is a finding on day one and a
    // delivery gate only after a measured round: a profile legitimately lists platforms a given grid
    // skips, and a hard gate on arrival is the shape — a grammar killing paid work.
    channels: channelRate(t.channels),
  };
}

/** The channels block as a rate, or an honest unknown. PURE. */
function channelRate(ch) {
  if (!ch || typeof ch !== "object" || ch.state === "unknown") {
    return { state: "unknown", planned: null, searched: null, never_searched: null,
      why: ch?.why ?? "this trace carries no channels block — what was ORDERED is not recorded here", rate: null };
  }
  const planned = Array.isArray(ch.planned) ? ch.planned.length : 0;
  const never = Array.isArray(ch.never_searched) ? ch.never_searched.length : 0;
  return { state: ch.state, planned, searched: Math.max(0, planned - never), never_searched: never, why: null,
    rate: planned > 0 ? (planned - never) / planned : null };
}

/**
 * The ratchet. Compares a run's rates to the committed floor and says which way each moved.
 *
 * A TRIP IS AN ANNOTATION, NEVER A SUPPRESSION — house rule with a real incident behind it. The
 * deliverable ships first; a trip means the ROUND cannot claim the contract held, never that the client
 * gets nothing. So this returns a verdict; it throws nothing and withholds nothing.
 *
 * An UNCOMPUTABLE trace does not trip. A run whose grid never parsed has not regressed against a floor —
 * it has no measurement, and reporting "worse than floor" for a missing number is the absence-as-value
 * shape this round spent the day removing. It reports `state: "unmeasured"` with the reason.
 */
export function reconciliationVerdict(artifact, floor) {
  const r = reconciliationRates(artifact);
  if (!r.computable) return { state: "unmeasured", reason: artifact?.reason ?? "trace not computable", rates: r, floor: floor ?? null, trips: [] };
  if (!floor || typeof floor !== "object") return { state: "no-floor", reason: "no committed floor to compare against", rates: r, floor: null, trips: [] };
  const trips = [];
  for (const [k, label] of [["candidates", "share of retrieved candidates reconciled"], ["cells", "share of candidate-bearing cells carrying their negative row"]]) {
    const got = r[k].rate, min = Number(floor?.[k]?.min_rate ?? NaN);
    if (got == null || !Number.isFinite(min)) continue;     // nothing to compare is not a regression
    if (got < min) trips.push({ metric: k, label, got, floor: min, shortfall: min - got });
  }
  return { state: trips.length ? "below-floor" : "at-or-above-floor", reason: null, rates: r, floor, trips };
}

/** One doubt per unreasoned drop, bounded, reporting what it omitted. Frozen doubt-record shape. */
export function mintCommonLawCarryDoubts(artifact, { max = 25 } = {}) {
  const all = Array.isArray(artifact?.unreasoned) ? artifact.unreasoned : [];
  const take = all.slice(0, Math.max(0, max));
  const doubts = take.map((r, i) => ({
    id: `doubt:commonlaw-carry:unreasoned:${i + 1}`,
    birth: { place: "commonlaw-carry", artifact: "common-law-grid.json", quote: clip(`${r.term} | ${r.platform} — ${r.title || r.url}`) },
    subject: {
      mark: r.title, owner: "", uris: r.url ? [r.url] : [], terms: [r.term],
      text: `this common-law candidate was retrieved and reached "${r.reach}", then stopped at the ${r.stopped_at} seam with no step recording a ground: ${r.detail}`,
    },
    status: "open",
    ending: null,
  }));
  return { doubts, minted: doubts.length, omitted: Math.max(0, all.length - doubts.length) };
}

/** The one-line reader answer to "where did this candidate stop". Substring, never the token matcher. */
export function explainCandidates(artifact, needle) {
  const n = String(needle ?? "").trim();
  if (!n) return [];
  const lc = n.toLowerCase();
  return (Array.isArray(artifact?.rows) ? artifact.rows : [])
    .filter((r) => String(r.title).includes(n) || String(r.term).includes(n)
      || String(r.url).toLowerCase().includes(lc) || String(r.title).toLowerCase().includes(lc));
}
