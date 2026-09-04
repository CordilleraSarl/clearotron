// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ops.test.mjs — the OPS write-face verbs (start_run / stop_run / feed_context) against an isolated
// temp workspace. No MCP SDK / jose. Sets CLEAROTRON_WORK_DIR BEFORE importing (driver.config reads it
// at module load), so the queue + run dirs land under a throwaway tmp tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "ops-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
const QUEUE = join(ROOT, "workspace-clawdi", "studio", "prelim-search", "queue");

const { startRun, stopRun, feedContext, markSent, listOutboxEvents, getDeliveryPacket, ackEvent } = await import("../lib/ops.mjs");

function makeRun({ slug = "tmpx-acme", codename = "2026-06-16-jade-x", state = "running" } = {}) {
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId, slug, codename, agent: "clawdi", state, markName: "ACME" }));
  return { runDir, runId };
}

test("start_run: enqueues a valid job into the agent's queue", () => {
  const r = startRun({ markName: "ZEPHYR", forwarder: "requester", classes: [9, 42], customer: "Acme", profileKey: "generic" });
  assert.equal(r.ok, true);
  assert.ok(r.id && r.queued);
  assert.ok(existsSync(r.queuePath), "queue file written");
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.markName, "ZEPHYR");
  assert.equal(job.forwarder, "requester");
  assert.deepEqual(job.classes, [9, 42]);
  assert.equal(job.enqueuedVia, "mcp/start_run");
  assert.ok(job.id && job.msgId, "id + msgId present (validateJob requires them)");
  assert.ok(!("projectKey" in job), "no projectKey ⇒ the key is absent (runs on the customer profile)");
});

test("start_run: passes a spec-62 projectKey through to the queued job (real overlay resolves ⇒ run)", () => {
  const r = startRun({ markName: "NOVAWING", forwarder: "requester", classes: [9, 28, 41], profileKey: "aurora", projectKey: "console-ecosystem" });
  assert.equal(r.ok, true);
  assert.equal(r.classify, "run", "a real project under its customer resolves — no clarify");
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.profileKey, "aurora");
  assert.equal(job.projectKey, "console-ecosystem", "projectKey survives into the queue file the runner drains");
});

test("start_run: an unknown projectKey under a real customer is rejected at the boundary (clarify, no queue write)", () => {
  assert.throws(
    () => startRun({ markName: "NOVAWING", forwarder: "requester", classes: [9], profileKey: "aurora", projectKey: "no-such-project" }),
    /no known project under this customer/,
    "the D4.1 clarify-gate fires before any spend — a typo'd/unscoped project never silently drops to the customer profile",
  );
});

test("start_run: full \u00a7B3 intake-fidelity passthrough (spec-62 projectKey, posture fields, flags)", () => {
  const r = startRun({
    markName: "PARITY", forwarder: "jordan", classes: [9], profileKey: "aurora", projectKey: "console-ecosystem",
    deliverableSpec: "excel only", commercialFlexibility: "locked", priorUse: "in use since 2020",
    campaignShape: "flavour sub-brand under the house mark; seasonal, one quarter",
    deadline: "2026-08-01T12:00:00Z", customerUnknown: true, dupOverride: true, forwarderDomain: "firm.example",
    rawRequest: "the verbatim ask",
  });
  assert.equal(r.ok, true);
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.projectKey, "console-ecosystem");
  assert.equal(job.deliverableSpec, "excel only");
  assert.equal(job.commercialFlexibility, "locked");
  assert.equal(job.priorUse, "in use since 2020");
  assert.equal(job.campaignShape, "flavour sub-brand under the house mark; seasonal, one quarter");   // P2-C §8a
  assert.equal(job.deadline, "2026-08-01T12:00:00Z");
  assert.equal(job.customerUnknown, true);
  assert.equal(job.dupOverride, true);
  assert.equal(job.forwarderDomain, "firm.example");
  assert.equal(job.rawRequest, "the verbatim ask");
});

test("start_run: rejects a job missing markName or forwarder", () => {
  assert.throws(() => startRun({ forwarder: "requester" }), /markName is required/);
  assert.throws(() => startRun({ markName: "X" }), /forwarder is required/);
});

test("start_run: rejects an unknown agent", () => {
  assert.throws(() => startRun({ agent: "evil", markName: "X", forwarder: "requester" }), /unknown agent/);
});

