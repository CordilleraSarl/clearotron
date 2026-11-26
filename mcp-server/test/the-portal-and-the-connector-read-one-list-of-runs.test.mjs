// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PORTAL AND THE CONNECTOR READ ONE LIST OF RUNS, AND SAY THE SAME THING ABOUT EACH.
//
// Both faces project their rows from one walk (driver/portal-runs.mjs walkRuns). Over the four demos and a run in
// every state, this compares what each face says: which runs exist, in what state, at what step. A difference
// between the faces is either a projection one face owns (the portal folds three waits into "paused") or one of
// the differences named below, each asserted by name, so a new difference fails here rather than reaching a reader.
//
// An unclaimed order is listed by both faces to the company that placed it, and to nobody else.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "one-list-of-runs-"));
const POOL = join(ROOT, "pool");
mkdirSync(POOL, { recursive: true });
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", POOL);
// The connector reads the install's configured intake queue as well as the workspace's: pinned here, so this file
// reads its own orders and not another test's.
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", join(ROOT, "intake-queue"));
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "one-list-of-runs-test-secret";

const { test, before } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { scanAccountRuns, scanAllRuns, pausedKindOf, RUN_STATES, walkRuns } = await import("../../driver/portal-runs.mjs");
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { config } = await import("../lib/driver.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, "..", "..", "demo");
const AGENT = config.defaultAgent;
const STUDIO = join(ROOT, `workspace-${AGENT}`, "studio", "clearance-search");
const QUEUE = join(STUDIO, "queue");
const T = "2026-01-10T10:00:00.000Z";

function run({ slug, codename, state, owner, extra = {}, archive = null }) {
  const dir = archive ? join(STUDIO, "archive", archive, slug, codename) : join(STUDIO, slug, codename);
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: `${slug}-${codename}`, slug, codename, date: codename.slice(0, 10), agent: AGENT,
    state, markName: slug.split("-").pop().toUpperCase(), startedAt: T, updatedAt: T, stepN: 4, stepTotal: 8, stepLabel: "Searching the registers", ...extra }));
  writeFileSync(join(dir, "_driver", "profile.json"), JSON.stringify({ profileKey: owner }));
  return `${slug}-${codename}`;
}

const IDS = {};
let RETIRED = null;
before(() => {
  // THE FOUR DEMOS, as an install holds them: the run in the archive, its delivered record in the pool.
  for (const product of readdirSync(DEMO).filter((n) => existsSync(join(DEMO, n, "meta.json")))) {
    const meta = JSON.parse(readFileSync(join(DEMO, product, "meta.json"), "utf8"));
    const s = JSON.parse(readFileSync(join(DEMO, product, "run", "status.json"), "utf8"));
    const dir = join(ROOT, `workspace-${AGENT}`, "studio", "clearance-search", "archive", s.date.slice(0, 7), s.slug, `${s.date}-${s.codename}`);
    mkdirSync(join(dir, "_driver"), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ ...s, agent: AGENT }));
    cpSync(join(DEMO, product, "run", "_driver", "profile.json"), join(dir, "_driver", "profile.json"));
    mkdirSync(join(POOL, meta.runId), { recursive: true });
    writeFileSync(join(POOL, meta.runId, "meta.json"), JSON.stringify(meta));
    IDS[product] = meta.runId;
  }
  IDS.running = run({ slug: "tmpst-running", codename: "2026-01-10-ash-river", state: "running", owner: "demo-brand-owner" });
  IDS.postponed = run({ slug: "tmpst-postponed", codename: "2026-01-10-blue-fen", state: "postponed", owner: "demo-brand-owner", extra: { resetsAt: "2026-01-10T15:00:00.000Z" } });
  IDS.recovering = run({ slug: "tmpst-recovering", codename: "2026-01-10-cold-ash", state: "recovering", owner: "acme" });
  IDS.parked = run({ slug: "tmpst-parked", codename: "2026-01-10-dry-oak", state: "parked-for-human", owner: "demo-brand-owner" });
  IDS.failed = run({ slug: "tmpst-failed", codename: "2026-01-10-elm-gate", state: "failed", owner: "acme", extra: { reason: "a stage failed", failedStage: "synthesis" } });
  IDS.cancelled = run({ slug: "tmpst-cancelled", codename: "2026-01-10-fog-hill", state: "cancelled", owner: "demo-brand-owner" });
  // A delivered run whose publish left nothing in the pool.
  IDS.nopool = run({ slug: "tmpst-nopool", codename: "2026-01-09-gold-pine", state: "delivered", owner: "acme", archive: "2026-01",
    extra: { stepN: 9, stepTotal: 9, stepLabel: "Sending to you" } });
  // Folders that hold a status file and no run: a what-if shadow, a register unit, history.
  for (const sub of [join(STUDIO, "tmpst-running", "2026-01-10-ash-river", "_experiments", "w1"), join(STUDIO, "tmpst-running", "2026-01-10-ash-river", "register-units", "u1"), join(STUDIO, "_history", "h1")]) {
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "status.json"), JSON.stringify({ runId: "shadow", slug: "shadow", codename: "2026-01-01-shadow", state: "running" }));
  }
  // One demo retired from the portal's list.
  RETIRED = IDS["full-country-search"];
  writeFileSync(join(POOL, "archive-tags.json"), JSON.stringify({ archived: [RETIRED] }));
  // Three unclaimed orders: two companies, and a generic order filed under an organisation.
  mkdirSync(QUEUE, { recursive: true });
  for (const [id, owner, tenant] of [["q-acme", "acme", null], ["q-demo", "demo-brand-owner", null], ["q-north", "generic", "org-north"]])
    writeFileSync(join(QUEUE, `${id}.json`), JSON.stringify({ id, profileKey: owner, ...(tenant ? { tenant } : {}), markName: `ORDER${id.slice(2).toUpperCase()}`, classes: [9] }));
});

