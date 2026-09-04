// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SCOPE BLOCK DECLARES WHAT ACTUALLY RAN.
//
// `TRACE_SCOPE` carries the instruction "Update this table when a path is instrumented, never silently
// widen the claim." That instruction was not followed. `commonlaw-carry.mjs` shipped and was wired, and
// on the delivered 2026-08-06 R2 run it produced a complete trace of the common-law path —
//
//     978 candidates traced · 58 reached findings · 920 dropped with a recorded ground · 2 unreasoned
//
// — while `record-carry.json` on that same run went on declaring:
//
//     "path": "common-law",
//     "reason": "common-law-grid.json → findings is not joined here; a candidate lost on that path
//                emits NO row and this trace can say nothing about it either way"
//
// A reader who trusted that — correctly; it exists to be trusted — concluded no common-law trace existed
// and that `withheld: 0` was proven for the register path alone. A stale boundary is worse than none,
// and this one failed in the direction that hides work, which also hid the 2 unreasoned drops the
// common-law trace did find.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACE_SCOPE, traceScopeFor } from "../record-carry.mjs";

const paths = (scope) => scope.uninstrumented.map((u) => u.path);

test("#402 no sibling ran ⇒ the static table, byte-identical — a run that traced nothing claims nothing", () => {
  assert.deepEqual(traceScopeFor([]), TRACE_SCOPE);
  assert.deepEqual(traceScopeFor(), TRACE_SCOPE);
  assert.deepEqual(traceScopeFor(null), TRACE_SCOPE);
  assert.ok(paths(TRACE_SCOPE).includes("common-law"));
});

test("#402 a computable common-law sibling moves that path to instrumented, and names the join", () => {
  const scope = traceScopeFor([{ slice: "common-law", computable: true }]);
  assert.ok(!paths(scope).includes("common-law"), "the path it traced is no longer declared untraced");
  assert.equal(scope.instrumented.length, 2);
  assert.match(scope.instrumented[1], /commonlaw-carry\.json/, "and the declaration names the artifact a reader should open");
  // The paths it genuinely does not trace are untouched. Widening one claim must not widen the others.
  assert.deepEqual(paths(scope).sort(), ["case-law", "crowd remainder", "serp/nativeread"]);
});

test("#402 the zh slice promotes serp/nativeread, and the two promote independently", () => {
  assert.ok(!paths(traceScopeFor([{ slice: "jx-zh", computable: true }])).includes("serp/nativeread"));
  assert.ok(paths(traceScopeFor([{ slice: "jx-zh", computable: true }])).includes("common-law"),
    "tracing the zh slice says nothing about the common-law slice");
  const both = traceScopeFor([{ slice: "common-law", computable: true }, { slice: "jx-zh", computable: true }]);
  assert.deepEqual(paths(both).sort(), ["case-law", "crowd remainder"]);
});

test("#402 promotion needs POSITIVE evidence — every other state stays uninstrumented", () => {
  // Fail-closed, the same direction the rest of the module uses. A trace that could not be computed is
  // not a trace, and declaring it as one would re-create the defect pointing the other way.
  for (const sib of [
    { slice: "common-law", computable: false },
    { slice: "common-law" },
    { slice: "common-law", computable: "true" },
    { computable: true },
    { slice: "case-law", computable: true },       // no tracer exists for it; a slice name cannot mint one
    null, "common-law", 42,
  ]) assert.ok(paths(traceScopeFor([sib])).includes("common-law"), `promoted on ${JSON.stringify(sib)}`);
});

test("#402 case-law is still declared uninstrumented, because it still is", () => {
  const scope = traceScopeFor([{ slice: "common-law", computable: true }, { slice: "jx-zh", computable: true }]);
  const cl = scope.uninstrumented.find((u) => u.path === "case-law");
  assert.ok(cl, "case-law findings are not traced to a record at all, and the artifact must keep saying so");
  assert.match(cl.reason, /not traced to a record/);
});