test("mark_sent: writes .sent + flips sendPending + clears the marker; idempotent on retry", () => {
  const { runDir, runId } = makeRun({ slug: "tmpx-sendme", codename: "2026-07-16-jade-y", state: "delivered" });
  const outbox = join(ROOT, "prelim-outbox");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    // no packet yet -> refused (nothing was pending a send)
    assert.throws(() => markSent({ runId }), /no delivery or failure packet/);
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: "tmpx-sendme-jade-y" }));
    writeFileSync(join(outbox, "tmpx-sendme-jade-y.pending"), "clawdi\n");
    // status with sendPending like the pipeline leaves it
    const sp = join(runDir, "status.json");
    writeFileSync(sp, JSON.stringify({ runId, slug: "tmpx-sendme", codename: "2026-07-16-jade-y", agent: "clawdi", state: "delivered", markName: "ACME", sendPending: true }));

    const r = markSent({ runId, messageId: "<sent-123@mail>" });
    assert.equal(r.ok, true);
    assert.equal(r.alreadySent, false);
    const sent = JSON.parse(readFileSync(join(runDir, ".sent"), "utf8"));
    assert.equal(sent.messageId, "<sent-123@mail>");
    assert.equal(JSON.parse(readFileSync(sp, "utf8")).sendPending, false, "sendPending flipped");
    assert.ok(!existsSync(join(outbox, "tmpx-sendme-jade-y.pending")), "outbox marker cleared");

    // retried courier: success, alreadySent, nothing rewritten
    const again = markSent({ runId });
    assert.equal(again.alreadySent, true);
    assert.equal(JSON.parse(readFileSync(join(runDir, ".sent"), "utf8")).messageId, "<sent-123@mail>", "first receipt preserved");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("mark_sent: a retry with the marker STILL present (a killed first call) removes it — no orphan re-fire", () => {
  // The runaway-spend bug: a first mark_sent SIGKILLed after writing .sent but before the marker rmSync
  // left .sent + marker coexisting; the alreadySent early-return then suppressed the only cleanup forever,
  // so the level-triggered prelim-outbox.path re-woke the courier every ~3.5min. This asserts the
  // previously-untested quadrant: .sent present AND marker present -> alreadySent:true AND marker removed.
  const { runDir, runId } = makeRun({ slug: "tmpx-orphan", codename: "2026-07-23-crimson-y", state: "delivered" });
  const outbox = join(ROOT, "prelim-outbox");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: "tmpx-orphan-crimson-y" }));
    // simulate the interrupted first call: .sent already written, marker NOT yet removed
    writeFileSync(join(runDir, ".sent"), JSON.stringify({ ts: "2026-07-23T23:00:00Z", messageId: "<orig@mail>", via: "mcp/mark_sent" }));
    const marker = join(outbox, "tmpx-orphan-crimson-y.pending");
    writeFileSync(marker, "clawdi\n");

    const r = markSent({ runId });
    assert.equal(r.alreadySent, true, "still idempotent — the courier must not treat its own prior success as failure");
    assert.ok(!existsSync(marker), "the orphaned marker is now removed on the alreadySent path (no more re-fire)");
    assert.equal(JSON.parse(readFileSync(join(runDir, ".sent"), "utf8")).messageId, "<orig@mail>", "original receipt untouched");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

