// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── The record-listing shim ( part 5) ───────────────────────────────────────────────────────────
//
// Every provider core already answers a search with normalized rows, and every core's row vocabulary is
// the same flat corsearch-shaped one (`record_id`, `mark_text`, `owner_name`, `classes`, `status`) —
// euipo/row.js states that key naming IS the contract, and uspto-local follows it. So the driver-side
// listing needs no new core: it is doSearch, parsed, with the errors read the way every other kernel
// reads them.
//
// ONE COPY, because the provider adapters would otherwise carry five copies of the same parse and the
// same ERROR-prefix check, and a provider whose copy drifted would report a failed fetch as an empty
// list of filings — the exact "absence reads as a finding" defect this lane exists to avoid.
//
// THE URL IS BUILT HERE, not in the renderer, because it is provider knowledge: a row that already
// carries a resolved link keeps it, and otherwise the provider's own public origin is joined to the
// record ref. A provider with no public record URL yields null, and the surfaces print the reference
// without a link rather than inventing an address.
export function recordsFromSearch(run, { origin = null } = {}) {
  return async (params, tctx) => {
    let r;
    try { r = await run(params, tctx); }
    catch (e) { return { ok: false, records: null, reason: `record listing threw: ${e.message}` }; }
    const text = typeof r?.text === "string" ? r.text : "";
    if (r?.isError || text.startsWith("ERROR")) return { ok: false, records: null, reason: text.slice(0, 300) || "provider error" };
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return { ok: false, records: null, reason: "unparseable search response on the record listing" }; }
    if (!Array.isArray(parsed?.results))
      return { ok: false, records: null, reason: "the search response carried no results[], so nothing was listed — which is not the same as no filings" };
    const link = (row) => {
      const resolved = row?.resolved_link ?? row?.record_url ?? null;
      if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) return resolved;
      const ref = row?.record_id;
      return (origin && typeof ref === "string" && ref.startsWith("/")) ? `${origin}${ref}` : null;
    };
    return {
      ok: true,
      records: parsed.results.map((row) => ({ ...row, record_url: link(row) })),
      // NULL, never the row count, when the body carried no integer. `fetched` under a null `total` is
      // an honest "we do not know how many more there are"; under a minted total it is a lie about
      // completeness — the count kernel's one rule, applied to the listing.
      total: Number.isFinite(parsed?.total_hits) ? parsed.total_hits : null,
    };
  };
}
