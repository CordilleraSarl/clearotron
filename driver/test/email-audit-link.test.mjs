// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The "Download audit (Excel)" link in a delivery email has to be a URL the deployment actually serves.
//
// It was not. It was built by swapping the filename on the report URL — `<pool>/<runId>/<runId>-audit.xlsx`
// — which addressed the ARCHIVE DIRECTORY, where the two files really do sit side by side. The SERVED SITE
// stopped being that directory at the 2026-07-20 portal cutover, which kept exactly one legacy path alive:
//
//     path_regexp ^/([A-Za-z0-9][A-Za-z0-9._-]{0,180})/report\.html$   →  /portal/report/<runId>
//
// `report.html`, and nothing else. Every workbook URL fell through to the host's `respond "Not found" 404`.
// Every audit link we have ever emailed was dead, and nothing said so: an unreported 404 looks exactly like
// a link nobody clicked.
//
// These tests pin the SHAPE of the link against the edge's routing, because the failure was never in the
// composition — the old link was a perfectly well-formed URL — but in where it pointed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditUrlFor, auditRouteFor, markReportRouteFor, composeEmailBody, composeEmailHtml } from "../publish/index.mjs";
// The two live handlers on the delivery host, transcribed from the Caddyfile. A link is "reachable" only
// if one of them claims it; anything else meets `handle { respond "Not found" 404 }`. Moved to its own
// leaf when the knockout lane needed the same predicate — two transcriptions of one Caddyfile is
// the defect this file is about, one level up.
import { servedByEdge } from "./edge-routes.mjs";

process.env.CLEAROTRON_ACCESS_DOMAIN ||= "acme.test";

const RUN = "noref000002-aquaplus-2026-07-19-copper-gantry";
const POOL = "https://trademark.example.com";
const REPORT_URL = `${POOL}/${RUN}/report.html`;
const AUDIT_FILE = `${RUN}-audit.xlsx`;

test("THE AUDIT LINK IS A URL THE EDGE ROUTES — this is the whole defect", () => {
  const url = auditUrlFor(REPORT_URL, AUDIT_FILE);
  assert.equal(url, `${POOL}/portal/report/${RUN}/audit.xlsx`);
  assert.ok(servedByEdge(url), "some handler claims it");
  // And the shape that shipped, stated explicitly so nobody reintroduces it as a "simplification".
  assert.ok(!servedByEdge(`${POOL}/${RUN}/${AUDIT_FILE}`), "the old archive-path link reached no handler at all");
});

test("it rides the SAME origin as the report link, so the two can never name different deployments", () => {
  // Derived from the report URL rather than from config for exactly this reason: one source, one host.
  assert.equal(new URL(auditUrlFor(REPORT_URL, AUDIT_FILE)).origin, new URL(REPORT_URL).origin);
  const staging = auditUrlFor(`https://staging.example.com/${RUN}/report.html`, AUDIT_FILE);
  assert.ok(staging.startsWith("https://staging.example.com/portal/"));
});

test("the run id in the link is the run id in the report link", () => {
  // The route resolves the FILENAME from that run's meta.json, so this segment is the only thing carrying
  // identity. A mismatch would ownership-check one run and serve another's name.
  assert.match(auditUrlFor(REPORT_URL, AUDIT_FILE), new RegExp(`/portal/report/${RUN}/audit\\.xlsx$`));
});

test("`audit.xlsx` is the ROUTE, not the file — the run's real filename still arrives at the browser", () => {
  // The literal name here is deliberate and must not be "corrected" to the run's own filename: the portal
  // route matches on `audit.xlsx` exactly, reads meta.auditFile, and sends it as the download filename.
  const url = auditUrlFor(REPORT_URL, "totally-different-name.xlsx");
  assert.ok(url.endsWith("/audit.xlsx"), "the route literal, whatever the file is called on disk");
});

