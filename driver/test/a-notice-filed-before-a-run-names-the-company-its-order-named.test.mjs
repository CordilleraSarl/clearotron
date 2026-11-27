// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A notice filed before any run exists — a failure before start, an intake refusal, a duplicate park —
// has no run to read an account from. It carries the account its order named, so a courier whose token
// is scoped to that company can see it; an order that named none carries null, which only a full grant
// sees. Every order, however it was placed, is told in the shipped not-started sentence: nobody is given the machine
// reason, the check's words or the queue (design, 2026-11-27).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "runless-notice-"));
const OUTBOX = join(ROOT, "outbox");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);

const { intakeNotify, duplicateNotify, preRunFailNotify } = await import("../runner.mjs");
const { clientNotStartedText } = await import("../run-outcome.mjs");
const { CLIENT_ACTION } = await import("../../shared/client-failure-note.mjs");

const packet = (prefix) => {
  const f = readdirSync(OUTBOX).find((n) => n.startsWith(prefix));
  assert.ok(f, `a packet starting ${prefix}`);
  return JSON.parse(readFileSync(join(OUTBOX, f), "utf8"));
};
const order = (over = {}) => ({ id: "job", markName: "VELLOQUIN", forwarder: "requester", classes: [9], ...over });

test("a failure before start carries the account its order named, and no organisation for a company", () => {
  assert.equal(preRunFailNotify("intake-agent", "job-a", order({ profileKey: "demo-brand-owner" }), "engine sign-in check failed"), true);
  const p = packet("intake-job-a.prerun-failed");
  assert.equal(p.kind, "pre-run-failed");
  assert.equal(p.account, "demo-brand-owner");
  assert.equal(p.organisation, null);
  assert.equal(p.text, clientNotStartedText(order(), "VELLOQUIN"), "an order nobody stamped is told in the same words");
  assert.equal(p.reason, undefined, "the reason stays in the queue's record");
});

test("a Generic order carries its organisation; an order that named no account carries null", () => {
  preRunFailNotify("intake-agent", "job-b", order({ profileKey: "generic", tenant: "org-invented" }), "x");
  assert.deepEqual([packet("intake-job-b.").account, packet("intake-job-b.").organisation], ["generic", "org-invented"]);
  preRunFailNotify("intake-agent", "job-c", order({ tenant: "org-invented" }), "x");
  assert.deepEqual([packet("intake-job-c.").account, packet("intake-job-c.").organisation], [null, null],
    "no named account, so no organisation either: the runner may still resolve it by the sender's domain");
});

test("an order placed from a company's door is told it was not started, in the shipped words, with no reason and no queue", () => {
  const job = order({ profileKey: "demo-brand-owner", clientPrincipal: true });
  preRunFailNotify("intake-agent", "job-d", job, "codex login refused: token expired at /home/invented");
  const p = packet("intake-job-d.");
  assert.equal(p.text, clientNotStartedText(job, "VELLOQUIN"));
  assert.ok(p.text.endsWith(`was not started, and nothing was delivered. ${CLIENT_ACTION}`), p.text);
  assert.doesNotMatch(p.text, /codex|token|\/home|job-d|queue|FAILED/);
  assert.doesNotMatch(JSON.stringify(p), /codex|token expired|\/home/, "no field carries the reason either");
});

test("every order refused at intake is told it was not started, with its kind and none of the check's words", async () => {
  const job = order({ profileKey: "demo-brand-owner", clientPrincipal: true });
  await intakeNotify("intake-agent", "job-h", job, { classify: "clarify", errors: ["runCaps.dailyRuns=3 for demo-brand-owner"] }, "run-cap");
  const p = packet("intake-job-h.failed");
  assert.equal(p.text, clientNotStartedText(job, "VELLOQUIN"));
  assert.deepEqual([p.reasonKind, p.errors], ["run-cap", []]);
  assert.doesNotMatch(JSON.stringify(p), /runCaps|dailyRuns|job-h\.failed|queue/);
  await intakeNotify("intake-agent", "job-i", order({ profileKey: "demo-brand-owner" }), { classify: "clarify", errors: ["no goods"] }, "details");
  const staff = packet("intake-job-i.failed");
  assert.equal(staff.text, clientNotStartedText(order({ profileKey: "demo-brand-owner" }), "VELLOQUIN"), "an order staff placed is told the same");
  assert.deepEqual([staff.reasonKind, staff.errors], ["details", []]);
  assert.doesNotMatch(JSON.stringify(staff), /no goods|job-i\.failed|queue/);
});

test("an intake refusal and a duplicate park carry the account too; an unreadable order carries none", async () => {
  await intakeNotify("intake-agent", "job-e", order({ profileKey: "demo-brand-owner" }), { classify: "clarify", errors: ["no goods"] });
  assert.equal(packet("intake-job-e.failed").account, "demo-brand-owner");
  await intakeNotify("intake-agent", "job-f", null, null);
  assert.equal(packet("intake-job-f.failed").account, null);
  await duplicateNotify("intake-agent", "job-g", order({ profileKey: "demo-brand-owner" }));
  assert.equal(packet("intake-job-g.duplicate").account, "demo-brand-owner");
});
