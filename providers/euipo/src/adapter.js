// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The euipo register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.
import { recordsFromSearch } from "../../_shared/records-from-search.mjs";

// ── EUIPO — the first FREE register provider ─────────────────────────────────────────────
// Everything above is a paid vendor with a global sweep. This one covers ONE office (the EU register:
// EUTMs plus international registrations designating the EU) and is free to query, which is what
// makes an open-source install possible at all.
//
// The auth object is a credential PAIR plus an environment, not a single key — hence the shape
// difference below. `environment` is load-bearing and not a preference: sandbox and production are
// separate deployments holding different corpora, and a sandbox cross-check must never be read as a
// live one. The core refuses an unknown value rather than falling back.
export const adapter = {
  id: "euipo",
  label: "EUIPO",
  credEnv: "EUIPO_CLIENT_ID",
  // The ONLY provider with more than one required variable. preflightCredentials checks the whole
  // list — without this, an instance holding the id and no secret passes preflight and dies on the
  // first token request, after model spend and reported as a provider fault.
  credEnvAlso: ["EUIPO_CLIENT_SECRET"],
  skillDoc: "skills/clearance-register/providers/euipo.md",
  hasPublicRecordUrl: true,
  publicRecordOrigin: "https://euipo.europa.eu",
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
      return { ok: false, cause: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
    }
    let doRecordFetch;
    try { ({ doRecordFetch } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doRecordFetch(null,   // null ⇒ the core reads the credential pair from env
        { record_id: uri }, { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // countProbe "cheap": the total rides page 0 of an ordinary search, so this is ONE call — free in
  // money terms, but it still spends the daily request allowance.
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
      return { ok: false, total: null, reason: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
    }
    let doCountHits;
    try { ({ doCountHits } = await import("./core.js")); }
    catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
    try {
      return await doCountHits(null,
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
        { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
    } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
  },
  // part 5. Free in money, one request against the daily allowance per term. The page knob is
  // `size`, not `limit` — this API has no `limit` at all, which is the exact trap the count kernel's
  // own header warns about, so the neutral cap is translated here rather than passed through.
  async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
    if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
      return { ok: false, records: null, reason: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
    }
    let doSearch;
    try { ({ doSearch } = await import("./core.js")); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    return recordsFromSearch((p, t) => doSearch(null, p, t))(
      { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), size: limit, page: 0 },
      { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
  },
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) {
      return { ok: false, cause: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET absent from driver env" };
    }
    let doExecutePlan;
    try { ({ doExecutePlan } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doExecutePlan(null,
        { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
        { kind: "execute_plan", agentId, sessionKey, sessionId: null, recordLog, ...(reaskTimedOut ? { reaskTimedOut: true } : {}) });
      const text = typeof r?.text === "string" ? r.text : "";
      return text.startsWith("ERROR") ? { ok: false, cause: text.slice(0, 200) } : { ok: true, summary: text.slice(0, 400) };
    } catch (e) { return { ok: false, cause: `executePlan threw: ${e.message}` }; }
  },
};