// ── post-merge audit 2: a settle clears EVERY runId form the marker could carry ─────────────────────
// clearMarker removed one name only (`packet.runId ?? args.runId`). A pre- delivery packet carries the
// legacy DATELESS `<slug>-<codename>` runId while the resolved run's own id is the dated canonical
// `<slug>-<date>-<codename>`. The pair below is the divergence read off a run delivered 2026-07-29: its
// _driver/delivery.json names the dateless form, its status.json the dated one. Slug and date verbatim
// from that run; the CODENAME is synthetic, because a real one is <adj>-<noun> from phase0.mjs's own
// vocabulary and no such pair may appear in this repo (no-client-identifiers.test.mjs). With markers
// under BOTH names the settle left the other one on disk, the level-triggered outbox kept re-firing on
// it, and the alreadySent early-return repeated the very same single-form removal — so no retry could
// ever finish the cleanup. Same dual-form defence rescanOwedRuns already applies to the queued check.
test("mark_sent: BOTH runId forms of the marker are cleared — the packet's and the resolved run's (and on the alreadySent retry)", () => {
  const slug = "tmpcoralfreezealn-coral-freeze";
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, "2026-07-29-jade-w");
  mkdirSync(driverDir(runDir), { recursive: true });
  const dated = `${slug}-2026-07-29-jade-w`;      // status.json runId — the canonical form
  const dateless = `${slug}-jade-w`;              // delivery.json runId — the pre- packet form
  const outbox = join(ROOT, "prelim-outbox-forms");   // its OWN outbox: a leaked marker must never
  mkdirSync(outbox, { recursive: true });             // change what the shared-dir listing tests count
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: dated, slug, codename: "jade-w",
      agent: "clawdi", state: "delivered", markName: "ACME", sendPending: true }));
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: dateless }));
    const datedMarker = join(outbox, `${dated}.pending`);
    const datelessMarker = join(outbox, `${dateless}.pending`);
    writeFileSync(datedMarker, "clawdi\n");
    writeFileSync(datelessMarker, "clawdi\n");

    const r = markSent({ runId: dated, messageId: "<settle-1@mail>" });
    assert.equal(r.ok, true);
    assert.equal(r.alreadySent, false);
    assert.ok(!existsSync(datelessMarker), "the packet's own form is cleared, as it always was");
    assert.ok(!existsSync(datedMarker), "the resolved run's form is cleared too — no permanently orphaned sibling");

    // A marker re-dropped under EITHER form after the settle (the rescan re-arming, or one in flight
    // across a deploy) is still cleaned by the idempotent retry — the path that used to repeat the
    // single-form removal forever.
    writeFileSync(datedMarker, "clawdi\n");
    writeFileSync(datelessMarker, "clawdi\n");
    const again = markSent({ runId: dated });
    assert.equal(again.alreadySent, true, "still idempotent — a retried courier never reads its own success as failure");
    assert.ok(!existsSync(datedMarker) && !existsSync(datelessMarker), "the alreadySent path clears both forms too");

    // Asked for by the LEGACY id (resolveRun's historical arm): the same two forms go, nothing else does.
    writeFileSync(datedMarker, "clawdi\n");
    writeFileSync(datelessMarker, "clawdi\n");
    const bystander = join(outbox, "tmpx-bystander-jade-q.pending");
    writeFileSync(bystander, "clawdi\n");
    markSent({ runId: dateless });
    assert.ok(!existsSync(datedMarker) && !existsSync(datelessMarker));
    assert.ok(existsSync(bystander), "another run's marker is never touched");
    rmSync(bystander, { force: true });
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("start_run: with CLEAROTRON_QUEUE_DIR set and NO agent, enqueues into the headless queue (docs/INTAKE.md)", () => {
  const q = join(ROOT, "headless-queue");
  pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", q);
  process.env.TRADEMARK_MSGID_DOMAIN = "mcp.tenant-a.example";
  try {
    const r = startRun({ markName: "HEADLESSPROBE", forwarder: "jordan", classes: [9] });
    assert.equal(r.ok, true);
    assert.equal(r.queuePath, join(q, `${r.id}.json`));
    const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
    assert.match(job.msgId, /@mcp\.tenant-a\.example>$/, "msgId domain is tenant-config, not a baked-in host");
    // an EXPLICIT agent still routes to that agent's workspace queue, not the headless dir
    const r2 = startRun({ agent: "clawdi", markName: "WORKSPACEPROBE", forwarder: "jordan", classes: [9] });
    assert.equal(r2.queuePath, join(QUEUE, `${r2.id}.json`));
  } finally {
    pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", undefined);
    delete process.env.TRADEMARK_MSGID_DOMAIN;
  }
});

test("pure-MCP integrator loop: list_outbox_events -> get_delivery_packet -> ack_event", () => {
  const outbox = join(ROOT, "prelim-outbox");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    // one legacy delivered marker + one self-contained event packet
    writeFileSync(join(outbox, "tmpx-loop-jade-z.pending"), "clawdi\n");
    writeFileSync(join(outbox, "intake-badjob.failed.pending"), JSON.stringify({
      kind: "intake-rejected", classify: "clarify", base: "badjob", forwarder: "jordan",
      errors: ["missing mark name(s)"], text: "\u26a0\ufe0f Prelim request ...",
    }));

    const l = listOutboxEvents();
    assert.equal(l.count, 2);
    const kinds = Object.fromEntries(l.events.map((e) => [e.file, e.kind]));
    assert.equal(kinds["tmpx-loop-jade-z.pending"], "delivered", "legacy marker normalized");
    assert.equal(kinds["intake-badjob.failed.pending"], "intake-rejected", "JSON packet passthrough");
    const intake = l.events.find((e) => e.kind === "intake-rejected");
    assert.deepEqual(intake.errors, ["missing mark name(s)"], "packet content is self-contained");

    // get_delivery_packet: full payload + send-state for a delivered run
    const { runDir, runId } = makeRun({ slug: "tmpx-loop", codename: "2026-07-16-jade-z", state: "delivered" });
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId, slug: "tmpx-loop", codename: "2026-07-16-jade-z", agent: "clawdi", state: "delivered", markName: "ACME", sendPending: true }));
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: "tmpx-loop-jade-z", subject: "Preliminary clearance \u2014 ACME", emailBodyHtml: "<p>x</p>", forwarder: "jordan" }));
    const g = getDeliveryPacket({ runId });
    assert.equal(g.sendPending, true);
    assert.equal(g.sent, false);
    assert.equal(g.delivery.subject, "Preliminary clearance \u2014 ACME");
    assert.equal(g.failure, null);
    assert.throws(() => getDeliveryPacket({ runId: "no-such-run" }), /not found/);

    // ack_event: consumes exactly one event; idempotent; path-shaped names refused
    assert.deepEqual(ackEvent({ file: "intake-badjob.failed.pending" }), { ok: true, file: "intake-badjob.failed.pending", alreadyGone: false });
    assert.equal(existsSync(join(outbox, "intake-badjob.failed.pending")), false);
    assert.equal(ackEvent({ file: "intake-badjob.failed.pending" }).alreadyGone, true);
    assert.throws(() => ackEvent({ file: "../.matter-ledger.jsonl" }), /bare \*\.pending name/);
    assert.throws(() => ackEvent({ file: "status.json" }), /bare \*\.pending name/);
    assert.equal(listOutboxEvents().count, 1, "the delivered marker remains (mark_sent owns it)");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("stop_run by id: dequeues a not-yet-claimed job (real cancel, no spend)", () => {
  const r = startRun({ markName: "TODEQUEUE", forwarder: "requester", classes: [9] });
  assert.ok(existsSync(r.queuePath));
  const s = stopRun({ id: r.id });
  assert.equal(s.action, "dequeued");
  assert.ok(!existsSync(r.queuePath), "queue file removed");
  // second stop = not-found (idempotent, honest)
  assert.equal(stopRun({ id: r.id }).action, "not-found");
});

