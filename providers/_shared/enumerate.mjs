// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Enumerate — the COMPLETENESS primitive, as a provider-agnostic kernel ───────────────────────────
//
// Lifted from providers/corsearch/src/core.js (judgment-relocation Move 1). The CALLER chooses the query
// (breadth stays with judgment / the manifest — adapts to any mark); this primitive owns the page LOOP,
// so the caller loses ONLY the right to stop early. It returns EXACTLY ONE of two states — there is no
// "good enough" / "top-N" / "sampled and accepted":
//   { state: "enumerated", total_hits, count, records:[…each screened] }
//        — exhausted; every named record, with its screening facts attached, ready to cross the firewall
//          to judgment.
//   { state: "incomplete", total_hits, fetched, sample:[…], reason }
//        — genuinely could not exhaust: the band is a crowd (total over the resource ceiling), the
//          provider's reachable window was hit, or a provider error occurred mid-loop. This is a SIGNAL
//          TO JUDGMENT (command a narrower enumeration, or halt/escalate) — NEVER a silent truncation,
//          NEVER a self-accepted clean. (Guardrails 1 & 2: the same contract at every tier; a true limit
//          is a halt, not a ceiling.)
// The resource ceiling is a RESOURCE GUARD that yields `incomplete`, not a sufficiency decision: the caller
// never gets to say "searched enough." Env-tunable (CLEAROTRON_ENUMERATE_CEILING); the default sits above a named
// exact/near band (low hundreds) and below a saturation crowd.
// PERF: the default is 600, not 1500, because a band paged record-by-record times out. The page loop is SILENT
// (no model tokens during the tool call), so a band paged record-by-record is dead wall-time on the gather
// stage's hard timeout. A band OVER the ceiling returns `incomplete` at page 0 in ONE round-trip (no paging,
// no screening) — the instant descriptor judgment consumes. This is LOAD-BEARING WITH the funnel's
// nice_classes scoping (unit.md). Raise CLEAROTRON_ENUMERATE_CEILING only with a deliberate, reviewed reason.
//
// ══ THE TWO CAPABILITY SEAMS ═══════════════════════════════════════════════════════════════════════
//
// SEAM 1 — capabilities.countProbe: WHERE the enumerate ceiling is tested.
//   "cheap"    Corsearch. The page-0 search IS the count probe: it returns totalHitCount alongside the
//              first 100 rows, so the ceiling is tested FETCH-THEN-CHECK, one round trip, and those rows
//              are reused as the crowd `sample` and as page 0 of the accumulation. A pre-loop count call
//              here would DOUBLE the billable calls and change the descriptor payload — it must not exist.
//              The per-term rescue probe is a `limit:1 fields:["uri"]` search (which also rides the core's
//              per-run SEARCH_CACHE and meters cache_hit).
//   "endpoint" Clarivate. /search has no pagination and no partial mode: it returns the COMPLETE guid set
//              or fails loud with tooManyResults past 30000. So the ceiling MUST be tested BEFORE the
//              search, via the cheap POST /count (works at any magnitude, returns per-office counts). The
//              per-term rescue probe uses the same /count.
//   "none"     Signa. No total exists anywhere in the response, so the ceiling can only be a page-count
//              cutoff: accumulate, and if the accumulated set passes the ceiling return `incomplete` with
//              an honest reason that says the total is unknown. total_hits is reported null — NEVER 0, and
//              never a fabricated figure.
//
// SEAM 2 — capabilities.screenSource: whether screening an enumerated band costs extra calls.
//   "bulk-endpoint"        Corsearch brand-json, 100/call — a separate cheap hydration endpoint.
//   "billed-record-fetch"  Clarivate POST /text, 100/call — same shape and same 100 batch bound, but the
//                          call is BILLED and screening an enumerated band also fully hydrates it.
//   "search-row"           Signa — search rows already carry status/classes/owner, so screening is inline
//                          and costs zero extra calls.
// In every case screening is BEST-EFFORT: on a screen miss the records still cross with their search-row
// fields and judgment can deep-fetch. We never DROP a band because screening failed.

import {
  BATCH_SCREEN_CHUNK, chunk, classifyStatus, isAllClass, normalizeBrandRow, screenVerdict,
} from "./screen.mjs";
import { makeCountProbe, parseToolText, isToolError } from "./count.mjs";
import { guardCountCall, guardToolCall } from "./transport-guard.mjs";
import { clipProviderText } from "./provider-text.mjs";   // — keep the discriminator

// ── — HOW MUCH OF A PROVIDER ERROR SURVIVES INTO THE BAND BLOCK ───────────────────────────────
//
// Both were 140, and 140 is where the defect lived: the Clarivate Near/Adj refusal is 144 characters
// and its verdict — `are not allowed` — is the last two words. Cut at 140 it arrived as `are not all`,
// 's structural predicate could not match, and a refusal that recurs byte-identically forever was
// filed as weather and retried on every future run of that shape.
//
// Raised so the messages actually seen on these paths FIT rather than being reconstructed from a
// stump, and measured rather than guessed: the vendor refusal is 144, and this kernel's OWN
// non-answer-body error (the longest thing that reaches the page arm) is ~200 with the query echoed.
// 400 clears both with room, and `deferExhaustedProviderErrors` still bounds what lands in the ledger
// at 240 downstream — so this widens what the CLASSIFIER sees, not what the record carries.
//
// The clip is tail-preserving either way, so the discriminator survives even past this budget. The
// budget is what stops that mattering in the ordinary case.
const COUNT_PROBE_BUDGET = 400;
const PAGE_ERROR_BUDGET = 400;

export { BATCH_SCREEN_CHUNK, chunk, classifyStatus, isAllClass, normalizeBrandRow, screenVerdict };

