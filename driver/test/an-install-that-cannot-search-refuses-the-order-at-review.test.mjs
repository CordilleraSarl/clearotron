// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INSTALL THAT CANNOT RUN A SEARCH REFUSES THE ORDER AT REVIEW, AND NOTHING IS QUEUED.
//
// Found in a stranger install: with no AI and no register chosen, the portal showed "Start search", then said
// "Clearance queued", and the runner refused the order at intake with only its terminal watching. The order
// then vanished from every page. The portal now asks the runner's own question (`orderTimeRefusal`, of the
// tables in order-tables.mjs) at the review and again at the start, and answers with the runner's own client
// sentence. These arms drive the real question with an environment that holds neither setting. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePortalService } from "../portal-service.mjs";
import { orderTimeRefusal } from "../run-requirements.mjs";
import { runTables } from "../order-tables.mjs";

const GRANTS = { tenants: { celta: { accounts: ["generic"], users: {} } },
  people: { "staff@example-firm.com": { run: true, manage: true, everything: true } } };
const PRINCIPAL = { email: "staff@example-firm.com" };
const ORDER = { account: "generic", markName: "QUILLBRAE", classes: [9], product: "global-preliminary-search", geography: { mode: "worldwide" } };
// The runner's question, asked of an install that has chosen neither an AI nor a register.
const UNCONFIGURED = async () => orderTimeRefusal({}, await runTables());

function service({ demo = false, orderRefusal = UNCONFIGURED } = {}) {
  const queued = [], audited = [];
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, demo, orderRefusal, audit: (row) => audited.push(row),
    trigger: async (job) => { queued.push(job); return { ok: true, id: job.id }; } });
  return { svc, queued, audited };
}

test("the runner's own question refuses an install with no AI and no register, in the client's words", async () => {
  const refusal = await UNCONFIGURED();
  assert.ok(refusal, "the control: an install with neither setting is one the runner refuses");
  for (const name of ["CLEAROTRON_AI", "CLEAROTRON_DATABASE"]) assert.ok(refusal.names.includes(name), `the refusal does not name ${name}: ${refusal.names}`);
  assert.doesNotMatch(refusal.client, /CLEAROTRON_|queued/i, "the client sentence names no setting and promises no queue");
});

test("the review refuses before it mints a ticket, and the start refuses before anything is queued", async () => {
  const { svc, queued, audited } = service();
  const { client } = await UNCONFIGURED();
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER);
  assert.equal(plan.status, 409);
  assert.deepEqual(plan.json.errors, [client]);
  assert.equal(plan.json.code, "not_configured", "the screen cannot tell this refusal from an edited review without its code");
  assert.equal(plan.json.confirmationToken, undefined, "a refused review hands out no ticket to start with");
  // A start with a ticket minted while the install could search is asked again, because the install may have
  // changed since: the ticket is necessary, never sufficient.
  const { svc: before } = service({ orderRefusal: async () => null });
  const ticket = (await before.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER)).json.confirmationToken;
  assert.ok(ticket, "the control: a configured install's review mints a ticket");
  const run = await svc.route("POST", "/portal/api/run", PRINCIPAL, { ...ORDER, confirmationToken: ticket });
  assert.equal(run.status, 409);
  assert.deepEqual(run.json.errors, [client]);
  assert.equal(queued.length, 0, "an order the runner would refuse reached the queue");
  // THE OPERATOR'S RECORD: one audit row per door, naming what is missing. The order doors are not admin writes, so
  // nothing else files a row for them.
  const rows = audited.filter((r) => r.refused === "not_configured");
  assert.deepEqual(rows.map((r) => r.event), ["plan", "trigger"]);
  for (const r of rows) assert.ok(r.missing.includes("CLEAROTRON_AI") && r.missing.includes("CLEAROTRON_DATABASE"), JSON.stringify(r));
  for (const r of [plan, run]) assert.doesNotMatch(JSON.stringify(r.json), /queued/i, "a refused order was told it was queued");
});

test("the screen heads this refusal as a search that did not start, not as a changed request", () => {
  // The screen's logic is reachable only by its source (portal-ui/test has no renderer). The heading is the shipped
  // one for a search that did not start; the client keeps the runner's sentence for this code (portal-ui/test/api.test.ts).
  const screen = readFileSync(new URL("../../portal-ui/src/screens/NewClearance.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(r\.detail\?\.code === 'not_configured'\) return \{ title: 'The search was not started', lines: \[r\.message\] \}/,
    "the not-configured refusal no longer has its own heading on the New clearance screen");
});

test("a demo walks its own ordering flow and is not asked", async () => {
  const { svc } = service({ demo: true });
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER);
  assert.notEqual(plan.status, 409, `a demo's review was refused as an unconfigured install: ${JSON.stringify(plan.json)}`);
});

test("the portal and the runner read one set of order tables, and the running portal asks the runner's question", async () => {
  const { runTables: runnerTables } = await import("../runner.mjs");
  assert.equal(runnerTables, runTables, "the runner's intake wall reads a different tables loader from the portal's");
  const src = readFileSync(new URL("../portal-service.mjs", import.meta.url), "utf8");
  assert.match(src, /orderRefusal: async \(\) => orderTimeRefusal\(process\.env, await runTables\(\)\)/,
    "the bootstrap no longer hands the running portal the runner's order-time question");
});
