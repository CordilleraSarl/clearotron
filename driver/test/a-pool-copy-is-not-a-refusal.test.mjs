// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-pool-copy-is-not-a-refusal.test.mjs — an unpreserved terminal state is not a failed order.
//
//. Scoring an archived run printed `delivered: NO — THE ORDER WAS REFUSED` above
// correct recall figures, for a run that had delivered. The pool preserves neither `status.json`
// (0 of 25 dirs) nor `_driver/` (0 of 28), so EVERY archived run scored as a refusal, and the sentence
// "everything below scores prose that was never signed off" sat above real numbers in a round handover.
//
// The tool already held the honest pattern four lines further down its own output: `withheld` names what
// it could not read and declines to answer. The delivery line invented a verdict from the same kind of
// absence. These arms pin the asymmetry closed in the direction of the honest half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deliveryLine, engineCommitOf, SCORER_VERSION } from "../reference-score.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (o) => ({ deliveryState: null, deliveredAt: null, hasStatus: false, poolMeta: null, ...o });

test("2025 a delivered run still says so, and a refusal still leads — both unchanged", () => {
  const yes = deliveryLine(run({ hasStatus: true, deliveryState: "delivered", deliveredAt: "2026-08-28T10:00:00Z" }));
  assert.match(yes, /^delivered: YES — 2026-08-28T10:00:00Z$/);

  // 's case, and it must keep working: a refusal after model work has every artifact a delivered
  // run has, so nothing further down the printout distinguishes them.
  const no = deliveryLine(run({ hasStatus: true, deliveryState: "failed" }));
  assert.match(no, /THE ORDER WAS REFUSED/);
  assert.match(no, /state=failed/);
  assert.match(no, /never signed off/);
});

test("2025 A POOL COPY IS NOT A REFUSAL — the defect, in one arm", () => {
  const line = deliveryLine(run({
    poolMeta: { issuedAt: "2026-08-28T09:12:00Z", verdict: "BLOCKING", engineCommit: "fee3b60a" },
  }));
  assert.equal(/THE ORDER WAS REFUSED/.test(line), false,
    "an archived run with no status.json was reported as a failed order — this is the whole issue");
  assert.equal(/never signed off/.test(line), false,
    "it still tells the reader the numbers below describe unsigned prose");
  assert.match(line, /NOT PRESERVED/);
  assert.match(line, /NOT a refusal/);
  // It must not swing the other way either: publication is not delivery.
  assert.equal(/delivered: YES/.test(line), false,
    "it inferred a delivery from meta.json — publish writes the pool copy BEFORE the run settles, so a "
    + "pool dir proves publication and never delivery");
});

test("2025 the unpreserved line still hands over what IS durable", () => {
  const line = deliveryLine(run({ poolMeta: { issuedAt: "2026-08-28T09:12:00Z", verdict: "BLOCKING" } }));
  assert.match(line, /published 2026-08-28T09:12:00Z/);
  assert.match(line, /verdict BLOCKING/);
  assert.match(line, /Score the workspace run dir/, "a named absence must say where the answer still lives");
  // A pool dir whose meta carries neither still refuses to invent one.
  const thin = deliveryLine(run({ poolMeta: {} }));
  assert.match(thin, /publication time not recorded/);
  assert.match(thin, /no verdict recorded/);
  assert.equal(/THE ORDER WAS REFUSED/.test(thin), false);
});

test("2025 a status.json with no state is NOT the same absence as no status.json", () => {
  // Two different absences. Collapsing them is how the original defect read a missing file as a state.
  const noField = deliveryLine(run({ hasStatus: true, deliveryState: null }));
  assert.match(noField, /THE ORDER WAS REFUSED/, "a run that HAS a status.json and no state is a refusal");
  assert.match(noField, /status\.json carries no state/);

  const noFile = deliveryLine(run({ hasStatus: false }));
  assert.match(noFile, /NOT ANSWERABLE/);
  assert.equal(/THE ORDER WAS REFUSED/.test(noFile), false);
  assert.notEqual(noField, noFile, "the two absences printed the same sentence");
});

test("2025 neither file present says so about BOTH, and infers nothing", () => {
  const line = deliveryLine(run({}));
  assert.match(line, /no status\.json and no meta\.json/);
  assert.match(line, /No verdict is inferred/);
});

test("2025 the engine commit comes from meta.json when the pool dir has no status.json", () => {
  // Same absence, same output block: reading only status.json made this line say the run "predates the
  // stamp" for every pool dir, which is a WRONG claim rather than a missing one.
  assert.deepEqual(engineCommitOf({ status: { engineCommit: "abc123" }, meta: { engineCommit: "zzz999" } }),
    { commit: "abc123", from: "status.json" }, "the run's own stamp must outrank the pool copy's");
  assert.deepEqual(engineCommitOf({ status: null, meta: { engineCommit: "fee3b60a" } }),
    { commit: "fee3b60a", from: "meta.json" });
  assert.deepEqual(engineCommitOf({}), { commit: null, from: null });
});

test("2025 the fixture's premise is PINNED to the publisher, so it cannot drift from a real pool dir", () => {
  // No real pool directory is readable from this account (/home/testuser is drwxr-x--- testuser:testuser),
  // so these arms drive a shape rather than a delivered artifact. The shape is only trustworthy while
  // this stays true: publish writes meta.json into the POOL run dir and nowhere else, which is what
  // makes "meta.json present, status.json absent" the archived-run signature.
  const src = readFileSync(join(DRIVER, "publish", "index.mjs"), "utf8");
  assert.match(src, /const writeRO = \(name, data\) => \{ const p = join\(poolRunDir, name\);/,
    "writeRO no longer targets poolRunDir — the archived-run signature these arms assume has moved");
  assert.match(src, /writeRO\('meta\.json'/,
    "meta.json is no longer written through writeRO — it may no longer be pool-only");
});

test("2025 the scorer version moved, because the delivery line's meaning changed", () => {
  // A number a reader carries away must carry its instrument. A v6 delivery verdict on a pool dir said
  // REFUSED; a v7 one declines. They are not comparable.
  assert.ok(SCORER_VERSION >= 7, `SCORER_VERSION is ${SCORER_VERSION} — it must move when this line's meaning does`);
});
