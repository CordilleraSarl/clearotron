// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The uspto-local register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.
import { recordsFromSearch } from "../../_shared/records-from-search.mjs";

export const adapter = {
  id: "uspto-local",
  label: "USPTO (local index)",
  credEnv: "USPTO_LOCAL_DB",
  skillDoc: "skills/clearance-register/providers/uspto-local.md",
  hasPublicRecordUrl: true,
  // TSDR publishes a page per serial, so a finding can cite an address the reader can open. The
  // record ref is /mark/us/<serial>, and the core builds the full statusSearch link on the record.
  publicRecordOrigin: "https://tsdr.uspto.gov",
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.USPTO_LOCAL_DB) return { ok: false, cause: "USPTO_LOCAL_DB absent from driver env" };
    let doRecordFetch;
    try { ({ doRecordFetch } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doRecordFetch({ dbPath: process.env.USPTO_LOCAL_DB },
        { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // Depth 2's count. A true count-only call — `SELECT count(*)` fetches no rows and works at any
  // magnitude — but see the freshness note above: this is also the seam where a stale index refuses.
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.USPTO_LOCAL_DB) return { ok: false, total: null, reason: "USPTO_LOCAL_DB absent from driver env" };
    let doCountHits;
    try { ({ doCountHits } = await import("./core.js")); }
    catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
    try {
      // `regions` is accepted and NOT forwarded: this source holds one office, and the plan resolved
      // its territorial scope against capabilities.offices.covered before ever reaching here — a
      // jurisdiction other than US is already a deferred gap upstream. Forwarding it would let a
      // caller believe it had narrowed a search that has nothing to narrow.
      return await doCountHits({ dbPath: process.env.USPTO_LOCAL_DB },
        { name, match_mode: matchMode, nice_classes: classes ?? [] },
        { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
    } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
  },
  // part 5. Free — a local SQLite read. `regions` is accepted and NOT forwarded for the same
  // reason the count above does not forward it: this source holds one office.
  async listRecords({ name, matchMode, classes, limit }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.USPTO_LOCAL_DB) return { ok: false, records: null, reason: "USPTO_LOCAL_DB absent from driver env" };
    let doSearch;
    try { ({ doSearch } = await import("./core.js")); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    return recordsFromSearch(
      (p, t) => doSearch({ dbPath: process.env.USPTO_LOCAL_DB }, p, t),
      { origin: "https://tsdr.uspto.gov" },
    )({ name, match_mode: matchMode, nice_classes: classes ?? [], limit },
      { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
  },
  // The repair-first plan-direct-execute lane. Without it this provider would fall back to the LLM
  // followup at the fan-in gate — a model turn doing what code does deterministically.
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    if (!process.env.USPTO_LOCAL_DB) return { ok: false, cause: "USPTO_LOCAL_DB absent from driver env" };
    let doExecutePlan;
    try { ({ doExecutePlan } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doExecutePlan({ dbPath: process.env.USPTO_LOCAL_DB },
        { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
        { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog, ...(reaskTimedOut ? { reaskTimedOut: true } : {}) });
      const text = typeof r?.text === "string" ? r.text : "";
      if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
      try { const summary = JSON.parse(text); return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] }; }
      catch { return { ok: false, cause: `unparseable execute_plan summary: ${text.slice(0, 120)}` }; }
    } catch (e) { return { ok: false, cause: `execute_plan threw: ${e.message}` }; }
  },
};
