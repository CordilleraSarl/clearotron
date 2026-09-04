// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal's run controls: stop a run, cancel a queued job, reorder the queue.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "rc-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "rc-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { makePortalService } = await import("../portal-service.mjs");
const { reorderQueue, orderedQueueFiles, readQueueOrder } = await import("../queue-order.mjs");

const STAFF_DOMAINS = ["example-firm.com"];
const STAFF = { email: "staff@example-firm.com" };
const GRANTS = { tenants: { celta: { accounts: ["aurora", "zephyr"], users: { "cli@celta.example": ["aurora"] } } } };
const CLIENT = { email: "cli@celta.example" };

function world(jobs, { live = [], pool = [], order = null } = {}) {
  const poolRoot = mkdtempSync(join(tmpdir(), "rc-poolfx-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "rc-wsfx-"));
  // A DELIVERED run is served from the pool, never from the live scan (readRun skips `delivered` so a
  // finished run does not appear twice) — so a delivered fixture has to be a pool row to exist at all.
  for (const r of pool) {
    mkdirSync(join(poolRoot, r.id), { recursive: true });
    writeFileSync(join(poolRoot, r.id, "meta.json"), JSON.stringify({
      runId: r.id, customerKey: r.account, title: r.id, kind: "clearance", overall: "LOW", date: "2026-07-28",
    }));
    writeFileSync(join(poolRoot, r.id, "report.html"), "<title>x</title>ok");
  }
  const studio = join(workspaceRoot, "workspace-clawdi", "studio", "prelim-search");
  const q = join(studio, "queue");
  mkdirSync(q, { recursive: true });
  for (const j of jobs) {
    writeFileSync(join(q, `${j.id}.json`), JSON.stringify({
      id: j.id, forwarder: "jordan", markName: j.mark ?? j.id, classes: [9], profileKey: j.account,
      enqueuedAt: j.at ?? "2026-07-28T10:00:00.000Z",
    }));
  }
  if (order) writeFileSync(join(studio, ".queue-order.json"), JSON.stringify({ order }) + "\n");
  for (const r of live) {
    const dir = join(studio, r.slug, "2026-07-28-code");
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({
      runId: r.id, slug: r.slug, codename: "code", date: "2026-07-28",
      markName: r.mark ?? r.id, state: r.state ?? "running", stepLabel: "Register sweeps", stepN: 4, stepTotal: 9,
      updatedAt: "2026-07-28T10:00:00Z",
    }));
    writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: r.account }));
  }
  return { poolRoot, workspaceRoot, q, studio };
}

const serviceFor = (w, stops) => makePortalService({
  poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, recipesDir: mkdtempSync(join(tmpdir(), "rc-rec-")),
  secret: "test-secret", staffDomains: STAFF_DOMAINS, grants: GRANTS,
  trigger: async () => ({ ok: true }),
  stopRun: async (args) => { stops.push(args); return args.id ? { ok: true, action: "dequeued" } : { ok: true, action: "cancel-requested" }; },
  audit: () => {},
});

// ── stopping a run ────────────────────────────────────────────────────────────────────────────────
test("stop: a running run reaches the engine by runId, and never asks for a confirmation token", async () => {
  // The confirmation gate exists to stop money being spent by accident. Stopping is its opposite, and
  // making someone confirm twice while a run they no longer want keeps billing gets it exactly backwards.
  const w = world([], { live: [{ id: "r-aurora", slug: "tmp-a", account: "aurora", state: "running" }] });
  const stops = [];
  const res = await serviceFor(w, stops).route("POST", "/portal/api/run/r-aurora/stop", CLIENT, null, {});
  assert.equal(res.status, 200, JSON.stringify(res.json));
  // — AND IT CARRIES THE HUMAN. `via` on the far side records only the channel, and the engine
  // sees one shared ops token for every UI stop, so this argument is the only thing that can put a
  // person in the run dir. Asserted here because this is where it leaves the portal.
  // — AND WHICH STOP. `immediate` travels on every press, including the safe
  // one, so a reader who chose to preserve the step is as legible on this lane as one who did not.
  assert.deepEqual(stops, [{ runId: "r-aurora", immediate: false, onBehalfOf: CLIENT.email }]);
});

