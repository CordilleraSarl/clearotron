// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── free-tier core: two sources, one register ───────────────────────────────────────────────────────
//
//. EUIPO serves the EU, the local index serves the US, and this file makes them look like a single
// provider to everything above it — one plan, one `qid` namespace, one coverage skeleton, one ledger.
// The capability contract and the routing table are in ./capabilities.js.
//
// ── FAN-OUT HAPPENS AT THE TOOLS, NOT INSIDE `executePlan` ──────────────────────────────────────────
//
// The issue describes fanning out inside executePlan, per entry, by `regions[]`. Doing it there is
// unsafe, and the reason is in the executor's own header: makeExecutePlan WRITES THE BAND FILE, and its
// merge semantics are "preserve un-owned blocks, REPLACE owned qids" — load-bearing and preserved
// exactly. Two members executing the same plan against one output path would each own the same qid, and
// the second would replace the first. The EU half of every two-office entry would vanish, silently, into
// a band that looks complete.
//
// So the fan-out sits one layer down, at the provider's own TOOLS. Each member keeps its own
// `doEnumerate` — and with it its own paging shape, ceilings, crowd descriptors and row screening — and
// the composite merges the two ANSWERS. makeExecutePlan is then handed a `search` and an `enumerate`
// that already span both offices, so the band writer, the qid stamping and the receipt shape are
// untouched. This is the seam the issue meant — "fan-out lives below the provider seam".
//
// It is deliberately NOT done by giving makeEnumerate a merged-page `search`, which was the first cut.
// Two things kill that: the members page DIFFERENTLY (euipo takes {size,page}, the index takes
// {limit,offset}), so one kernel's page params cannot drive both; and screenSource "search-row" requires
// a rowScreen, which is per-member row vocabulary. Delegating to each member's own enumerate keeps both
// facts where they belong — inside the member that owns them.
//
// ── WHAT MERGING TWO ANSWERS MEANS ──────────────────────────────────────────────────────────────────
//
//   records     concatenated. Members are office-disjoint, so no record can appear twice; the dedupe by
//               record_id is a backstop, not the mechanism.
//   total_hits  the SUM, and ONLY when every participating member reported a finite number.
//   state       "enumerated" only if EVERY member enumerated. One incomplete member makes the band
//               incomplete, with its reason carried — a band that exhausted the EU and gave up on the US
//               is not a completed enumeration of EU+US.
//
// The total is the honest half. This provider's countProbe is "cheap", which means the search response
// IS the count, and the kernels refuse to call a band either a crowd or a clean when total_hits is not
// finite. If one source cannot say how many it holds, the composite genuinely does not know its total,
// and a sum over only the members that DID answer would be a smaller number wearing the authority of a
// complete one. Null (unknown) is the truth. Never 0.
//
// ── A MEMBER THAT FAILS TAKES THE SLICE WITH IT ─────────────────────────────────────────────────────
//
// joinPlanToBands has exactly three outcomes per qid — executed, missing, deferred — and NO shape for
// "half of this ran". With one qid per entry, a two-office slice whose US half errored cannot be
// reported as executed: a clean must never rest on a half-searched band. So any member error fails the
// whole search, carrying the failing office in the reason. The EU rows are not lost — they are simply
// not passed off as a complete answer.
//
// ── AND WHY THAT NO LONGER COSTS AN UNCONFIGURED DEPLOYMENT ITS EU COVERAGE ──────────────────
//
// The rule above used to force driver.config to require BOTH members' credentials before a free-tier run
// started: with an EU+US entry deferring whole, a box holding only EUIPO credentials would have lost the
// EU coverage it actually has, silently, on every entry spanning both.
//
// The split now happens EARLIER — at plan compile, in driver/register-availability.mjs — so an office
// this deployment cannot reach never becomes part of a two-office entry in the first place. Every qid
// reaching this file is single-office, the rule above is never tested by a configuration gap, and the
// unreachable office rides the plan as a disclosed `deferred_coverage` row instead. Preflight now
// requires the EU half only.
//
// The rule is unchanged, and it is still what makes the early split necessary rather than optional. What
// `callMember` below adds is the backstop for the case where an unconfigured member is reached anyway:
// a disclosed capability gap, never an opaque crash and never a half-band wearing a completeness claim.