async function connectorList(scope) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer({ scope, local: scope === null ? null : false }).connect(b);
  const client = new Client({ name: "one-list-test", version: "1" });
  await client.connect(a);
  const r = await client.callTool({ name: "list_runs", arguments: {} });
  await client.close();
  return JSON.parse(r.content[0].text);
}
const portalList = (account, generic = null) => scanAccountRuns({ poolRoot: POOL, workspaceRoot: ROOT, account, generic, queueDirs: [QUEUE] });

/** A portal row's state in the engine's own words: the paused fold undone. */
const UNFOLD = Object.fromEntries(RUN_STATES.filter((s) => pausedKindOf(s)).map((s) => [pausedKindOf(s), s]));
const canonical = (row) => (row.state === "paused" ? UNFOLD[row.pausedKind] : row.state);

test("both faces list the same runs, in the same state, at the same step, except the differences named here", async () => {
  const portal = new Map(scanAllRuns({ poolRoot: POOL, workspaceRoot: ROOT, queueDirs: [QUEUE] }).map((r) => [r.runId, r]));
  const connector = new Map((await connectorList(null)).map((r) => [r.runId, r]));
  // THE RECORDED DIFFERENCES, each by name. A retired run leaves the portal's list and stays on the connector's;
  // a delivered run with no pool copy is the connector's alone.
  const onlyConnector = [RETIRED, IDS.nopool].sort();
  assert.deepEqual([...connector.keys()].filter((id) => !portal.has(id)).sort(), onlyConnector, "the runs only the connector lists");
  assert.deepEqual([...portal.keys()].filter((id) => !connector.has(id)), [], "the runs only the portal lists");
  assert.ok(!connector.has("shadow") && !portal.has("shadow"), "a what-if shadow, a register unit and history are not runs");

  let compared = 0;
  for (const [id, p] of portal) {
    const c = connector.get(id);
    assert.equal(canonical(p), c.state, `${id}: the portal says ${p.state}/${p.pausedKind}, the connector ${c.state}`);
    // THE STEP, where both faces carry one. A delivered row on the portal comes from the pool record and carries
    // none; that is the third recorded difference.
    if (p.state === "delivered") assert.equal(p.step ?? null, null, `${id}: a delivered portal row carries no step`);
    else if (p.state === "queued") assert.equal(c.step, p.step, `${id}: an order's step`);
    else assert.equal(c.step, `${(c.step ?? "").split(" ")[0]} ${p.step}`.trim(), `${id}: the portal's step is the connector's, without its count`);
    compared++;
  }
  // POSITIVE EVIDENCE OF COVERAGE: four demos less the retired one, six live states, three orders.
  assert.equal(compared, 3 + 6 + 3, `compared ${compared} runs`);
  for (const s of ["running", "postponed", "recovering", "parked-for-human", "failed", "cancelled", "delivered", "queued"])
    assert.ok([...connector.values()].some((r) => r.state === s), `no run in state ${s} was compared`);
});

test("an unclaimed order is listed to the company that placed it, on both faces, and to no other", async () => {
  const cases = [
    { label: "acme", scope: { kind: "account", accounts: ["acme"], sub: "a@acme.example" }, portal: portalList("acme"), sees: ["q-acme"] },
    { label: "demo", scope: { kind: "account", accounts: ["demo-brand-owner"], sub: "d@demo.example" }, portal: portalList("demo-brand-owner"), sees: ["q-demo"] },
    { label: "north's generic", scope: { kind: "account", accounts: ["acme"], genericOrgs: ["org-north"], sub: "n@north.example" },
      portal: portalList("acme", { orgs: ["org-north"] }), sees: ["q-acme", "q-north"] },
  ];
  for (const { label, scope, portal, sees } of cases) {
    const connector = await connectorList(scope);
    const orders = (rows) => rows.filter((r) => r.state === "queued").map((r) => r.runId).sort();
    assert.deepEqual(orders(connector), sees, `${label}: the connector's orders`);
    assert.deepEqual(orders(portal), sees, `${label}: the portal's orders`);
    // ACCESS DOES NOT CHANGE: the same runs on both faces, and nothing of another company's.
    const ids = (rows) => rows.map((r) => r.runId).filter((id) => id !== RETIRED && id !== IDS.nopool).sort();
    assert.deepEqual(ids(connector), ids(portal), `${label}: the same runs on both faces`);
  }
});

test("a connector lookup reads neither the pool nor the queue", () => {
  const walk = walkRuns({ workspaceRoot: ROOT, archive: true, orders: false });
  assert.equal(walk.records.length, 0);
  assert.equal(walk.queued.length, 0);
  assert.ok(walk.runs.length >= 11, `the walk read ${walk.runs.length} runs`);
});