test("stop: a PAUSED run can be stopped — that is when people reach for it", async () => {
  // A rate-limit park can sit for hours. Refusing to stop a parked run (which stop_run used to do) is
  // backwards: it is the state where giving up is most likely, and the one the engine cannot self-cancel.
  for (const state of ["paused", "postponed", "recovering", "parked-for-human"]) {
    const w = world([], { live: [{ id: `r-${state}`, slug: `tmp-${state}`, account: "aurora", state }] });
    const stops = [];
    const res = await serviceFor(w, stops).route("POST", `/portal/api/run/r-${state}/stop`, CLIENT, null, {});
    assert.equal(res.status, 200, `${state}: ${JSON.stringify(res.json)}`);
    assert.deepEqual(stops, [{ runId: `r-${state}`, immediate: false, onBehalfOf: CLIENT.email }]);   // + 2076
  }
});

test("stop: another account's run is a 404, never an upstream error", async () => {
  // The engine's own account gate would refuse it too — but as an upstream fault, which is a different
  // observable from "no such run". A run you may not touch must look exactly like one that is not there.
  const w = world([], { live: [{ id: "r-zephyr", slug: "tmp-z", account: "zephyr", state: "running" }] });
  const stops = [];
  const res = await serviceFor(w, stops).route("POST", "/portal/api/run/r-zephyr/stop", CLIENT, null, {});
  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: "not_found" });
  assert.deepEqual(stops, [], "and nothing reached the engine");
});

test("stop: a run that already finished is refused, and the engine is not called", async () => {
  // failed and cancelled live in the workspace; delivered lives in the pool. All three are terminal,
  // and stopping one has to be refused rather than passed upstream to be refused there.
  for (const state of ["failed", "cancelled"]) {
    const w = world([], { live: [{ id: `r-${state}`, slug: `tmp-${state}`, account: "aurora", state }] });
    const stops = [];
    const res = await serviceFor(w, stops).route("POST", `/portal/api/run/r-${state}/stop`, CLIENT, null, {});
    assert.equal(res.status, 409, `${state}: ${JSON.stringify(res.json)}`);
    assert.deepEqual(stops, [], `${state}: nothing reached the engine`);
  }
  const w = world([], { pool: [{ id: "r-delivered", account: "aurora" }] });
  const stops = [];
  const res = await serviceFor(w, stops).route("POST", "/portal/api/run/r-delivered/stop", CLIENT, null, {});
  assert.equal(res.status, 409, JSON.stringify(res.json));
  assert.deepEqual(stops, []);
});

