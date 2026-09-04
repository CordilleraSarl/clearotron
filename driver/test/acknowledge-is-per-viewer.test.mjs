// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — FAILED RUNS PILED UP ON THE DASHBOARD FOR EVER.
//
// Home.tsx states its own job in its first line: "what is in flight, what is waiting, and the way out of
// both." A failed run is neither in flight nor waiting, and it had no way out — so it stayed. On the test
// instance the dead runs became the dominant content, crowding out the work actually running, which is
// the one thing that section exists to show.
//
// THE STORE IS THE DESIGN DECISION, and the issue says why: this must NOT reuse 's archive tag.
// `archive-tags.json` is pool-wide — retiring hides a run from everyone, the brand owner included.
// Dashboard clutter is one person's annoyance. One control over both would mean a staff member tidying
// their own screen silently hiding a client's run, which is a different act entirely.
//
// KEYED ON (runId, state), NEVER ON runId. A run that leaves the state you dismissed it in is a
// different fact. An id-only key would hide a run for ever the moment it briefly read as failed — and
// hiding a live run is exactly the failure this feature exists to prevent.
//
// BREAK MATRIX:
//   · acking takes it off THIS viewer's dashboard   → break: stop stamping `acked`, arm 1 goes red
//   · a colleague's dashboard is untouched          → break: one shared file, arm 2 goes red
//   · the RUN is unchanged, still in Clearances     → break: write to meta/archive-tags, arm 3 goes red
//   · paused and recovering cannot be acknowledged  → break: widen ACKNOWLEDGEABLE, arm 4 goes red
//   · the key carries the STATE                     → break: key on runId alone, arm 5 goes red
//   · undo puts it straight back                    → break: ignore acknowledged:false, arm 6 goes red
//   · the file is named by hash, not by address     → break: interpolate the email, arm 7 goes red
//   · 's tag is not touched by any of it        → break: write archive-tags too, arm 3 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { makePortalService } from "../portal-service.mjs";
import { readAcks, setAck, ACKNOWLEDGEABLE, ACKS_DIR } from "../portal-acks.mjs";
import { readArchivedSet } from "../publish/archive-tags.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const live = (rel) => readFileSync(join(HERE, "..", "..", rel), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");

// A pool of DELIVERED runs is no use here — the dashboard band is everything that is not delivered. The
// state lives in status.json for a live run, so the fixture writes the workspace shape the scan reads.
const poolWith = (runs = {}) => {
  const root = mkdtempSync(join(tmpdir(), "ack-pool-"));
  const ws = mkdtempSync(join(tmpdir(), "ack-ws-"));
  for (const [runId, [customerKey, state]] of Object.entries(runs)) {
    const dir = join(ws, `workspace-${runId}`, "studio", "prelim-search", "runs", runId);
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ runId, state, markName: runId.toUpperCase(), slug: runId }));
    writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: customerKey }));
  }
  return { root, ws };
};

const svcOn = ({ root, ws }) =>
  makePortalService({
    poolRoot: root, workspaceRoot: ws, secret: "s",
    staffDomains: ["staff.example"],
    grants: () => ({ tenants: { aurora: { accounts: ["aurora"], users: { "c@aurora.example": ["aurora"] } } } }),
  });

const STAFF = { email: "k@staff.example" };
const OTHER_STAFF = { email: "j@staff.example" };
const rowsFor = async (svc, who) => (await svc.route("GET", "/portal/api/runs", who, {}, { scope: "mine" })).json.runs;
const ackedIds = (rows) => rows.filter((r) => r.acked).map((r) => r.runId).sort();

test("#613 arm 1 — acknowledging a failed run marks it for this viewer, and only that", async () => {
  const pool = poolWith({ dead: ["aurora", "failed"], alive: ["aurora", "running"] });
  const svc = svcOn(pool);
  assert.deepEqual((await rowsFor(svc, STAFF)).map((r) => r.runId).sort(), ["alive", "dead"], "premise: both are on the wire");
  assert.deepEqual(ackedIds(await rowsFor(svc, STAFF)), [], "and nothing is acknowledged yet");

  const r = await svc.route("POST", "/portal/api/ack", STAFF, { runId: "dead", state: "failed", acknowledged: true });
  assert.equal(r.status, 200);
  assert.deepEqual(ackedIds(await rowsFor(svc, STAFF)), ["dead"], "the stamp is on the row the dashboard filters on");
  const rows = await rowsFor(svc, STAFF);
  assert.equal(rows.find((x) => x.runId === "alive").acked, undefined, "the running run is untouched");
});