import { CAPABILITIES, FREE_TIER_MEMBER_IDS, memberForOffice, overlappingOffices } from "./capabilities.js";
import { makeExecutePlan, planPredicateParams, CAPABILITY_GAP_MARKER } from "../../_shared/execute-plan.mjs";
import { makeLedger } from "../../_shared/ledger.mjs";

export { CAPABILITIES };
export const ENUMERATE_NAMES_CHUNK_DEFAULT = CAPABILITIES.kernel.namesChunkDefault;
export const { logCall, logRecordBody, tctxOf } = makeLedger("free-tier");

// ── disjointness, enforced HERE and not in capabilities.js ──────────────────────────────────────────
//
// register-capabilities.mjs imports every contract at module load, so a throw there would take down
// consumers that never touch the free tier — including the offline test fleet. This module is only
// loaded when the free tier is actually the wired provider, which is exactly when the invariant matters.
//
// Overlapping members would mean one office answered by two sources, and then `record_id`
// (`/mark/<office>/<provider-id>`) could collide across sources with nothing to de-duplicate on.
const OVERLAP = overlappingOffices();
if (OVERLAP.length) {
  throw new Error(`[free-tier] members overlap on ${OVERLAP.join(", ")} — the free tier composes only `
    + `office-DISJOINT sources, so a record_id can never need matching across them. Members: `
    + `${FREE_TIER_MEMBER_IDS.join(", ")}.`);
}

// ── member cores, imported lazily and once ──────────────────────────────────────────────────────────
//
// Lazy for the same reason driver.config imports provider cores lazily: a core reaches for its
// credentials and its transport at load, and the free tier must not drag EUIPO's OAuth or the index's
// sqlite handle into a process that only wanted a capability lookup.
const coreCache = new Map();
async function memberCore(id) {
  if (!coreCache.has(id)) coreCache.set(id, import(`../../${id}/src/core.js`));
  return coreCache.get(id);
}

/** Test seam: drop the cached member cores. Never called by product code. */
export const _resetMemberCores = () => coreCache.clear();

/**
 * Test seam: stand a member core in, so the MERGE ARITHMETIC can be driven over every shape a member
 * can return — a missing total, a partial enumeration, a hard error — without a live EUIPO token or a
 * multi-gigabyte index. Never called by product code.
 *
 * The merge is the only thing this file adds over its members, so it is the only thing worth testing
 * here, and it is untestable against real sources: neither member can be made to return "I do not know
 * how many I hold" on demand.
 */
export const _setMemberCore = (id, core) => coreCache.set(id, Promise.resolve(core));

const gap = (msg) => ({ type: "text", text: `ERROR: ${CAPABILITY_GAP_MARKER} ${msg}` });
const isToolError = (r) => typeof r?.text === "string" && r.text.startsWith("ERROR");
/** A tool error that is specifically a DISCLOSED capability gap, not a failure a re-run could close. */
const isGap = (r) => typeof r?.text === "string" && r.text.includes(CAPABILITY_GAP_MARKER);
const parseText = (r) => { try { return JSON.parse(r.text); } catch { return null; } };

/**
 * Call a member's tool, converting a THROW into a disclosed capability gap.
 *
 * A member returns a tool ERROR for things that went wrong while it was working — a 500, a rate limit, a
 * malformed page. It THROWS for things that mean it was never in a position to work at all: uspto-local's
 * resolveDbPath throws when USPTO_LOCAL_DB is unset, and openFor throws when the index is absent or has
 * no rows. Those two classes want opposite treatment and had the same one, because an uncaught throw here
 * escaped the tool boundary entirely — no gap marker, no deferred row, just a stage failure carrying a
 * provider's internal message.
 *
 * A throw becomes `gap()`, which is the CAPABILITY_GAP_MARKER path: error:true + deferred:true → a
 * disclosed coverage row → held rather than re-run. That is the right bucket, because nothing a re-run
 * does closes it — the same unset variable produces the same throw and spends a paid unit to re-derive a
 * deterministic no. Configuring the member is what closes it, and the message says so.
 *
 * This is a BACKSTOP, not the mechanism. On a correctly planned run the unreachable office was already
 * split off at plan compile (driver/register-availability.mjs) and no qid for it ever reaches a member.
 * What this guarantees is that the failure mode when that does not happen is a disclosed deferral rather
 * than an opaque crash — never a clean.
 */
