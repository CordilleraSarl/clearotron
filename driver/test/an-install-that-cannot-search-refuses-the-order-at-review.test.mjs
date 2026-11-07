// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INSTALL THAT CANNOT RUN A SEARCH REFUSES THE ORDER AT REVIEW, AND NOTHING IS QUEUED.
//
// Found in a stranger install: with no AI and no register chosen, the portal showed "Start search", then said
// "Clearance queued", and the runner refused the order at intake with only its terminal watching. The order
// then vanished from every page. The portal now asks the runner's own question (`orderTimeRefusal`, of the
// tables in order-tables.mjs) at the review and again at the start. The person who runs the install is told
// what is missing and the command that sets it, in the owner's words; everyone else gets the runner's own client
// sentence. These arms drive the real question with an environment that holds neither setting. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePortalService } from "../portal-service.mjs";
import { orderTimeRefusal, whatIsMissing } from "../run-requirements.mjs";
import { runTables } from "../order-tables.mjs";

const GRANTS = { tenants: { celta: { accounts: ["generic", "zephyr"], users: { "cli@celta.example": ["zephyr"] } } },
  people: { "staff@example-firm.com": { run: true, manage: true, everything: true }, "cli@celta.example": { run: true } } };
const PRINCIPAL = { email: "staff@example-firm.com" };   // sees everything: the person who runs the install
const CLIENT = { email: "cli@celta.example" };            // runs searches for one company, and sees nothing else
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
  // The person who runs the install is told what is missing, in the owner's words, filled in.
  assert.equal(refusal.installer, "This install cannot run a search yet: no AI is chosen and no register is chosen. "
    + "Run `clearotron install` in a terminal to set it up. Nothing has been searched and nothing has been charged.");
  assert.doesNotMatch(refusal.installer, /CLEAROTRON_|queued/i, "the installer's sentence names a setting or promises a queue");
});

test("what is missing is said in the owner's phrases, one per kind, joined by \"and\"", () => {
  const rows = (...about) => about.map((a) => ({ about: a }));
  assert.equal(whatIsMissing(rows("register")), "no register is chosen");
  assert.equal(whatIsMissing(rows("credentials", "program", "payment")),
    "the register's credentials are missing and the AI's program is not installed and the AI's payment is not set up");
  // In the order the owner gave them, whatever order the rows arrive in, and each kind once.
  assert.equal(whatIsMissing(rows("register", "ai", "register")), "no AI is chosen and no register is chosen");
  // With no AI chosen, the program and payment rows are the default AI's, which nobody chose.
  assert.equal(whatIsMissing(rows("ai", "program", "payment")), "no AI is chosen");
  assert.equal(whatIsMissing(rows("store", "research")), "", "a row with no phrase is given one");
});

test("the review refuses before it mints a ticket, and the start refuses before anything is queued", async () => {
  const { svc, queued, audited } = service();
  const { installer } = await UNCONFIGURED();
  const plan = await svc.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER);
  assert.equal(plan.status, 409);
  assert.deepEqual(plan.json.errors, [installer], "the person who runs the install is not told what is missing");
  assert.equal(plan.json.code, "not_configured", "the screen cannot tell this refusal from an edited review without its code");
  assert.equal(plan.json.confirmationToken, undefined, "a refused review hands out no ticket to start with");
  // A start with a ticket minted while the install could search is asked again, because the install may have
  // changed since: the ticket is necessary, never sufficient.
  const { svc: before } = service({ orderRefusal: async () => null });
  const ticket = (await before.route("POST", "/portal/api/run/plan", PRINCIPAL, ORDER)).json.confirmationToken;
  assert.ok(ticket, "the control: a configured install's review mints a ticket");
  const run = await svc.route("POST", "/portal/api/run", PRINCIPAL, { ...ORDER, confirmationToken: ticket });
  assert.equal(run.status, 409);
  assert.deepEqual(run.json.errors, [installer]);
  assert.equal(queued.length, 0, "an order the runner would refuse reached the queue");
  // THE OPERATOR'S RECORD: one audit row per door, naming what is missing. The order doors are not admin writes, so
  // nothing else files a row for them.
  const rows = audited.filter((r) => r.refused === "not_configured");
  assert.deepEqual(rows.map((r) => r.event), ["plan", "trigger"]);
  for (const r of rows) assert.ok(r.missing.includes("CLEAROTRON_AI") && r.missing.includes("CLEAROTRON_DATABASE"), JSON.stringify(r));
  for (const r of [plan, run]) assert.doesNotMatch(JSON.stringify(r.json), /queued/i, "a refused order was told it was queued");
});