test("stop_run by runId: files a .cancel sentinel on a running run", () => {
  const { runDir, runId } = makeRun({ slug: "tmpc-cancel", codename: "2026-06-16-cancel-x" });
  const s = stopRun({ runId });
  assert.equal(s.action, "cancel-requested");
  assert.ok(existsSync(join(runDir, ".cancel")), ".cancel sentinel written");
  // — the request becomes a state the run CARRIES: stopRequestedAt rides
  // status.json (additive; writeRunStatus spread-merges, so later progress writes preserve it), and
  // the screen derives "Stopping…" from it beside a non-terminal state.
  const st = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(typeof st.stopRequestedAt, "string", "the stop request is visible in status.json");
  assert.notEqual(st.state, "cancelled", "…while the state stays truthful: the run is still running");
});

test("2076: a SECOND press is answered as already-stopping — the first request's timestamp is the one that counts", () => {
  // The owner pressed Stop, saw no change, and pressed again; each press implied a fresh act. The
  // marker was always idempotent; the ANSWER now is too, so the caller can say when the standing
  // request was filed instead of re-promising.
  const { runId } = makeRun({ slug: "tmpc-twice", codename: "2026-06-16-twice-x" });
  const first = stopRun({ runId });
  assert.equal(first.action, "cancel-requested");
  const second = stopRun({ runId });
  assert.equal(second.action, "already-stopping");
  assert.equal(second.requestedAt, first.requestedAt, "the standing request's own timestamp, not a new one");
  assert.match(second.note, /Pressing again changes nothing/);
});

test("stop_run by runId: noop on an already-terminal run", () => {
  const { runId } = makeRun({ slug: "tmpd-done", codename: "2026-06-16-done-x", state: "delivered" });
  assert.equal(stopRun({ runId }).action, "noop");
});

test("feed_context: writes the late-bind customer-bind.json + instructions sidecar", () => {
  const { runDir, runId } = makeRun({ slug: "tmpf-feed", codename: "2026-06-16-feed-x" });
  const r = feedContext({ runId, customer: "Globex", exclusions: ["Globex", "Globex Corp"], instructions: "treat ACME as expired" });
  assert.equal(r.ok, true);
  assert.ok(r.wrote.includes("customer-bind.json"));
  const bind = JSON.parse(readFileSync(join(runDir, "customer-bind.json"), "utf8"));
  assert.equal(bind.customer, "Globex");
  assert.deepEqual(bind.exclusions, ["Globex", "Globex Corp"]);
  assert.equal(bind.source, "mcp/feed_context");
  assert.ok(existsSync(driverDir(runDir, "fed-context.json")));
});

test("feed_context: errors when there is nothing to write", () => {
  const { runId } = makeRun({ slug: "tmpg-empty", codename: "2026-06-16-empty-x" });
  assert.throws(() => feedContext({ runId }), /nothing to write/);
});

test.after(() => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

// ---- search-depth spine: selectors, batch marks, filename hardening ----------

test("start_run: product rides the job; an unknown level is refused AT THE DOOR (clarify semantics)", () => {
  const r = startRun({ markName: "SPINE-L1", forwarder: "requester", classes: [9], product: "global-preliminary-search" });
  assert.equal(r.ok, true);
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.product, "global-preliminary-search");
  // AND THE GEOGRAPHY STAMP RIDES WITH IT. A Global preliminary search IS worldwide, so a request that
  // ordered one and named no territories has asked for everywhere — stamping "account-default" there
  // would send it down the ladder into the account's own territories and run a narrower search than the
  // one that was bought.
  assert.deepEqual(job.geography, { mode: "worldwide", origin: "request" });
  assert.throws(() => startRun({ markName: "SPINE-L2", forwarder: "requester", classes: [9], product: "stage-9" }),
    /names no search we offer/);
  assert.throws(() => startRun({ markName: "SPINE-L3", forwarder: "requester", classes: [9], product: "global-preliminary-search", recipeKey: "quick" }),
    /name ONE selector/);
});

