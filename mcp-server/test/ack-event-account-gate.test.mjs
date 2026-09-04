// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ack_event must not reach outside an accounts-scoped session's grant (fix-list A3).
//
// THE HOLE THIS CLOSES. Every other write verb is account-gated somewhere:
//   start_run   → scope.authorize() checks args.profileKey against scope.accounts
//   mark_sent / feed_context / stop_run(runId) → the server.mjs CallTool chokepoint, which fires on
//                 `Array.isArray(scope?.accounts) && authedArgs?.runId != null`
//   stop_run(id) → lib/ops.mjs, reading the queued manifest's profileKey
// ack_event is addressed by a FILENAME. It carries no runId into the chokepoint, so NONE of those
// gates ever saw it: an ops token minted with accounts:["aurora"] could delete the outbox marker of a
// celta run and that run's delivery would never be routed to anybody. It is not reachable from the
// portal today (that token is verb-scoped to start_run alone), which is why this is A3 and not A1 —
// but the gate belongs on the verb, not on the current shape of one caller's token.
//
// THE REFUSAL SHAPE IS THE OTHER HALF OF THE FIX, and it is asserted here as hard as the refusal
// itself: a foreign event must answer byte-identically to an absent one ({ok:true, alreadyGone:true}),
// or a scoped caller has an existence oracle over other customers' runs — the same doctrine stop_run's
// queue form already states ("a FOREIGN job answers exactly like a nonexistent one", review
// 2026-07-18). And it must NOT delete the file, or the fix would still destroy the event.
//
// Fixtures are copied from the real artifacts, never invented: the delivered marker is
// `<runId>.pending` holding the forwarding agent id — written by pipelineInner() in pipeline.mjs and by
// backstopFailureNotice() in runner.mjs, read back by markersForAgent() in outbox-backoff.mjs, whose own
// comment states the same claim. These were three LINE citations and all three were wrong — one landed on
// claimToken's declaration, one on prose about obligation counting, one on a blank line. Only the last was
// ever caught, and only because an edit above it shifted it onto punctuation;
// the other two pointed at real code and read as correct to every check. Symbols now, so no edit above
// them can stale them again — and the old numbers are deliberately not repeated here, because the
// checker reads a quoted example as a live citation. The JSON packet shape is the one
// ops.test.mjs's integrator-loop test
// writes, and the account tag is `_driver/profile.json` {profileKey} as freezeProfile writes it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "ack-gate-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);                     // driver.config reads it lazily, but pin it before import
const OUTBOX = join(ROOT, "prelim-outbox");
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);
mkdirSync(OUTBOX, { recursive: true });

const { ackEvent, listOutboxEvents } = await import("../lib/ops.mjs");

/** A run tagged with an account, exactly as the driver freezes it. Returns its runId. */
function makeRun(slug, codename, profileKey) {
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    schema: 1, runId, slug, codename, agent: "clawdi", state: "delivered", markName: slug.toUpperCase(),
    sendPending: true, updatedAt: "2026-07-20T00:00:00Z",
  }));
  if (profileKey) writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ profileKey, name: profileKey }));
  return runId;
}

/** The delivered marker the driver drops: <runId>.pending, body = the forwarding agent id. */
const marker = (runId) => { writeFileSync(join(OUTBOX, `${runId}.pending`), "clawdi\n"); return `${runId}.pending`; };

const MINE = makeRun("tmpack-aurora", "2026-07-20-jade-a", "aurora");
const THEIRS = makeRun("tmpack-celta", "2026-07-20-jade-b", "celta");
const UNTAGGED = makeRun("tmpack-legacy", "2026-07-20-jade-c", null);   // pre-grants run: no profile.json

const SCOPED = { kind: "ops", sub: "trial-connector", accounts: ["aurora"] };
const ABSENT = (file) => ({ ok: true, file, alreadyGone: true });

test("A SCOPED session cannot consume another account's event — and the file SURVIVES", () => {
  const f = marker(THEIRS);
  const r = ackEvent({ file: f }, { scope: SCOPED });
  // The destructive half: before the fix this rmSync'd celta's marker and returned alreadyGone:false.
  assert.equal(existsSync(join(OUTBOX, f)), true, "a foreign event must still be on disk for the full-grant courier");
  assert.equal(readFileSync(join(OUTBOX, f), "utf8"), "clawdi\n", "and byte-intact — not truncated or rewritten");
  // The disclosure half: the answer is the one an absent file gives, field for field.
  assert.deepEqual(r, ABSENT(f), "a foreign event must be indistinguishable from one that is not there");
  rmSync(join(OUTBOX, f), { force: true });
});

