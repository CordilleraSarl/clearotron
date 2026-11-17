// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The signa register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.

export const adapter = {
  id: "signa",
  label: "Signa",
  credEnv: "SIGNA_API_KEY",
  skillDoc: "skills/clearance-register/providers/signa.md",
  hasPublicRecordUrl: false, // Signa exposes no per-record public URL — cite the office register
  //, ruling 2026-08-20 — no register UI exists to link to at all, so the card points at
  // the artifact that DOES carry the record: the audit workbook. Naming it is the whole of this
  // branch; constructing a per-record URL for a provider that publishes none would be a fabricated
  // citation on a legal deliverable, and the ruling forbids it in those words.
  recordCitation: "workbook",
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
    let doRecordFetch, DEFAULT_BASE;
    try { ({ doRecordFetch, DEFAULT_BASE } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.SIGNA_BASE_URL || DEFAULT_BASE;
    try {
      const r = await doRecordFetch(process.env.SIGNA_API_KEY, base,
        { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // ── the three adapters that make this a code-driven provider ─────────────────────────
  //
  // Until these existed signa declared `recordFetch` alone, `planExec` resolved to null, and a run
  // fell to the agent lane — a model asked to page a register by hand. Preflight refuses that
  // outright now, so signa was unrunnable end to end until this landed.
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
    let core;
    try { core = await import("./core.js"); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
    try {
      // THROUGH toSignaParams, not around it. `strategies: [matchMode]` is the same defect
      // fixed one layer down: `contains`, `starts_with` and `ends_with` are DETERMINISTIC
      // modes, not strategies, and the API rejects them in the strategies array. These wrappers
      // hand-built the vendor shape and so were untouched by that fix — the translator is the one
      // place that knows which mode rides which request shape, and every caller must go through it.
      // A MODE THIS PROVIDER CANNOT EXPRESS REFUSES THE CELL, rather than being answered by a
      // different predicate's number. The translator names it; this turns it into an honest unknown,
      // which the count kernel already treats as a disclosed gap. The alternative is what this
      // issue was: a narrower query answering under the wider query's label, invisibly.
      const signaParams = core.toSignaParams({ name, match_mode: matchMode || "exact", nice_classes: classes, regions });
      if (signaParams.unsupported_match_mode) {
        return { ok: false, total: null, unsupported: true,
          cause: `this register provider cannot express the "${signaParams.unsupported_match_mode}" match mode, so this count is UNKNOWN — it is not answered with a different predicate's number` };
      }
      const r = await core.doCountHits(process.env.SIGNA_API_KEY, base, signaParams,
        { kind: "count", agentId, sessionKey, sessionId: null, recordLog });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
      const p = JSON.parse(text);
      // The total is REAL now: `options.include_total` puts the register's own corpus total
      // on the search response, so this no longer has to answer `present` and nothing else. It is
      // still null whenever the vendor would only approximate it — and null there means UNKNOWN,
      // which is the whole reason the field may never be filled in with a figure from anywhere else.
      // `floor` rides beside `approximate` because the two are one fact: the register answered, and the
      // answer is "more than this". Without the number the disclosure is not usable — "approximate"
      // alone says no more than "unknown" does, which is the state this replaces.
      return { ok: true, total: Number.isFinite(p.total_hits) ? p.total_hits : null,
        approximate: p.total_approximate === true, floor: Number.isFinite(p.total_floor) ? p.total_floor : null,
        present: p.present === true, note: p.note };
    } catch (e) { return { ok: false, cause: `countHits threw: ${e.message}` }; }
  },
  // `reason`, not `cause`, on every refusal: the listing reads `reason` (register-records.mjs), so a
  // Signa search that failed reached the workbook as "the search did not run", its cause dropped.
  async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.SIGNA_API_KEY) return { ok: false, records: null, reason: "SIGNA_API_KEY absent from driver env" };
    let core;
    try { core = await import("./core.js"); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
    try {
      // The listing takes the same refusal as the count above, and for the same reason one level on:
      // a narrower search here returns FEWER records under the wider query's name, so the listing
      // would under-report and read as complete.
      const signaListParams = core.toSignaParams({ name, match_mode: matchMode || "exact", nice_classes: classes, regions });
      if (signaListParams.unsupported_match_mode) {
        return { ok: false, records: null,
          reason: `this register provider cannot express the "${signaListParams.unsupported_match_mode}" match mode, so this listing was not taken — it is not answered with a narrower search` };
      }
      const r = await core.doSearch(process.env.SIGNA_API_KEY, base,
        { ...signaListParams, limit },
        { kind: "search", agentId, sessionKey, sessionId: null, recordLog });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, records: null, reason: text.slice(0, 200) };
      const p = JSON.parse(text);
      // THE SEARCH ROW IS NOT THE LISTING'S RECORD. The row names the owner `owner`, the classes
      // `nice_classes` and the filing date `filing_date`; the listing reads `owner_name`, `classes` and
      // `application_date`. Handed over unmapped, every Signa filing reached the knockout with no owner,
      // no classes and no filing date. Mapped here, as clarivate's adapter above maps its screen row.
      //
      // The office's own numbers come off the full record Signa returns on search, through the
      // provider's own normaliser, so publish can address the office's page for each filing
      // (publish/office-record-links.mjs) instead of showing the handle.
      //
      // THE TOTAL RIDES THE SAME ANSWER and is carried, not dropped: `include_total` puts the register's
      // own count for this exact question on every search, so the listing of a term already holds the
      // figure the count lane would ask for separately. An approximation stays one: no number in
      // `total`, the floor beside it — the count lane's rule, unchanged.
      return { ok: true,
        total: Number.isFinite(p.total_hits) ? p.total_hits : null,
        ...(p.total_approximate === true ? { approximate: true, floor: Number.isFinite(p.total_floor) ? p.total_floor : null } : {}),
        // The register's own notes on this answer, carried whole as the clearance sweep carries them —
        // `expanded_fallback` among them, which says the total counts records rather than marks. The
        // knockout listing dropped them, so a knockout run could not show what a clearance run shows.
        ...(Array.isArray(p.warnings) && p.warnings.length ? { warnings: p.warnings } : {}),
        records: (Array.isArray(p.results) ? p.results : []).map((row) => {
        const rec = row?.raw && typeof row.raw === "object" ? core.normalizeRecord(row.raw, row.office || null) : null;
        return {
          record_id: row?.record_id ?? null,
          mark_text: row?.mark_text ?? null,
          owner_name: rec?.owner ?? row?.owner ?? null,
          owner_country: rec?.ownerCountry ?? null,
          status: row?.status ?? null,
          classes: Array.isArray(row?.nice_classes) ? row.nice_classes : null,
          office: row?.office || null,
          application_date: row?.filing_date ?? null,
          registration_date: row?.registration_date ?? null,
          application_number: rec?.applicationNumber ?? null,
          registration_number: rec?.registrationNumber ?? null,
          ir_number: rec?.irNumber ?? null,
          filing_route: rec?.filingRoute ?? null,
          // No page per record at Signa (hasPublicRecordUrl: false above), and none is made up here.
          record_url: null,
          // The office's own page as the register gives it, for publish to fall back on where it cannot
          // address the office's page from the numbers above (office-record-links.mjs).
          office_url: rec?.officeUrl ?? null,
        };
      }) };
    } catch (e) { return { ok: false, records: null, reason: `listRecords threw: ${e.message}` }; }
  },
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    if (!process.env.SIGNA_API_KEY) return { ok: false, cause: "SIGNA_API_KEY absent from driver env" };
    let core;
    try { core = await import("./core.js"); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    const base = process.env.SIGNA_BASE_URL || core.DEFAULT_BASE;
    try {
      const r = await core.doExecutePlan({ apiKey: process.env.SIGNA_API_KEY, base },
        { plan_path: planPath, axis, output_path: outputPath, qids },
        { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog, ...(reaskTimedOut ? { reaskTimedOut: true } : {}) });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
      try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
      catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
    } catch (e) { return { ok: false, cause: `executePlan threw: ${e.message}` }; }
  },
};
