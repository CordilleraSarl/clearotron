// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The free-tier register's driver-side adapter: what the driver itself asks this register, with no model in the path.
// `driver.config.mjs` lists it in PROVIDERS. The core is imported only when a call needs it.
import { recordsFromSearch } from "../../_shared/records-from-search.mjs";

// ──: the free tier — EUIPO + the local US index as ONE register ──────────────────────────────
//
// WHAT PREFLIGHT REQUIRES IS THE EU HALF, NOT BOTH HALVES.
//
// This list used to carry USPTO_LOCAL_DB, and the argument was that joinPlanToBands has three outcomes
// per qid — executed, missing, deferred — with no shape for "half of this ran", so a two-office slice
// whose US half is unconfigured would defer WHOLE and take its EU coverage with it. Refusing up front
// looked like the only honest answer.
//
// That invariant is real and is unchanged. What was wrong is where it was enforced. The two offices
// now part company at PLAN COMPILE (driver/register-availability.mjs → compileRegisterPlan), so every
// qid the executor sees is already single-office: every entry is EU-only, and nothing is ever
// half-run. With the split early, refusing the whole run buys nothing and costs the EU coverage the
// box genuinely has.
//
// CORRECTED 2026-08-11. This paragraph used to say "the US entry is a disclosed `deferred_coverage`
// row". THERE IS NO US ENTRY — the unreachable office produces no plan entry at all, which is exactly
// why every surviving qid is single-office. The distinction was not pedantic: nothing a reader sees
// was reading `deferred_coverage`, so the run shipped an EU-only clean with no row saying the US
// register was never searched, and this comment was the argument for dropping the variable from the
// list above. The disclosure now exists — coverage-form.mjs reads `plan.deferred_coverage` and emits
// an `open` row per active axis — so the reasoning below stands on something real. Before that it did
// not, and this list was right for the wrong reason.
//
// It also gated the wrong thing in practice. The US index is the one piece of this tier an operator
// cannot get in a minute — it is a 41.5 GB build over two bulk products, behind an account with ID.me
// identity verification, and it takes hours — so requiring it made the free tier unusable for exactly
// the person it exists for. That CODE was merged; the INDEX is what no box had, and that was enough
// to keep and from ever being exercised.
//
// The EU pair stays REQUIRED: a free tier with no configured member at all is not degraded, it is
// unconfigured, and it must refuse by name rather than produce a register layer with nothing in it.
// credEnvAlso is still what makes that a whole check — a single credEnv string cannot express a
// two-variable OAuth provider, and the half-check that reads credEnv alone is a known second site.
// The free tier's REQUIRED variables, in one place: the guards in this adapter and preflightCredentials
// must not drift apart on which ones matter.
//
// USPTO_LOCAL_DB left this list with and is deliberately not checked here. These guards front the
// driver-side record/count calls, and those route BY OFFICE — an EU record fetch on a box with no US
// index is a call the free tier can serve perfectly well, and refusing it because a variable the call
// never touches is unset would turn a disclosed US deferral into a run that also cannot cite its EU
// evidence. The US half's absence is stated once, at plan compile, as a deferred coverage row; a member
// that IS asked for and is not configured refuses inside its own core, naming its own variable.
function freeTierMissing(env = process.env) {
  return ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"]
    .filter((k) => !String(env[k] ?? "").trim());
}

export const adapter = {
  id: "free-tier",
  label: "Free tier (EUIPO + USPTO local index)",
  credEnv: "EUIPO_CLIENT_ID",
  credEnvAlso: ["EUIPO_CLIENT_SECRET"],
  skillDoc: "skills/clearance-register/providers/free-tier.md",
  hasPublicRecordUrl: true,
  // NULL, deliberately: the two members have DIFFERENT public origins (euipo.europa.eu and the USPTO),
  // so a single origin string here would stamp one office's host onto the other's citations. The
  // record-level link is built from the record itself; publish/index.mjs reads this only as a prefix
  // and treats null as "no prefix", which is the honest answer for a two-office register.
  publicRecordOrigin: null,
  // — WHICH HOSTS THIS PROVIDER MAY LEGITIMATELY PRODUCE. The record-URL gate reads origins
  // through recordOriginsFor(), and a composite's are its MEMBERS'. Keyed on the null above: a gate
  // that took `publicRecordOrigin` at face value here would resolve to an EMPTY allow-list and refuse
  // every free-tier delivery — every one of whose record links is legitimately a EUIPO or a USPTO one.
  composedOf: ["euipo", "uspto-local"],
  async recordFetch(uri, { agentId, sessionKey, recordLog = null }) {
    const missing = freeTierMissing();
    if (missing.length) return { ok: false, cause: `${missing.join(" + ")} absent from driver env` };
    let doRecordFetch;
    try { ({ doRecordFetch } = await import("./core.js")); }
    catch (e) { return { ok: false, cause: `plugin core unavailable: ${e.message}` }; }
    try {
      const r = await doRecordFetch(null, { record_id: uri },
        { kind: "record_fetch", agentId, sessionKey, sessionId: null, recordLog });
      const err = typeof r?.text === "string" && r.text.startsWith("ERROR") ? r.text : null;
      return err ? { ok: false, cause: err.slice(0, 140) } : { ok: true };
    } catch (e) { return { ok: false, cause: `fetch threw: ${e.message}` }; }
  },
  // countProbe "cheap" — the WEAKEST member's mode. EUIPO's total rides page 0 of an ordinary search,
  // so the composite pays that price even though the US index has a true count endpoint.
  async countHits({ name, matchMode, classes, regions }, { agentId, sessionKey, recordLog = null }) {
    const missing = freeTierMissing();
    if (missing.length) return { ok: false, total: null, reason: `${missing.join(" + ")} absent from driver env` };
    let doCountHits;
    try { ({ doCountHits } = await import("./core.js")); }
    catch (e) { return { ok: false, total: null, reason: `plugin core unavailable: ${e.message}` }; }
    try {
      return await doCountHits(null,
        { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}) },
        { kind: "count_hits", agentId, sessionKey, sessionId: null, recordLog });
    } catch (e) { return { ok: false, total: null, reason: `count threw: ${e.message}` }; }
  },
  // part 5. Free on both members. `size` AND `limit` ride together on purpose: this composite
  // fans out to EUIPO (which pages on `size`) and to the local US index (which pages on `limit`), and
  // its own doSearch hands each member the params it understands. Sending one knob would silently
  // give the other member its default page size — a listing capped somewhere nobody chose.
  async listRecords({ name, matchMode, classes, regions, limit }, { agentId, sessionKey, recordLog = null }) {
    const missing = freeTierMissing();
    if (missing.length) return { ok: false, records: null, reason: `${missing.join(" + ")} absent from driver env` };
    let doSearch;
    try { ({ doSearch } = await import("./core.js")); }
    catch (e) { return { ok: false, records: null, reason: `plugin core unavailable: ${e.message}` }; }
    return recordsFromSearch((p, t) => doSearch(null, p, t))(
      { name, match_mode: matchMode, nice_classes: classes ?? [], ...(regions?.length ? { regions } : {}), size: limit, limit, page: 0 },
      { kind: "record_list", agentId, sessionKey, sessionId: null, recordLog });
  },
  async executePlan({ planPath, axis, outputPath, qids }, { agentId, sessionKey, recordLog = null, reaskTimedOut = false }) {
    const missing = freeTierMissing();
    if (missing.length) return { ok: false, cause: `${missing.join(" + ")} absent from driver env` };
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