test("the refusal is INDISTINGUISHABLE from a genuinely absent file (no existence oracle)", () => {
  // Same scope, two questions: one about a real celta event, one about a name with no file at all.
  // If these answers ever differ, a scoped caller can enumerate which runs exist for other customers.
  const real = marker(THEIRS);
  const fake = "tmpack-celta-2026-07-20-no-such-run.pending";
  assert.deepEqual(
    ackEvent({ file: real }, { scope: SCOPED }),
    { ...ackEvent({ file: fake }, { scope: SCOPED }), file: real },
    "exists-but-foreign and does-not-exist must answer the same",
  );
  rmSync(join(OUTBOX, real), { force: true });
});

test("a scoped session CONSUMES its own account's event normally (the gate is not a blanket refusal)", () => {
  const f = marker(MINE);
  assert.deepEqual(ackEvent({ file: f }, { scope: SCOPED }), { ok: true, file: f, alreadyGone: false });
  assert.equal(existsSync(join(OUTBOX, f)), false, "an in-grant event is consumed exactly as before");
});

test("fail closed: an UNTAGGED run, an unresolvable runId, and an unreadable packet are all refused", () => {
  // Untagged (pre-grants) runs are full-grant-only everywhere else (assertAccountAccess) — same here.
  const u = marker(UNTAGGED);
  assert.deepEqual(ackEvent({ file: u }, { scope: SCOPED }), ABSENT(u));
  assert.equal(existsSync(join(OUTBOX, u)), true);

  // A packet naming no run at all — the real intake-rejected shape, filed BEFORE any run exists.
  // There is nothing to resolve an account from, so a scoped session must not be able to destroy it.
  const intake = "intake-badjob.failed.pending";
  writeFileSync(join(OUTBOX, intake), JSON.stringify({
    kind: "intake-rejected", classify: "clarify", base: "badjob", forwarder: "jordan",
    errors: ["missing mark name(s)"], text: "⚠️ Prelim request ...",
  }));
  assert.deepEqual(ackEvent({ file: intake }, { scope: SCOPED }), ABSENT(intake));
  assert.equal(existsSync(join(OUTBOX, intake)), true, "an account-less event is full-grant-only, not free-for-all");

  // A JSON packet whose runId resolves to nothing (a purged/archived-away run).
  const orphan = "tmpack-ghost-2026-07-20-jade-z.pending";
  writeFileSync(join(OUTBOX, orphan), JSON.stringify({ kind: "run-failed", runId: "tmpack-ghost-2026-07-20-jade-z" }));
  assert.deepEqual(ackEvent({ file: orphan }, { scope: SCOPED }), ABSENT(orphan));
  assert.equal(existsSync(join(OUTBOX, orphan)), true);
});

test("a FULL-GRANT session is untouched — accounts '*' and legacy (no accounts claim) still consume anything", () => {
  // The gate keys on Array.isArray(scope.accounts); "*" and undefined are the un-narrowed principals
  // (a legacy ops token, the local stdio surface). Both must keep working or the delivery lane stops.
  const a = marker(THEIRS);
  assert.equal(ackEvent({ file: a }, { scope: { kind: "ops", accounts: "*" } }).alreadyGone, false);
  assert.equal(existsSync(join(OUTBOX, a)), false);

  const b = marker(THEIRS);
  assert.equal(ackEvent({ file: b }, { scope: { kind: "ops" } }).alreadyGone, false, "legacy token = full authority");
  assert.equal(existsSync(join(OUTBOX, b)), false);

  const c = marker(THEIRS);
  assert.equal(ackEvent({ file: c }).alreadyGone, false, "no scope at all (stdio/tests) = full authority");
  assert.equal(existsSync(join(OUTBOX, c)), false);
});

test("the pre-existing filename hardening still fires BEFORE the account gate", () => {
  // Path traversal must stay a loud throw for every principal — the account gate's quiet ABSENT answer
  // is only for a well-formed name that is simply not the caller's.
  assert.throws(() => ackEvent({ file: "../.matter-ledger.jsonl" }, { scope: SCOPED }), /bare \*\.pending name/);
  assert.throws(() => ackEvent({ file: "status.json" }, { scope: SCOPED }), /bare \*\.pending name/);
  assert.throws(() => ackEvent({ file: "" }, { scope: SCOPED }), /file is required/);
});

test("the gate resolves a run the SAME way listOutboxEvents does (gate and listing cannot disagree)", () => {
  // If the listing shows an event to a scoped courier, ack_event must accept it; if it hides it,
  // ack_event must refuse it. Both sides derive the run from the JSON runId, else the filename.
  const mine = marker(MINE), theirs = marker(THEIRS);
  const seen = Object.fromEntries(listOutboxEvents().events.map((e) => [e.file, e.runId]));
  assert.equal(seen[mine], MINE, "listing derives runId from the marker filename");
  assert.equal(seen[theirs], THEIRS);
  assert.equal(ackEvent({ file: mine }, { scope: SCOPED }).alreadyGone, false, "listed-for-me ⇒ ackable");
  assert.equal(ackEvent({ file: theirs }, { scope: SCOPED }).alreadyGone, true, "hidden-from-me ⇒ not ackable");
  rmSync(join(OUTBOX, theirs), { force: true });
});