test("everyone but the person who runs the install keeps the client sentence, which names nothing to set", async () => {
  const { svc, queued } = service();
  const { client } = await UNCONFIGURED();
  const plan = await svc.route("POST", "/portal/api/run/plan", CLIENT, { ...ORDER, account: "zephyr" });
  assert.equal(plan.status, 409, JSON.stringify(plan.json));
  assert.deepEqual(plan.json.errors, [client]);
  assert.doesNotMatch(JSON.stringify(plan.json), /clearotron install|no AI is chosen|no register is chosen/,
    "a client was shown what is missing on an install they do not run");
  assert.equal(queued.length, 0);
});

test("the screen heads this refusal as a search that did not start, not as a changed request", () => {
  // The screen's logic is reachable only by its source (portal-ui/test has no renderer). The heading is the shipped
  // one for a search that did not start; the client keeps the runner's sentence for this code (portal-ui/test/api.test.ts).
  const screen = readFileSync(new URL("../../portal-ui/src/screens/NewClearance.tsx", import.meta.url), "utf8");
  assert.match(screen, /if \(r\.detail\?\.code === 'not_configured'\) return \{ title: 'The search was not started', lines: \[r\.message\] \}/,
    "the not-configured refusal no longer has its own heading on the New clearance screen");
});

test("/me says the install cannot search, so Home leaves out its invite to start one", async () => {
  const meOf = async (opts, who = PRINCIPAL) => (await service(opts).svc.route("GET", "/portal/api/me", who, {})).json;
  const me = async (opts) => (await meOf(opts)).canSearch;
  assert.equal(await me({}), false, "an install the runner would refuse reads as able to search");
  assert.equal(await me({ orderRefusal: async () => null }), true, "the control: a configured install reads as able");
  assert.equal(await me({ demo: true }), true, "a demo walks its own ordering flow and reads as able");
  // And /me carries the refusal the review would give this person, so a screen can say it before anyone fills a
  // search in: what is missing for the person who runs the install, the client sentence for everyone else.
  const { installer, client } = await UNCONFIGURED();
  assert.equal((await meOf({})).searchRefusal, installer);
  assert.equal((await meOf({}, CLIENT)).searchRefusal, client);
  assert.equal((await meOf({ orderRefusal: async () => null })).searchRefusal, undefined, "a configured install carries a refusal");
  const home = readFileSync(new URL("../../portal-ui/src/screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /canRun\(ctx\.me\) && ctx\.me\.canSearch !== false \? ' Start one with New clearance\.' : ''/,
    "Home's invite no longer depends on whether the install can search");
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
  assert.match(src, /orderRefusal: async \(\) => portalOrderRefusal\(\{ tables: await runTables\(\) \}\)/,
    "the bootstrap no longer hands the running portal its own refusal path");
  assert.match(src, /env = process\.env, tables = \{\}[\s\S]{0,300}return orderTimeRefusal\(env, tables, \{\s*howFor: \(missing\) => howItRuns\(/,
    "the portal's refusal path no longer asks the runner's order-time question of the environment it runs with, and how it runs");
});

test("a terminal start says an order is refused until the install can search, and what it lacks", async () => {
  // `clearotron start` said "Ordering a clearance from the portal starts it" whatever the install held, so a reader
  // who had chosen nothing was told their order would start a run. It now asks the runner's question of the
  // environment its worker is handed, and says the owner's sentence with the portal's phrases.
  const { orderingLines } = await import("../../bin/start.mjs");
  const { missing } = await UNCONFIGURED();
  const said = orderingLines({ missing, install: "clearotron install", file: "/srv/op/.config/clearotron/.env" }).map((l) => l.trim()).join(" ");
  assert.equal(said, "Ordering a clearance from the portal is refused until this install can run a search: "
    + "no AI is chosen and no register is chosen. Run `clearotron install` in a terminal to set it up, then stop this command "
    + "with Ctrl-C and run it again: it reads the settings setup writes when it starts.");
  // CONTROL: an install that can search keeps today's words, which promise a priced run.
  assert.match(orderingLines({ missing: "" }).join(" "), /Ordering a clearance from the portal starts it\./);
  const src = readFileSync(new URL("../../bin/start.mjs", import.meta.url), "utf8");
  assert.match(src, /const cannot = missingRequirements\(childProcessEnv\(process\.env, envs\.worker\), await runTables\(\)\)\.atOrder;\n\s*for \(const line of orderingLines\(\{ missing: whatIsMissing\(cannot\), install: invoke\("install"\), doctor: invoke\("doctor"\), file: envFileRead\(\) \}\)\) say\(line\);/,
    "the terminal start no longer asks the runner's question of the worker's own environment");
});