export const ENUMERATE_CEILING_DEFAULT = 600;
export const ENUMERATE_PAGE_DEFAULT = 100;          // corsearch doSearch limit max
export const ENUMERATE_PAGE_GUARD_DEFAULT = 60;     // 60 × 100 = 6000 > the 5000 provider window — backstop, never the normal stop
// THE URI CEILING. The mechanical form-neighbourhood band for a long mark
// dictates ONE exact slice with hundreds of OR names (OPENCOUNTRY → 838); the single GET's query
// blew the provider's URI limit → HTTP 414 → the slice could never enumerate and the fan-in gate
// (rightly) failed the run — all three auto-recoveries retried the same oversized query. Wide `names`
// bands are CHUNKED here, the one choke point every caller shares. ~80 backtick-quoted names ≈ 2–4KB of
// encoded query — far under every URI cap. Env-tunable like the ceiling.
// Re-exported by each core: register-plan.mjs mirrors this bound at COMPILE time (PLAN_MAX_OR_WIDTH) and
// an agreement test pins the two together — the planner must never dictate an OR-stack the executor
// would have to chunk-rescue.
export const ENUMERATE_NAMES_CHUNK_DEFAULT = 80;

// ── Screen-row → flat band-record field lift (review findings 7/15) ────────────────────────────────
// The band contract is the corsearch-shaped FLAT row; the screen row uses the screening vocabulary
// (`owner`, `uri`). This maps the ONE genuine naming divergence and copies content ONLY into keys the
// search row left null/undefined — a provider whose rows already carry content is untouched (the
// screen row NEVER overwrites a search-row fact, so the two can't silently disagree).
export const SCREEN_TO_RECORD_FIELDS = Object.freeze({
  mark_text: "mark_text",
  classes: "classes",
  status: "status",
  owner: "owner_name",
  owner_country: "owner_country",
  application_date: "application_date",
  registration_date: "registration_date",
  expiry_date: "expiry_date",
  mark_feature: "mark_feature",
});

export function liftScreenFields(record, screenRow) {
  if (!screenRow || typeof screenRow !== "object" || !record || typeof record !== "object") return record;
  const out = { ...record };
  for (const [from, to] of Object.entries(SCREEN_TO_RECORD_FIELDS)) {
    if (out[to] == null && screenRow[from] != null) out[to] = screenRow[from];
  }
  return out;
}

// Defined in count.mjs (the kernel this one's SEAM-1 probe is now built from) and re-exported here so
// every existing importer — providers/clarivate/src/core.js — is unchanged.
export { parseToolText, isToolError };

const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/**
 * Is this band scoped to an OWNER — a bare-owner sweep or an owner×term slice?
 *
 * ONE definition, exported, because two consumers now key on it: the kernel (which reaches for the
 * per-CLASS rescue on this shape and no other) and a provider's `ceilingFor` ( — signa's result
 * window is narrower for exactly this shape). Two hand-written copies of a predicate that must agree
 * is the shape that fails silently: they drift, the rescue fires where the window does not, and the
 * band comes back a crowd or a transport error with nothing to say which.
 */
export const isOwnerScoped = (params) => Boolean(
  (typeof params?.owner === "string" && params.owner.trim())
  || (Array.isArray(params?.owners) && params.owners.filter(Boolean).length));

/**
 * Build the enumerate primitive for one provider.
 *
 * @param deps.search   (auth, params, tctx) => toolResult  — the provider's paged search.
 * @param deps.count    (auth, params, tctx) => { ok:boolean, total:number|null, reason?:string }
 *                      — REQUIRED when capabilities.countProbe === "endpoint"; unused otherwise.
 * @param deps.screen   (auth, { uris, in_scope_classes }, tctx) => toolResult carrying `rows[]`
 *                      — used for "bulk-endpoint" and "billed-record-fetch".
 * @param deps.rowScreen (row, inScopeClasses) => object — used for "search-row".
 * @param deps.hasAnyElement (params) => boolean
 */
