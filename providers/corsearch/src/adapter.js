// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The corsearch register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.
import { recordsFromSearch } from "../../_shared/records-from-search.mjs";

export const adapter = {
  id: "corsearch",
  label: "Corsearch",
  credEnv: "CORSEARCH_SESSION_KEY",
  skillDoc: "skills/clearance-register/providers/corsearch.md",
  hasPublicRecordUrl: true,
  // WP-receipts W2: the public per-record origin (publicRecordOrigin + /mark/<jur>/<id> is a working
  // link) — replaces the fragile resolved-link-origin inference at render for receipt-carrying runs.
  publicRecordOrigin: "https://tm.corsearch.com",
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, cause: "CORSEARCH_SESSION_KEY absent from driver env" };
    let doRecordFetch;
    try { ({ doRecordFetch } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doRecordFetch(process.env.CORSEARCH_SESSION_KEY,
        { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // Depth 2 (knockout-register): "how many filings match this name?" and nothing else. Same lazy
  // import + credential guard as recordFetch above; the counting itself is the shared kernel
  // (providers/_shared/count.mjs), so every provider answers in one shape. ONE BILLABLE SEARCH per
  // call on this provider (the count rides page 0 — capabilities.countProbe "cheap").
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, total: null, reason: "CORSEARCH_SESSION_KEY absent from driver env" };
    let doCountHits;
    try { ({ doCountHits } = await import("./core.js")); }
    catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
    try {
      return await doCountHits(process.env.CORSEARCH_SESSION_KEY,
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
        { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
    } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
  },
  // part 5 — the FILINGS behind the narrow counts. A SECOND billable search per term, and it
  // cannot be folded into the count above: that call rides `cheapCountParams` (`limit:1,
  // fields:["uri"]`, the smallest response the API gives) and makeEnumerate builds the same probe, so
  // widening it to carry rows would change what every enumerate call fetches. The listing pays its
  // own way and the receipts ledger stamps `stage:"records"` on it so the two are told apart.
  async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, records: null, reason: "CORSEARCH_SESSION_KEY absent from driver env" };
    let doSearch;
    try { ({ doSearch } = await import("./core.js")); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    return recordsFromSearch(
      (p, t) => doSearch(process.env.CORSEARCH_SESSION_KEY, p, t),
      { origin: "https://tm.corsearch.com" },
    )({ name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), limit },
      { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
  },
  // Repair-first (2026-07-05): the fan-in plan-direct-execute repair. Re-runs ONLY the dictated qids
  // that own no band block, as pure code at the gate (no agent turn, no gateway lane) — the tool's
  // qid-ownership merge preserves every untargeted/judgment block, and the chunked doEnumerate under
  // it is the same executor the initial gather used. Corsearch-only today: providers without an
  // executePlan adapter fall back to the LLM followup at the gate. (Corsearch + Clarivate carry one
  // as of phase 5, 2026-07-21; Signa does not — it has no enumerate/execute surface yet.)
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    if (!process.env.CORSEARCH_SESSION_KEY) return { ok: false, cause: "CORSEARCH_SESSION_KEY absent from driver env" };
    let doExecutePlan;
    try { ({ doExecutePlan } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doExecutePlan(process.env.CORSEARCH_SESSION_KEY,
        { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
        { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog, ...(reaskTimedOut ? { reaskTimedOut: true } : {}) });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
      try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
      catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
    } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
  },
};
