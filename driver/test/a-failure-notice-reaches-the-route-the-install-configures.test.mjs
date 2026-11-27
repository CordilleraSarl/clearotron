// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A FAILURE NOTICE REACHES THE ROUTE THE INSTALL CONFIGURES. An install with no courier names a receiver on this
// machine, and the worker sends each owed notice there itself: the person who placed an order refused before it ran,
// the person whose run stopped, and the operator for what only the operator can fix. Each notice is recorded from
// first sight to confirmed delivery, across restarts, and nothing is sent twice that the receiver cannot drop.
//
// Driven offline: the submission door (the CLI), the worker (the real runner, against the mock engine, as systemd runs
// it), and a receiver on loopback that records what it is sent and to whom. No model, no paid lookup, no real notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CLI = join(HERE, "..", "enqueue.mjs");
const RUNNER = join(HERE, "..", "runner.mjs");
chmodSync(CLAUDE, 0o755);

/**
 * A receiver on loopback: records each notice it takes, with the id it was sent under. `mode` is "accept" (a bare
 * 2xx), "receipt" (a 2xx that says it sent the notice on, with the downstream message's id) or "silent".
 * `beforeAnswer(notice)`, when set, runs once before the next answer: what happens to the run while a notice is with
 * the receiver, so its answer arrives late.
 */
async function receiver({ dedupe = false } = {}) {
  const records = [], seen = new Set();
  const state = { mode: "accept", beforeAnswer: null };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      if (state.mode === "silent") return;   // takes the request and never answers
      const key = req.headers["idempotency-key"];
      const notice = JSON.parse(body);
      if (!(dedupe && seen.has(key))) records.push({ key, notice });
      seen.add(key);
      const meanwhile = state.beforeAnswer;
      state.beforeAnswer = null;
      if (meanwhile) await meanwhile(notice);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(state.mode === "receipt" ? JSON.stringify({ sent: { messageId: `downstream-${key}` } }) : "{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/notices`;
  return { url, records, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

/** An install of its own, every folder under one root. */
function install() {
  const root = mkdtempSync(join(tmpdir(), "notice-route-"));
  const qdir = join(root, "intake-queue");
  mkdirSync(qdir, { recursive: true });
  return {
    root, qdir, outbox: join(root, "clearance-outbox"),
    env: {
      CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
      CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_QUEUE_DIR: qdir,
      CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
      CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",
      CLEAROTRON_QUEUE_SCAN_MS: "100",
    },
  };
}

function submit(box, id, profileKey, extra = {}) {
  const file = join(box.root, `${id}.request.json`);
  writeFileSync(file, JSON.stringify({ id, profileKey, markName: `${profileKey.toUpperCase()} NOTICE PROBE`, classes: [9],
    goods: "downloadable software", forwarder: `${profileKey}-desk`, forwarderEmail: `desk@${profileKey}.example`, ...extra }));
  const r = spawnSync(process.execPath, [CLI, "--job", file], { env: { ...process.env, ...box.env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/**
 * The worker exactly as systemd starts it: one drain, then one notice pass. Spawned without blocking, because the
 * receiver answers from this process.
 */
function drain(box, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER], { env: { ...process.env, ...box.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`runner exited ${code}\n${out.slice(-4000)}`)); });
  });
}

const deliveries = (box) => {
  const dir = join(box.outbox, "deliveries");
  try { return readdirSync(dir).filter((n) => /^[0-9a-f]{24}\.json$/.test(n)).map((n) => JSON.parse(readFileSync(join(dir, n), "utf8"))); }
  catch { return []; }
};
/** The run stops again after a resume, as the runner records it: a new failure packet, and the earlier send's receipt removed. */
async function stopsAgain(runDir, runId) {
  const { buildFailurePacket } = await import("../run-outcome.mjs");
  const { paths } = await import("../run-record.mjs");
  const packet = buildFailurePacket({ runId, agent: "zephyr", job: { markName: "ZEPHYR NOTICE PROBE" }, failedStage: "record_matter_frame",
    shortReason: "stopped again", reasonVerbatim: "stopped again" });
  rmSync(join(runDir, ".sent"), { force: true });
  writeFileSync(paths(runDir).failure, JSON.stringify(packet, null, 2) + "\n");
  const sp = join(runDir, "status.json");
  writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, "utf8")), state: "failed", sendPending: true }));
  return packet.failureId;
}

/** The run recovers and finishes, as the delivery handoff records it: its report is owed and its failure packet is gone. */
async function recovers(runDir, runId) {
  const { paths } = await import("../run-record.mjs");
  rmSync(paths(runDir).failure, { force: true });
  writeFileSync(paths(runDir).delivery, JSON.stringify({ runId: runId ?? null, subject: "an invented report" }));
  const sp = join(runDir, "status.json");
  writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, "utf8")), state: "delivered", sendPending: true }));
}