export function makeEnumerate(deps) {
  const {
    search: rawSearch,
    count: rawCount = null,
    screen: rawScreen = null,
    rowScreen = null,
    hasAnyElement = () => true,
    missingElementError = "ERROR: at least one search element is required.",
    capabilities = {},
    // shape adapters (defaults are the corsearch shapes)
    namesKey = "names",
    // (page, pageSize, prevParsed) — the third argument is the previous page's parsed response,
    // for providers that paginate by cursor rather than by index. Ignored by the default.
    pageParams = (page, pageSize) => ({ limit: pageSize, page }),
    cheapCountParams = { limit: 1, fields: ["uri"] },
    recordIdOf = (rec) => rec?.record_id,
    recordKeyOf = (rec) => rec?.record_id ?? rec?.uri ?? JSON.stringify(rec).slice(0, 120),
    screenJoinKey = (row) => row?.uri,
    // ── A RESULT WINDOW THAT IS A PROPERTY OF THE QUERY, NOT OF THE PROVIDER ────────────────
    //
    // `ceilingDefault` models a provider with ONE result window. Signa's depends on the query SHAPE:
    // Same term and limit, an `exact` band pages to 685 and a `contains` band to
    // 2047 — but add `filters.owner_name` and the fourth page 400s with "This cursor points beyond the
    // 400 result pagination window."
    //
    // The band was safe (it returned `incomplete`) and it was still wrong twice over: judgment got a
    // TRANSPORT error where it needed "this owner holds more filings than this provider will page — the
    // band is a crowd", and the count-first per-CLASS rescue — which exists for precisely this
    // portfolio-shaped crowd — was never reached, because the band died mid-page before the ceiling
    // test that calls it.
    //
    // `(params) => number|null`. `null` means the shape imposes nothing and `ceilingDefault` stands.
    // A declared window is a HARD vendor limit rather than a preference, so it is applied as a MINIMUM
    // against the tuned ceiling below and can only ever narrow it — `CLEAROTRON_ENUMERATE_CEILING` cannot
    // raise a band past a window the vendor answers with an HTTP 400.
    ceilingFor = null,
  } = deps;

  // ── the I/O seam: a network REJECTION degrades like a 503, it does not abort the stage ────────────
  // Rebound HERE, before anything closes over them, so every internal call site inherits the guard —
  // the page loop, the "endpoint" pre-loop count, the screening call, the count-first per-term and
  // per-class rescues, and the recursive names-chunking. See ./transport-guard.mjs for why the wrapper
  // goes around the DEPENDENCY and never around a kernel body.
  const search = guardToolCall(rawSearch, "search");
  const count = guardCountCall(rawCount, "count");
  const screen = guardToolCall(rawScreen, "record-screen");

  const {
    countProbe = "cheap",
    screenSource = "bulk-endpoint",
    pageSize = ENUMERATE_PAGE_DEFAULT,
    pageGuard = ENUMERATE_PAGE_GUARD_DEFAULT,
    ceilingDefault = ENUMERATE_CEILING_DEFAULT,
    namesChunkDefault = ENUMERATE_NAMES_CHUNK_DEFAULT,
    providerWindow = "5000-record cap",
    // The provider's SEARCH ROW carries no content (clarivate /search returns bare guids) so the screen
    // call is the only source of mark_text/classes/status/owner/dates. Flips two kernel behaviours:
    // a screen failure becomes a content-loss `incomplete` instead of a best-effort degrade, and a
    // partial screen (some chunks errored) is likewise incomplete. Default false = the corsearch/signa
    // assumption, byte-identical.
    contentFromScreen = false,
    // — the provider's own signature for "this query would match too much", when it arrives as an
    // error on the count probe rather than as a countable total. Optional: a provider that does not
    // declare one keeps the previous behaviour exactly.
    cardinalityRefusal = null,
  } = capabilities;

  if (countProbe === "endpoint" && typeof count !== "function") {
    throw new Error('[enumerate-kernel] capabilities.countProbe === "endpoint" requires a count() dependency');
  }
  if (screenSource === "search-row" && typeof rowScreen !== "function") {
    throw new Error('[enumerate-kernel] capabilities.screenSource === "search-row" requires a rowScreen() dependency');
  }

  const crowdReason = (total, ceiling) =>
    `total_hits ${total} exceeds the enumerate ceiling ${ceiling} — this is a CROWD, not a named exact/near band. Record it as a count+sample descriptor and hand it up to judgment; the funnel does NOT narrow-and-retry a crowd here. Whether a narrower NAMED enumeration is warranted, and whether this slice is material, is judgment's call (Layer B) — never accept it as clean.`;

  // ── count-first per-term rescue ───────────────────────────────────────────────────────────────────
  // A multi-name OR-stack that crowds over the ceiling used to return ONE blind `incomplete` — a rare
  // term bundled with a saturated one (FROSTBERRY + ICEBERRY) vanished inside the pile and was read as
  // 0/clean. The rescue restores per-term truth at the one choke point every caller shares: count each
  // term with the cheapest probe available to the provider (SEAM 1), then individually enumerate every
  // term that is populated AND tractable (0 < n ≤ ceiling), cheapest first under a merged-records budget
  // of one ceiling. INVARIANT: a populated term can never be recorded 0 — it is in `term_counts`, and if
  // tractable its records are carried. Dispositions:
  //   verified-zero — the probe returned 0 (deterministic true-0, tool-derived)
  //   enumerated    — individually paged to exhaustion; records merged into the block
  //   crowd         — the term is ITSELF over the ceiling (dilution for judgment, never enumerated here)
  //   unenumerated  — populated + tractable but the records budget was exhausted first (still a gap:
  //                   full accounting is only verified-zero|enumerated|crowd — a clean cannot sit on it)
  //   error         — the probe/enumeration failed; honest unknown, never a zero
  // Lazy by design: on "cheap" the page-0 total IS the free whole-stack count, so the clean case costs
  // zero extra calls; the probes only run when the stack crowds. It had a kill switch; nothing set it,
  // so it is gone rather than carried as an untested path.
  //
  // The probe itself is the SHARED count kernel (count.mjs) — the same code Stage 0.5 calls when it
  // asks a register "how many", so the two can never drift. `null` on any failure is preserved
  // exactly: a term whose probe failed is dispositioned `error`, never `verified-zero`.
  const countHits = makeCountProbe({ search, count, capabilities: { countProbe }, cheapCountParams });
  const probeTermCount = async (auth, params, term, tctx) => {
    const c = await countHits(auth, { ...params, [namesKey]: [term] }, tctx);
    return c.ok ? c.total : null;
  };

  async function countFirstRescue(auth, params, names, ceiling, stackTotal, tctx, incomplete) {
    const term_counts = {};
    const tractable = [];
    for (const t of names) {
      const n = await probeTermCount(auth, params, t, tctx);
      if (n == null) { term_counts[t] = { total_hits: null, disposition: "error" }; continue; }
      if (n === 0) term_counts[t] = { total_hits: 0, disposition: "verified-zero" };
      else if (n > ceiling) term_counts[t] = { total_hits: n, disposition: "crowd" };
      else tractable.push({ t, n });
    }
    tractable.sort((a, b) => a.n - b.n); // cheapest first — maximizes fully-enumerated terms under the budget
    const merged = new Map();
    for (const { t, n } of tractable) {
      if (merged.size + n > ceiling) { term_counts[t] = { total_hits: n, disposition: "unenumerated" }; continue; }
      const r = await enumerate(auth, { ...params, [namesKey]: [t] }, tctx);
      const parsed = isToolError(r) ? null : parseToolText(r);
      if (!parsed) { term_counts[t] = { total_hits: n, disposition: "error" }; continue; }
      if (parsed.state === "enumerated") {
        term_counts[t] = { total_hits: n, disposition: "enumerated" };
        for (const rec of (parsed.records ?? [])) {
          const k = recordKeyOf(rec);
          if (!merged.has(k)) merged.set(k, rec);
        }
      } else {
        // drifted past the probe count (provider re-count) or hit the provider window — honest per-term state
        const m = parsed.total_hits ?? n;
        term_counts[t] = { total_hits: m, disposition: m > ceiling ? "crowd" : "error" };
      }
    }
    const records = [...merged.values()];
    const tally = { "verified-zero": 0, enumerated: 0, crowd: 0, unenumerated: 0, error: 0 };
    for (const v of Object.values(term_counts)) tally[v.disposition] += 1;
    const unresolved = tally.crowd + tally.unenumerated + tally.error;
    if (unresolved === 0 && records.length > 0) {
      // every term resolved to verified-zero or fully-enumerated ⇒ the union of per-term enumerations IS
      // the complete stack (every record matching ≥1 name sits in some term's enumeration) — a true band.
      return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: stackTotal, count: records.length, records, term_counts }, null, 2) };
    }
    return incomplete(stackTotal, records.length, records,
      `stack total_hits ${stackTotal} exceeds the enumerate ceiling ${ceiling}; count-first per-term rescue ran (${names.length} terms: ${tally["verified-zero"]} verified-zero, ${tally.enumerated} enumerated with records carried, ${tally.crowd} crowd, ${tally.unenumerated} unenumerated on budget, ${tally.error} error). Saturated terms stay a CROWD descriptor for judgment; term_counts is the per-term truth — a populated term is never recorded 0.`,
      { term_counts, records });
  }

  // ── count-first per-CLASS rescue ──────────────────────────────────────────────────────────────────
  // The per-term rescue's exact sibling, on the OTHER axis a stack can crowd along. A multi-class
  // owner query [cl 5,29,30,32,33,35,43] came back 805 > 600 and shipped as one blind count — "Cl. 30
  // leg unopened" became the whole of the residual risk story — when per-class counts would have made
  // EVERY leg individually enumerable. So: an OWNER-SCOPED query (a bare-owner sweep or an owner×term
  // slice — the only shapes whose crowds are portfolio-shaped rather than name-shaped) that crowds over
  // the ceiling across >1 class is counted per class with the SAME shared count kernel, and every
  // populated tractable class leg (0 < n ≤ ceiling) is individually enumerated, cheapest first, under a
  // merged-records budget of one ceiling. Same invariant, same disposition vocabulary as term_counts:
  // a populated class can never be recorded 0 — it is in `class_counts`, and if tractable its records
  // are carried. NOTE a record filed in several classes sits in each leg's enumeration; the merge
  // dedupes it, so per-class totals may legitimately sum past the stack total.
  async function classSplitRescue(auth, params, classes, ceiling, stackTotal, tctx, incomplete) {
    const class_counts = {};
    const tractable = [];
    for (const c of classes) {
      const probe = await countHits(auth, { ...params, nice_classes: [c] }, tctx);
      const n = probe.ok ? probe.total : null;
      if (n == null) { class_counts[c] = { total_hits: null, disposition: "error" }; continue; }
      if (n === 0) class_counts[c] = { total_hits: 0, disposition: "verified-zero" };
      else if (n > ceiling) class_counts[c] = { total_hits: n, disposition: "crowd" };
      else tractable.push({ c, n });
    }
    tractable.sort((a, b) => a.n - b.n); // cheapest first — maximizes fully-enumerated legs under the budget
    const merged = new Map();
    for (const { c, n } of tractable) {
      if (merged.size + n > ceiling) { class_counts[c] = { total_hits: n, disposition: "unenumerated" }; continue; }
      const r = await enumerate(auth, { ...params, nice_classes: [c] }, tctx);
      const parsed = isToolError(r) ? null : parseToolText(r);
      if (!parsed) { class_counts[c] = { total_hits: n, disposition: "error" }; continue; }
      if (parsed.state === "enumerated") {
        class_counts[c] = { total_hits: n, disposition: "enumerated" };
        for (const rec of (parsed.records ?? [])) {
          const k = recordKeyOf(rec);
          if (!merged.has(k)) merged.set(k, rec);
        }
      } else {
        // drifted past the probe count (provider re-count) or hit the provider window — honest per-leg state
        const m = parsed.total_hits ?? n;
        class_counts[c] = { total_hits: m, disposition: m > ceiling ? "crowd" : "error" };
      }
    }
    const records = [...merged.values()];
    const tally = { "verified-zero": 0, enumerated: 0, crowd: 0, unenumerated: 0, error: 0 };
    for (const v of Object.values(class_counts)) tally[v.disposition] += 1;
    const unresolved = tally.crowd + tally.unenumerated + tally.error;
    if (unresolved === 0 && records.length > 0) {
      // every class resolved to verified-zero or fully-enumerated ⇒ the union of per-class enumerations
      // IS the complete stack (every record carries ≥1 in-filter class) — a true band, the class rescue.
      return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: stackTotal, count: records.length, records, class_counts }, null, 2) };
    }
    return incomplete(stackTotal, records.length, records,
      `owner-scoped total_hits ${stackTotal} exceeds the enumerate ceiling ${ceiling}; count-first per-CLASS rescue ran (${classes.length} classes: ${tally["verified-zero"]} verified-zero, ${tally.enumerated} enumerated with records carried, ${tally.crowd} crowd, ${tally.unenumerated} unenumerated on budget, ${tally.error} error). Saturated class legs stay a CROWD descriptor for judgment; class_counts is the per-class truth — a populated class leg is never recorded 0 and never "unopened".`,
      { class_counts, records });
  }

  async function enumerate(auth, params, tctx) {
    if (!hasAnyElement(params)) return { type: "text", text: missingElementError };

    // The tuned ceiling, then narrowed by any window the QUERY SHAPE imposes. Min, never max:
    // a shape window is a vendor limit, and a band that pages past it does not return more records, it
    // returns an HTTP 400. With no `ceilingFor` — every provider but signa — this is the old line.
    const tunedCeiling = envInt("CLEAROTRON_ENUMERATE_CEILING", ceilingDefault);
    const shapeCeiling = typeof ceilingFor === "function" ? ceilingFor(params) : null;
    const ceiling = Number.isFinite(shapeCeiling) && shapeCeiling > 0
      ? Math.min(tunedCeiling, shapeCeiling) : tunedCeiling;
    const inScopeClasses = Array.isArray(params?.in_scope_classes)
      ? params.in_scope_classes.map(Number).filter(Number.isFinite) : [];
    const incomplete = (total, fetched, sample, reason, extras) =>
      ({ type: "text", text: JSON.stringify({ state: "incomplete", total_hits: total, fetched, sample: (sample ?? []).slice(0, 20), reason, ...(extras ?? {}) }, null, 2) });
    // A provider with no total anywhere cannot run a count-first rescue — there is nothing to count.
    const countFirst = countProbe !== "none";
    // The per-class rescue's trigger shape: an owner-scoped query (bare-owner sweep or owner×term
    // slice) spanning >1 class — the portfolio-shaped crowd the 805 count died as. The per-term rescue
    // keeps precedence on multi-name stacks (its accounting is the finer truth there).
    const ownerScoped = isOwnerScoped(params);
    const splitClasses = ownerScoped
      ? [...new Set((Array.isArray(params?.nice_classes) ? params.nice_classes : [])
          .map((c) => Number(c)).filter(Number.isFinite))]
      : [];

    // ── wide `names` bands run CHUNKED (HTTP-414 guard; see ENUMERATE_NAMES_CHUNK_DEFAULT) ─────────────
    // Each chunk runs the FULL enumerate contract below (paged to exhaustion, screened); records merge
    // with record-id dedupe; total_hits SUM (a record matching names in two chunks may double-count the
    // descriptor total — `count` is the deduped truth); the resource ceiling applies to the RUNNING total
    // so a crowd still returns an incomplete descriptor. ANY chunk error/incomplete makes the WHOLE slice
    // incomplete — a clean can never ship over a partially-executed slice.
    const namesChunk = envInt("CLEAROTRON_ENUMERATE_NAMES_CHUNK", namesChunkDefault);
    const allNames = Array.isArray(params[namesKey]) ? params[namesKey].filter(Boolean) : null;
    if (allNames && allNames.length > namesChunk) {
      const merged = new Map();
      const termCounts = {};            // count-first accounting aggregated across windows
      const rescueNotes = [];           // per-window rescue summaries for the final descriptor
      const enumeratedWindowTerms = []; // terms whose whole window enumerated cleanly (per-term truth by superset)
      let totalSum = 0;
      const chunks = Math.ceil(allNames.length / namesChunk);
      const mergeRecs = (recs) => {
        for (const rec of (recs ?? [])) {
          const k = recordKeyOf(rec);
          if (!merged.has(k)) merged.set(k, rec);
        }
      };
      for (let i = 0; i < chunks; i += 1) {
        const part = allNames.slice(i * namesChunk, (i + 1) * namesChunk);
        const r = await enumerate(auth, { ...params, [namesKey]: part }, tctx);
        const parsed = parseToolText(r);
        if (isToolError(r) || !parsed) {
          return incomplete(totalSum, merged.size, [...merged.values()],
            `chunk ${i + 1}/${chunks} (${part.length} names) failed: ${String(r?.text ?? "unparseable").slice(0, 140)}`,
            Object.keys(termCounts).length ? { term_counts: termCounts, records: [...merged.values()] } : undefined);
        }
        if (parsed.state !== "enumerated") {
          // A rescued window (term_counts attached) carries its per-term truth — aggregate and CONTINUE so
          // the remaining windows still get their accounting; the slice stays incomplete either way, but a
          // partial abort here would leave later windows' terms unaccounted and the clean-gate blind.
          if (countFirst && parsed.term_counts && typeof parsed.term_counts === "object") {
            Object.assign(termCounts, parsed.term_counts);
            totalSum += parsed.total_hits ?? 0;
            mergeRecs(parsed.records);
            rescueNotes.push(`chunk ${i + 1}/${chunks}: ${String(parsed.reason ?? "").slice(0, 140)}`);
            continue;
          }
          return incomplete(totalSum + (parsed.total_hits ?? 0), merged.size + (parsed.fetched ?? 0),
            [...merged.values(), ...(parsed.sample ?? [])],
            `chunk ${i + 1}/${chunks} (${part.length} names) ${parsed.state}: ${String(parsed.reason ?? "").slice(0, 180)}`);
        }
        totalSum += parsed.total_hits ?? 0;
        mergeRecs(parsed.records);
        if (parsed.term_counts && typeof parsed.term_counts === "object") Object.assign(termCounts, parsed.term_counts);
        enumeratedWindowTerms.push(...part);
        if (totalSum > ceiling && !rescueNotes.length) {
          return incomplete(totalSum, merged.size, [...merged.values()],
            `cumulative total_hits ${totalSum} exceeds the enumerate ceiling ${ceiling} across ${i + 1}/${chunks} name chunks — a CROWD, not a named exact/near band; record it as a count+sample descriptor and hand it up to judgment, never a self-accepted clean.`,
            Object.keys(termCounts).length ? { term_counts: termCounts, records: [...merged.values()] } : undefined);
        }
      }
      if (rescueNotes.length) {
        // a term inside a cleanly-enumerated window has per-term truth by superset (every record matching
        // it was carried) — stamp it `enumerated` so the slice's accounting covers ALL terms, not only the
        // rescued windows' (the clean-gate discriminates on full accounting).
        for (const t of enumeratedWindowTerms) {
          if (!(t in termCounts)) termCounts[t] = { total_hits: null, disposition: "enumerated" };
        }
        return incomplete(totalSum, merged.size, [...merged.values()],
          `count-first per-term rescue ran in ${rescueNotes.length}/${chunks} name chunks — saturated terms stay CROWD descriptors for judgment; term_counts is the per-term truth (a populated term is never recorded 0). ${rescueNotes.join(" · ")}`.slice(0, 900),
          { term_counts: termCounts, records: [...merged.values()] });
      }
      return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: totalSum, count: merged.size, records: [...merged.values()], ...(Object.keys(termCounts).length ? { term_counts: termCounts } : {}) }, null, 2) };
    }

    const results = [];
    let total = countProbe === "none" ? null : 0;
    let probeTotal = null;                 // SEAM 1 "endpoint": the /count answer, kept for reconciliation
    let capWarning = null;

    // ── SEAM 1, "endpoint": COUNT FIRST, test the ceiling, and only then search ──────────────────────
    // The provider's search has no partial mode — it returns the whole set or fails loud — so the
    // ceiling cannot be tested fetch-then-check. The crowd descriptor here carries an EMPTY sample by
    // construction (no rows were fetched); it is still a crowd descriptor for judgment, never a clean.
    if (countProbe === "endpoint") {
      const c = await count(auth, params, tctx);
      if (!c || c.ok !== true) {
        // ── — A DECLARED CARDINALITY REFUSAL IS A CROWD, NOT AN ERROR ───────────────────────────
        //
        // The provider is not failing; it is telling us the query would match too much. That is the same
        // condition `resultCeiling` describes, and the engine already has the right answer for it: a
        // count+sample descriptor handed to judgment. Routed here rather than into the provider-error
        // arm, where it became an unanswered coverage hole AND consumed the repair ladder retrying a
        // query that can never succeed.
        //
        // THE HONEST DIFFERENCE FROM THE OTHER CROWD, and it is why this reason says so in words: a
        // `resultCeiling` crowd KNOWS its total. This one does not — the count never came back. So
        // `total_hits` is null rather than 0, and `crowd_basis` names why. A zero here would be the one
        // output this system must never produce.
        //
        // Depends: until the refusal stopped being truncated three characters before
        // `allowed`, no predicate keyed on the vendor's wording could fire at all.
        if (cardinalityRefusal && cardinalityRefusal.test(String(c?.reason ?? ""))) {
          return incomplete(null, 0, [],
            "the provider REFUSED to count this slice because it would match too much — a structural "
            + "cardinality limit on the query shape, not an outage and not a transient. It will refuse "
            + "the same shape identically on every future run, so retrying cannot change it. This is a "
            + "CROWD: record it as a count+sample descriptor and hand it up to judgment (Layer B), never "
            + "accept it as clean. The total is UNKNOWN rather than zero — the count never returned. "
            + `Provider's own words: ${clipProviderText(c?.reason ?? "", COUNT_PROBE_BUDGET)}`,
            { crowd_basis: "provider-refused-count", count_unavailable: true });
        }
        return incomplete(0, 0, [],
          `provider error on the count probe before enumeration: ${clipProviderText(c?.reason ?? "count unavailable", COUNT_PROBE_BUDGET)}`);
      }
      total = Number.isFinite(c.total) ? c.total : 0;
      probeTotal = total;
      if (total > ceiling) {
        if (countFirst && allNames && allNames.length > 1) {
          return countFirstRescue(auth, params, allNames, ceiling, total, tctx, incomplete);
        }
        if (countFirst && splitClasses.length > 1) {
          return classSplitRescue(auth, params, splitClasses, ceiling, total, tctx, incomplete);
        }
        return incomplete(total, 0, [], crowdReason(total, ceiling));
      }
    }

    // `prevParsed` is the seam CURSOR pagination needs. The loop was page-indexed, which serves
    // every provider that takes `limit`+`page` — and cannot express a provider whose next request is
    // built from the LAST RESPONSE. Signa returns `pagination.cursor` with `has_more`, so without this
    // its second page is unreachable and an enumerate could only ever return page 0, which reads as a
    // complete band. Passed as a third argument, so every existing pageParams ignores it unchanged.
    let prevParsed = null;
    for (let page = 0; ; page += 1) {
      const r = await search(auth, { ...params, ...pageParams(page, pageSize, prevParsed) }, tctx);
      if (isToolError(r)) return incomplete(total, results.length, results, `provider error during enumeration (page ${page}): ${clipProviderText(r.text, PAGE_ERROR_BUDGET)}`);
      const parsed = parseToolText(r);
      if (!parsed) return incomplete(total, results.length, results, `unparseable search response during enumeration (page ${page})`);
      // ── the number the completeness claim rests on must BE a number ────────────────────────────────
      // On the "cheap" seam the page response IS the count — the ceiling is tested off `total_hits` and
      // nothing else. A response that parsed but carries no usable total therefore cannot support a
      // completeness claim in either direction: not a crowd, and above all not a clean. This is the
      // same lock the adapter holds (each core refuses an unparsed body before it reaches here) placed
      // where the "enumerated" verdict is actually minted, so it cannot depend on every future adapter
      // remembering. total_hits rides out NULL — unknown — never a fabricated 0.
      if (countProbe === "cheap" && !Number.isFinite(parsed.total_hits)) {
        return incomplete(null, results.length, results,
          `provider error during enumeration (page ${page}): the search response carried no usable total_hits, and on this provider the response IS the count — so the enumerate ceiling could not be tested and this band cannot be read as either a completed enumeration or a sanctioned crowd. The total is UNKNOWN (null, never 0).`);
      }
      // ── count/search reconciliation (review finding 3) ────────────────────────────────────────────
      // On the "endpoint" seam the /count answer and the /search rows come from TWO calls, so they can
      // disagree. The old line let the search's row count overwrite the probe total unconditionally —
      // so a /search that returned HTTP 200 with no usable ids{} produced {state:"enumerated",
      // total_hits:0, count:0}: a CLEAN NEGATIVE over a band the provider had just said was populated,
      // with the only evidence (the probe total) erased. Keep the probe total as the FLOOR and let the
      // post-loop check below adjudicate the divergence. On "cheap" the total and the rows come from
      // ONE response and cannot diverge — behaviour there is unchanged.
      if (countProbe === "endpoint") total = Math.max(probeTotal ?? 0, parsed.total_hits ?? 0);
      else if (countProbe !== "none") total = parsed.total_hits ?? total;
      capWarning = parsed.cap_warning ?? capWarning;
      // ── SEAM 1, "cheap": the page-0 fetch IS the count probe — resource ceiling tested fetch-then-check.
      // A crowd, not a named band: hand the descriptor up, never accept (Guardrail 1/2). ONE round trip.
      if (countProbe === "cheap" && page === 0 && total > ceiling) {
        // multi-name stack: rescue per-term truth before writing a blind crowd descriptor — a rare term
        // must never vanish inside a saturated OR-stack (see countFirstRescue). Single-name crowds keep
        // the instant one-round-trip descriptor unchanged.
        if (countFirst && allNames && allNames.length > 1) {
          return countFirstRescue(auth, params, allNames, ceiling, total, tctx, incomplete);
        }
        if (countFirst && splitClasses.length > 1) {
          return classSplitRescue(auth, params, splitClasses, ceiling, total, tctx, incomplete);
        }
        return incomplete(total, parsed.results?.length ?? 0, parsed.results, crowdReason(total, ceiling));
      }
      for (const row of (parsed.results ?? [])) results.push(row);
      // ── SEAM 1, "none": no total exists anywhere, so the ceiling can only be a page-count cutoff.
      // Report total_hits as null (unknown) — never 0, never a fabricated figure.
      if (countProbe === "none" && results.length > ceiling) {
        return incomplete(null, results.length, results,
          `${results.length} records fetched, past the enumerate ceiling ${ceiling}, and this provider exposes NO total anywhere in its response — so the size of the remainder is UNKNOWN (total_hits null, never 0). Treat this as a CROWD descriptor for judgment: narrow the named band and re-enumerate, or record the dilution. It is not a clean negative and not a completed enumeration.`);
      }
      prevParsed = parsed;
      if (!parsed.has_more) break;
      if (page + 1 >= pageGuard) {
        return incomplete(total, results.length, results,
          `pagination guard hit (${pageGuard} pages) before has_more:false — the provider's reachable window (${capWarning ?? providerWindow}) is exhausted; the remainder is unreachable by paging. This is an incomplete crowd descriptor — hand it up to judgment (Layer B decides whether a narrower NAMED enumeration is warranted); the funnel does not self-narrow-and-retry.`);
      }
    }

    // ── count/search reconciliation, part 2 (review finding 3) ────────────────────────────────────
    // The probe said N; the search handed back fewer rows than N. Something did not land — a partial
    // ids{} (count covers CH+US, search returns only the CH guids), an unparsed body, a silently
    // dropped office. That is NOT a crowd (the crowd path already returned above, over the ceiling)
    // and it is certainly not a clean: it is the provider contradicting itself on the one number the
    // completeness contract rests on. The reason is deliberately "provider error"-framed so
    // execute-plan stamps the block error:true → the slice joins MISSING → the repair/deferral ladder,
    // NEVER an executed clean or a sanctioned crowd descriptor.
    if (countProbe === "endpoint" && Number.isFinite(probeTotal) && results.length < probeTotal) {
      return incomplete(probeTotal, results.length, results,
        `provider error — count/search divergence: the count probe reported ${probeTotal} record(s) but the search returned ${results.length}. `
        + `The enumeration did NOT land completely and the shortfall is unaccounted, so this slice cannot be read as either a completed band or a sanctioned crowd.`);
    }
    // The SAME contradiction on the "cheap" seam (audit item 5b). The comment above says one response's
    // total and rows "cannot diverge" — a real provider body proved otherwise: {totalHitCount:3, rows:[]}
    // (counted-but-rowless) parsed cleanly, sat under the ceiling, and the endpoint-only check let it
    // mint state:"enumerated" with 0 records — a confident clean over a band the provider had just said
    // was populated. Under the ceiling every counted row is owed: a body that counts N and hands back
    // fewer is the provider contradicting itself on the one number the completeness contract rests on.
    // "provider error"-framed for the same reason as above: execute-plan stamps error:true → the slice
    // joins MISSING → the repair/deferral ladder, never an executed clean.
    if (countProbe === "cheap" && Number.isFinite(total) && results.length < total) {
      return incomplete(total, results.length, results,
        `provider error — count/search divergence: the response counted ${total} record(s) but carried ${results.length} row(s) with no further pages. `
        + `A counted-but-rowless (or short) enumeration did NOT land completely, so this slice cannot be read as either a completed band or a sanctioned crowd.`);
    }

    // ── SEAM 2 — ENUMERATED: attach screening facts so the complete band crosses the firewall screened.
    let records = results;
    let screenLift = null;      // — what the lift did, so a skip is never silent
    if (screenSource === "search-row") {
      // rows already carry status/classes/owner — screen inline, zero extra calls.
      records = results.map((x) => ({ ...x, screen: rowScreen(x, inScopeClasses) }));
    } else if (typeof screen === "function") {
      // "bulk-endpoint" (a cheap hydration endpoint) and "billed-record-fetch" (the billed record call,
      // which also HYDRATES the band) share one shape: N/chunk, joined back by record id.
      const uris = results.map(recordIdOf).filter(Boolean);
      if (uris.length) {
        const s = await screen(auth, { uris, in_scope_classes: inScopeClasses }, tctx);
        const sj = isToolError(s) ? null : parseToolText(s);
        // ──: WHY THE LIFT DID NOT HAPPEN IS A FACT ABOUT THE BAND ─────────────────────────────
        //
        // Two ways the lift silently does nothing, and neither used to leave a trace:
        //
        //   1. The response carries no `rows` array — the provider answered under a name this kernel
        //      does not read. The `if` below is simply false and the band ships unlifted.
        //   2. `rows` are present but the JOIN KEY does not line up. `byUri` is keyed on
        //      screenJoinKey(row); if that yields undefined for every row the map collapses to one
        //      entry keyed `undefined`, and `byUri.get(<a real id>)` misses for every single record.
        //
        // The second is the one the old code could not see at all. The contentFromScreen gate below
        // inspects whether the CALL succeeded — never whether the join did — so on clarivate, whose
        // search rows are bare guids by design, a key mismatch produced a full band of nameless ids
        // stamped `enumerated`. That is the same false clean this seam exists to prevent, reached by a
        // different road.
        if (sj && !Array.isArray(sj.rows)) {
          screenLift = { attempted: true, applied: false, matched: 0, rows: 0,
            reason: "the batch-screen response carried no `rows` array — the provider answered under a name this kernel does not read" };
        }
        if (sj && Array.isArray(sj.rows)) {
          const byUri = new Map(sj.rows.map((row) => [screenJoinKey(row), row]));
          let matched = 0;
          records = results.map((x) => {
            const row = byUri.get(recordIdOf(x)) ?? null;
            if (row) matched += 1;
            // ── LIFT the screen row's content onto the FLAT record (review findings 7/15) ───────────
            // The band contract every downstream consumer reads is the corsearch-shaped FLAT row
            // (record_id/mark_text/classes/status/owner_name/dates). On a guid-only provider those keys
            // are null by construction and the real values sit under `screen` — so named-band.mjs hands
            // judgment a list of anonymous ids stamped "enumerated", form-neighbourhood.mjs harvests no
            // names, and the supplemental preview shows all-null. Fill ONLY keys the search row left
            // null/undefined, so a provider whose rows already carry content (corsearch, signa) is
            // byte-identical. `screen` is still attached verbatim — nothing is replaced or hidden.
            return { ...liftScreenFields(x, row), screen: row };
          });
          // A SHORT join is legitimate and always was — a record-content endpoint may answer for fewer
          // ids than it was asked about (a guid that is not a trademark record yields no content, and
          // that is a provider fact). A ZERO join against a NON-EMPTY row list is not: the provider
          // answered about something, and none of it was about these records.
          screenLift = { attempted: true, applied: matched > 0, matched, rows: sj.rows.length,
            reason: matched > 0 ? null
              : `the batch-screen returned ${sj.rows.length} row(s) and none joined to a record — the join key did not line up` };
        }
        if (contentFromScreen) {
          // The screen call is the SOLE content source here, so a screen miss is not "best-effort
          // degraded" — it is a band of nameless ids with no signal that its content was lost. That can
          // never ship as state:"enumerated" (review findings 8/9). Both total and partial failures
          // count: an errored 100-id chunk means those 100 records have no mark text at all.
          // What counts as content LOSS, precisely: a call that FAILED (no usable response at all, or
          // a chunk that errored). NOT a short row count — a record-content endpoint may legitimately
          // return fewer rows than ids asked for (clarivate's /text splits {trademarks, nonTrademarks}:
          // a guid that is not a trademark record yields no content and that is a provider FACT, not a
          // failure). Keying on row shortfall would turn every such band into a false incomplete.
          const chunkErrors = Array.isArray(sj?.errors) ? sj.errors : [];
          const screened = (sj && Array.isArray(sj.rows)) ? sj.rows.length : 0;
          // — A JOIN THAT MATCHED NOTHING IS CONTENT LOSS, exactly like a call that failed. On this
          // provider the screen is the SOLE source of mark text, so a band whose every record missed the
          // join is a band of nameless ids, whatever the transport did. This arm used to check only that
          // the call came back.
          if (screenLift && screenLift.attempted && !screenLift.applied && screened > 0) {
            return incomplete(total, results.length, records,
              `provider error — the record-content call (this provider's ONLY source of mark text, classes, status and owner: the search returns bare ids) `
              + `returned ${screened} row(s) for ${uris.length} record(s) and NOT ONE joined: ${screenLift.reason}. `
              + `The band enumerated but its CONTENT did not land, so it cannot be read as a completed, screened band.`);
          }
          if (!sj || !Array.isArray(sj.rows) || chunkErrors.length) {
            return incomplete(total, results.length, records,
              `provider error — the record-content call (this provider's ONLY source of mark text, classes, status and owner: the search returns bare ids) `
              + `${sj ? `covered ${screened} of ${uris.length} record(s) and reported ${chunkErrors.length} failed chunk(s)` : "returned no usable response"}`
              + `${chunkErrors.length ? `: ${chunkErrors.join("; ").slice(0, 200)}` : ""}. `
              + `The band enumerated but its CONTENT did not land, so it cannot be read as a completed, screened band.`);
          }
        }
        // On a content-carrying provider screening stays best-effort: on a screen error the records still
        // cross with their search-row fields (mark_text/classes/status/owner/dates) — judgment can
        // deep-fetch; we never DROP the band here.
      }
    }
    // — a band that shipped WITHOUT the lift says so, on the band. On a content-carrying provider
    // (corsearch) the skip is survivable: the search row already holds mark text, so the lift only ever
    // filled gaps and dropping it is a degradation, not a hole. But "survivable" and "unreported" are
    // different words, and only the first one was ever true here. `named-band.mjs` spreads records
    // verbatim and `form-neighbourhood.mjs` no-ops on a null mark_text, so nothing downstream could
    // distinguish a record that is legitimately thin from one whose content silently failed to lift.
    return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: total, count: records.length, records,
      ...(screenLift && !screenLift.applied ? { screen_lift: screenLift } : {}) }, null, 2) };
  }

  return { enumerate, countFirstRescue, classSplitRescue };
}