async function callMember(id, offices, fn) {
  try { return await fn(); }
  catch (e) {
    return gap(`the ${id} member (${(offices ?? []).join(", ") || "no office"}) is not usable on this `
      + `deployment, so its offices were never searched: ${String(e?.message ?? e).slice(0, 240)}`);
  }
}

/**
 * Which members serve this call, each with the subset of `regions` it covers.
 *
 * An EMPTY/absent `regions` is UNRESTRICTED — every member participates, each over its own whole
 * coverage. That is the worldwide shape, and on the free tier "worldwide" honestly means EU+US: every
 * other territory was already split off as a deferred jurisdiction by resolveRegions, against this
 * provider's `offices.covered`, before the plan was compiled.
 *
 * A region no member claims cannot reach here (resolveRegions defers it first), but if one ever did it
 * would produce an empty member list and a loud refusal rather than a quiet single-source answer.
 */
export function routeRegions(regions) {
  const list = (Array.isArray(regions) ? regions : []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return FREE_TIER_MEMBER_IDS.map((id) => ({ id, regions: null }));
  const byMember = new Map();
  const unrouted = [];
  for (const code of list) {
    const m = memberForOffice(code);
    if (!m) { unrouted.push(code); continue; }
    if (!byMember.has(m.id)) byMember.set(m.id, []);
    byMember.get(m.id).push(code);
  }
  return { routed: [...byMember.entries()].map(([id, rs]) => ({ id, regions: rs })), unrouted };
}

/** Normalised: always { routed, unrouted }. */
function route(regions) {
  const r = routeRegions(regions);
  return Array.isArray(r) ? { routed: r, unrouted: [] } : r;
}

// ── THE PAGING SEAM: the composite translates, and a member's vocabulary never crosses it ─────
//
// The members do not page the same way. euipo reads `page`/`size`; the local index reads
// `limit`/`offset`. This file used to build ONE `sub = {...params}` and hand it to both, so whichever
// vocabulary the caller sent, the other member silently took its DEFAULT page instead of the page that
// was asked for — no error, no warning. Latent rather than active only because nothing today rests a
// completeness claim on the composite's paged search; the moment a caller pages it, one member returns
// page 1 forever while the caller advances, and the merged set repeats rows and omits everything past
// the first page, under a `has_more` computed from the member that WAS paging correctly.
//
// This is the same defect as at the other end of the call — the composite forwarding across a seam
// it does not translate — and the fix has the same shape: ONE neutral vocabulary at the boundary, each
// member's own vocabulary confined to that member.
//
// NEUTRAL IS `page`/`size`, because that is what this provider's own search response already emits and
// what CAPABILITIES.kernel.pageSize describes. `limit`/`offset` from a caller is a member's vocabulary
// leaking IN — accepted (refusing would break a caller that guessed right) and normalised here, so
// there is exactly one place that knows both spellings.
const MEMBER_PAGING = {
  "euipo": "page-size",
  "uspto-local": "limit-offset",
};

/** Neutral paging out of whatever the caller sent. `size: null` = "the caller stated no size". */
export function neutralPaging(params) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const size = num(params?.size) ?? num(params?.limit);
  let page = num(params?.page);
  if (page === null) {
    // limit/offset from the caller: a page only exists if a size does, and only if it divides evenly.
    // A ragged offset is NOT rounded into a page — that would silently move the window the caller asked
    // for. It rides through as an offset on the members that take one and defers on the ones that
    // do not, which is visible; a quietly shifted page is not.
    const offset = num(params?.offset);
    page = (offset !== null && size) ? (offset % size === 0 ? offset / size : null) : null;
  }
  return { page: page === null ? null : Math.max(0, page), size: size === null ? null : Math.max(0, size) };
}

/**
 * The params for ONE member: the caller's, minus every paging spelling, plus that member's own.
 *
 * Stripping both spellings first is the half that matters. Passing the caller's `limit` through to euipo
 * alongside a translated `page` leaves the member reading a field the composite did not mean, which is
 * exactly the leak this closes.
 */
