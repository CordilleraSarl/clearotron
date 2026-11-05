// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO'S CONNECTION STILL OFFERS FOUR TOOLS THAT WRITE: stop_run, feed_context, ack_event and mark_sent. A demo may
// change its own data and nothing else, and its connection must never reach a real install on the same machine.
// Driven here through the binding a demo's connection starts with (shared/demo-connection.mjs), beside a real
// install whose own settings name its queue and outbox: every file each tool writes or removes is the demo's, and
// the real install's files are byte for byte what they were. Invented names throughout.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../../shared/driver-dir.mjs";
import { bindDemoConnection } from "../../shared/demo-connection.mjs";

const DEMO = mkdtempSync(join(tmpdir(), "demo-bound-"));
const REAL = mkdtempSync(join(tmpdir(), "real-install-"));
after(() => { rmSync(DEMO, { recursive: true, force: true }); rmSync(REAL, { recursive: true, force: true }); });

// THE REAL INSTALL'S OWN SETTINGS, as the shell an assistant was started from could carry them. The binding has to
// replace every one before the server reads anything, so they are set first and the binding runs over them.
process.env.CLEAROTRON_QUEUE_DIR = join(REAL, "queue");
process.env.CLEAROTRON_OUTBOX_DIR = join(REAL, "outbox");
process.env.CLEAROTRON_RUN_LOCK_DIR = join(REAL, "locks");
mkdirSync(join(DEMO, "work"), { recursive: true });
process.env.CLEAROTRON_WORK_DIR = join(DEMO, "work");
assert.equal(bindDemoConnection(process.env), null, "the demo's folder is there, so the connection binds to it");

const { config } = await import("../lib/driver.mjs");
const { stopRun, feedContext, markSent, ackEvent } = await import("../lib/ops.mjs");

const STUDIO = join(DEMO, "work", `workspace-${config.defaultAgent}`, "studio", "clearance-search");
const SLUG = "tmpdemo-quillbrae", CODENAME = "2026-09-18-amber-quay", RUN_ID = `${SLUG}-${CODENAME}`;
const RUN_DIR = join(STUDIO, SLUG, CODENAME);

// One delivered example in the demo, its send still owed, and an event waiting in the demo's outbox.
mkdirSync(driverDir(RUN_DIR), { recursive: true });
writeFileSync(join(RUN_DIR, "status.json"), JSON.stringify({ runId: RUN_ID, slug: SLUG, codename: CODENAME, agent: config.defaultAgent, state: "delivered", markName: "QUILLBRAE", sendPending: true }));
writeFileSync(driverDir(RUN_DIR, "delivery.json"), JSON.stringify({ runId: RUN_ID }));
mkdirSync(join(DEMO, "outbox"), { recursive: true });
writeFileSync(join(DEMO, "outbox", `${RUN_ID}.pending`), "{}");
writeFileSync(join(DEMO, "outbox", "demo-event.pending"), "{}");

// The real install beside it: a queued job and an event, under the names a caller could guess.
mkdirSync(join(REAL, "queue"), { recursive: true });
writeFileSync(join(REAL, "queue", "job-orbelle.json"), JSON.stringify({ id: "job-orbelle", markName: "ORBELLE" }));
mkdirSync(join(REAL, "outbox"), { recursive: true });
writeFileSync(join(REAL, "outbox", "real-event.pending"), "{}");

const snapshot = (root) => {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(root);
  return out;
};

test("the binding puts the folders these tools write into the demo's own folder", () => {
  assert.equal(config.outboxDir, join(DEMO, "outbox"));
  assert.equal(process.env.CLEAROTRON_QUEUE_DIR, join(DEMO, "queue"));
  assert.equal(process.env.CLEAROTRON_RUN_LOCK_DIR, join(DEMO, "locks"));
});

test("stop_run, feed_context, ack_event and mark_sent change the demo's files and leave a real install's alone", async () => {
  const real = snapshot(REAL);
  assert.equal(Object.keys(real).length, 2, "the control: the real install holds the two files asserted on below");

  // A real install's job and event, asked for by name, are not found: the demo's queue and outbox hold neither.
  const stopQueued = await stopRun({ id: "job-orbelle" });
  assert.equal(stopQueued.action, "not-found");
  assert.deepEqual(ackEvent({ file: "real-event.pending" }), { ok: true, file: "real-event.pending", alreadyGone: true });

  // The demo's own data, changed where the demo keeps it.
  assert.equal(ackEvent({ file: "demo-event.pending" }).alreadyGone, false);
  assert.equal(existsSync(join(DEMO, "outbox", "demo-event.pending")), false, "the demo's event was not removed");
  assert.deepEqual(feedContext({ runId: RUN_ID, customer: "Invented Customer Ltd" }).wrote, ["customer-bind.json"]);
  const sent = markSent({ runId: RUN_ID, attestation: "Shown in the demo." });
  assert.equal(sent.ok, true);
  assert.ok(existsSync(join(RUN_DIR, ".sent")), "the demo's run carries no send record");
  assert.equal(existsSync(join(DEMO, "outbox", `${RUN_ID}.pending`)), false, "the demo's send marker was not cleared");
  const stopped = await stopRun({ runId: RUN_ID });
  assert.ok(stopped && typeof stopped === "object", "stop_run answered nothing for the demo's run");

  assert.deepEqual(snapshot(REAL), real, "a tool on the demo's connection changed a file of the real install");
  // What the tools wrote, found where the demo keeps its runs: positive evidence, not only an absence elsewhere.
  const written = Object.keys(snapshot(DEMO));
  assert.ok(written.some((p) => p.endsWith("customer-bind.json") && join(DEMO, p).startsWith(RUN_DIR)), `feed_context wrote outside the demo's run: ${written.join(", ")}`);
  assert.ok(written.includes(relative(DEMO, join(RUN_DIR, ".sent"))), `mark_sent wrote outside the demo's run: ${written.join(", ")}`);
});