test("start_run: marks[] batch form — one job carries every mark; markName defaults to the first", () => {
  // A BATCH IS A KNOCKOUT SEARCH, and it has to say so now. This case named no product, so the request
  // resolved through the scope to a Global preliminary search — which reads ONE name — and start_run
  // refuses it at the door instead of queueing three names for the runner to park hours later. Naming
  // the product is not a workaround: it is the request the batch form exists to make.
  const r = startRun({ forwarder: "requester", classes: [9], product: "knockout-search", marks: [{ name: "ALPHA", classes: [9] }, { name: "BETA" }, { name: "GAMMA", ref: "T3" }] });
  assert.equal(r.ok, true);
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.markName, "ALPHA");
  assert.deepEqual(job.marks.map((m) => m.name), ["ALPHA", "BETA", "GAMMA"]);
  assert.deepEqual(job.marks[2], { name: "GAMMA", ref: "T3" });
  assert.throws(() => startRun({ forwarder: "requester", classes: [9] }), /markName is required/);
  // markName "" is falsy-but-not-nullish: it must fall through to the first batch mark
  const blank = startRun({ markName: "", forwarder: "requester", classes: [9], product: "knockout-search", marks: [{ name: "DELTA" }] });
  assert.equal(JSON.parse(readFileSync(blank.queuePath, "utf8")).markName, "DELTA", "an empty markName never enqueues");
});

test("start_run/stop_run: a path-shaped id is refused (the queue-filename hardening)", () => {
  for (const id of ["../evil", "a/b", "..", ".hidden"]) {
    assert.throws(() => startRun({ markName: "SPINE-H", forwarder: "requester", classes: [9], id }), /bare filename slug/, `id ${id}`);
    assert.throws(() => stopRun({ id }), /bare filename slug/, `stop id ${id}`);
  }
  const ok = startRun({ markName: "SPINE-H2", forwarder: "requester", classes: [9], id: "mcp-spine.h2@test-1" });
  assert.equal(ok.ok, true, "the legacy id charset (dots/@/dashes) still passes");
});

test("start_run: deliveryRoute + parentRunId ride the job; an unbuilt route and a bad one are BOTH refused", () => {
  const r = startRun({ markName: "SPINE-R1", forwarder: "requester", classes: [9], deliveryRoute: "email", parentRunId: "spine-cedar-1" });
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.deliveryRoute, "email");
  assert.equal(job.parentRunId, "spine-cedar-1");
  // A route this build cannot honour is REFUSED HERE. This case used to assert that start_run QUEUED a
  // `deliveryRoute: "portal"` job — and the runner's wall and plan_run both refuse one, so the pin was on
  // the asymmetry itself: the tool the MCP schema OFFERS the field on accepted it, and the requester found
  // out at claim that their report was going out by email. Same sentence at every door now.
  assert.throws(() => startRun({ markName: "SPINE-R3", forwarder: "requester", classes: [9], deliveryRoute: "portal" }),
    /portal delivery lane ships with the portal/);
  assert.throws(() => startRun({ markName: "SPINE-R2", forwarder: "requester", classes: [9], deliveryRoute: "fax" }), /"email" or "portal"/);
});

// ── scope threading — attribution stamping + the stop_run queue-form account gate ────────
test("start_run stamps the VERIFIED principal (scope.sub) as enqueuedBy; no scope = no stamp; body cannot supply it", () => {
  const r = startRun({ markName: "ATTRIB", forwarder: "req", classes: [9], profileKey: "generic",
    enqueuedBy: "attacker@evil" }, { scope: { kind: "ops", sub: "portal-poc" } });
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.equal(job.enqueuedBy, "portal-poc", "attribution = the token's sub, never the body");
  rmSync(r.queuePath, { force: true });
  const r2 = startRun({ markName: "ATTRIB2", forwarder: "req", classes: [9], profileKey: "generic", enqueuedBy: "attacker@evil" });
  const job2 = JSON.parse(readFileSync(r2.queuePath, "utf8"));
  assert.equal(job2.enqueuedBy, undefined, "a body-supplied enqueuedBy is ignored by construction");
  rmSync(r2.queuePath, { force: true });
});