// ── cancelling a queued job ───────────────────────────────────────────────────────────────────────
test("cancel: a queued job is dropped by id, and someone else's is a 404", async () => {
  const w = world([{ id: "q-a", account: "aurora" }, { id: "q-z", account: "zephyr" }], { order: ["q-a", "q-z"] });
  const stops = [];
  const svc = serviceFor(w, stops);

  const ok = await svc.route("POST", "/portal/api/queue/q-a/cancel", CLIENT, null, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(stops, [{ id: "q-a", onBehalfOf: CLIENT.email }]);   // — the queue-cancel lane too

  const foreign = await svc.route("POST", "/portal/api/queue/q-z/cancel", CLIENT, null, {});
  assert.equal(foreign.status, 404);
  assert.deepEqual(stops, [{ id: "q-a", onBehalfOf: CLIENT.email }], "the foreign id never reached the engine");
});

test("cancel: losing the race to the runner is a race, not a failure", async () => {
  // The runner claimed it between the click and the request. Saying "error" would be wrong — the job is
  // fine, it is running. Never dress a lost race as a fault, and never grey the control out to avoid it.
  const w = world([{ id: "q-a", account: "aurora" }]);
  const svc = makePortalService({
    poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, recipesDir: mkdtempSync(join(tmpdir(), "rc-rec-")),
    secret: "test-secret", staffDomains: STAFF_DOMAINS, grants: GRANTS,
    trigger: async () => ({ ok: true }),
    stopRun: async () => ({ ok: false, action: "already-claimed", note: "Already claimed by the runner" }),
    audit: () => {},
  });
  const res = await svc.route("POST", "/portal/api/queue/q-a/cancel", CLIENT, null, {});
  assert.equal(res.status, 409);
  assert.equal(res.json.action, "already-claimed");
  assert.match(res.json.error, /running now/i, "the copy sends them to the card, not to an error");
});

// ── reordering ────────────────────────────────────────────────────────────────────────────────────
test("reorder: YOU MOVE YOUR OWN WORK AND NOBODY ELSE MOVES", async () => {
  // The rule that makes this safe. The caller sees a dense list of only their own jobs, so a naive
  // implementation ("their new order, then everyone else") looks identical on their screen while
  // silently promoting them past another tenant's queued work.
  const w = world([
    { id: "q-z1", account: "zephyr" },
    { id: "q-a1", account: "aurora" },
    { id: "q-z2", account: "zephyr" },
    { id: "q-a2", account: "aurora" },
  ], { order: ["q-z1", "q-a1", "q-z2", "q-a2"] });

  // aurora asks for its two in the opposite order.
  const res = await serviceFor(w, []).route("POST", "/portal/api/queue/order", CLIENT, { order: ["q-a2", "q-a1"] }, {});
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const now = readQueueOrder(w.q);
  assert.deepEqual(now, ["q-z1", "q-a2", "q-z2", "q-a1"],
    "aurora's two swapped WITH EACH OTHER; zephyr's stayed at positions 1 and 3");
});

test("reorder: ids the caller does not hold are dropped silently, never named in a refusal", async () => {
  // Refusing and naming the offending id would confirm that another tenant's job exists — the one thing
  // every refusal on these routes is shaped to avoid.
  const w = world([
    { id: "q-a1", account: "aurora" },
    { id: "q-z1", account: "zephyr" },
  ], { order: ["q-a1", "q-z1"] });

  const res = await serviceFor(w, []).route("POST", "/portal/api/queue/order", CLIENT, { order: ["q-z1", "q-a1"] }, {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.order, ["q-a1"], "only the caller's own id survived");
  assert.deepEqual(readQueueOrder(w.q), ["q-a1", "q-z1"], "and zephyr's job did not move");
});

test("reorder: the order the portal writes is the order the runner reads", async () => {
  // One function, two callers. If these ever diverged the screen would assert an order the engine
  // does not honour, which is precisely the fiction this whole change exists to remove.
  const w = world([
    { id: "q-a1", account: "aurora" },
    { id: "q-a2", account: "aurora" },
    { id: "q-a3", account: "aurora" },
  ], { order: ["q-a1", "q-a2", "q-a3"] });

  await serviceFor(w, []).route("POST", "/portal/api/queue/order", CLIENT, { order: ["q-a3", "q-a1", "q-a2"] }, {});
  const asRunnerSeesIt = orderedQueueFiles(w.q, ["q-a1.json", "q-a2.json", "q-a3.json"]).map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual(asRunnerSeesIt, ["q-a3", "q-a1", "q-a2"]);
});

test("reorder: a bad body is refused without touching the queue", async () => {
  const w = world([{ id: "q-a1", account: "aurora" }]);
  const res = await serviceFor(w, []).route("POST", "/portal/api/queue/order", CLIENT, { order: "not-an-array" }, {});
  assert.equal(res.status, 400);
  assert.ok(!existsSync(join(w.studio, ".queue-order.json")), "no order file was written");
});

test("reorderQueue: a lane the caller has nothing in is left completely alone", () => {
  // Directly, because the route only ever exercises one lane. A write to an untouched lane would be a
  // silent reshuffle of work the caller never asked about.
  const workspaceRoot = mkdtempSync(join(tmpdir(), "rc-lanes-"));
  const mk = (agent, ids) => {
    const q = join(workspaceRoot, `workspace-${agent}`, "studio", "prelim-search", "queue");
    mkdirSync(q, { recursive: true });
    for (const id of ids) writeFileSync(join(q, `${id}.json`), JSON.stringify({ id, enqueuedAt: "2026-07-28T10:00:00.000Z" }));
    return q;
  };
  const qa = mk("clawdi", ["m1", "m2"]);
  const qb = mk("clawdi-b", ["n1", "n2"]);

  const out = reorderQueue({ workspaceRoot, order: ["m2", "m1"], allowed: new Set(["m1", "m2"]) });
  assert.equal(out.lanes, 1, "exactly one lane was rewritten");
  assert.deepEqual(readQueueOrder(qa), ["m2", "m1"]);
  assert.deepEqual(readQueueOrder(qb), [], "the other lane has no order file at all — it was never touched");
});

// ── A5e: the wire never carries the engine's park vocabulary ─────────────────────────────────────────
test("listing: parked-for-human maps to paused + pausedKind operator on the wire — the raw value never leaves the server", async () => {
  // The portal contract coerces an unknown state to "running" — exactly the zombie face this state
  // exists to end — so the mapping MUST happen server-side, like postponed/recovering always did.
  const w = world([], { live: [
    { id: "r-parked", slug: "tmp-p", account: "aurora", state: "parked-for-human" },
    { id: "r-recover", slug: "tmp-r", account: "aurora", state: "recovering" },
  ] });
  const res = await serviceFor(w, []).route("GET", "/portal/api/runs", CLIENT, null, {});
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const rows = res.json.runs ?? res.json;
  const parked = rows.find((r) => r.runId === "r-parked");
  assert.ok(parked, `parked run listed: ${JSON.stringify(rows.map((r) => r.runId))}`);
  assert.equal(parked.state, "paused");
  assert.equal(parked.pausedKind, "operator");
  const recovering = rows.find((r) => r.runId === "r-recover");
  assert.equal(recovering.state, "paused");
  assert.equal(recovering.pausedKind, "recovering");
});

// ── — THE CHOICE AT THE PRESS, AND WHAT COMES BACK ──────────────────────────
//
// Owner ruling, on his second encounter with the same wait: "a stop is a stop — maybe it should be a
// 'stop immediately or at next boundary to preserve data' kind of question when you press it." The
// driver half landed the mode (`stop_run`'s `immediate`); this is the lane that carries a reader's
// answer to it, and the answer that comes back.
//
// BREAK MATRIX:
//   · the reader's choice reaches the engine        → break: drop it from the args, arm 1 red
//   · anything but `true` is the SAFE stop           → break: coerce truthy, arm 2 red
//   · the mode is read off the ANSWER, not the press → break: echo the request, arm 3 red
//   · no pid reaches a browser                       → break: forward the tool result, arm 4 red
const stopRunReturning = (w, stops, reply) => makePortalService({
  poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, recipesDir: mkdtempSync(join(tmpdir(), "rc-rec-")),
  secret: "test-secret", staffDomains: STAFF_DOMAINS, grants: GRANTS,
  trigger: async () => ({ ok: true }),
  stopRun: async (args) => { stops.push(args); return reply(args); },
  audit: () => {},
});
const running = () => world([], { live: [{ id: "r-aurora", slug: "tmp-a", account: "aurora", state: "running" }] });

test("2076 arm 1 — the reader's choice reaches the engine, and the answer says which stop happened", async () => {
  const w = running();
  const stops = [];
  const svc = stopRunReturning(w, stops, () => ({
    ok: true, action: "cancel-requested", immediate: { attempted: true, signalled: "SIGTERM", pid: 4242 },
    note: "Stopping now. The step in flight has been ended rather than allowed to finish.",
  }));
  const res = await svc.route("POST", "/portal/api/run/r-aurora/stop", CLIENT, { immediate: true }, {});

  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(stops[0].immediate, true, "the reader chose to end the step in flight and the engine was not told");
  assert.equal(res.json.stop.mode, "immediate");
  assert.match(res.json.stop.note, /Stopping now/, "the driver's own sentence is not carried, so the screen must invent one");
});

test("2076 arm 2 — anything but an explicit true is the stop that PRESERVES the step", async () => {
  // This control ends a run mid-turn. A truthy string arriving from a hand-rolled POST must not read as
  // consent to lose the step in flight, and an older client that sends no body must get what it always
  // got. The safe path is the one an unrecognised body reaches.
  for (const body of [null, {}, { immediate: false }, { immediate: "true" }, { immediate: 1 }, { immediate: "yes" }]) {
    const w = running();
    const stops = [];
    const svc = stopRunReturning(w, stops, () => ({ ok: true, action: "cancel-requested", note: "Stopping." }));
    await svc.route("POST", "/portal/api/run/r-aurora/stop", CLIENT, body, {});
    assert.equal(stops[0].immediate, false, `${JSON.stringify(body)} was read as consent to end the step in flight`);
  }
});

test("2076 arm 3 — an immediate stop that could not act is reported as the boundary stop it BECAME", async () => {
  // The driver's own rule, and the reason this issue exists: presenting a fallback as the immediate stop
  // the button offered would be the second silent thing in a row on this control.
  const w = running();
  const stops = [];
  const svc = stopRunReturning(w, stops, () => ({
    ok: true, action: "cancel-requested",
    immediate: { attempted: false, why: "no engine turn is recorded for this run — the cancel stands" },
    note: "Stopping at the next step boundary. An immediate stop was asked for and could not be made.",
  }));
  const res = await svc.route("POST", "/portal/api/run/r-aurora/stop", CLIENT, { immediate: true }, {});

  assert.equal(stops[0].immediate, true, "premise: the reader asked for the immediate stop");
  assert.equal(res.json.stop.mode, "boundary",
    "a press that could not end the step in flight is being reported as though it had");

  // AND THE SIGNAL THAT FAILED IS NOT SUCCESS EITHER. `attempted` alone is not the same as `signalled`.
  const w2 = running();
  const stops2 = [];
  const res2 = await stopRunReturning(w2, stops2, () => ({
    ok: true, action: "cancel-requested", immediate: { attempted: true, signalled: null, pid: 9, error: "EPERM" },
  })).route("POST", "/portal/api/run/r-aurora/stop", CLIENT, { immediate: true }, {});
  assert.equal(res2.json.stop.mode, "boundary", "a signal that was refused is being reported as an immediate stop");
});

test("2076 arm 4 — no process id reaches the browser, and the raw tool result stops travelling", async () => {
  // This route returned `upstream: r` wholesale, which was harmless while the tool answered in states
  // and sentences. `stop_run`'s immediate mode carries `immediate.pid` — a process id on the box — and
  // this response goes to a client's browser. Nothing in the client has ever read `upstream`.
  const w = running();
  const svc = stopRunReturning(w, [], () => ({
    ok: true, action: "cancel-requested",
    immediate: { attempted: true, signalled: "SIGTERM", pid: 3292812 },
    note: "Stopping now.",
    // NOT a real operator's home — forbids naming one in any executable line, and a fixture is an
    // executable line. What this stands for is "some internal string the tool returned", and the arm
    // below asserts it does not travel; which internal string it is does not matter to that.
    internalDetail: "<a run directory the tool knows and a browser must not>",
  }));
  const res = await svc.route("POST", "/portal/api/run/r-aurora/stop", CLIENT, { immediate: true }, {});

  const wire = JSON.stringify(res.json);
  assert.ok(!wire.includes("3292812"), `a process id reached the browser: ${wire}`);
  assert.ok(!wire.includes("internalDetail"), "the raw tool result is still being forwarded wholesale");
  assert.equal(res.json.upstream, undefined, "`upstream` is back on the wire");
  // AND THE READER STILL GETS WHAT THEY NEED — an arm that only asserted absence would pass on a
  // response that said nothing at all.
  assert.equal(res.json.stop.mode, "immediate");
  assert.equal(res.json.stop.note, "Stopping now.");
});
