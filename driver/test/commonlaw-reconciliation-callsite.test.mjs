// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// #1039 — THE #703/#914 RATCHET, TESTED AT ITS CALL SITE.
//
// `commonlaw-carry-ratchet.test.mjs` is 133 lines, green since #914, and tests `reconciliationVerdict`
// in isolation. The ratchet still never recorded once: `deriveRecordCarry`'s verdict block in pipeline.mjs named a bare `slice` with no
// binding, the ReferenceError threw on the first statement after the verdict, and the catch reported
// `verdict failed (non-fatal)` — to stderr only. **Ten pool traversals, ten failures, zero successes.**
//
// The unit was tested. The wiring was not. So this file tests the WIRING: does calling
// `deriveRecordCarry` put a `commonlaw-reconciliation` line in `run.jsonl`? Nothing short of that
// question would have failed while the defect was live.
//
// It also pins the two properties the repaired catch owes:
//   · a ReferenceError is recorded as a DRIVER BUG, distinct from a domain failure — one of them means
//     our code is broken and the other means the artifact was;
//   · both leave a DURABLE record in run.jsonl. `note()` is stderr-only, which is the second half of why
//     #914 survived two months: no consumer we have reads stderr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   // #1336

import { deriveRecordCarry } from "../pipeline.mjs";
import { paths } from "../stages.mjs";

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "clc-ratchet-"));
  mkdirSync(driverDir(d), { recursive: true });
  // The one file deriveRecordCarry refuses without: absent ⇒ it returns `notComputable` before the
  // ratchet is reached, and the test would pass by never arriving. It lives at the RUN ROOT, not under
  // _driver/ — the first draft of this fixture wrote it to _driver/ and the arm below caught that.
  writeFileSync(join(d, "register-named-band.json"), JSON.stringify({ enumerated: [], crowds: [] }));
  return d;
}
const ctxFor = (d) => ({ paths: paths(d) });
const events = (d) => {
  const p = driverDir(d, "run.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const named = (d, event) => events(d).filter((e) => e.event === event);

test("THE CALL SITE: deriving the carry actually puts a commonlaw-reconciliation line in run.jsonl", () => {
  // The assertion #914 never had. With the unbound identifier in place this fails, and every one of the
  // 133 isolated tests still passes — which is the whole lesson.
  const d = runDir();
  deriveRecordCarry(ctxFor(d), "publish", { findings: [] });

  const rows = named(d, "commonlaw-reconciliation");
  assert.equal(rows.length, 1, "the ratchet must record on every run — this is the event that never once appeared");
  assert.ok(typeof rows[0].state === "string" && rows[0].state, "the row carries the verdict state");
  assert.ok("candidates_rate" in rows[0] && "cells_rate" in rows[0], "…and the two rates the floor is compared on");
  assert.deepEqual(named(d, "commonlaw-reconciliation-bug"), [], "a healthy run raises no driver-bug row");
});

test("the walk reached the ratchet rather than short-circuiting before it", () => {
  // deriveRecordCarry returns `notComputable` when register-named-band.json is missing, and that path
  // ALSO writes a record-carry event. Without this arm the test above could be satisfied by a fixture
  // that never got as far as the code under test.
  const d = runDir();
  deriveRecordCarry(ctxFor(d), "publish", { findings: [] });
  const carry = named(d, "record-carry");
  assert.equal(carry.length, 1, "record-carry is emitted at :2455, immediately before the ratchet");
  assert.notEqual(carry[0].reason, "no register-named-band.json (nothing was retrieved, or a run predating the named band)",
    "the fixture short-circuited: this run never reached the ratchet at all");
});

// NOT TESTED HERE, AND SAID RATHER THAN FAKED: the ReferenceError branch cannot be driven from a test.
// A genuine one needs an unbound identifier IN the try block, which means editing the source — there is
// no injection point, because `COMMONLAW_CARRY_FLOOR` is a module constant and a malformed artifact
// throws a TypeError, which is deliberately NOT in the bug bucket. Writing a test that throws its own
// ReferenceError somewhere else would assert that `instanceof` works, not that this catch classifies.
// The branch is verified by MUTATION instead — reintroduce an unbound identifier, observe the
// `commonlaw-reconciliation-bug` row — and the PR carries that output. The test below pins the shape so
// the classification cannot drift without a reader noticing.

test("the repaired catch reports DURABLY — a stderr-only report is what bought #914 two months", () => {
  // note() writes to stderr (log.mjs:61). Nothing that reads artifacts can see it. The catch must put a
  // row in run.jsonl whichever branch it takes, or the next non-fatal failure is equally invisible.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("#1039 — THIS CATCH BOUGHT"), src.indexOf("#1039 — THIS CATCH BOUGHT") + 2200);
  assert.ok(/runLog\(P\.runDir, \{[\s\S]*?event: bug \? "commonlaw-reconciliation-bug" : "commonlaw-reconciliation-failed"/.test(block),
    "the catch must runLog a durable row on BOTH branches");
  assert.ok(/const bug = e instanceof ReferenceError;/.test(block),
    "ReferenceError is the discriminator; if this changed, the classification boundary moved and the census rationale is stale");
  assert.ok(!/instanceof TypeError/.test(block),
    "TypeError must not join the programming-error bucket — that repeats this catch's own substitution in reverse");
});