test("stop_run (queue-id form): scoped sessions get 'not-found' for foreign jobs (existence never leaks); granted dequeues; full-grant unrestricted", () => {
  const mine = startRun({ markName: "MINE", forwarder: "req", classes: [9], profileKey: "aurora" });
  const foreign = startRun({ markName: "THEIRS", forwarder: "req", classes: [9], profileKey: "zephyr" });
  const scoped = { kind: "ops", sub: "portal-poc", accounts: ["aurora"] };
  const denied = stopRun({ id: foreign.id }, { scope: scoped });
  assert.equal(denied.action, "not-found", "a foreign queued job answers EXACTLY like a nonexistent one (review 2026-07-18: the old deny named the owning account)");
  assert.ok(existsSync(foreign.queuePath), "the foreign job survives the probe untouched");
  const ok = stopRun({ id: mine.id }, { scope: scoped });
  assert.equal(ok.action, "dequeued");
  const full = stopRun({ id: foreign.id }, { scope: { kind: "ops", sub: "x", accounts: "*" } });
  assert.equal(full.action, "dequeued", "a full-grant session dequeues anything");
  // scoped start_run must name profileKey explicitly (the forwarderDomain resolution bypass is closed)
  assert.throws(() => startRun({ markName: "X", forwarder: "req", classes: [9] }, { scope: scoped }), /profileKey explicitly/);
});

test("start_run: per-run scope rides the MCP door and lands NORMALIZED in the queue file", () => {
  // The point of the whole exercise: an agent can state where to search, not just what. The door passes
  // scope through verbatim and validateJob owns the vocabulary, so the MCP surface cannot drift from the
  // CLI or the portal — all three share one validator.
  const r = startRun({
    markName: "SCOPEPROBE", forwarder: "requester", classes: [9],
    jurisdictions: ["US", "us", "  EU  "], platforms: ["gnc.com"], profileKey: "generic",
  });
  assert.equal(r.ok, true);
  const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
  assert.deepEqual(job.jurisdictions, ["US", "EU"], "deduped and trimmed by the shared validator before the write");
  assert.deepEqual(job.platforms, ["gnc.com"]);
});

test("start_run: a bad territory or platform is refused at the door, before anything is queued", () => {
  const before = readdirSync(QUEUE).length;
  assert.throws(
    () => startRun({ markName: "BADJX", forwarder: "requester", classes: [9], jurisdictions: ["X"] }),
    /2–40 characters/,
  );
  assert.throws(
    () => startRun({ markName: "BADPLAT", forwarder: "requester", classes: [9], platforms: ["web"] }),
    /general-web cell is implicit/,
  );
  assert.throws(
    () => startRun({ markName: "BADCLASS", forwarder: "requester", classes: [99] }),
    /whole numbers 1–45/,
  );
  assert.equal(readdirSync(QUEUE).length, before, "a refused job writes NOTHING — no spend, no queue litter");
});

// ── the client ACCOUNT principal cannot cancel another account's queued job ───────────────────────
// stop_run's runId form is gated at the dispatch chokepoint (server.mjs, assertAccountAccess on the
// resolved run). Its ID form is NOT — a queued job has no run yet, so that gate never fires and the
// scoping has to live in stopRun's own scopedOut(). That makes this the one accountSafe tool whose
// isolation is invisible from the authorize() tests, which is exactly why it gets its own case: "scoped
// to your own account" is the sales promise, and a cross-account cancel undercuts it directly.
//
// Queue files are written directly rather than via startRun: the profileKey validator only accepts keys
// in the customer registry, and what is under test here is scopedOut reading a manifest, not intake.
const ACCT = (accounts) => ({ kind: "account", runId: null, sub: "lawyer@acme.example", verbs: null, accounts });
function queueFile(id, profileKey, ext = "json") {
  mkdirSync(QUEUE, { recursive: true });
  const p = join(QUEUE, `${id}.${ext}`);
  writeFileSync(p, JSON.stringify({ id, markName: "X", forwarder: "r", profileKey }));
  return p;
}

test("stop_run by id: a foreign queued job answers exactly like a nonexistent one", () => {
  const p = queueFile("job-theirs", "other-co");
  const s = stopRun({ id: "job-theirs" }, { scope: ACCT(["acme"]) });
  assert.equal(s.action, "not-found", "a client cancelled another account's queued job");
  assert.ok(!/other-co/.test(JSON.stringify(s)), "the refusal named the owning account — ownership must not leak");
  assert.ok(existsSync(p), "the foreign job was removed from the queue");
});

test("stop_run by id: an account CAN cancel its own queued job", () => {
  const p = queueFile("job-mine", "acme");
  const s = stopRun({ id: "job-mine" }, { scope: ACCT(["acme"]) });
  assert.equal(s.action, "dequeued");
  assert.ok(!existsSync(p));
});

