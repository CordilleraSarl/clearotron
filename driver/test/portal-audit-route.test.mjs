// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Serving the audit workbook.
//
// The workbook is part of the deliverable, and until this route existed it was unreachable from the
// portal: the report's own link points at the archive (relative, correct there, 404 here) and the embed
// strip removes it. A link stripped without being replaced is a feature that quietly stopped existing,
// which is how this was found — not by a test, but by someone asking where the Excel had gone.
//
// Two things are worth testing rather than assuming: that the bytes arrive intact (a Buffer through the
// JSON path becomes `{"type":"Buffer","data":[…]}`, which downloads as a corrupt file rather than
// failing), and that the route cannot be talked into serving anything else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePortalService } from "../portal-service.mjs";

const RUN = "noref000002-aquaplus-2026-07-19-copper-gantry";
// Real xlsx files are zips, so they start "PK". Using the real magic bytes means a test that passes
// cannot be passing on a placeholder that no spreadsheet application would open.
const XLSX = Buffer.from("PKfake-workbook-body", "latin1");

const poolWith = ({ auditFile = `${RUN}-audit.xlsx`, customerKey = "zephyr", writeFile = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "audit-pool-"));
  mkdirSync(join(root, RUN), { recursive: true });
  writeFileSync(join(root, RUN, "meta.json"), JSON.stringify({ runId: RUN, customerKey, auditFile }));
  writeFileSync(join(root, RUN, "report.html"), "<html><body>report</body></html>");
  if (writeFile && auditFile) writeFileSync(join(root, RUN, auditFile), XLSX);
  writeFileSync(join(root, RUN, "secret.txt"), "SHOULD-NEVER-BE-SERVED");
  return root;
};

const svcOn = (root) =>
  makePortalService({
    poolRoot: root, workspaceRoot: "/nonexistent", secret: "s",
    staffDomains: ["staff.example"],
    grants: () => ({ tenants: { zephyr: { accounts: ["zephyr"], users: { "c@zephyr.example": ["zephyr"] } } } }),
  });

const STAFF = { email: "k@staff.example" };
const CLIENT = { email: "c@zephyr.example" };
const get = (svc, path, who) => svc.route("GET", path, who);

test("THE WORKBOOK IS SERVED, byte for byte, as a spreadsheet", async () => {
  const r = await get(svcOn(poolWith()), `/portal/report/${RUN}/audit.xlsx`, STAFF);
  assert.equal(r.status, 200);
  assert.ok(Buffer.isBuffer(r.file.body), "a Buffer, not a JSON-encoded one");
  assert.deepEqual(r.file.body, XLSX, "not one byte changed on the way out");
  assert.equal(r.file.body.slice(0, 2).toString("latin1"), "PK", "still a zip, which is what an xlsx is");
  assert.match(r.file.contentType, /spreadsheetml\.sheet$/);
  assert.equal(r.file.filename, `${RUN}-audit.xlsx`);
});

test("it does not collide with the report route, which matches any deeper path", async () => {
  // The report branch is `parts.length >= 3`, so without an earlier branch this URL returns the report's
  // HTML under a spreadsheet's name — a download that opens as gibberish rather than an honest 404.
  const svc = svcOn(poolWith());
  const sheet = await get(svc, `/portal/report/${RUN}/audit.xlsx`, STAFF);
  const report = await get(svc, `/portal/report/${RUN}/`, STAFF);
  assert.ok(sheet.file && !sheet.html, "the workbook route wins for audit.xlsx");
  assert.ok(report.html && !report.file, "and the report route still answers everything else");
});

test("A CLIENT DOWNLOADS THEIR OWN WORKBOOK — role is no longer the gate, ownership is", async () => {
  // This route used to 404 a client on role alone, matching a renderer that kept the workbook out of the
  // client export. Both were retired by the owner on 2026-07-27 with the two-report split: one report for
  // everyone, and a reader who owns the run gets its workbook. Ownership is the only boundary left, and
  // the next two tests are what hold it.
  const svc = svcOn(poolWith());
  const own = await get(svc, `/portal/report/${RUN}/`, CLIENT);
  assert.equal(own.status, 200, "the client can read their own report");
  const r = await get(svc, `/portal/report/${RUN}/audit.xlsx`, CLIENT);
  assert.equal(r.status, 200, "and now the workbook that belongs to it");
  assert.deepEqual(r.file.body, XLSX, "the same bytes staff get — one deliverable, not a client cut");
});

test("`generic` stays staff-only even now — the house account is not a client's to read", async () => {
  // Widening by role must not widen the LEAK-#9 rule underneath it: an unbound run sits under `generic`,
  // which belongs to no customer, so no client owns it and none may take its working paper.
  const r = await get(svcOn(poolWith({ customerKey: "generic" })), `/portal/report/${RUN}/audit.xlsx`, CLIENT);
  assert.equal(r.status, 404);
  assert.ok(!r.file);
});

test("another customer's workbook is 404, never 403", async () => {
  const r = await get(svcOn(poolWith({ customerKey: "othercorp" })), `/portal/report/${RUN}/audit.xlsx`, CLIENT);
  assert.equal(r.status, 404);
});

test("THE FILENAME COMES FROM META, so no part of the served path is caller-controlled", async () => {
  // The URL supplies one segment — the run id — validated to be a directory name. Everything else is
  // read from that run's own metadata. This is the property that answers "a route serving archive files
  // by a path from the URL is the shape of the bypass that leaked reports".
  const svc = svcOn(poolWith());
  for (const bad of ["../../etc/passwd", "..", "a/b", ".", "%2e%2e"]) {
    const r = await get(svc, `/portal/report/${encodeURIComponent(bad)}/audit.xlsx`, STAFF);
    assert.equal(r.status, 404, `${bad} served nothing`);
  }
});

test("a meta naming something outside the run dir serves nothing", async () => {
  // meta.json is generated by us, and "generated by us" is not "safe to concatenate into a path". The
  // name is re-checked to be a plain .xlsx basename even though nothing should ever put anything else
  // there.
  for (const auditFile of ["../secret.txt", "secret.txt", "sub/dir.xlsx", "/etc/passwd", ".xlsx", ""]) {
    const r = await get(svcOn(poolWith({ auditFile, writeFile: false })), `/portal/report/${RUN}/audit.xlsx`, STAFF);
    assert.equal(r.status, 404, `${JSON.stringify(auditFile)} served nothing`);
    assert.ok(!JSON.stringify(r).includes("SHOULD-NEVER-BE-SERVED"));
  }
});

test("a run with no workbook 404s rather than serving an empty download", async () => {
  // Not every run has one: buildAudit can fail, and older runs predate it. An empty or missing file must
  // read as "there isn't one" rather than as a zero-byte spreadsheet.
  const missing = await get(svcOn(poolWith({ writeFile: false })), `/portal/report/${RUN}/audit.xlsx`, STAFF);
  assert.equal(missing.status, 404);
  const none = await get(svcOn(poolWith({ auditFile: null })), `/portal/report/${RUN}/audit.xlsx`, STAFF);
  assert.equal(none.status, 404);
});

test("only GET is mounted", async () => {
  const svc = svcOn(poolWith());
  for (const method of ["POST", "PUT", "DELETE"]) {
    const r = await svc.route(method, `/portal/report/${RUN}/audit.xlsx`, STAFF, {});
    assert.equal(r.status, 404, `${method} is not mounted`);
  }
});
