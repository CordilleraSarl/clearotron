// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The link a delivery sends OPENS (tracker issue 289).
//
// THE DEFECT. The delivered URL was `<origin>/<runId>/report.html` — the pool's directory layout on disk
// pasted behind the public origin. That is where the documents sit; it is not an application route. It
// shipped on every delivered report, both products, on all three surfaces that quote the URL (the chat
// notice, the email's own "open the report" anchor, and the briefing tool's answer).
//
// It resolved only where an edge rewrite happened to claim it, and on production no such rewrite is in
// force: the emailed link, opened by the run's OWN owner, returned the portal application's own
// `{"error":"not_found"}`. The application answered, so nothing rewrote the path ahead of it.
//
// WHY THESE ARMS DRIVE THE ROUTER INSTEAD OF MATCHING THE STRING. The issue's own judging rule: "This
// defect exists because a URL was built and never fetched. An acceptance test that string-matches the URL
// reproduces the bug exactly." Every arm below composes the link the way a delivery composes it, then
// asks the REAL portal router to serve that link's pathname. A string assertion would have passed on the
// broken tree for the same reason review did.
//
// THE OLD SHAPE IS KEPT AS A CONTROL. An arm proving the new link opens says nothing about whether the
// old one was broken — and if the router happened to serve both, this whole change would be pointless.
// So the retired shape is driven through the same router in the same test, and must 404.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makePortalService } from "../portal-service.mjs";
import { reportRouteFor, auditRouteFor, auditUrlFor, markReportRouteFor } from "../publish/index.mjs";

const ORIGIN = "https://reports.example.test";
const RUN = "tmp1-ironwhisk-2026-09-07-amber-summit";
const OWNER = { email: "requester@tenant.example" };
const FOREIGN = { email: "other@rival.example" };   // granted, but to a DIFFERENT account

/** A pool holding one published, owned run — the shape a delivered report actually leaves behind. */
function world() {
  const poolRoot = mkdtempSync(join(tmpdir(), "link-pool-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "link-ws-"));
  const dir = join(poolRoot, RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    runId: RUN, account: "tenant", customerKey: "tenant", issued: "2026-09-07",
    auditFile: `${RUN}-audit.xlsx`,
  }));
  writeFileSync(join(dir, "report.html"), "<html><body>the report</body></html>");
  const service = makePortalService({
    poolRoot, workspaceRoot, secret: "s", staffDomains: [],
    grants: () => ({ tenants: {
      tenant: { accounts: ["tenant"], users: { "requester@tenant.example": ["tenant"] } },
      rival: { accounts: ["rival"], users: { "other@rival.example": ["rival"] } },
    } }),
    audit: () => {},
  });
  return { service, poolRoot };
}

/** Open a composed URL against the real router, exactly as a recipient's browser would ask for it. */
const open = async (service, url, who) => {
  const p = new URL(String(url)).pathname;
  return service.route("GET", p, who, {}, {});
};

// ── the link we send ─────────────────────────────────────────────────────────────────────────────────

test("289: the delivered report link OPENS for the run's owner", async () => {
  const { service } = world();
  const url = reportRouteFor(ORIGIN, RUN);
  assert.ok(url, "a link is composed at all");

  const r = await open(service, url, OWNER);
  assert.notEqual(r.status, 404,
    `the link we send must not 404 for the person we send it to — got ${r.status} for ${new URL(url).pathname}`);
});

// THE CONTROL. Without this, an arm showing the new link works cannot tell a fix from a no-op: if the
// router served both shapes, changing the link would achieve nothing and this file would still be green.
test("289 control: the RETIRED shape 404s at the application, which is why it had to change", async () => {
  const { service } = world();
  const legacy = `${ORIGIN}/${RUN}/report.html`;
  const r = await open(service, legacy, OWNER);
  assert.equal(r.status, 404,
    "the pool-path link is not an application route — this is the 404 the owner saw on production");
});

// Ownership is orthogonal to the shape and must stay enforced: fixing a link must not open a run to
// somebody who does not own it. This is the other half of why the reported 404 was ambiguous.
test("289: the new shape is still ownership-checked — a foreign account gets nothing", async () => {
  const { service } = world();
  const r = await open(service, reportRouteFor(ORIGIN, RUN), FOREIGN);
  // FOREIGN is a real, entitled user of ANOTHER account — not a stranger. A stranger is refused at the
  // authorisation layer with 403 and never reaches this route, so testing with one would measure the
  // wrong gate. The route's own documentation is "foreign = 404 (never 403)", and 404 is what a reader
  // must get: a 403 would confirm the run exists to somebody with no business knowing that.
  assert.equal(r.status, 404, "a foreign account must not reach another tenant's report through the new link");
});

// ── the composer, and the parser that reads it back ──────────────────────────────────────────────────

test("289: no origin configured ⇒ no link at all, on either product", () => {
  assert.equal(reportRouteFor(null, RUN), null, "an unset origin yields no link rather than a broken one");
  assert.equal(reportRouteFor("", RUN), null);
  assert.equal(reportRouteFor(ORIGIN, ""), null, "and a run id that is not a clean path segment yields none");
  assert.equal(reportRouteFor(ORIGIN, "../../etc"), null, "traversal is refused by the same gate the route uses");
});

// THE REPARSER, which is where this change could have broken the one link that always worked. The audit
// URL is DERIVED from the report URL by parsing the run id out of it. Change the report shape and forget
// the parser, and the workbook link silently becomes null on every delivery — the exact class of defect
// this issue is an instance of, reintroduced one field along.
test("289: the audit link still derives — from the new shape AND from an archived legacy one", () => {
  const fromNew = auditUrlFor(reportRouteFor(ORIGIN, RUN), `${RUN}-audit.xlsx`);
  assert.equal(fromNew, auditRouteFor(ORIGIN, RUN), "the workbook link survives the new report shape");
  assert.match(fromNew, /\/portal\/report\/.+\/audit\.xlsx$/);

  const fromLegacy = auditUrlFor(`${ORIGIN}/${RUN}/report.html`, `${RUN}-audit.xlsx`);
  assert.equal(fromLegacy, auditRouteFor(ORIGIN, RUN),
    "an archived run re-published from its stored legacy URL must not lose its audit link");

  assert.equal(auditUrlFor(`${ORIGIN}/nonsense`, `${RUN}-audit.xlsx`), null,
    "and anything that is not a report URL still yields null rather than a guess");
});

// The multi-name product already composed a portal route; this pins that it was not disturbed, since it
// is the reference for what a correct link looks like.
test("289: the per-name link was already correct and is unchanged", () => {
  // Shape only, deliberately. Opening this one needs a multi-document run in the pool, which is a
  // different fixture and a different product's publish path; what this pins is that the composer the
  // multi-name product already used — the reference for a correct link — was not disturbed by the change
  // to the single-document one.
  const url = markReportRouteFor(ORIGIN, RUN, "ironwhisk");
  assert.match(url, /\/portal\/report\/.+\/ironwhisk\/$/);
  assert.equal(markReportRouteFor(null, RUN, "ironwhisk"), null, "and it still yields no link with no origin");
});