test("stop_run by id: a CLAIMED foreign job is gated too, and an unreadable manifest fails CLOSED", () => {
  queueFile("job-claimed", "other-co", "processing");
  assert.equal(stopRun({ id: "job-claimed" }, { scope: ACCT(["acme"]) }).action, "not-found");
  // a manifest that cannot be parsed must not read as "no account, therefore allowed"
  writeFileSync(join(QUEUE, "job-claimed.processing"), "{ not json");
  assert.equal(stopRun({ id: "job-claimed" }, { scope: ACCT(["acme"]) }).action, "not-found");
});

test("stop_run by id: an untagged (pre-grants) job is NOT cancellable by a scoped client", () => {
  queueFile("job-untagged", undefined);
  assert.equal(stopRun({ id: "job-untagged" }, { scope: ACCT(["acme"]) }).action, "not-found");
});

// ── the failure notice settles ───────────────────────────────────────────────────────────────────────
//
// When a run dies, the backstop lane gives the notice the same guaranteed treatment as a delivery
// ( T5): a code-authored `_driver/failure.json`, status.sendPending = true, and a `<runId>.pending`
// wake marker. The courier sends it and calls mark_sent to settle — and mark_sent threw, because it looked
// only for `_driver/delivery.json` and a failed run has never had one.
//
// The consequence was not a stuck marker. It was a REPEATING one: outbox-backoff re-arms on exactly
// "sendPending === true and no .sent", so the client received the same failure notice on every sweep until
// somebody deleted the file by hand. The lane built so a failure could never be silent had made it
// impossible to quieten.

const failedRunWithNotice = (slug, codename) => {
  const { runDir, runId } = makeRun({ slug, codename, state: "failed" });
  const outbox = join(ROOT, "prelim-outbox");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  const packetRunId = `${slug}-${codename.split("-").slice(3).join("-")}`;
  // Exactly what the backstop writer leaves behind (pipeline.mjs, the `if (!failPingSent)` arm).
  writeFileSync(driverDir(runDir, "failure.json"), JSON.stringify({
    kind: "run-failed", runId: packetRunId, failedStage: "synthesis", reason: "provider outage",
  }));
  const marker = join(outbox, `${packetRunId}.pending`);
  writeFileSync(marker, "clawdi\n");
  const sp = join(runDir, "status.json");
  writeFileSync(sp, JSON.stringify({ runId, slug, codename, agent: "clawdi", state: "failed", markName: "ACME", sendPending: true }));
  return { runDir, runId, marker, sp };
};