test("no link at all rather than a broken one, when there is nothing to point at", () => {
  // Same posture as the access note's unset domain: silence beats a confidently wrong instruction.
  assert.equal(auditUrlFor(REPORT_URL, null), null);
  assert.equal(auditUrlFor(REPORT_URL, ""), null);
  assert.equal(auditUrlFor(null, AUDIT_FILE), null, "no poolUrl configured ⇒ no report link ⇒ no audit link");
  for (const weird of ["https://x/report.html", "https://x/deep/path/report.htm", "not a url", `${POOL}/${RUN}/`])
    assert.equal(auditUrlFor(weird, AUDIT_FILE), null, `${weird} is not a report URL we can derive from`);
});

test("whatever goes in, the link that comes out addresses ONE run under /portal/report/", () => {
  // The id reaches this function from the run, not from a request — but "ours" is not "safe to concatenate",
  // so the property worth pinning is about the OUTPUT, not the input. Two mechanisms give it: the URL parser
  // resolves `..` before the pattern ever sees it (so a traversal collapses to a plain segment, which then
  // simply 404s at the route — there is no run called "etc"), and the pattern admits no separator at all.
  // Either way nothing can climb out of the route's own namespace.
  for (const odd of ["../../etc", "a/b", "..", "with space", "%2e%2e", "x?y", "x#y"]) {
    const url = auditUrlFor(`${POOL}/${odd}/report.html`, AUDIT_FILE);
    if (url === null) continue;                       // refused outright — also fine
    const path = new URL(url).pathname;
    assert.match(path, /^\/portal\/report\/[A-Za-z0-9][A-Za-z0-9._-]*\/audit\.xlsx$/, `${odd} → ${path}`);
    assert.ok(!path.includes(".."), `${odd} left no traversal in the path`);
  }
});

// ── the knockout lane's two addresses ─────────────────────────────────────────────────────────
//
// The same defect, found twice more: the knockout audit link (live on every knockout ever delivered)
// and 's per-mark report links (never delivered to a client — prod does not carry the fan-out yet).
// Both were composed by naming a file in the pool directory. Both were well-formed. Neither was served.

test("the workbook route is composable WITHOUT a report URL — a batch has none, and that is the bug's home", () => {
  // auditUrlFor derives from the report link so the two can never name different deployments. A batch
  // publishes no run-level report, so `url` is null by design and the derivation yields null for
  // exactly the runs that still have a workbook. Hence the origin+id form.
  const url = auditRouteFor(POOL, RUN);
  assert.equal(url, `${POOL}/portal/report/${RUN}/audit.xlsx`);
  assert.ok(servedByEdge(url), "some handler claims it");
  assert.equal(url, auditUrlFor(REPORT_URL, AUDIT_FILE), "same answer as the derived form, so there is one address");
});

test("one mark's document in a batch is addressed by SLUG at the portal, never by filename in the pool", () => {
  const url = markReportRouteFor(POOL, RUN, "cinder-lantern");
  assert.equal(url, `${POOL}/portal/report/${RUN}/cinder-lantern/`);
  assert.ok(servedByEdge(url), "some handler claims it");
  // And the shape that shipped, stated explicitly so nobody reintroduces it as a "simplification".
  assert.ok(!servedByEdge(`${POOL}/${RUN}/report-cinder-lantern.html`),
    "the pool-path link reached no handler at all — the legacy rewrite is spelled report.html and admits no other filename");
  assert.ok(!servedByEdge(`${POOL}/${RUN}/${AUDIT_FILE}`), "nor did the pool-path workbook link");
});