test("#613 arm 2 — one person clearing their dashboard does not clear a colleague's", async () => {
  // The requirement, and the reason the store is per viewer rather than pool-wide.
  const pool = poolWith({ dead: ["aurora", "failed"] });
  const svc = svcOn(pool);
  await svc.route("POST", "/portal/api/ack", STAFF, { runId: "dead", state: "failed", acknowledged: true });
  assert.deepEqual(ackedIds(await rowsFor(svc, STAFF)), ["dead"]);
  assert.deepEqual(ackedIds(await rowsFor(svc, OTHER_STAFF)), [], "the other reader still sees it, whole");
  // Two files, not one — which is what makes a concurrent ack impossible to lose.
  assert.equal(readdirSync(join(pool.root, ACKS_DIR)).length, 1, "one viewer, one file");
  await svc.route("POST", "/portal/api/ack", OTHER_STAFF, { runId: "dead", state: "failed", acknowledged: true });
  assert.equal(readdirSync(join(pool.root, ACKS_DIR)).length, 2, "a second viewer writes a SECOND file");
});

test("#613 arm 3 — the run is unchanged: not its state, not its record, not #611's tag", async () => {
  // "A dismissed run is still in Clearances with its status intact. Nothing about the record changes."
  const pool = poolWith({ dead: ["aurora", "failed"] });
  const svc = svcOn(pool);
  const before = (await rowsFor(svc, STAFF))[0];
  await svc.route("POST", "/portal/api/ack", STAFF, { runId: "dead", state: "failed", acknowledged: true });
  const after = (await rowsFor(svc, STAFF))[0];
  assert.equal(after.state, before.state, "the state did not move");
  assert.deepEqual({ ...after, acked: undefined }, { ...before, acked: undefined }, "and nothing else on the row did either");
  assert.deepEqual([...readArchivedSet(pool.root)], [], "#611's pool-wide tag is NOT written — two problems, two stores");
  assert.deepEqual(readdirSync(pool.root).sort(), [ACKS_DIR], "one directory appeared, and it is the per-viewer one");
});

test("#613 arm 4 — a paused or recovering run offers no acknowledge, and cannot be forced into one", async () => {
  // "A run that is paused or recovering must not be dismissible; that is a run someone still needs to see."
  const pool = poolWith({ waiting: ["aurora", "postponed"] });
  const svc = svcOn(pool);
  const row = (await rowsFor(svc, STAFF))[0];
  assert.equal(row.state, "paused", "premise: the engine's postponed maps to paused on the wire");

  const r = await svc.route("POST", "/portal/api/ack", STAFF, { runId: "waiting", state: "paused", acknowledged: true });
  assert.equal(r.status, 400, "refused at the door");
  assert.deepEqual(ackedIds(await rowsFor(svc, STAFF)), [], "and nothing was written");
  assert.deepEqual([...ACKNOWLEDGEABLE], ["failed", "cancelled"], "terminal and NOT delivered — nothing else");
  // The screen must not offer it either: a refused button is worse than an absent one.
  const home = live("portal-ui/src/screens/Home.tsx");
  assert.match(home, /const canAck = run\.state === 'failed' \|\| run\.state === 'cancelled'/);
});

test("#613 arm 5 — the key carries the STATE, so a run that moves on comes back", async () => {
  // THE TRAP. Keyed on runId alone, a run dismissed while it briefly read `failed` stays hidden for
  // ever — including after a resume. The dismissal is of a FACT, not of a name.
  const pool = poolWith({ dead: ["aurora", "failed"] });
  setAck(pool.root, STAFF.email, { runId: "dead", state: "failed" });
  assert.deepEqual([...readAcks(pool.root, STAFF.email)], [["dead", "failed"]]);

  // the same run, now running again (a re-run under the same id, or an operator resume)
  const dir = join(pool.ws, "workspace-dead", "studio", "prelim-search", "runs", "dead");
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: "dead", state: "running", markName: "DEAD", slug: "dead" }));
  const rows = await rowsFor(svcOn(pool), STAFF);
  assert.equal(rows[0].state, "running");
  assert.equal(rows[0].acked, undefined, "the ack does not survive the state it was made in");
});

