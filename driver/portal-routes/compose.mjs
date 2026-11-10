// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/compose.mjs — reading a pasted brief into a draft search (/portal/api/compose/read). It spends nothing and
// queues nothing.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { browserCommand } from "../../shared/invocation.mjs";
import { assertPrincipal } from "../portal-access.mjs";

export async function composeRoutes({ audit, composeRead, readBudget, READ_OFF_NOTE }, { method, parts, principal, body }) {
  // /portal/api/compose/read — turn a pasted brief into a filled-in composer.
  //
  // THE ONE THING TO KEEP TRUE ABOUT THIS ROUTE: it is the only POST under /portal/api that is not
  // a step towards spending money. It mints no confirmation token, writes nothing, queues nothing
  // and returns a draft. If it ever grows a side effect, it stops being safe to leave un-gated
  // behind the composer's first click and belongs beside plan/run instead.
  if (parts[1] === "api" && parts[2] === "compose" && parts[3] === "read" && method === "POST") {
    // Door check only. The read touches no account data, so demanding an account here would be a
    // gate with nothing behind it — and a staff member composing for a client they have not yet
    // picked would be refused a form-filler for no reason.
    assertPrincipal(principal, { door: true });
    // `error` carries the SENTENCE, `code` the machine word — the convention every other route on
    // this service follows, and what portal-ui's decoder reads. A code in `error` reaches a client
    // screen as the literal word "read_failed".
    if (!composeRead) {
      return { status: 501, json: { code: "unavailable", error: READ_OFF_NOTE } };
    }
    if (readBudget && !readBudget.take(principal.email)) {
      return { status: 429, json: { code: "rate_limited", error: "That is a lot of reading in one hour — set this one up below." } };
    }
    let out;
    try {
      out = await composeRead(typeof body?.brief === "string" ? body.brief : "");
    } catch (e) {
      // A provider outage is not a portal fault and must not read as one. The composer shows the
      // sentence and keeps every field the user already typed — the brief is still in the box.
      audit({ event: "compose-read", by: principal.email, ok: false, error: String(e?.message ?? e) });
      // NOT "just now": a throw says nothing about whether it will pass, and that wording sent a reader
      // back to the button for a failure no retry fixes. It names the check instead.
      return { status: 502, json: { code: "read_failed",
        error: `The request could not be read: the reader failed. \`${browserCommand("doctor --probe-engine")}\` finds out why — set the search up below meanwhile.` } };
    }
    // Length, never content. A brief is client material — whose mark, for whose product, before
    // whose deadline — and an audit log is a different disclosure surface from a run store.
    audit({ event: "compose-read", by: principal.email, ok: out.ok === true,
      chars: String(body?.brief ?? "").length, ...(out.ok ? {} : { error: out.error }) });
    if (!out.ok) {
      // "engine" IS AN UPSTREAM FAULT AND KEEPS ITS 502. Before this the reader
      // built its own client and a provider outage THREW, landing in the catch above as a 502. Going
      // through the engine door made it a returned refusal instead — total rather than throwing — and
      // routing that to 422 would have told the user their brief was unprocessable when the engine
      // was simply unreachable. Same fault, same status as before; the reader changed, not the
      // meaning. `unreadable` and `shape` stay 422 beside it: those ARE answers, just untrustworthy
      // ones, and 422 is what this route has always said about them.
      if (out.error === "engine") {
        audit({ event: "compose-read", by: principal.email, ok: false, error: out.cause ?? "engine" });
        return { status: 502, json: { code: "read_failed", error: out.message } };
      }
      const status = out.error === "too_long" || out.error === "empty" ? 400 : 422;
      return { status, json: { code: out.error, error: out.message } };
    }
    return { status: 200, json: { read: out.read } };
  }
  return undefined;
}
