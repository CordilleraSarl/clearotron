// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SAID-BACK REFUSAL NEVER FAILS A PASS (reports always ship, ruled 2026-08-27).
//
// The placement form's refusals refuse the pass so that a corrective turn carries them to the step: the
// judgement is the only way back to it within a pass. They are the stage's last check, so a pass whose
// attempts run out on one has passed every other. Its artifact stands, and what it left open is recorded by
// the floor duty and named at delivery: the run is never failed over a duty the step was told of. For the same
// reason a said-back refusal does not stop the rescue of a turn whose artifact landed before the turn died.
// Any other refusal still fails the stage. Driven through the real ladder with a registered fake engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { runStage, registerEngine } from "../gateway.mjs";

const FLOOR = "placement_floors_without_fate=1: /mark/eu/b1 in (b) — each is a floor";
const REFUSED = "placement_refused=1: select /mark/eu/x (the band holds no record with this id) — the form refused each of these";
const UNJUDGED = "placement_unjudged=1: PR-X (placement_reason_missing) — finish these rows";
const ok = () => ({ code: 0, killed: false, wall: 5, stdout: "ok", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, sessionRef: "s" });
// The artifact landed, then the final message failed: the adapter reports exit 1.
const exit1 = () => ({ code: 1, killed: false, wall: 8, stdout: "API Error: 500 (final assistant message)", stderr: "", laneWaitMs: 0,
  json: { status: "error", result: { meta: { agentMeta: {} }, payloads: [{ text: "" }] }, summary: "success" },
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, sessionRef: "s" });

/** One placement pass, three attempts allowed, whose every judgement refuses with `reason`. */
async function pass(tag, reason, turn = ok) {
  const dir = mkdtempSync(join(tmpdir(), "said-back-ladder-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const out = join(dir, "placement-recommendations.md");
  const messages = [];
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  registerEngine({ name: `fake-said-back-${tag}`, runTurn: async (a) => { messages.push(a.message); writeFileSync(out, "# placed\n"); return turn(); } });
  process.env.CLEAROTRON_AI = `fake-said-back-${tag}`;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try {
    const r = await runStage("placement-inquiry", { agent: "mailagent", sessionKey: `clearotron-test-said-back-${tag}`, message: "place the band",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out, validate: () => ({ ok: false, reason }), runDir: dir, maxRetries: 2 });
    return { r, messages };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a pass whose attempts run out on a floor said back stands, after a corrective turn carried the floor to the step", async () => {
  const { r, messages } = await pass("floor", FLOOR);
  assert.equal(r.ok, true, `the stage failed the run over a floor the step was told of: ${r.fail}`);
  assert.ok(messages.length >= 2, "no corrective turn carried the refusal");
  assert.ok(messages[1].includes(FLOOR), "the corrective turn did not carry the floor and its line");
  assert.equal(r.saidBackOpen?.endsWith(FLOOR), true, "the pass does not say what it left open");
});

test("so does a pass whose attempts run out on the form's refusals", async () => {
  const { r } = await pass("refused", REFUSED);
  assert.equal(r.ok, true, `the stage failed the run over a refusal the step was told of: ${r.fail}`);
  assert.equal(r.saidBackOpen?.endsWith(REFUSED), true);
});

test("a turn whose artifact landed before it died is rescued though the form still says a floor back", async () => {
  const { r, messages } = await pass("rescue", FLOOR, exit1);
  assert.equal(r.ok, true, `the rescue was refused over an open duty, not an invalid artifact: ${r.fail}`);
  assert.equal(messages.length, 1, "finished work was run again");
});

test("THE CONTROL: an unfinished row still fails the stage when the attempts run out", async () => {
  const { r, messages } = await pass("unjudged", UNJUDGED);
  assert.equal(r.ok, false);
  assert.ok(messages.length >= 2);
  assert.match(r.fail, /placement_unjudged=1/);
});