test("no link at all rather than a broken one, for both route composers", () => {
  for (const bad of [null, "", "a/b", "../etc", "with space", ".."]) {
    assert.equal(auditRouteFor(POOL, bad), null, `auditRouteFor rejects ${JSON.stringify(bad)}`);
    assert.equal(markReportRouteFor(POOL, bad, "slug"), null, `markReportRouteFor rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(auditRouteFor(null, RUN), null, "no pool URL configured ⇒ no link");
  assert.equal(markReportRouteFor(null, RUN, "slug"), null);
  assert.equal(markReportRouteFor(POOL, RUN, null), null, "no slug ⇒ no per-mark address");
});

test("a slug the portal could not match is refused, never percent-encoded into a link that 404s", () => {
  // portal-service matches the RAW segment off path.split("/") and never decodes it, so encoding a slug
  // would produce a link that cannot match the run's own list — the same silent defect as, one
  // level down. kebab() emits [a-z0-9-] and nothing else, so nothing legitimate is refused here today.
  for (const bad of ["Coral Freeze", "coral/freeze", "coral%2ffreeze", "CORAL-FREEZE", "-leading", "色度", ".."]) {
    assert.equal(markReportRouteFor(POOL, RUN, bad), null, `slug ${JSON.stringify(bad)} is refused, not encoded`);
  }
  for (const good of ["coral-freeze", "cinder-lantern", "mark", "a1"]) {
    const url = markReportRouteFor(POOL, RUN, good);
    assert.equal(url, `${POOL}/portal/report/${RUN}/${good}/`, "and a kebab slug rides through untouched");
    assert.ok(servedByEdge(url));
  }
});

test("a trailing slash on the configured pool URL cannot double up in the path", () => {
  // CLEAROTRON_REPORTS_URL is operator-set and has carried a trailing slash before.
  assert.equal(auditRouteFor(`${POOL}/`, RUN), `${POOL}/portal/report/${RUN}/audit.xlsx`);
  assert.equal(markReportRouteFor(`${POOL}/`, RUN, "coral-freeze"), `${POOL}/portal/report/${RUN}/coral-freeze/`);
});

// ── and the two surfaces that carry it ───────────────────────────────────────────────────────────────

const REPORT_MD = [
  "---", "type: prelim-clearance", "matter: TMP8552", "title: Satin & Steel",
  "client: ACME", "classes: 9", "overall_label: MEDIUM", "overall_badge: l3",
  "---", "", "# Summary", "One conflict matters.", "", "# Marks", "## SATIN & BRONZE — US", "- tier: 3", "", "# Coverage", "text",
].join("\n");
const CLIENT_SUMMARY = [
  "# Header", "- name: Satin & Steel", "", "# Executive Summary",
  "- summary: One conflict matters.", "- recommendation: Confirm the US position.",
].join("\n");

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "auditlink-"));
  const r = join(dir, "report.md");
  const c = join(dir, "client-summary.md");
  writeFileSync(r, REPORT_MD);
  writeFileSync(c, CLIENT_SUMMARY);
  return { r, c };
};

test("BOTH email variants carry the working link — the markdown one and the table one", () => {
  const { r, c } = fixture();
  const want = `${POOL}/portal/report/${RUN}/audit.xlsx`;

  const md = composeEmailBody(r, REPORT_URL, AUDIT_FILE);
  assert.ok(md.includes(want), "markdown notification");
  assert.ok(!md.includes(`/${RUN}/${AUDIT_FILE}`), "and not the dead archive path");

  const html = composeEmailHtml(r, REPORT_URL, AUDIT_FILE, ["Satin & Steel"], { email: "table", privileged: true });
  assert.ok(html.includes(want), "table cover note");
  assert.ok(!html.includes(`/${RUN}/${AUDIT_FILE}`), "and not the dead archive path");
});

test("a run with no workbook offers no Excel link on either surface", () => {
  const { r, c } = fixture();
  const md = composeEmailBody(r, REPORT_URL, null);
  assert.ok(!/audit/i.test(md.split("\n").find((l) => l.includes("Open the full report")) ?? ""));
  const html = composeEmailHtml(r, REPORT_URL, null, ["Satin & Steel"], { email: "table", privileged: true });
  assert.ok(!/Download audit/.test(html));
});
