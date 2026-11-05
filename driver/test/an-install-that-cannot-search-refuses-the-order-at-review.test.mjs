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
  const queued = [];
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, demo, orderRefusal, audit: () => {},
    trigger: async (job) => { queued.push(job); return { ok: true, id: job.id }; } });
  return { svc, queued };
}

test("the runner's own question refuses an install with no AI and no register, in the client's words", async () => {
  const refusal = await UNCONFIGURED();
  assert.ok(refusal, "the control: an install with neither setting is one the runner refuses");
  for (const name of ["CLEAROTRON_AI", "CLEAROTRON_DATABASE"]) assert.ok(refusal.names.includes(name), `the refusal does not name ${name}: ${refusal.names}`);
  assert.doesNotMatch(refusal.client, /CLEAROTRON_|queued/i, "the client sentence names no setting and promises no queue");
});

test("the review refuses before it mints a ticket, and the start refuses before anything is queued", async () => {
  const { svc, queued } = service();
  const { client } = await UNCONFIGURED();
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER);
  assert.equal(plan.status, 409);
  assert.deepEqual(plan.json.errors, [client]);
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
  for (const r of [plan, run]) assert.doesNotMatch(JSON.stringify(r.json), /queued/i, "a refused order was told it was queued");
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