export function memberParams(memberId, params) {
  const { page, size } = neutralPaging(params);
  const sub = { ...params };
  for (const k of ["page", "size", "limit", "offset"]) delete sub[k];

  const vocab = MEMBER_PAGING[memberId];
  if (!vocab) return sub;                     // an unknown member gets no paging rather than a guess
  if (vocab === "page-size") {
    if (page !== null) sub.page = page;
    if (size !== null) sub.size = size;
  } else {
    if (size !== null) sub.limit = size;
    // offset is derived from the neutral page when there is one, and passed through verbatim when the
    // caller spoke limit/offset and the page could not be derived (a ragged offset — see above).
    const rawOffset = Number(params?.offset);
    if (page !== null && size !== null) sub.offset = page * size;
    else if (Number.isFinite(rawOffset)) sub.offset = Math.max(0, rawOffset);
  }
  return sub;
}

// ── search: the one primitive every kernel is built on ──────────────────────────────────────────────

export async function doSearch(auth, params, tctx) {
  const { routed, unrouted } = route(params?.regions);
  if (unrouted.length) {
    return gap(`free_tier_search — no member of the free tier covers ${unrouted.join(", ")}. `
      + `Covered: ${CAPABILITIES.offices.covered.join(", ")}.`);
  }
  if (!routed.length) return gap("free_tier_search — no member of the free tier serves this request.");

  const merged = [];
  let anyMore = false;
  let total = 0;
  let totalKnown = true;

  for (const { id, regions } of routed) {
    const core = await memberCore(id);
    // — the member's OWN paging vocabulary, translated at this boundary. Never `{...params}`:
    // euipo reads page/size and the local index reads limit/offset, so one forwarded object means one
    // of them silently pages from its default.
    const sub = memberParams(id, params);
    if (regions) sub.regions = regions; else delete sub.regions;
    const r = await callMember(id, regions ?? core.CAPABILITIES.offices.covered,
      () => core.doSearch(auth, sub, { ...tctx, target: tctx?.target }));
    // A capability gap rides out AS a gap, unwrapped. Rewrapping it in the sentence below would
    // strip CAPABILITY_GAP_MARKER and turn a disclosed deferral into an ordinary provider failure —
    // which the ladder then RE-RUNS, spending a paid unit per attempt to meet the same unset variable.
    // The whole slice still defers, which is the rule this file is built on; what differs is that it
    // defers into the bucket that says "nothing here a re-run can close".
    if (isGap(r)) return r;
    // A member error fails the WHOLE slice: see the header. Half a band must never be passed off as a
    // complete one, and the failing office is named so the deferral says which source could not answer.
    if (isToolError(r)) {
      return { type: "text", text: `ERROR: free_tier_search — the ${id} member `
        + `(${(regions ?? core.CAPABILITIES.offices.covered).join(", ")}) failed, so this slice is `
        + `INCOMPLETE and must not be read as a whole-tier answer. ${String(r.text).slice(0, 400)}` };
    }
    const parsed = parseText(r);
    if (!parsed) {
      return { type: "text", text: `ERROR: free_tier_search — the ${id} member returned an unparseable `
        + `search response; the free tier cannot state a total or a completeness claim over it.` };
    }
    for (const row of (parsed.results ?? [])) merged.push(row);
    if (parsed.has_more) anyMore = true;
    if (Number.isFinite(parsed.total_hits)) total += parsed.total_hits;
    else totalKnown = false;          // one unknown makes the SUM unknown — never a partial sum
  }

  return { type: "text", text: JSON.stringify({
    members: routed.map((m) => m.id),
    page: Math.max(0, Number(params?.page) || 0),
    size: Number(params?.size) || CAPABILITIES.kernel.pageSize,
    // NULL, never 0, when any participating member could not say. On this provider the response IS the
    // count, so a fabricated sum here would become a completeness claim over a source that never answered.
    total_hits: totalKnown ? total : null,
    has_more: anyMore,
    results: merged,
  }, null, 2) };
}

// ── record fetch / batch screen / image: routed by the office IN THE RECORD ID ──────────────────────
//
// `/mark/<office>/<provider-id>` — the office is in the id, so a fetch never needs `regions` and can
// never reach the wrong source.

const officeOfRecordId = (uri) => {
  const m = /^\/mark\/([a-z]{2})\//i.exec(String(uri ?? "").trim());
  return m ? m[1].toUpperCase() : null;
};

async function coreForRecord(uri, tool) {
  const office = officeOfRecordId(uri);
  if (!office) {
    return { error: gap(`${tool} — "${String(uri).slice(0, 80)}" is not a /mark/<office>/<id> record id, `
      + `so the free tier cannot tell which source holds it.`) };
  }
  const m = memberForOffice(office);
  if (!m) {
    return { error: gap(`${tool} — no member of the free tier covers ${office}. `
      + `Covered: ${CAPABILITIES.offices.covered.join(", ")}.`) };
  }
  return { id: m.id, core: await memberCore(m.id) };
}

