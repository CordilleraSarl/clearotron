// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Offline runner intake tests — the never-silent guarantee, in BOTH comms modes. A job that dies at
// intake must (a) terminally park as .failed + .failed.reason (no .processing residue — the leak that let
// the 90s timer resurrect and re-fail a bad job forever), and (b) surface exactly ONE requester-facing
// notice: an OUTBOX EVENT PACKET — the only lane since, proven here with NO gateway binary on the
// box at all, which is every deployment of this product. A refless-but-valid job
// must RUN — not fail — under a noref<hash> slug (the "Roadtrippin' Vibes"/Zephyr regression).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

test("HANDOFF (default): intake rejects park + write outbox packets with ZERO gateway; refless job runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-intake-"));
  const outbox = join(root, "outbox");
  for (const [k, v] of Object.entries({
    // The headless-product proof: THERE IS NO GATEWAY BINARY TO POINT AT. The runner must not preflight
    // anything, must not ping, and must still park + notify (packets) + run the valid job.
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: outbox,
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  delete process.env.CLEAROTRON_DELIVERY; // exercise the DEFAULT (handoff)

  const q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });
  // (1) markless → "clarify"-class intake failure (runnable identity, missing search subject)
  writeFileSync(join(q, "job-markless.json"),
    JSON.stringify({ id: "markless", msgId: "<markless@x>", forwarder: "jordan", ref: "TMP9002" }));
  // (2) unparseable JSON → reject; regression guard for the .processing leak
  writeFileSync(join(q, "job-broken.json"), "not json {{{");
  // (3) refless but otherwise valid → must RUN (warning, not error)
  writeFileSync(join(q, "job-refless.json"), JSON.stringify({
    id: "refless-1", msgId: "<refless@x>", forwarder: "jordan", forwarderDomain: "example.com",
    markName: "ROADTRIP PROBE", classes: [32], provider: "corsearch",
  }));

  const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  // — DELIBERATELY NOT WIRED, and this comment is the record of why.
  //
  // This file TOLERATES pre-run failures. Its claim is that the refless job is not rejected AT INTAKE;
  // what happens to the run afterwards is not its subject. On CI there are no vendor credentials, so
  // every claimed job fails pre-run on a missing key and writes the packets — and this test passed
  // through that for as long as it has existed. Wiring `refuseOnPreRunFailure` here turned a condition
  // the test is designed to ignore into a red, which is what CI caught.
  //
  // It is the opt-out member the mechanism's own header describes: a test that is about, or indifferent
  // to, the pre-run failure path wants those packets to exist.

  // Parked jobs: .failed + reason, packet outcome appended, NOTHING left to resurrect.
  assert.ok(existsSync(join(q, "job-markless.failed")), "markless parked as .failed");
  const reasonMarkless = readFileSync(join(q, "job-markless.failed.reason"), "utf8");
  assert.match(reasonMarkless, /missing mark name/);
  assert.match(reasonMarkless, /notify: packet /);
  assert.ok(existsSync(join(q, "job-broken.failed")), "broken parked as .failed");
  const reasonBroken = readFileSync(join(q, "job-broken.failed.reason"), "utf8");
  assert.match(reasonBroken, /unparseable/);
  assert.match(reasonBroken, /notify: packet /);
  for (const f of ["job-markless", "job-broken", "job-refless"]) {
    assert.ok(!existsSync(join(q, `${f}.processing`)), `${f}.processing must not be left behind`);
    assert.ok(!existsSync(join(q, `${f}.json`)), `${f}.json must be consumed`);
  }

  // The outbox carries one self-contained intake-rejected packet per parked job.
  for (const base of ["job-markless", "job-broken"]) {
    const p = join(outbox, `intake-${base}.failed.pending`);
    assert.ok(existsSync(p), `outbox packet for ${base}`);
    const packet = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(packet.kind, "intake-rejected");
    assert.equal(packet.base, base);
    assert.ok(Array.isArray(packet.errors) && packet.errors.length, "packet carries the validator errors");
    assert.match(packet.text, /Nothing has been searched or delivered/);
    // markless/unparseable jobs have no mark name → the text must name the queue file, never a boolean
    // leaked from a fallback chain (`Prelim request "false"` — the review-confirmed && / ?? footgun).
    assert.match(packet.text, new RegExp(`Prelim request "${base}"`));
    assert.ok(!existsSync(`${p}.tmp`), "atomic publish — no tmp residue");
  }
  assert.equal(JSON.parse(readFileSync(join(outbox, "intake-job-broken.failed.pending"), "utf8")).classify, "reject");
  assert.equal(JSON.parse(readFileSync(join(outbox, "intake-job-markless.failed.pending"), "utf8")).classify, "clarify");

  // Refless job ran to .done with the hash slug (stable per id, see enqueue-schema.test.mjs) — the whole
  // pipeline, delivery included, without any gateway binary on the box.
  assert.ok(existsSync(join(q, "job-refless.done")), "refless job must RUN, not fail at intake");
  const res = JSON.parse(readFileSync(join(q, "job-refless.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.runDir, /\/noref[0-9a-f]{6}-roadtrip-probe\//, `runDir carries the noref slug: ${res.runDir}`);

  // Delivered outbox marker (docs/DELIVERY.md): <runId>.pending, legacy plain-text body = the agent id.
  // runId = the CANONICAL dated `<slug>-<date>-<codename>` (charter P1 §3 — one form across every
  // consumer; the dateless form the pipeline used to mint here is what split one delivery into two
  // markers). Derive it from the archived run dir, whose leaf IS "<date>-<codename>".
  const slug = basename(dirname(res.runDir));
  const marker = join(outbox, `${slug}-${basename(res.runDir)}.pending`);
  assert.ok(existsSync(marker), `delivered outbox marker written: ${marker}`);
  assert.equal(readFileSync(marker, "utf8"), "clawdi\n", "marker body is the agent id (edge-trigger shape)");
});