test("#613 arm 6 — the count is reachable and one click undoes it", async () => {
  const pool = poolWith({ dead: ["aurora", "failed"] });
  const svc = svcOn(pool);
  await svc.route("POST", "/portal/api/ack", STAFF, { runId: "dead", state: "failed", acknowledged: true });
  const back = await svc.route("POST", "/portal/api/ack", STAFF, { runId: "dead", state: "failed", acknowledged: false });
  assert.equal(back.status, 200);
  assert.equal(back.json.count, 0);
  assert.deepEqual(ackedIds(await rowsFor(svc, STAFF)), [], "it is on the dashboard again");

  // "A count is better than a silent disappearance." The screen states the number and opens the list.
  const home = live("portal-ui/src/screens/Home.tsx");
  assert.match(home, /\{acked\.length\} acknowledged/, "the number is on screen");
  assert.match(home, /Bring back/, "…and each one has its way back beside it");
  const contract = live("portal-ui/src/contract/home.ts");
  assert.match(contract, /r\.state !== 'delivered' && !r\.acked/, "inFlight drops them");
  assert.match(contract, /r\.state !== 'delivered' && r\.acked/, "…and `acknowledged` is its exact complement");
});

test("#613 arm 7 — the file is named by hash; an address is never a path component", async () => {
  const pool = poolWith({ dead: ["aurora", "failed"] });
  setAck(pool.root, "Owner+test@Staff.EXAMPLE", { runId: "dead", state: "failed" });
  const [name] = readdirSync(join(pool.root, ACKS_DIR));
  assert.match(name, /^[0-9a-f]{32}\.json$/, "hex, fixed length — no '/', no '..', no case, nothing to escape");
  assert.ok(!name.toLowerCase().includes("owner"), "and a listing of the pool does not enumerate its readers");
  // Case and surrounding space are the same reader — one person, one file, or the dismissals split.
  assert.equal(readAcks(pool.root, "  owner+test@staff.example  ").get("dead"), "failed");
  assert.equal(readdirSync(join(pool.root, ACKS_DIR)).length, 1);
});

test("#613 arm 9 — the SERVED BUNDLE carries it; portal-ui/dist is what the browser gets", (ctx) => {
  // The source is not the surface. `portal-ui/dist` is committed on purpose and portal-static serves it
  // verbatim, so a source-only fix leaves the user on the old dashboard while every other test passes.
  const dir = join(HERE, "..", "..", "portal-ui", "dist", "assets");
  // BUILD OUTPUT, NOT SOURCE. `portal-ui/dist` is withheld from the public cut, so this arm has
  // nothing to read there. A STATED skip, never a silent pass: the defect it guards — a source-only
  // fix leaving the served bundle stale — cannot exist in a tree that commits no bundle, and in a
  // tree that does, this still runs.
  if (!existsSync(dir)) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const bundles = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(bundles.length, "there is a built bundle at all");
  const anyHas = (needle) => bundles.some((b) => readFileSync(join(dir, b), "utf8").includes(needle));
  assert.ok(anyHas("Acknowledge"), "the served dashboard has no way to put a dead run down — dist was not rebuilt");
  assert.ok(anyHas("acknowledged"), "…nor the count that keeps it from being a disappearance");
  assert.ok(anyHas("Bring back"), "…nor the way out of the count");
  assert.ok(anyHas("/portal/api/ack"), "…nor the route it calls");
});

test("#613 arm 8 — the door is the only gate, and a junk id cannot become a path", async () => {
  const pool = poolWith({ dead: ["aurora", "failed"] });
  const svc = svcOn(pool);
  for (const runId of ["../../etc/passwd", "a/b", "", ".."]) {
    const r = await svc.route("POST", "/portal/api/ack", STAFF, { runId, state: "failed", acknowledged: true });
    assert.equal(r.status, 400, `refused: ${JSON.stringify(runId)}`);
  }
  assert.ok(!existsSync(join(pool.root, ACKS_DIR)), "not one file written by any of them");
  // A client CAN acknowledge, and that is deliberate: this is the one curation act on the service that
  // changes nothing anybody else can see. It hangs off /portal/api, not /portal/admin, which is what
  // keeps it out of the staff-only surfaces — asserted here rather than left to the reader.
  const ok = await svc.route("POST", "/portal/api/ack", { email: "c@aurora.example" },
    { runId: "dead", state: "failed", acknowledged: true });
  assert.equal(ok.status, 200);
  const route = live("driver/portal-service.mjs");
  assert.match(route, /parts\[1\] === "api" && parts\[2\] === "ack" && method === "POST"/,
    "under /portal/api — a pool-wide act would belong under /portal/admin and be audited");
  assert.deepEqual([...readArchivedSet(pool.root)], [], "and a client's dismissal writes no pool-wide tag");
  // THE CONTRAST IS THE ARGUMENT. 's retire hides a run from everyone including the brand owner, so
  // it is staff-only and audited; this one hides nothing from anybody else, so it is neither. Asserting
  // both here is what stops the next reader from "tidying" them into one control.
  assert.equal((await svc.route("POST", "/portal/admin/retired", { email: "c@aurora.example" },
    { action: "retire", runIds: ["dead"] })).status, 404, "the pool-wide one stays staff-only");
});