export async function doRecordFetch(auth, params, tctx) {
  const r = await coreForRecord(params?.record_id, "free_tier_record_fetch");
  if (r.error) return r.error;
  return callMember(r.id, r.core.CAPABILITIES?.offices?.covered, () => r.core.doRecordFetch(auth, params, tctx));
}

export async function doImageFetch(auth, params, tctx) {
  const r = await coreForRecord(params?.record_id, "free_tier_image_fetch");
  if (r.error) return r.error;
  if (typeof r.core.doImageFetch !== "function") {
    return gap(`free_tier_image_fetch — the ${r.id} member serves no mark images, so this record's image `
      + `cannot be fetched. This is a source limitation, not an absent image.`);
  }
  return callMember(r.id, r.core.CAPABILITIES?.offices?.covered, () => r.core.doImageFetch(auth, params, tctx));
}

// ── THE SCREEN THAT SCREENED NOTHING AND SAID SO IN THE SHAPE OF A SUCCESS ──────────────────────────
//
// Found by adversarial review and reproduced end to end. This function was wrong at BOTH
// seams and the two errors hid each other:
//
//   * it read `params.record_ids` and forwarded `record_ids` to the members — and every member reads
//     `params.uris` (euipo, uspto-local and corsearch all declare `uris` as their required parameter).
//     So each member received an empty id list and screened nothing.
//   * it then read the members' rows from `parsed.results ?? parsed.records` — and no member returns
//     either. corsearch and uspto-local return `rows`; euipo returns `screened`.
//
// The result was `{count: 0, results: []}`: a well-formed, error-free screen over records nobody looked
// at. Batch screen is what decides which surfaced records are in scope, so an empty screen is not a
// visible failure — it is every candidate silently unscreened, on the provider the open-source tier
// depends on.
//
// `uris` is the canonical name and this now speaks it, matching every other provider so one skill doc
// serves them all. `record_ids` is still accepted, because that is what this provider's own MCP schema
// has been declaring. The return is `rows`, which is what corsearch and uspto-local return; `results` is
// kept alongside it so nothing reading the old name breaks.
//
// euipo's `screened` is a genuine cross-provider inconsistency and is NOT resolved here — changing a
// shipped provider's return shape is not this function's business. It is read, and it is filed.
export async function doBatchScreen(auth, params, tctx) {
  // Both spellings, because the tool schema and the member cores have disagreed since.
  const ids = Array.isArray(params?.uris) ? params.uris
    : Array.isArray(params?.record_ids) ? params.record_ids : [];
  if (!ids.length) return gap("free_tier_batch_screen — uris is required and must be non-empty.");
  const byMember = new Map();
  const unrouted = [];
  for (const uri of ids) {
    const office = officeOfRecordId(uri);
    const m = office ? memberForOffice(office) : null;
    if (!m) { unrouted.push(uri); continue; }
    if (!byMember.has(m.id)) byMember.set(m.id, []);
    byMember.get(m.id).push(uri);
  }
  if (unrouted.length) {
    return gap(`free_tier_batch_screen — ${unrouted.length} record id(s) belong to no member of the free `
      + `tier: ${unrouted.slice(0, 5).join(", ")}. Covered: ${CAPABILITIES.offices.covered.join(", ")}.`);
  }
  const rows = [];
  const notFound = [];
  for (const [id, subset] of byMember) {
    const core = await memberCore(id);
    const r = await callMember(id, core.CAPABILITIES.offices.covered,
      // `uris` is what every member actually reads. `record_ids` rode out of here for as long as this
      // provider existed and was read by nobody.
      () => core.doBatchScreen(auth, { ...params, uris: subset, record_ids: subset }, tctx));
    if (isGap(r)) return r;   // a disclosed gap, unwrapped — see callMember
    if (isToolError(r)) {
      return { type: "text", text: `ERROR: free_tier_batch_screen — the ${id} member failed on `
        + `${subset.length} record(s), so the screen is INCOMPLETE. ${String(r.text).slice(0, 300)}` };
    }
    const parsed = parseText(r);
    if (!parsed) {
      return { type: "text", text: `ERROR: free_tier_batch_screen — the ${id} member returned an `
        + `unparseable screen response.` };
    }
    // — ONE declared name, not a chain of guesses.
    //
    // This read `parsed.rows ?? parsed.screened ?? parsed.results ?? parsed.records`, which was written
    // defensively and is a trap: on euipo, `screened` is a COUNT, not a row list. The chain never fires
    // on it today only because `rows` is always present and `??` falls through on null/undefined alone
    // — so the guard behind it is the only thing standing between a provider that omits `rows` and this
    // function treating an integer as a screen. A contract that survives on the ordering of a `??` chain
    // is not a contract.
    //
    // `rows` is the neutral name and every provider that implements batch screen already returns it
    // (corsearch, clarivate, euipo, uspto-local — checked on origin/main). Reading only that name means
    // a provider that invents a new one FAILS HERE, loudly, naming the keys it did return — instead of
    // screening zero records and looking downstream exactly like "nothing matched".
    const memberRows = parsed.rows;
    if (!Array.isArray(memberRows)) {
      return { type: "text", text: `ERROR: free_tier_batch_screen — the ${id} member returned no `
        + `\`rows\` array (keys: ${Object.keys(parsed).join(", ") || "none"}). \`rows\` is the neutral `
        + `result vocabulary for register_batch_screen; a member that answers in another name is a `
        + `contract break, not an empty screen. Refusing rather than reporting a clean screen over `
        + `${subset.length} record(s) that were never judged.` };
    }
    for (const row of memberRows) rows.push(row);
    for (const nf of (parsed.not_found ?? [])) notFound.push(nf);
  }
  return { type: "text", text: JSON.stringify({
    members: [...byMember.keys()],
    count: rows.length,
    // `rows` is the name corsearch and uspto-local use; `results` is kept so nothing reading the old
    // name breaks. An UNANSWERED id is not a verdict, so it rides separately and is never an absence.
    rows,
    results: rows,
    ...(notFound.length ? { not_found: notFound } : {}),
  }, null, 2) };
}

