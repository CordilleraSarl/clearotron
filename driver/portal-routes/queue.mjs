// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/queue.mjs — the queue an account sees: cancelling a queued search and reordering its own queued searches.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { assertPrincipal, seesEverything } from "../portal-access.mjs";
import { scanAccountRuns } from "../portal-runs.mjs";
import { reorderQueue } from "../queue-order.mjs";

export async function queueRoutes({ poolRoot, workspaceRoot, queueDirs, stopRun, audit }, { method, parts, principal, body, query }) {
  // /portal/api/queue/<id>/cancel — drop a job that has not started. No spend has happened, so
  // there is nothing to account for and no row is left behind.
  if (parts[1] === "api" && parts[2] === "queue" && parts[3] && parts[4] === "cancel" && method === "POST") {
    const account = assertPrincipal(principal, { account: query.account ?? null, tenant: query.tenant ?? null, run: true });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    const id = decodeURIComponent(parts[3]);
    const mine = scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() }).find((r) => r.runId === id && r.state === "queued");
    if (!mine) return { status: 404, json: { error: "not_found" } };
    let r = null;
    try {
      r = await stopRun({ id, onBehalfOf: principal.email });   // — same lane, same reason
    } catch (e) {
      const detail = String(e?.message ?? e);
      audit({ event: "queue-cancel", by: principal.email, account, id, ok: false, error: detail });
      return { status: 502, json: { ok: false, unwired: /not wired|verb|scope/i.test(detail),
        error: seesEverything(principal) ? detail : "It could not be cancelled just now. Nothing has been charged." } };
    }
    audit({ event: "queue-cancel", by: principal.email, account, id, ok: Boolean(r?.ok), action: r?.action ?? null });
    // ALREADY-CLAIMED IS A RACE, NOT AN ERROR. The runner picked it up between the click and the
    // request. Say so plainly and let the caller re-read the list, where it is now a running card —
    // never dress a lost race as a failure, and never pre-emptively disable the control to avoid it.
    if (r && r.ok === false && r.action === "already-claimed")
      return { status: 409, json: { ok: false, action: "already-claimed", id,
        error: "It started just before this reached us. It is running now — stop it from the card." } };
    return { status: 200, json: { ok: true, id, action: r?.action ?? null } };
  }

  // /portal/api/queue/order — the order queued jobs are admitted in.
  //
  // Written straight to the shared order file rather than through the MCP: reordering spends
  // nothing and starts nothing, so putting it behind an ops verb would widen that token's authority
  // for no gain. The tenancy wall is the same one every other route uses — the caller's resolved
  // account — applied per id.
  if (parts[1] === "api" && parts[2] === "queue" && parts[3] === "order" && method === "POST") {
    const account = assertPrincipal(principal, { account: query.account ?? null, tenant: query.tenant ?? null, run: true });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    const asked = Array.isArray(body?.order) ? body.order.filter((s) => typeof s === "string" && s) : null;
    if (!asked) return { status: 400, json: { error: "send { order: [id, …] }" } };
    // Only ids this caller actually holds, and only ones still queued. Anything else is dropped
    // SILENTLY rather than refused: a rejection that named the offending id would confirm that some
    // other tenant's job exists, which is the one thing every refusal here is shaped to avoid.
    const ownQueued = new Map(
      scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() })
        .filter((r) => r.state === "queued")
        .map((r) => [r.runId, r]),
    );
    const wanted = asked.filter((id) => ownQueued.has(id));
    const applied = reorderQueue({ workspaceRoot, order: wanted, allowed: new Set(ownQueued.keys()) });
    audit({ event: "queue-order", by: principal.email, account, ids: wanted.length, lanes: applied.lanes });
    return { status: 200, json: { ok: true, order: wanted, lanes: applied.lanes } };
  }
  return undefined;
}
