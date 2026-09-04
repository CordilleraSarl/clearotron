// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Count — the "how many", as a provider-agnostic kernel ──────────────────────────────────────────
//
// ONE call, ONE number: how many records match this query. No records are fetched, nothing is screened,
// nothing is paged. This is the cheapest question a register can answer, and it is the whole of Stage
// 0.5 (driver/register-count.mjs).
//
// It is EXTRACTED from makeEnumerate's private per-term probe rather than written beside it, and that
// matters: the count-first rescue's probe and this entry point are now provably the same code, so the
// number a caller asks for directly can never drift from the number the enumerate ceiling is tested
// against. makeEnumerate builds one of these and calls it — its own behaviour is unchanged.
//
// SEAM (capabilities.countProbe) — WHERE the number comes from. Same three values enumerate.mjs
// documents, same meanings:
//   "endpoint" Clarivate. A real POST /count: cheap, works at ANY magnitude (209012 returned without
//              complaint), fetches nothing. A true count-only call.
//   "cheap"    Corsearch. The count rides page 0 of a normal search (totalHitCount) — so it is one
//              BILLABLE search with `limit:1 fields:["uri"]`, the smallest response the API will give.
//              Cheap, not free: every count here is a metered call.
//   "none"     NO PROVIDER DECLARES THIS TODAY. The kernel still implements it: a provider whose
//              response carries no total anywhere REFUSES — { ok:false, unsupported:true } — and the
//              refusal is the product's answer. Signa was the example here and it is NOT one any more:
// moved it to "cheap". The sentence naming it survived that change by
//              nineteen months of commits, and providers/signa/src/core.js had already recorded the
//              drift ("the header five lines above it did not") without it being chased here. A
//              capability read off this comment rather than off the declaration would have concluded
//              signa cannot be probed at all. Read capabilities.js; this list is orientation.
//
// ══ THE ONE RULE ═══════════════════════════════════════════════════════════════════════════════════
//
// A PROVIDER THAT CANNOT COUNT MUST NEVER READ AS ZERO. "We could not ask" and "we asked and the
// answer is none" are different facts, and a count is the one artifact where they are trivially
// confusable: both are rendered as a small number in a narrow column. Every failure path here returns
// `total: null` with a reason. Nothing in this file can produce a 0 that was not counted.
//
// ══ WHAT THIS KERNEL DELIBERATELY DOES NOT HAVE ════════════════════════════════════════════════════
//
// THE ENUMERATE CEILING DOES NOT APPLY TO A COUNT. Over there a total past the ceiling means "this band
// cannot be exhausted" — a crowd descriptor, a signal to judgment, never a clean. Here a big number is
// simply the answer, and often the most useful one: "over five hundred filings contain this name" is
// exactly what a client choosing between names is paying to learn. So there is no ceiling, no crowd
// reason, no per-term rescue and no `state` here — those belong to completeness, and this kernel makes
// no completeness claim. Do not port them in.
//
// PURE: no node imports, no vendor HTTP.

import { guardCountCall, guardToolCall } from "./transport-guard.mjs";
import { clipProviderText } from "./provider-text.mjs";   // — keep the discriminator

export const parseToolText = (r) => { try { return JSON.parse(r?.text ?? ""); } catch { return null; } };
export const isToolError = (r) => !!(r?.isError) || (typeof r?.text === "string" && r.text.startsWith("ERROR"));

/**
 * Build the count primitive for one provider.
 *
 * @param deps.search   (auth, params, tctx) => toolResult — the provider's paged search, used by "cheap".
 * @param deps.count    (auth, params, tctx) => { ok, total, reason? } — REQUIRED for "endpoint".
 * @param deps.capabilities.countProbe — the seam ("endpoint" | "cheap" | "none").
 * @param deps.cheapCountParams — the smallest-response params for a "cheap" probe (corsearch shapes).
 *
 * @returns async (auth, params, tctx) => { ok, total, probe, reason, unsupported? }
 *          `total` is a number ONLY when ok === true. Never a number on any failure path.
 */
export function makeCountProbe(deps) {
  const {
    search: rawSearch = null,
    count: rawCount = null,
    capabilities = {},
    cheapCountParams = { limit: 1, fields: ["uri"] },
  } = deps;
  const { countProbe = "cheap" } = capabilities;

  // A count call that never gets an answer is the same fact as a count call that gets a 503: the number
  // is UNKNOWN. Both must land on `total: null` — a transport rejection escaping this kernel would kill
  // Stage 0.5 outright instead of reporting an honest unknown for the one query that timed out.
  // Double-guarding is idempotent: makeEnumerate hands its already-guarded deps straight in.
  const search = guardToolCall(rawSearch, "search");
  const count = guardCountCall(rawCount, "count");

  if (countProbe === "endpoint" && typeof count !== "function")
    throw new Error('[count-kernel] capabilities.countProbe === "endpoint" requires a count() dependency');
  if (countProbe === "cheap" && typeof search !== "function")
    throw new Error('[count-kernel] capabilities.countProbe === "cheap" requires a search() dependency');

  return async function countHits(auth, params, tctx) {
    if (countProbe === "none") {
      // Not a degraded answer — an absent capability. The caller discloses it; it never becomes a zero.
      return { ok: false, total: null, probe: "none", unsupported: true,
        reason: "this register provider exposes no total anywhere in its responses, so a count cannot be taken — the number is UNKNOWN, which is not the same as none" };
    }
    if (countProbe === "endpoint") {
      const c = await count(auth, params, tctx);
      if (c && c.ok === true && Number.isFinite(c.total))
        return { ok: true, total: c.total, probe: "endpoint", reason: null, ...(c.per_office ? { per_office: c.per_office } : {}) };
      return { ok: false, total: null, probe: "endpoint", reason: String(c?.reason ?? "count unavailable") };
    }
    // "cheap": page 0 of a normal search IS the count — one billable call, smallest response.
    const r = await search(auth, { ...params, ...cheapCountParams }, tctx);
    if (isToolError(r)) return { ok: false, total: null, probe: "cheap", reason: clipProviderText(r?.text ?? "provider error", 240) };
    const parsed = parseToolText(r);
    if (!parsed) return { ok: false, total: null, probe: "cheap", reason: "unparseable search response on the count probe" };
    // ── THERE IS NO PATH HERE WHERE A MISSING NUMBER BECOMES 0 ────────────────────────────────────
    // This line used to read `parsed.total_hits ?? 0`, licensed by a comment saying a response with no
    // total is "the ONE path where 0 is a counted answer" — on the reasoning that
    // normalizeSearchResponse always emits the key. It does; but it emitted 0 for an ABSENT body too,
    // so "the key is always there" was never the same claim as "a number was counted". A truncated 200
    // arrived here as total_hits 0 and left as `{ok:true, total:0}` — the count kernel's own rule
    // ("a provider that cannot count must never read as zero") broken from the inside, by its own
    // comment. The number now has to BE a number; nothing else is an answer.
    if (!Number.isFinite(parsed.total_hits)) {
      return { ok: false, total: null, probe: "cheap",
        reason: "the search response carried no usable total_hits, so nothing was counted — the number is UNKNOWN, which is not the same as none" };
    }
    return { ok: true, total: parsed.total_hits, probe: "cheap", reason: null };
  };
}
