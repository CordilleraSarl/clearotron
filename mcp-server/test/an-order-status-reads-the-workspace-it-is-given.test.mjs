// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ORDER'S STATUS READS THE WORKSPACE IT IS GIVEN, AND ONLY THAT ONE.
//
// order_status takes the agent workspace an order was filed under. Given, the caller has said which queue the order went
// to, so only that queue is read: another queue holding the same reference cannot make the answer "ambiguous", and
// another queue that cannot be read cannot turn it into "could-not-look". Not given, the default queue and every known
// queue are read, so a reference two of them hold is "ambiguous", and the assistant is told to pass the full id and, if
// that is not enough, the workspace. Every name is invented.
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "order-status-workspace-"));
const HEADLESS = join(ROOT, "queue");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", HEADLESS);

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { orderStatus } = await import("../lib/ops.mjs");
const { config } = await import("../lib/driver.mjs");

const AGENT = config.defaultAgent;
const WORKSPACE = config.queueDirForAgent(AGENT);
const STAFF = null;   // sees every account, so the reference is read as given
const file = (dir, ref, job) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${ref}.json`), JSON.stringify({ id: ref, markName: "QZORVAK", forwarder: "requester", ...job })); };

file(HEADLESS, "ORDER-9", { profileKey: "demo-brand-owner" });
file(WORKSPACE, "ORDER-9", { profileKey: "zephyr" });

test("named by no one, the default and every known queue are read: one reference in two queues is ambiguous", () => {
  assert.notEqual(HEADLESS, WORKSPACE, "premise: two queues");
  const r = orderStatus({ id: "ORDER-9" }, { scope: STAFF });
  assert.deepEqual(r, { found: false, basis: "ambiguous" });
});

test("a named workspace is the only queue read: it resolves the order filed there", () => {
  const r = orderStatus({ id: "ORDER-9", agent: AGENT }, { scope: STAFF });
  assert.equal(r.found, true, JSON.stringify(r));
  assert.equal(r.account, "zephyr", "the order in the named workspace, not the other queue's");
  assert.equal(r.state, "waiting");
});

test("another queue that cannot be read cannot spoil a lookup in the named workspace", { skip: process.getuid?.() === 0 ? "root reads an unreadable folder" : false }, () => {
  chmodSync(HEADLESS, 0o000);
  try {
    const named = orderStatus({ id: "ORDER-9", agent: AGENT }, { scope: STAFF });
    assert.equal(named.found, true, JSON.stringify(named));
    assert.equal(named.account, "zephyr");
    // Named by no one, the unreadable queue is read too: a reference no readable queue holds is "could-not-look".
    const unnamed = orderStatus({ id: "ORDER-404" }, { scope: STAFF });
    assert.deepEqual(unnamed, { found: false, basis: "could-not-look" }, "an unreadable queue is never a 'not found'");
  } finally { chmodSync(HEADLESS, 0o755); }
});

test("an unknown workspace is refused, not read as an empty one", () => {
  assert.throws(() => orderStatus({ id: "ORDER-9", agent: "nowhere-agent" }, { scope: STAFF }), /unknown agent "nowhere-agent"/);
});