test("MARK_SENT SETTLES A FAILURE NOTICE — no delivery packet, and that is the normal case for a dead run", () => {
  const { runDir, runId, marker, sp } = failedRunWithNotice("tmpx-failnotice", "2026-07-27-amber-z");
  try {
    const r = markSent({ runId, messageId: "<failed-1@mail>" });
    assert.equal(r.ok, true);
    assert.equal(r.alreadySent, false);
    assert.equal(JSON.parse(readFileSync(sp, "utf8")).sendPending, false, "sendPending flipped — this is what stops the repeat");
    assert.ok(!existsSync(marker), "the wake marker is gone, so outbox-backoff has nothing to re-arm from");
    assert.ok(existsSync(join(runDir, ".sent")), "and the receipt exists");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("the receipt records WHICH packet it settled — 'we told them it failed' is not 'they got their report'", () => {
  const { runDir, runId } = failedRunWithNotice("tmpx-failkind", "2026-07-27-basalt-z");
  try {
    markSent({ runId, messageId: "<failure-notice-1@mail>" });   // a notice is an email too — its id is the evidence
    assert.equal(JSON.parse(readFileSync(join(runDir, ".sent"), "utf8")).settled, "failure");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("a run that failed and was then DELIVERED settles against the delivery — the newer, truer record", () => {
  // A repaired run keeps its failure.json (the forensic record is deliberately never deleted on that path).
  // Settling it as a failure would file a receipt saying the client was told it died, on a run where they
  // received their report.
  const { runDir, runId } = failedRunWithNotice("tmpx-recovered", "2026-07-27-cobalt-z");
  try {
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: "tmpx-recovered-cobalt-z" }));
    markSent({ runId, messageId: "<delivery-2@mail>" });
    assert.equal(JSON.parse(readFileSync(join(runDir, ".sent"), "utf8")).settled, "delivery");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("still idempotent on the failure path — a retried courier is not an error", () => {
  const { runId, marker } = failedRunWithNotice("tmpx-failretry", "2026-07-27-dune-z");
  try {
    markSent({ runId, messageId: "<failure-notice-3@mail>" });
    writeFileSync(marker, "clawdi\n");            // a killed first call, or a sweep that re-armed before the flip landed
    const again = markSent({ runId });
    assert.equal(again.alreadySent, true);
    assert.ok(!existsSync(marker), "and the orphan is cleared on the retry, same as the delivery path");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});

test("a run with NEITHER packet is still refused — this widened the door, it did not remove it", () => {
  const { runId } = makeRun({ slug: "tmpx-nopacket", codename: "2026-07-27-elm-z", state: "failed" });
  assert.throws(() => markSent({ runId }), /no delivery or failure packet/);
});

// ---- audit item 7: settling requires evidence — a receipt, never an intention --------------------------
test("mark_sent: refuses without evidence; records an out-of-band attestation VERBATIM", () => {
  // The delivered-run incident this closes: the email was BLOCKED on the send allowlist, the courier
  // called mark_sent anyway, .sent landed with messageId:null — and the .sent guard then suppressed
  // every retry while STATUS.md still said SEND PENDING. A settle without evidence is that lie's door.
  const { runDir, runId } = makeRun({ slug: "tmpx-evidence", codename: "2026-07-31-ivory-y", state: "delivered" });
  const outbox = join(ROOT, "prelim-outbox");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: "tmpx-evidence-ivory-y" }));
    const marker = join(outbox, "tmpx-evidence-ivory-y.pending");
    writeFileSync(marker, "clawdi\n");
    const sp = join(runDir, "status.json");
    writeFileSync(sp, JSON.stringify({ runId, slug: "tmpx-evidence", codename: "2026-07-31-ivory-y", agent: "clawdi", state: "delivered", markName: "ACME", sendPending: true }));

    // No messageId, no attestation → refused, and NOTHING settles: the marker stays (the send is still
    // owed), sendPending stays true, no .sent exists to suppress the retries.
    assert.throws(() => markSent({ runId }), /without send evidence/);
    assert.throws(() => markSent({ runId, messageId: "   " }), /without send evidence/, "whitespace is not a receipt");
    assert.ok(!existsSync(join(runDir, ".sent")), "no evidence, no receipt file");
    assert.ok(existsSync(marker), "the outbox marker survives — the send stays owed");
    assert.equal(JSON.parse(readFileSync(sp, "utf8")).sendPending, true, "still pending — that is the truth");

    // An explicit out-of-band attestation settles, recorded verbatim beside a null messageId.
    const said = "relayed via WhatsApp to the requesting lawyer at 14:02 CEST, 2026-07-31 (no email messageId — the mail lane was blocked)";
    const r = markSent({ runId, attestation: `  ${said}  ` });
    assert.equal(r.ok, true);
    const sent = JSON.parse(readFileSync(join(runDir, ".sent"), "utf8"));
    assert.equal(sent.messageId, null);
    assert.equal(sent.attestation, said, "the courier's exact words — an auditor reads what was claimed, verbatim");
    assert.equal(sent.settled, "delivery");
    assert.equal(JSON.parse(readFileSync(sp, "utf8")).sendPending, false);
    assert.ok(!existsSync(marker), "outbox marker cleared on the evidenced settle");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
  }
});


test("mark_sent: a marker minted under the DERIVED <slug>-<codename> form is cleared too — the courier never re-sends", () => {
  // Review NOTE 2 on the dual-form fix: clearMarker unioned only the three OBSERVED ids (packet,
  // resolved run, args), while rescanOwedRuns DERIVES the legacy `<slug>-<codename>` name. A marker
  // minted under the derived name — packet since rewritten with the dated id — is named by none of the
  // three and survived the settle. Not permanent (list_outbox_events hands the courier the marker's own
  // name next pass) but the recovery costs a RE-SEND: the deliver skill sends BEFORE mark_sent, so the
  // reader gets the report twice.
  const slug = "tmpz-legacyform";
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, "2026-07-31-slate-heron");
  mkdirSync(driverDir(runDir), { recursive: true });
  const dated = `${slug}-2026-07-31-slate-heron`;
  const derived = `${slug}-slate-heron`;              // what rescanOwedRuns would mint; named by NO observed id
  const outbox = join(ROOT, "prelim-outbox-derived");
  mkdirSync(outbox, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);
  try {
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: dated, slug, codename: "slate-heron",
      agent: "clawdi", state: "delivered", markName: "ACME", sendPending: true }));
    writeFileSync(driverDir(runDir, "delivery.json"), JSON.stringify({ runId: dated }));  // packet carries the DATED id
    const derivedMarker = join(outbox, `${derived}.pending`);
    const bystander = join(outbox, `${slug}-2026-07-30-other-heron.pending`);   // a DIFFERENT run
    writeFileSync(derivedMarker, "clawdi\n");
    writeFileSync(bystander, "clawdi\n");

    const r = markSent({ runId: dated, messageId: "<settle-derived@mail>" });
    assert.equal(r.ok, true);
    assert.ok(!existsSync(derivedMarker), "the derived <slug>-<codename> marker is cleared — no re-send, no duplicate report");
    assert.ok(existsSync(bystander), "a DIFFERENT run's marker is untouched");
  } finally {
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", undefined);
    rmSync(runDir, { recursive: true, force: true });
  }
});
