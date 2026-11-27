// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CLEARANCES STAYS QUICK AS COMPLETED ORDERS ACCUMULATE.
//
// Opening Clearances lists the portal's accepted orders that have no run yet: those a worker is checking, and those
// refused before any run. The lookup runs synchronously in the portal process, so everyone on it waits while it works.
// It read every completed order's files and filtered the whole queue listing once per order: measured in review on
// 2026-11-27, 33 to 36 ms at 250 completed orders, 320 to 349 ms at 1,000, and 4.61 to 5.66 s at 4,000.
//
// Here a company's queue holds 4,000 delivered orders, two marker files each, beside an order being checked and an
// order refused before any run, and orders of another company and of a Generic organisation. The lookup answers the
// same rows it always did, each in its owner's visibility, and three timed reads after a warm-up each stay well under
// the bound. Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { preRunOrders, recordStart } from "../portal-orders.mjs";

const COMPLETED = 4000;
// Generous on purpose: the lookup this replaces took 4.6 s here, and what is left is one listing and two small reads.
// A slow runner has room; a lookup that reads every completed order again does not.
const BOUND_MS = 750;

const root = mkdtempSync(join(tmpdir(), "clearances-quick-"));
const workspaceRoot = join(root, "workspace"), qdir = join(workspaceRoot, "queue");
mkdirSync(qdir, { recursive: true });
const job = (reference, account, organisation = null) => JSON.stringify({ id: reference, profileKey: account,
  ...(organisation ? { tenant: organisation } : {}), markName: "VELLOQUIN", product: "global-preliminary-search", forwarder: "jordan" });
for (let i = 0; i < COMPLETED; i++) {
  const reference = `portal-2026-11-${String(i).padStart(5, "0")}`;
  writeFileSync(join(qdir, `${reference}.done`), job(reference, "demo-brand-owner"));
  writeFileSync(join(qdir, `${reference}.done.result`), JSON.stringify({ ok: true, runDir: join(root, "runs", reference) }));
  recordStart(workspaceRoot, { account: "demo-brand-owner", reference });
}
// The two rows the list exists for, in scope, and one of each kind out of it.
writeFileSync(join(qdir, "portal-checking-1.processing"), job("portal-checking-1", "demo-brand-owner"));
recordStart(workspaceRoot, { account: "demo-brand-owner", reference: "portal-checking-1" });
writeFileSync(join(qdir, "portal-refused-1.failed"), job("portal-refused-1", "demo-brand-owner"));
writeFileSync(join(qdir, "portal-refused-1.failed.reason"), "the runner's own words\nnotify: sent\n");
writeFileSync(join(qdir, "portal-refused-1.failed.kind"), "run-cap\n");
recordStart(workspaceRoot, { account: "demo-brand-owner", reference: "portal-refused-1" });
writeFileSync(join(qdir, "portal-other-1.processing"), job("portal-other-1", "zephyr"));
recordStart(workspaceRoot, { account: "zephyr", reference: "portal-other-1" });
writeFileSync(join(qdir, "portal-org-1.failed"), job("portal-org-1", "generic", "orgx"));
writeFileSync(join(qdir, "portal-org-1.failed.reason"), "x\n");
recordStart(workspaceRoot, { account: "generic", organisation: "orgx", reference: "portal-org-1" });

const company = { workspaceRoot, queueDirs: [qdir], scopes: [{ account: "demo-brand-owner" }] };
const rowsOf = (rows) => rows.map((r) => `${r.reference}:${r.state}:${r.reasonKind ?? "-"}`).sort();

test("the rows are the ones they always were, each in its owner's visibility", () => {
  assert.deepEqual(rowsOf(preRunOrders(company)), ["portal-checking-1:checking:-", "portal-refused-1:refused:run-cap"]);
  assert.deepEqual(rowsOf(preRunOrders({ workspaceRoot, queueDirs: [qdir], scopes: [{ account: "zephyr" }] })), ["portal-other-1:checking:-"]);
  assert.deepEqual(rowsOf(preRunOrders({ workspaceRoot, queueDirs: [qdir], scopes: [{ account: "generic", organisation: "orgx" }] })),
    ["portal-org-1:refused:other"]);
  assert.deepEqual(preRunOrders({ workspaceRoot, queueDirs: [qdir], scopes: [{ account: "generic", organisation: "orgy" }] }), [],
    "another Generic organisation sees nothing");
  assert.deepEqual(rowsOf(preRunOrders({ workspaceRoot, queueDirs: [qdir], everything: true })),
    ["portal-checking-1:checking:-", "portal-org-1:refused:other", "portal-other-1:checking:-", "portal-refused-1:refused:run-cap"]);
  const refused = preRunOrders(company).find((r) => r.state === "refused");
  assert.equal(refused.markName, "VELLOQUIN", "the refused order is read for its row");
  assert.ok(!JSON.stringify(refused).includes("runner's own words"), "never the runner's words");
});

test(`with ${COMPLETED} delivered orders, a company's lookup and a full-access lookup each stay under ${BOUND_MS} ms`, () => {
  for (const [label, args] of [["company", company], ["everything", { workspaceRoot, queueDirs: [qdir], everything: true }]]) {
    preRunOrders(args);   // warm-up, as the review measured
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const rows = preRunOrders(args);
      times.push(performance.now() - t0);
      assert.ok(rows.length >= 2, `${label}: the rows are still found`);
    }
    const worst = Math.max(...times);
    assert.ok(worst < BOUND_MS, `${label}: three reads took ${times.map((t) => `${t.toFixed(1)} ms`).join(", ")}; the bound is ${BOUND_MS} ms`);
  }
});