// ── enumerate: each member enumerates ITSELF, and the two answers are merged ────────────────────────
//
// Delegating rather than re-paging is the whole point. A member's own enumerate owns its paging shape,
// its resource ceiling, its crowd descriptor and its row screening — none of which the composite should
// know. What the composite owns is the arithmetic of putting two answers together honestly.

export async function doEnumerate(auth, params, tctx) {
  const { routed, unrouted } = route(params?.regions);
  if (unrouted.length) {
    return gap(`free_tier_enumerate — no member of the free tier covers ${unrouted.join(", ")}. `
      + `Covered: ${CAPABILITIES.offices.covered.join(", ")}.`);
  }
  if (!routed.length) return gap("free_tier_enumerate — no member of the free tier serves this request.");

  const byId = new Map();
  const merged = new Map();          // record_id → row; disjoint members, so the dedupe is a backstop
  let total = 0, totalKnown = true, allEnumerated = true;
  const reasons = [];

  for (const { id, regions } of routed) {
    const core = await memberCore(id);
    const sub = { ...params };
    if (regions) sub.regions = regions; else delete sub.regions;
    const r = await callMember(id, regions ?? core.CAPABILITIES.offices.covered,
      () => core.doEnumerate(auth, sub, tctx));
    if (isGap(r)) return r;   // a disclosed gap, unwrapped — see callMember
    if (isToolError(r)) {
      // A member ERROR is not an incomplete band — it is a slice that did not run. It must reach
      // joinPlanToBands as an error, never as a short enumeration wearing a completeness claim.
      return { type: "text", text: `ERROR: free_tier_enumerate — the ${id} member failed, so this band `
        + `spans only part of ${CAPABILITIES.offices.covered.join("+")} and must not be read as a `
        + `whole-tier answer. ${String(r.text).slice(0, 400)}` };
    }
    const parsed = parseText(r);
    if (!parsed) {
      return { type: "text", text: `ERROR: free_tier_enumerate — the ${id} member returned an `
        + `unparseable enumerate response; no completeness claim can rest on it.` };
    }
    byId.set(id, parsed.state ?? "unknown");
    for (const rec of (parsed.records ?? parsed.sample ?? [])) {
      const k = rec?.record_id ?? rec?.uri;
      if (k != null && !merged.has(k)) merged.set(k, rec);
    }
    if (Number.isFinite(parsed.total_hits)) total += parsed.total_hits;
    else totalKnown = false;
    if (String(parsed.state) !== "enumerated") {
      allEnumerated = false;
      reasons.push(`${id}: ${String(parsed.reason ?? "incomplete").slice(0, 240)}`);
    }
  }

  const records = [...merged.values()];
  const total_hits = totalKnown ? total : null;
  if (allEnumerated) {
    return { type: "text", text: JSON.stringify({
      state: "enumerated", members: [...byId.keys()], total_hits, count: records.length, records,
    }, null, 2) };
  }
  // ONE incomplete member makes the BAND incomplete. A band that exhausted the EU and gave up on the US
  // is not a completed enumeration of EU+US, and calling it one is the clean-negative this whole
  // provider exists to avoid. The records already gathered ride along as the sample they are.
  return { type: "text", text: JSON.stringify({
    state: "incomplete", members: [...byId.keys()], total_hits, fetched: records.length, sample: records,
    reason: `the free tier spans ${CAPABILITIES.offices.covered.join("+")} and at least one source did `
      + `not enumerate to completion, so this band is a CROWD/partial descriptor for judgment, never a `
      + `clean negative over the whole tier. Per member — ${reasons.join(" · ")}`,
  }, null, 2) };
}