const failureIdOf = async (runDir) => {
  const { paths } = await import("../run-record.mjs");
  return JSON.parse(readFileSync(paths(runDir).failure, "utf8")).failureId;
};
const sentOf = (runDir) => (existsSync(join(runDir, ".sent")) ? JSON.parse(readFileSync(join(runDir, ".sent"), "utf8")) : null);
const owesASend = (runDir) => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).sendPending === true;

// Every setting named every time, so one test's setting never carries into the next through the pinned environment.
const routeEnv = (url, audiences, extra = {}) => ({ CLEAROTRON_NOTICE_URL: url, CLEAROTRON_NOTICE_AUDIENCES: audiences, CLEAROTRON_NOTICE_DEDUPE: "", ...extra });

test("the worker tells each company's submitter, and the operator, through the configured route, and nothing twice", async () => {
  const box = install();
  const rx = await receiver();
  try {
    submit(box, "notice-a-refused", "demo-brand-owner");                 // a demo account without the demo marker: refused at the claim
    submit(box, "notice-b-stops", "zephyr", { demoRun: true });           // a run that stops at its first stage
    const env = routeEnv(rx.url, "submitter,operator", { MOCK_FAIL_STAGE: "record_matter_frame" });
    rx.state.mode = "receipt";   // the receiver sends each notice on, and says so
    await drain(box, env);

    const byKind = (kind, audience) => rx.records.filter((r) => r.notice.kind === kind && r.notice.audience === audience);
    // Refused before any run existed: its submitter is told, with the runner's reason and no run id.
    const [refused] = byKind("order-refused", "submitter");
    assert.ok(refused, JSON.stringify(rx.records.map((r) => r.notice)));
    assert.deepEqual([refused.notice.order.reference, refused.notice.order.state, refused.notice.order.runId],
      ["notice-a-refused", "refused", null]);
    assert.ok(refused.notice.order.reason?.length > 10, "the reason the runner recorded");
    assert.deepEqual([refused.notice.recipient.account, refused.notice.recipient.forwarderEmail], ["demo-brand-owner", "desk@demo-brand-owner.example"]);
    // Refused at the claim, on the order's own account: nothing for the operator to fix.
    assert.equal(byKind("order-refused", "operator").length, 0);

    // A run that stopped: its submitter is told it stopped, with its run id and no diagnostics; the operator gets the fault.
    const [stopped] = byKind("run-stopped", "submitter");
    assert.ok(stopped, JSON.stringify(rx.records.map((r) => r.notice)));
    assert.deepEqual([stopped.notice.order.reference, stopped.notice.order.state, stopped.notice.order.reason],
      ["notice-b-stops", "failed", null]);
    assert.match(stopped.notice.order.runId ?? "", /-\d{4}-\d{2}-\d{2}-/);
    assert.deepEqual([stopped.notice.recipient.account, stopped.notice.recipient.forwarderEmail], ["zephyr", "desk@zephyr.example"]);
    const [fault] = byKind("run-stopped", "operator");
    assert.deepEqual([fault.notice.recipient, fault.notice.fault.nextAction, fault.notice.fault.runId], [{ role: "operator" }, "read-the-run", stopped.notice.order.runId]);
    assert.ok(fault.notice.fault.reason, "the operator is told why");

    // Neither company's notice carries anything of the other's.
    for (const r of rx.records.filter((x) => x.notice.audience === "submitter")) {
      const other = r.notice.recipient.account === "zephyr" ? ["demo-brand-owner", "notice-a-refused"] : ["zephyr", "notice-b-stops"];
      for (const word of other) assert.doesNotMatch(JSON.stringify(r.notice), new RegExp(word), `${r.notice.recipient.account}'s notice names ${word}`);
    }

    // Every notice is recorded confirmed, and the receiver's downstream receipt settles the stopped run's owed send as
    // mark_sent settles it, with the downstream message's id, never the delivery id.
    assert.equal(rx.records.length, 3, JSON.stringify(rx.records.map((r) => [r.notice.kind, r.notice.audience])));
    assert.deepEqual(deliveries(box).map((d) => d.state), ["confirmed", "confirmed", "confirmed"]);
    const result = JSON.parse(readFileSync(join(box.qdir, "notice-b-stops.failed.result"), "utf8"));
    const sent = JSON.parse(readFileSync(join(result.runDir, ".sent"), "utf8"));
    assert.deepEqual([sent.via, sent.settled, sent.messageId], ["notice-route", "failure", `downstream-${stopped.key}`]);
    assert.equal(JSON.parse(readFileSync(join(result.runDir, "status.json"), "utf8")).sendPending, false);

    // The worker runs again, and a marker is dropped again for the run: nothing is sent a second time.
    writeFileSync(join(box.outbox, `${stopped.notice.order.runId}.failed.pending`), "{}");
    await drain(box, env);
    assert.equal(rx.records.length, 3, "no notice twice");
    assert.equal(deliveries(box).length, 3, "no second record for a re-dropped marker");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("with a courier declared for submitters, the route carries the operator's notices only, and the outbox is the courier's", async () => {
  const box = install();
  const rx = await receiver();
  try {
    submit(box, "courier-a-refused", "demo-brand-owner");
    submit(box, "courier-b-stops", "zephyr", { demoRun: true });
    await drain(box, routeEnv(rx.url, "operator", { MOCK_FAIL_STAGE: "record_matter_frame" }));
    assert.deepEqual([...new Set(rx.records.map((r) => r.notice.audience))], ["operator"], JSON.stringify(rx.records.map((r) => r.notice)));
    // The courier's packets are where it expects them, and the stopped run is still owed its send.
    const pending = readdirSync(box.outbox).filter((n) => n.endsWith(".pending"));
    assert.ok(pending.some((n) => n.startsWith("intake-courier-a-refused")), JSON.stringify(pending));
    assert.ok(pending.some((n) => n.endsWith(".failed.pending") && !n.startsWith("intake-")), JSON.stringify(pending));
    const result = JSON.parse(readFileSync(join(box.qdir, "courier-b-stops.failed.result"), "utf8"));
    assert.equal(existsSync(join(result.runDir, ".sent")), false, "the courier still owes the person their notice");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("with no route configured, the worker sends nothing and records nothing", async () => {
  const box = install();
  try {
    submit(box, "plain-a-refused", "demo-brand-owner");
    await drain(box);
    assert.equal(existsSync(join(box.outbox, "deliveries")), false);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

// ── THE RECEIVER'S SIDE OF IT: unreachable, and the stop between its answer and the record ──────────────────────────

/** An order refused at the claim, as the runner leaves it, for one company; `at` dates its files. */
function refusedOrder(box, id, profileKey, { at = null, ...job } = {}) {
  const files = [join(box.qdir, `${id}.failed`), join(box.qdir, `${id}.failed.reason`)];
  writeFileSync(files[0], JSON.stringify({ id, profileKey, markName: "PROBE", forwarder: `${profileKey}-desk`, forwarderEmail: `desk@${profileKey}.example`, ...job }));
  writeFileSync(files[1], "The order was refused at the claim.\nnotify: sent\n");
  if (at != null) for (const f of files) utimesSync(f, new Date(at), new Date(at));
}

async function pass(box, env, opts = {}) {
  for (const [k, v] of Object.entries({ ...box.env, ...env })) pinEnv(process.env, k, v);
  const { deliverNotices, markRouteSeen } = await import("../notice-delivery.mjs");
  return { deliverNotices, markRouteSeen, out: opts.skip ? null : await deliverNotices({ env: process.env, ...opts }) };
}

test("an unreachable receiver leaves the notice failed and owed; the next pass after the wait delivers it, once", async () => {
  const box = install();
  const rx = await receiver();
  try {
    const { markRouteSeen } = await pass(box, routeEnv(rx.url, "submitter"), { skip: true });
    markRouteSeen({ env: process.env, now: Date.now() - 60_000 });
    refusedOrder(box, "unreach-a", "demo-brand-owner");
    const down = await pass(box, routeEnv("http://127.0.0.1:9/notices", "submitter"));
    assert.equal(down.out.sent, 1);
    const [rec] = deliveries(box);
    assert.equal(rec.state, "failed");
    assert.equal(rec.attempts[0].detail, "ECONNREFUSED");
    assert.ok(Date.parse(rec.nextAttemptAt) > Date.now(), "sent again only after a wait");
    // Before the wait is out, nothing is sent; after it, the notice reaches the receiver, under the same id.
    assert.equal((await pass(box, routeEnv(rx.url, "submitter"))).out.sent, 0);
    const later = Date.parse(rec.nextAttemptAt) + 1000;
    const up = await pass(box, routeEnv(rx.url, "submitter"), { now: () => later });
    assert.deepEqual([up.out.sent, up.out.confirmed], [1, 1]);
    assert.deepEqual(rx.records.map((r) => r.key), [rec.id]);
    assert.equal(deliveries(box)[0].state, "confirmed");
    assert.deepEqual(deliveries(box)[0].attempts.map((a) => a.outcome), ["failed", "confirmed"]);
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

/** A pass in a process of its own that stops dead between the receiver's answer and the record being written. */
function passThatStops(box, env) {
  const script = `
    const { deliverNotices } = await import(${JSON.stringify(join(HERE, "..", "notice-delivery.mjs"))});
    await deliverNotices({ afterAccepted: () => process.exit(9) });
    process.exit(0);`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, ...box.env, ...env }, stdio: "inherit" });
    child.on("exit", (code) => resolve(code));
  });
}

for (const dedupe of [false, true]) {
  test(`restart after the receiver took a notice and before it was recorded: ${dedupe ? "a receiver that drops repeats is sent it again and holds one" : "left ambiguous for the operator, never sent twice"}`, async () => {
    const box = install();
    const rx = await receiver({ dedupe });
    const env = routeEnv(rx.url, "submitter", dedupe ? { CLEAROTRON_NOTICE_DEDUPE: "1" } : {});
    try {
      const { markRouteSeen } = await pass(box, env, { skip: true });
      markRouteSeen({ env: process.env, now: Date.now() - 60_000 });
      refusedOrder(box, "restart-a", "demo-brand-owner");
      assert.equal(await passThatStops(box, env), 9, "the process stopped at the seam");
      assert.equal(rx.records.length, 1, "the receiver holds the notice");
      assert.equal(deliveries(box)[0].state, "attempted", "the record never heard the answer");

      const { out } = await pass(box, env);   // a fresh worker takes over
      const [rec] = deliveries(box);
      if (dedupe) {
        assert.deepEqual([out.sent, rec.state], [1, "confirmed"]);
        assert.equal(rx.records.length, 1, "the receiver dropped the repeat, under the same id");
      } else {
        assert.deepEqual([out.sent, rec.state], [0, "ambiguous"]);
        assert.equal(rx.records.length, 1, "never sent twice to a receiver that cannot drop a repeat");
        const { undeliveredNotices } = await import("../notice-delivery.mjs");
        assert.deepEqual(undeliveredNotices().map((n) => [n.state, n.nextAction]), [["ambiguous", "settle-with-receiver"]]);
      }
    } finally {
      await rx.close();
      rmSync(box.root, { recursive: true, force: true });
    }
  });
}

test("a receiver that takes the request and never answers leaves the notice ambiguous", async () => {
  const box = install();
  const rx = await receiver();
  rx.state.mode = "silent";
  try {
    const { markRouteSeen } = await pass(box, routeEnv(rx.url, "submitter"), { skip: true });
    markRouteSeen({ env: process.env, now: Date.now() - 60_000 });
    refusedOrder(box, "silent-a", "demo-brand-owner");
    const { postNotice } = await import("../notice-route.mjs");
    const { out } = await pass(box, routeEnv(rx.url, "submitter"), { post: (url, body, o) => postNotice(url, body, { ...o, timeoutMs: 300 }) });
    assert.equal(out.sent, 1);
    assert.equal(deliveries(box)[0].state, "ambiguous");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("an audience moved from the courier to the route is told nothing the courier already told it", async () => {
  const box = install();
  const rx = await receiver();
  const t = Date.now();
  try {
    const { markRouteSeen } = await pass(box, routeEnv(rx.url, "operator"), { skip: true });
    markRouteSeen({ env: process.env, now: t - 120_000 });                 // the route serves the operator; a courier, submitters
    refusedOrder(box, "handover-before", "demo-brand-owner", { at: t - 60_000 });
    await pass(box, routeEnv(rx.url, "operator"));
    assert.equal(rx.records.length, 0, "a refusal at the claim is the submitter's, and the courier holds them");
    // The install drops its courier: the route now serves submitters too, from this moment.
    pinEnv(process.env, "CLEAROTRON_NOTICE_AUDIENCES", "submitter,operator");
    markRouteSeen({ env: process.env, now: t - 30_000 });
    refusedOrder(box, "handover-after", "demo-brand-owner", { at: t });
    await pass(box, routeEnv(rx.url, "submitter,operator"));
    assert.deepEqual(rx.records.map((r) => r.notice.order?.reference), ["handover-after"],
      "the refusal the courier held is not sent again; the one after the switch is");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("two Generic organisations: each submitter gets its own notice, naming nothing of the other", async () => {
  const box = install();
  const rx = await receiver();
  try {
    const { markRouteSeen } = await pass(box, routeEnv(rx.url, "submitter"), { skip: true });
    markRouteSeen({ env: process.env, now: Date.now() - 60_000 });
    // The same desk, ordering for two organisations' Generic: two recipients, not one.
    for (const [id, tenant] of [["generic-x", "orgx"], ["generic-y", "orgy"]])
      refusedOrder(box, id, "generic", { tenant, forwarder: "shared-desk", forwarderEmail: "desk@shared.example" });
    await pass(box, routeEnv(rx.url, "submitter"));
    const got = rx.records.map((r) => [r.notice.order.reference, r.notice.recipient.organisation]).sort();
    assert.deepEqual(got, [["generic-x", "orgx"], ["generic-y", "orgy"]]);
    assert.equal(new Set(rx.records.map((r) => r.key)).size, 2, "two delivery ids");
    for (const r of rx.records) {
      const other = r.notice.recipient.organisation === "orgx" ? ["orgy", "generic-y"] : ["orgx", "generic-x"];
      for (const word of other) assert.doesNotMatch(JSON.stringify(r.notice), new RegExp(word));
    }
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a route that is not on this machine, or serves no audience, sends nothing", async () => {
  const { noticeRoute } = await import("../notice-route.mjs");
  assert.deepEqual(noticeRoute({}), { configured: false });
  assert.equal(noticeRoute({ CLEAROTRON_NOTICE_URL: "https://notices.example.com/in", CLEAROTRON_NOTICE_AUDIENCES: "operator" }).problem, "url-not-loopback");
  assert.equal(noticeRoute({ CLEAROTRON_NOTICE_URL: "http://127.0.0.1:8080/in" }).problem, "no-audience");
  assert.equal(noticeRoute({ CLEAROTRON_NOTICE_URL: "http://127.0.0.1:8080/in", CLEAROTRON_NOTICE_AUDIENCES: "everyone" }).problem, "audience-unknown");
  const ok = noticeRoute({ CLEAROTRON_NOTICE_URL: "http://[::1]:8080/in", CLEAROTRON_NOTICE_AUDIENCES: "operator, submitter", CLEAROTRON_NOTICE_DEDUPE: "1" });
  assert.deepEqual([ok.ok, ok.audiences, ok.dedupe], [true, ["submitter", "operator"], true]);
});

// ── A FINISHED REPORT WHOSE SEND FAILED (design, 2026-11-26: the route carries failures only) ──────────────────────

/** The courier's wake, as the outbox's own breaker judges it: an ok turn that left the markers where they were. */
function courierWakeThatDeliversNothing(box) {
  const r = spawnSync(process.execPath, [join(HERE, "..", "outbox-backoff.mjs"), "settle", "localagent", "0"],
    { input: JSON.stringify({ status: "ok", result: {} }), env: { ...process.env, ...box.env, CLEAROTRON_OUTBOX_NOPROGRESS_MAX: "2" }, encoding: "utf8" });
  return r.stdout.trim();
}

test("a finished report the courier cannot send: the operator is alerted once, the report stays owed, and the courier's delivery settles it with no second search", async () => {
  const box = install();
  const rx = await receiver();
  const env = routeEnv(rx.url, "submitter,operator");
  try {
    submit(box, "stuck-b-delivers", "zephyr", { demoRun: true });
    await drain(box, env);
    const result = JSON.parse(readFileSync(join(box.qdir, "stuck-b-delivers.done.result"), "utf8"));
    const status = () => JSON.parse(readFileSync(join(result.runDir, "status.json"), "utf8"));
    assert.equal(status().sendPending, true, "guard: the report is owed its send");
    assert.equal(rx.records.length, 0, "a finished report is the courier's to deliver: the route sends nothing for it");
    // The courier wakes and delivers nothing, twice: the breaker sets the marker aside and records it.
    const wakes = [courierWakeThatDeliversNothing(box), courierWakeThatDeliversNothing(box)];
    assert.match(wakes.at(-1), /^quarantine/, `guard: the breaker did not set the marker aside: ${JSON.stringify(wakes)}`);
    await drain(box, env);
    const alerts = rx.records.filter((r) => r.notice.kind === "delivery-stuck");
    assert.deepEqual(alerts.map((a) => [a.notice.audience, a.notice.fault.runId, a.notice.fault.nextAction]),
      [["operator", status().runId, "release-the-delivery"]], JSON.stringify(rx.records.map((r) => r.notice)));
    assert.equal(rx.records.length, 1, "nothing for the submitter");
    assert.equal(status().sendPending, true, "the operator's alert settled the report's send");
    assert.equal(existsSync(join(result.runDir, ".sent")), false);
    await drain(box, env);
    assert.equal(rx.records.length, 1, "the operator was alerted twice");
    // Recovery, as the breaker's record says: the marker goes back, and the courier delivers and settles it.
    const runs = () => readdirSync(dirname(result.runDir)).length;
    const before = runs();
    const marker = JSON.parse(readFileSync(join(box.outbox, "quarantine", "STUCK-ALERTS.jsonl"), "utf8").trim().split("\n")[0]).marker;
    writeFileSync(join(box.outbox, marker), readFileSync(join(box.outbox, "quarantine", marker)));
    rmSync(join(box.outbox, "quarantine", marker));
    const { settleSend } = await import("../send-settle.mjs");
    const s = status();
    settleSend({ run: { runId: s.runId, runDir: result.runDir, slug: s.slug, codename: s.codename }, evidence: { messageId: "<courier-delivered@example>" }, via: "mcp/mark_sent" });
    await drain(box, env);
    assert.equal(status().sendPending, false, "the courier's delivery did not settle the report");
    assert.equal(JSON.parse(readFileSync(join(result.runDir, ".sent"), "utf8")).via, "mcp/mark_sent");
    assert.equal(runs(), before, "a second search ran");
    assert.equal(rx.records.length, 1, "the delivered report raised another alert");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

// ── THE OPERATOR SETTLES AN UNCERTAIN NOTICE BY ITS DELIVERY ID ──────────────────────────────────────────────────────

const operatorSays = (box, ...args) => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "notice-delivery.mjs"), ...args], { env: { ...process.env, ...box.env }, encoding: "utf8" });
  let out = null; try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
  return { code: r.status, out, stderr: r.stderr };
};

test("an uncertain notice the receiver cannot drop is the operator's: listed with its id, then received, absent, or left as it is", async () => {
  const box = install();
  const rx = await receiver();
  const env = routeEnv(rx.url, "submitter");
  try {
    const { markRouteSeen } = await pass(box, env, { skip: true });
    markRouteSeen({ env: process.env, now: Date.now() - 60_000 });
    for (const id of ["settle-received", "settle-absent", "settle-unknown"]) refusedOrder(box, id, "demo-brand-owner");
    // Each is sent, and the process stops after the receiver's answer, three times: three uncertain notices.
    for (let i = 0; i < 3; i++) assert.equal(await passThatStops(box, env), 9);
    await pass(box, env);
    const byRef = Object.fromEntries(rx.records.map((r) => [r.notice.order.reference, r.key]));
    assert.equal(Object.keys(byRef).length, 3, "guard: the receiver holds the three notices");
    const listed = operatorSays(box, "list");
    assert.equal(listed.code, 0, listed.stderr);
    for (const ref of Object.keys(byRef)) {
      const n = listed.out.find((x) => x.id === byRef[ref]);
      assert.deepEqual([n?.state, n?.nextAction, n?.retriesByItself], ["ambiguous", "settle-with-receiver", false], ref);
    }
    // Received: that notice alone is confirmed, and nothing is sent.
    assert.deepEqual(operatorSays(box, "received", byRef["settle-received"]).out, { ok: true, id: byRef["settle-received"], state: "confirmed" });
    // Absent: that notice alone is sent again, under the same id.
    assert.deepEqual(operatorSays(box, "absent", byRef["settle-absent"]).out, { ok: true, id: byRef["settle-absent"], state: "failed" });
    await pass(box, env);
    assert.deepEqual(rx.records.slice(3).map((r) => r.key), [byRef["settle-absent"]], "not that notice alone, or not under its id");
    // Unknown: no answer is given, and it stays uncertain.
    const after = Object.fromEntries(deliveries(box).map((d) => [d.id, d.state]));
    assert.deepEqual([after[byRef["settle-received"]], after[byRef["settle-absent"]], after[byRef["settle-unknown"]]], ["confirmed", "confirmed", "ambiguous"]);
    // An answer for a confirmed notice, or for no notice, is refused by its reason.
    assert.deepEqual([operatorSays(box, "received", byRef["settle-received"]).code, operatorSays(box, "received", byRef["settle-received"]).out.reason], [4, "not-reconcilable:confirmed"]);
    assert.equal(operatorSays(box, "absent", "0".repeat(24)).out.reason, "no-such-notice");
    assert.equal(operatorSays(box, "unknown", byRef["settle-unknown"]).code, 2, "an unknown answer is not a command");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

// ── WHAT AN ACKNOWLEDGEMENT SETTLES (design, 2026-11-26) ──────────────────────────────────────────────────────────────

test("a bare 2xx says the receiver took the notice, not that the person was told: the run stays owed, and nothing is handed over twice", async () => {
  const box = install();
  const rx = await receiver();   // "accept": a 2xx with no downstream receipt
  const env = routeEnv(rx.url, "submitter", { MOCK_FAIL_STAGE: "record_matter_frame" });
  try {
    submit(box, "bare-b-stops", "zephyr", { demoRun: true });
    await drain(box, env);
    assert.equal(rx.records.length, 1, JSON.stringify(rx.records.map((r) => r.notice)));
    assert.equal(deliveries(box)[0].state, "confirmed");
    const result = JSON.parse(readFileSync(join(box.qdir, "bare-b-stops.failed.result"), "utf8"));
    assert.equal(existsSync(join(result.runDir, ".sent")), false, "a bare 2xx settled the run's send");
    assert.equal(JSON.parse(readFileSync(join(result.runDir, "status.json"), "utf8")).sendPending, true);
    await drain(box, env);
    assert.equal(rx.records.length, 1, "the accepted notice was handed over again");
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("an old acknowledgement that arrives after the run recovered settles nothing: the new report stays owed", async () => {
  const box = install();
  const rx = await receiver();
  rx.state.mode = "silent";   // the first handoff gets no answer
  try {
    submit(box, "late-b-stops", "zephyr", { demoRun: true });
    await drain(box, routeEnv(rx.url, "submitter", { MOCK_FAIL_STAGE: "record_matter_frame" }));
    assert.equal(deliveries(box)[0].state, "ambiguous", "guard: the first handoff was not left uncertain");
    const result = JSON.parse(readFileSync(join(box.qdir, "late-b-stops.failed.result"), "utf8"));
    // The receiver that drops repeats is sent the notice again. While it holds it, the run recovers and finishes: it
    // now owes its report, a different send from the failure the notice was about. Then the receipt arrives.
    rx.state.mode = "receipt";
    rx.state.beforeAnswer = () => recovers(result.runDir, result.runId);
    const later = Date.now() + 5 * 60_000;   // past the wait before an uncertain notice is sent again
    const env = routeEnv(rx.url, "submitter", { CLEAROTRON_NOTICE_DEDUPE: "1" });
    const { out } = await pass(box, env, { now: () => later });
    assert.equal(out.confirmed, 1, "guard: the late acknowledgement did not arrive");
    assert.equal(deliveries(box)[0].downstream?.messageId?.startsWith("downstream-"), true);
    assert.equal(sentOf(result.runDir), null, "the failure's acknowledgement marked the new report sent");
    assert.equal(owesASend(result.runDir), true, "the new report is no longer owed");
    // A run that recovered no longer stands stopped: nobody is told it stopped again, under any id.
    const again = await pass(box, env, { now: () => later + 60 * 60_000 });
    assert.deepEqual([again.out.sent, rx.records.length, deliveries(box).length], [0, 1, 1]);
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a late acknowledgement for one failure leaves the next failure owed, which is told under its own id and settled by its own receipt", async () => {
  const box = install();
  const rx = await receiver({ dedupe: true });
  try {
    submit(box, "late-a-then-b", "zephyr", { demoRun: true });
    // Failure A's notice is with the receiver when the run, resumed, stops again (failure B). Then A's receipt arrives.
    let failureA = null, failureB = null;
    rx.state.mode = "receipt";
    rx.state.beforeAnswer = async () => {
      const result = JSON.parse(readFileSync(join(box.qdir, "late-a-then-b.failed.result"), "utf8"));
      failureA = await failureIdOf(result.runDir);
      failureB = await stopsAgain(result.runDir, result.runId);
    };
    await drain(box, routeEnv(rx.url, "submitter", { MOCK_FAIL_STAGE: "record_matter_frame" }));
    const result = JSON.parse(readFileSync(join(box.qdir, "late-a-then-b.failed.result"), "utf8"));
    assert.ok(failureA && failureB && failureA !== failureB, "guard: two failures, each with its own id");
    const [a] = deliveries(box);
    assert.deepEqual([a.state, a.settle.failureId, a.downstream?.messageId], ["confirmed", failureA, `downstream-${a.id}`]);
    assert.equal(sentOf(result.runDir), null, "A's receipt settled failure B");
    assert.equal(owesASend(result.runDir), true, "failure B is no longer owed");

    // Failure B is its own notice: a new id the receiver does not drop as a repeat, and its own receipt settles it.
    const { out } = await pass(box, routeEnv(rx.url, "submitter", { CLEAROTRON_NOTICE_DEDUPE: "1" }));
    assert.deepEqual([out.sent, out.confirmed, rx.records.length], [1, 1, 2]);
    const b = deliveries(box).find((d) => d.id !== a.id);
    assert.equal(b.settle.failureId, failureB);
    assert.equal(rx.records[1].key, b.id);
    assert.deepEqual([sentOf(result.runDir)?.messageId, sentOf(result.runDir)?.settled], [`downstream-${b.id}`, "failure"]);
    assert.equal(owesASend(result.runDir), false);
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a failure whose notice was left uncertain is not sent again once the run stops again, even released by the operator: only the new failure's notice goes, and only its receipt settles", async () => {
  const box = install();
  const rx = await receiver({ dedupe: true });
  rx.state.mode = "silent";
  try {
    submit(box, "uncertain-a-then-b", "zephyr", { demoRun: true });
    await drain(box, routeEnv(rx.url, "submitter", { MOCK_FAIL_STAGE: "record_matter_frame" }));
    const [a] = deliveries(box);
    assert.equal(a.state, "ambiguous", "guard: failure A's notice was not left uncertain");
    const result = JSON.parse(readFileSync(join(box.qdir, "uncertain-a-then-b.failed.result"), "utf8"));
    const failureB = await stopsAgain(result.runDir, result.runId);
    // The operator, asked about A, says the receiver does not hold it: A is released to be sent again under its own id.
    const env = routeEnv(rx.url, "submitter", { CLEAROTRON_NOTICE_DEDUPE: "1" });
    await pass(box, env, { skip: true });
    const { reconcileNotice } = await import("../notice-delivery.mjs");
    assert.equal(reconcileNotice(a.id, "absent").ok, true);
    const released = deliveries(box).find((d) => d.id === a.id);
    rx.state.mode = "receipt";
    const { out } = await pass(box, env, { now: () => Date.now() + 5 * 60_000 });
    assert.deepEqual([out.sent, rx.records.length], [1, 1], "A's uncertain notice was sent again");
    const b = deliveries(box).find((d) => d.id !== a.id);
    assert.deepEqual([b.settle.failureId, rx.records[0].key], [failureB, b.id]);
    assert.deepEqual(deliveries(box).find((d) => d.id === a.id), released, "A was sent again after failure B");
    assert.equal(sentOf(result.runDir)?.messageId, `downstream-${b.id}`);
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a failure packet with no id is settled by no receipt: the person is told, and the run stays owed", async () => {
  const box = install();
  const rx = await receiver();
  try {
    submit(box, "no-id-stops", "zephyr", { demoRun: true });
    // The route is down as the run stops; the packet is then one written before packets carried an id.
    await drain(box, routeEnv("http://127.0.0.1:9/notices", "submitter", { MOCK_FAIL_STAGE: "record_matter_frame" }));
    const result = JSON.parse(readFileSync(join(box.qdir, "no-id-stops.failed.result"), "utf8"));
    const { paths } = await import("../run-record.mjs");
    const { failureId, ...packet } = JSON.parse(readFileSync(paths(result.runDir).failure, "utf8"));
    assert.ok(failureId, "guard: the runner's packet carried an id");
    writeFileSync(paths(result.runDir).failure, JSON.stringify(packet, null, 2) + "\n");
    rx.state.mode = "receipt";
    const { out } = await pass(box, routeEnv(rx.url, "submitter"));
    assert.deepEqual([out.sent, out.confirmed], [1, 1]);
    const told = deliveries(box).find((d) => d.state === "confirmed");
    assert.deepEqual([told.settle.failureId, told.downstream?.messageId], [null, `downstream-${told.id}`]);
    assert.equal(sentOf(result.runDir), null, "a receipt settled a failure it cannot be bound to");
    assert.equal(owesASend(result.runDir), true);
  } finally {
    await rx.close();
    rmSync(box.root, { recursive: true, force: true });
  }
});

test("a settle that names its failure is written only while that failure is the one owed", async () => {
  const root = mkdtempSync(join(tmpdir(), "settle-expect-"));
  try {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", root);
    const { settleSend } = await import("../send-settle.mjs");
    const { paths } = await import("../run-record.mjs");
    const runDir = join(root, "run");
    mkdirSync(dirname(paths(runDir).failure), { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: "invented-2026-01-01-probe", sendPending: true }));
    const run = { runId: "invented-2026-01-01-probe", runDir, slug: null, codename: null };
    const failureB = await stopsAgain(runDir, run.runId);
    const asFor = (failureId) => settleSend({ run, evidence: { messageId: "m-1" }, via: "notice-route", expect: { settled: "failure", failureId } });
    assert.deepEqual(asFor("an-earlier-failure"), { alreadySent: false, statusFlipped: null, refused: "packet-changed" });
    assert.deepEqual(asFor(null).refused, "packet-changed", "an unnamed failure matched");
    assert.equal(sentOf(runDir), null);
    assert.equal(asFor(failureB).alreadySent, false);
    assert.deepEqual([sentOf(runDir).messageId, owesASend(runDir)], ["m-1", false]);
    // A caller that names no failure (mark_sent) settles as before.
    await stopsAgain(runDir, run.runId);
    assert.equal(settleSend({ run, evidence: { messageId: "m-2" }, via: "test" }).alreadySent, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
