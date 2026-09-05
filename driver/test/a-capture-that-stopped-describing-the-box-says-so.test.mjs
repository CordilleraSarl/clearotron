// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The configuration page answers LIVE, and the last run's capture is the secondary row (tracker 170).
//
// THE RULING. Owner, 2026-09-05: "the global configuration page shows LIVE configuration, always. No
// run-time snapshot as the source of truth — I don't see why it needs to take an old snapshot." Age
// banners go with it.
//
// WHY AN AGE WAS NEVER THE GUARD IT LOOKED LIKE, which is what the ruling replaces. The snapshot's only
// writers were a run and the launcher. A deployment being CONFIGURED runs nothing by definition — so its
// capture is stale for exactly as long as somebody is working on the configuration, which is exactly when
// they are reading the page. Found live: the register provider was moved from signa to clarivate and every
// service restarted onto it, and the page still said Signa. It happened to be 26 hours old, so a banner
// appeared and the owner asked. An hour earlier the same page would have shown the same wrong answer in
// silence — the case that needed the warning was the case too fresh to get one.
//
// So the page reads live, and the capture keeps one job: naming any field it disagrees with. The arms
// below pull in opposite directions on purpose:
//
//   • a capture that DISAGREES is named at ANY age, including a minute old;
//   • a capture that AGREES is not reported as wrong at any age — old and wrong are different facts, and
//     a check that cried wrong on every old capture would be switched off within a week.
//
// And each ABSENCE is its own fact: no capture, no live posture, and a capture too old to carry a
// comparable field are three different answers that must not collapse into one another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { buildFlagSnapshot, postureDisagreement, snapshotPath } from "../flag-snapshot.mjs";
import { flagView } from "../portal-config-view.mjs";

// A REAL POOL IN A FRESH DIRECTORY, never /tmp by a fixed name. `/tmp` on this box is shared and
// sticky, and a file another user left there has already changed a test result silently — the arm read
// a leftover and reported it as its own subject.
const withPool = (snapshot) => {
  const root = mkdtempSync(join(tmpdir(), "capture-view-"));
  if (snapshot) {
    const p = snapshotPath(root);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(snapshot, null, 2));
  }
  return root;
};

const posture = (over = {}) => buildFlagSnapshot({}, {
  capturedAt: new Date().toISOString(),
  registerProvider: "clarivate",
  engine: { id: "engine-a", billing: { mode: "subscription" } },
  ...over,
});

const HOUR = 60 * 60 * 1000;

