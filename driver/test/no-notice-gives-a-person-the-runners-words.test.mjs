// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO NOTICE GIVES A PERSON THE RUNNER'S WORDS.
//
// A notice filed before any run exists is relayed to whoever asked: an intake refusal, a failure before start, a
// duplicate park. Every person is told in product words, whoever placed the order and however it came in (design,
// 2026-11-27): never a queue's name, a file's path, an override flag, a network error code or a check's own message.
// Here each notice is handed all five, through the check's errors and the failure's reason, for an order placed from
// a company's door, one forwarded by email and one staff placed for someone else. The whole packet is read: the
// sentence and every field a courier could pass on. The command line's refusal of an id already queued is read too.
// Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "notice-words-"));
const OUTBOX = join(ROOT, "outbox");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);

const { intakeNotify, duplicateNotify, preRunFailNotify } = await import("../runner.mjs");
const { clientNotStartedText } = await import("../run-outcome.mjs");

const RECORDED = "/home/invented/work/workspace-intake-agent/studio/queue/ORDER.failed: re-submit with --dup-override; "
  + "receiver said ETIMEDOUT; runCaps.dailyRuns must be at most 2";
const INTERNAL = /\/home\/invented|workspace-intake-agent|studio\/queue|--dup-override|dupOverride|ETIMEDOUT|runCaps|dailyRuns|queue/;

const ORIGINS = {
  "from-portal": { clientPrincipal: true, forwarder: "portal", forwarderEmail: "orders@alpha.example" },
  "by-email": { forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: "<m1@outside.example>" },
  "for-someone-else": { forwarder: "staff", forwarderEmail: "orders@alpha.example" },
};
const order = (origin) => ({ id: `job-${origin}`, profileKey: "demo-brand-owner", markName: "VELLOQUIN", classes: [9], ...ORIGINS[origin] });
const packet = (name) => {
  const f = readdirSync(OUTBOX).find((n) => n.startsWith(name));
  assert.ok(f, `a packet starting ${name}`);
  return JSON.parse(readFileSync(join(OUTBOX, f), "utf8"));
};

for (const origin of Object.keys(ORIGINS)) {
  test(`${origin}: an intake refusal, a failure before start and a duplicate are told in product words only`, async () => {
    const job = order(origin);
    await intakeNotify("intake-agent", `refused-${origin}`, job, { classify: "clarify", errors: [RECORDED] }, "details");
    const refused = packet(`intake-refused-${origin}.failed`);
    assert.equal(refused.text, clientNotStartedText(job, "VELLOQUIN"));
    assert.deepEqual([refused.reasonKind, refused.errors], ["details", []]);
    assert.doesNotMatch(JSON.stringify(refused), INTERNAL, JSON.stringify(refused));

    preRunFailNotify("intake-agent", `prerun-${origin}`, job, RECORDED);
    const prerun = packet(`intake-prerun-${origin}.prerun-failed`);
    assert.equal(prerun.text, clientNotStartedText(job, "VELLOQUIN"));
    assert.doesNotMatch(JSON.stringify(prerun), INTERNAL, JSON.stringify(prerun));

    await duplicateNotify("intake-agent", `dup-${origin}`, job, { msgId: "<m0@outside.example>", id: "job-earlier", ts: Date.now() },
      `${RECORDED}|velloquin|9`, true);
    const dup = packet(`intake-dup-${origin}.duplicate`);
    assert.equal(dup.text, `This order was flagged as a duplicate. Order reference: dup-${origin}`);
    assert.doesNotMatch(JSON.stringify(dup), INTERNAL, JSON.stringify(dup));
  });
}

test("the command line refuses an id already queued without printing the queue's folder", () => {
  const qdir = join(mkdtempSync(join(tmpdir(), "notice-words-q-")), "queue");
  mkdirSync(qdir, { recursive: true });
  writeFileSync(join(qdir, "job-waiting.json"), JSON.stringify(order("by-email")));
  const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "enqueue.mjs");
  const r = spawnSync(process.execPath, [CLI, "--queue-dir", qdir, "--mark", "VELLOQUIN", "--classes", "9", "--forwarder", "jordan",
    "--id", "job-waiting"], { encoding: "utf8", env: { ...process.env } });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /already queued\/processing/);
  assert.ok(!(r.stdout + r.stderr).includes(qdir), `the queue's folder is printed: ${r.stderr}`);
});
