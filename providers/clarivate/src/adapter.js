// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The clarivate register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.

export const adapter = {
  id: "clarivate",
  label: "Clarivate Compumark",
  credEnv: "CLARIVATE_API_KEY",
  skillDoc: "skills/clearance-register/providers/clarivate.md",
  hasPublicRecordUrl: false, // Compumark Content has no public record URL — cite the office register
  //, ruling 2026-08-20 — WHAT A CARD SHOWS WHERE A LINK CANNOT GO. A UI exists for this
  // provider and we do not know its per-record URL, so the card says so and says it is unfinished.
  // "placeholder" is the reader-facing admission; anything else would read as a citation.
  recordCitation: "placeholder",
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CLARIVATE_API_KEY) return { ok: false, cause: "CLARIVATE_API_KEY absent from driver env" };
    let doRecordFetch, DEFAULT_BASE;
    try { ({ doRecordFetch, DEFAULT_BASE } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
    try {
      const r = await doRecordFetch(process.env.CLARIVATE_API_KEY, base,
        { record_ids: [uri] }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // Depth 2's count, same contract as corsearch's (see above). A TRUE count-only call here: POST
  // /count fetches no records and works at any magnitude. regions[] is mandatory on this provider,
  // so a worldwide count is a disclosed capability gap rather than a number — register-count.mjs
  // refuses the run up front instead of letting every mark fail one at a time.
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CLARIVATE_API_KEY) return { ok: false, total: null, reason: "CLARIVATE_API_KEY absent from driver env" };
    let doCountHits, DEFAULT_BASE;
    try { ({ doCountHits, DEFAULT_BASE } = await import("./core.js")); }
    catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
    try {
      return await doCountHits(process.env.CLARIVATE_API_KEY, base,
        { ...(Array.isArray(name) ? { names: name } : { name }), match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
        { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
    } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
  },
  // part 5 — TWO calls, not a per-record bill. Compumark's POST /search answers with record
  // IDENTIFIERS and nothing else (normalizeSearchResponse fills mark_text, classes, status and
  // owner_name with null on every row, by construction), so the fields a filings list prints have to
  // be fetched. But the fetch is a BATCH: TEXT_BATCH_MAX is 100 ids per call and POST /text hydrates
  // every id in the call. A 100-filing listing for one name is ONE search plus ONE screen call.
  //
  // An earlier draft of this method refused here and priced the listing at "up to 100 extra billed
  // calls per name". That was wrong by the batch factor, and it mattered: clarivate is the register
  // wired on the test deployment, so the refusal would have shipped this whole part inert on the one
  // provider that runs. `screenSource: "billed-record-fetch"` states that the fields cost a fetch —
  // it does not state that the fetch is per record, and doRecordFetch chunks at the same 100.
  //
  // THE CAP IS APPLIED TO THE IDS, BEFORE THE SCREEN, because this provider's search is single-shot:
  // capabilities.pageParams is empty and POST /search returns the COMPLETE guid set up to the 30000
  // ceiling. Screening whatever came back would be exactly the runaway the cap exists to prevent.
  //
  // Class scope comes from the SEARCH (`classFilter: "native"`), as on every other provider here.
  // `in_scope_classes` is deliberately NOT sent to the screen: there it drives `screen_verdict`, a
  // keep/drop judgment, and this lane adds none — it prints what the register said.
  async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CLARIVATE_API_KEY) return { ok: false, records: null, reason: "CLARIVATE_API_KEY absent from driver env" };
    let doSearch, doBatchScreen, DEFAULT_BASE;
    try { ({ doSearch, doBatchScreen, DEFAULT_BASE } = await import("./core.js")); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
    const tctx = { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog };
    const readJson = (r, what) => {
      const text = typeof r?.text === "string" ? r.text : "";
      if (r?.isError || text.startsWith("ERROR")) return { err: text.slice(0, 300) || `provider error on the ${what}` };
      try { return { doc: JSON.parse(text) }; }
      catch { return { err: `unparseable ${what} response on the record listing` }; }
    };
    let ids, total;
    try {
      const { doc, err } = readJson(await doSearch(process.env.CLARIVATE_API_KEY, base,
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) }, tctx), "search");
      if (err) return { ok: false, records: null, reason: err };
      if (!Array.isArray(doc?.results))
        return { ok: false, records: null, reason: "the search response carried no results[], so nothing was listed — which is not the same as no filings" };
      // NULL, never the id count: the same rule the rest of this lane runs on.
      total = Number.isFinite(doc?.total_hits) ? doc.total_hits : null;
      const want = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : doc.results.length;
      ids = doc.results.map((row) => row?.record_id).filter((u) => typeof u === "string" && u).slice(0, want);
    } catch (e) { return { ok: false, records: null, reason: `record listing threw: ${e.message}` }; }
    // Nothing to hydrate is a real, answered zero — and it keeps the screen call unmade.
    if (!ids.length) return { ok: true, records: [], total };
    try {
      const { doc, err } = readJson(await doBatchScreen(process.env.CLARIVATE_API_KEY, base, { uris: ids }, tctx), "screen");
      if (err) return { ok: false, records: null, reason: err };
      if (!Array.isArray(doc?.rows))
        return { ok: false, records: null, reason: "the screen response carried no rows[], so nothing was listed — which is not the same as no filings" };
      // A PARTIAL HYDRATE IS NOT A LISTING. doBatchScreen only hard-errors when EVERY chunk failed;
      // one failed chunk among several comes back as rows plus a populated `errors`, and returning
      // those rows would present a short list as the whole answer — the same lie the count lane
      // refuses when it declines to sum a partial variant sweep. Fewer rows than ids with NO errors is
      // a different thing (an id the register no longer resolves) and rides through as a real result.
      if (Array.isArray(doc.errors) && doc.errors.length)
        return { ok: false, records: null, reason: `the hydrate failed on ${doc.errors.length} of ${Math.ceil(ids.length / 100)} batch(es), so this listing would be short without saying so: ${String(doc.errors[0]).slice(0, 200)}` };
      return { ok: true, total, records: doc.rows.map((row) => ({
        record_id: row?.uri ?? null,
        mark_text: row?.mark_text ?? null,
        // The screen row names this `owner`; the neutral record reads `owner_name`. Mapped here so the
        // seam is in one place rather than as a second spelling inside register-records.mjs.
        owner_name: row?.owner ?? null,
        owner_country: row?.owner_country ?? null,
        status: row?.status ?? null,
        classes: Array.isArray(row?.classes) ? row.classes : null,
        office: row?.office ?? null,
        application_date: row?.application_date ?? null,
        registration_date: row?.registration_date ?? null,
        // The office's own numbers: publish addresses the filing at the office's page from these, the
        // way it does for this register's clearance findings. Compumark states no filing route or IR
        // number of its own, so a Madrid designation is addressed as the national filing it is listed as.
        application_number: row?.application_number ?? null,
        registration_number: row?.registration_number ?? null,
        // hasPublicRecordUrl:false on this provider — there is no per-record page to link, and a
        // fabricated one would be worse than none.
        record_url: null,
      })) };
    } catch (e) { return { ok: false, records: null, reason: `record hydrate threw: ${e.message}` }; }
  },
  // The repair-first plan-direct-execute lane, same contract as corsearch's (see above). Without it
  // Clarivate would silently fall back to the LLM followup at the fan-in gate — a model turn doing
  // what code can do deterministically, which is the transcription lane this whole design closes.
  // Signature note: the clarivate core takes (apiKey, base, params, tctx), not corsearch's
  // (sessionKey, params, tctx) — the base is threaded explicitly here.
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    if (!process.env.CLARIVATE_API_KEY) return { ok: false, cause: "CLARIVATE_API_KEY absent from driver env" };
    let doExecutePlan, DEFAULT_BASE;
    try { ({ doExecutePlan, DEFAULT_BASE } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
    try {
      const r = await doExecutePlan(process.env.CLARIVATE_API_KEY, base,
        { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
        { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog, ...(reaskTimedOut ? { reaskTimedOut: true } : {}) });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
      try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
      catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
    } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
  },
};