// ── the arm the issue names first ───────────────────────────────────────────────────────────────────
test("a capture naming a different register is flagged as disagreeing, and names the field", () => {
  const root = withPool(posture({ registerProvider: "signa" }));
  try {
    const view = flagView(root, { live: posture({ registerProvider: "clarivate" }) });
    assert.equal(view.source, "live", "the page must be answering from the live posture, not the capture");
    const rows = view.lastRun.disagrees;
    assert.ok(Array.isArray(rows) && rows.length > 0, "the page did not report the disagreement at all");
    const row = rows.find((r) => /register/i.test(r.what));
    assert.ok(row, `no row named the register: ${JSON.stringify(rows)}`);
    // NAMING THE FIELD IS THE POINT. "Something is out of date" sends a reader to ssh; "this capture
    // says signa; this deployment is configured for clarivate" is a sentence they can act on.
    assert.equal(row.capture, "signa");
    assert.equal(row.live, "clarivate");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("…and it is flagged at ANY age, including a capture written one minute ago", () => {
  // THE CASE THAT NEEDS THE WARNING IS THE ONE THAT DID NOT GET IT. The live incident was caught only
  // because the capture happened to be old enough for the age banner. A box mid-configuration writes
  // fresh captures constantly, so freshness is exactly when the old signal was blindest.
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const root = withPool(posture({ registerProvider: "signa", capturedAt: fresh }));
  try {
    const view = flagView(root, { live: posture({ registerProvider: "clarivate" }) });
    assert.ok(view.lastRun.disagrees.some((r) => /register/i.test(r.what)),
      "a fresh capture that names the wrong register was reported as fine — which is the live defect");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── the arm that stops the first one from being a nuisance ──────────────────────────────────────────
test("a capture that agrees is old, not wrong — two days on, nothing is flagged as disagreeing", () => {
  const twoDays = new Date(Date.now() - 48 * HOUR).toISOString();
  const agreeing = posture({ capturedAt: twoDays });
  const root = withPool(agreeing);
  try {
    const view = flagView(root, { live: posture() });
    assert.equal(view.lastRun.capturedAt, twoDays, "the capture's date is still reported, as a fact rather than a warning");
    assert.deepEqual(view.lastRun.disagrees, [],
      "an agreeing capture was reported as disagreeing because of its age — old and wrong are different "
      + "facts, and a check that conflates them gets switched off");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── the absences, each a different fact ─────────────────────────────────────────────────────────────
test("no capture at all reports null, never an empty list", () => {
  const root = withPool(null);
  try {
    const view = flagView(root, { live: posture() });
    assert.equal(view.available, true, "the page can answer LIVE even with no capture at all — that is the ruling");
    assert.equal(view.source, "live");
    assert.equal(view.lastRun, null,
      "`[]` is the value that means 'compared, and they agree'. There is no capture here, so nothing "
      + "was compared, and saying so with the same value would be an absence reading as a pass");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a caller that supplies no live posture says so, rather than passing a capture off as live", () => {
  const root = withPool(posture({ registerProvider: "signa" }));
  try {
    const view = flagView(root);
    assert.equal(view.source, "capture",
      "a capture was presented without saying which reading it is — the ruling's whole complaint was a "
      + "page showing an old reading as current fact");
    assert.equal(view.lastRun.disagrees, null,
      "with nothing to compare against, the honest answer is 'not checked' — and this capture would "
      + "have disagreed, so a `[]` here would be certifying the exact case the issue is about");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── the trap this comparison walked into while it was being written ─────────────────────────────────
test("a capture too old to carry any comparable field says so, rather than reading as agreement", () => {
  // PLANTED DURING DEVELOPMENT AND IT PASSED. An early version returned `[]` here, which is the same
  // value agreement returns — so a capture predating every field certified itself as matching the box.
  // Same shape as `postureDelta`'s empty-flag row one function above, arrived at by the same route.
  const rows = postureDisagreement({ flags: {} }, posture());
  assert.equal(rows.length, 1, `expected the comparison to report its own vacuity, got ${JSON.stringify(rows)}`);
  assert.match(rows[0].effect, /not evidence that they agree/);
});

test("a field absent on ONE side is silence, not conflict", () => {
  // The opposite failure, and the reason the rule above is not simply "report everything". A capture
  // written before a field shipped does not disagree with a deployment that has it. Without this, every
  // box in the estate lights up red the day any new field lands.
  const older = posture({ registerProvider: null });
  assert.deepEqual(postureDisagreement(older, posture()), [],
    "a capture silent about the register was reported as disagreeing with one that names it");
});

test("either side missing is null — which is not agreement", () => {
  assert.equal(postureDisagreement(null, posture()), null);
  assert.equal(postureDisagreement(posture(), null), null);
});

// ── and the disagreement is not register-only ───────────────────────────────────────────────────────
test("the engine and the billing mode are compared too, because both change the answer silently", () => {
  const rows = postureDisagreement(
    posture({ engine: { id: "engine-a", billing: { mode: "subscription" } } }),
    posture({ engine: { id: "engine-b", billing: { mode: "metered" } } }),
  );
  const named = rows.map((r) => r.what);
  assert.ok(named.includes("engine"), `engine change not reported: ${JSON.stringify(named)}`);
  assert.ok(named.includes("billing mode"), `billing change not reported: ${JSON.stringify(named)}`);
});