// ── count: sum, and only when every participating member answered ───────────────────────────────────

export async function doCountHits(auth, params, tctx) {
  const { routed, unrouted } = route(params?.regions);
  if (unrouted.length) {
    return { ok: false, total: null, probe: CAPABILITIES.countProbe,
      reason: `${CAPABILITY_GAP_MARKER} no member of the free tier covers ${unrouted.join(", ")}.` };
  }
  if (!routed.length) {
    return { ok: false, total: null, probe: CAPABILITIES.countProbe,
      reason: `${CAPABILITY_GAP_MARKER} no member of the free tier serves this request.` };
  }
  let total = 0;
  const per = {};
  for (const { id, regions } of routed) {
    const core = await memberCore(id);
    const sub = { ...params };
    if (regions) sub.regions = regions; else delete sub.regions;
    // The count path cannot use `callMember`: it answers in {ok,total,reason}, not a text tool result, so
    // a gap here has to be built in this function's own shape. Same rule though — an unconfigured member
    // THROWS (uspto-local's resolveDbPath), and an uncaught throw would escape the count lane entirely.
    // That is the exact surface was reported on: "the free-tier credential is absent" arriving from
    // knockout-register-count. CAPABILITY_GAP_MARKER on the reason keeps it a disclosed, held deferral.
    let r;
    try { r = await core.doCountHits(auth, sub, tctx); }
    catch (e) {
      return { ok: false, total: null, probe: CAPABILITIES.countProbe,
        reason: `${CAPABILITY_GAP_MARKER} the ${id} member is not usable on this deployment, so the free `
          + `tier's total over ${CAPABILITIES.offices.covered.join("+")} is UNKNOWN — never the partial `
          + `sum of the sources that did answer. ${String(e?.message ?? e).slice(0, 240)}` };
    }
    // A PARTIAL total is the dangerous answer here: it is a real number, smaller than the truth, and
    // nothing downstream can tell it apart from a complete one. One member that cannot count makes the
    // composite's total UNKNOWN — null, never the sum of the rest, and never 0.
    if (!r?.ok || !Number.isFinite(r.total)) {
      return { ok: false, total: null, probe: CAPABILITIES.countProbe,
        reason: `the ${id} member could not count, so the free tier's total over `
          + `${CAPABILITIES.offices.covered.join("+")} is UNKNOWN — not the partial sum of the sources `
          + `that did answer. ${String(r?.reason ?? "no reason given").slice(0, 240)}` };
    }
    per[id] = r.total;
    total += r.total;
  }
  return { ok: true, total, probe: CAPABILITIES.countProbe, per_member: per };
}

const executePlanKernel = makeExecutePlan({
  search: doSearch,
  enumerate: doEnumerate,
  predicateParams: planPredicateParams,
  // The FULL contract: the script-form and owner×term refusals read it, and the composite's contract is
  // the pointwise-weakest one — which is exactly what must be refused against.
  capabilities: CAPABILITIES,
});
export const doExecutePlan = (auth, params, tctx) => executePlanKernel(auth, params, tctx);
