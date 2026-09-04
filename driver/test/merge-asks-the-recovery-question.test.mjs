// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE MERGE ASKS WHAT WENT WRONG BEFORE DECIDING NOTHING CAN BE DONE.
//
// Two of two clearances died at the common-law merge in one round, deterministic, zero recoveries, on
// two different validator complaints. Two defects stacked, and the second is the one that made the
// first fatal.
//
//   1. The merge's remedy channel — a bounded, dictated, ONE-round repair that routes the validator's own
//      correction hint back to the meaning seat — extracted its token from `e.message`. StageFailure
//      builds that as `${stage}: ${reason}`, and  moved the payload out of `reason` into `detail`.
//      So the token was never in the string being searched, `!tok` was true on every merge failure, and
//      the channel re-threw before it opened. Dead since that split, silently.
//   2. `clFailClass` was computed from quarantine state alone, TWO LINES ABOVE the validator call, so
//      `v.reason` never reached the classification and every unquarantined merge failure was
//      deterministic — parkBudget 0 — whatever had gone wrong.
//
// The proof that (2) was wrong is a production run: `connotation_call_partial` RECOVERED at a half hours
// earlier on the same engine family and killed a run at the merge. Same token, two paths, one of them
// never asking.
//
// SCOPE, kept honest and unchanged from the issue: it is NOT established that every merge complaint is
// recoverable. A genuine dead end must still terminate. What these tests pin is that the QUESTION IS
// ASKED — the token reaches the channel, and the class comes from what the validator said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StageFailure, connotationRemedyToken } from "../pipeline.mjs";
import { classifyFailureReason } from "../repairs.mjs";

// The two failures that prompted this, verbatim in shape: the sentence in `reason`, the token in `detail`.
const R2_DETAIL = "connotation_quote_unbound:quote_unbound=3;X-SBCJC2ZS [https://e.test/1] missing";
const R1_DETAIL = "connotation_call_partial:the 77 rows already recorded are KEPT; 2 still outstanding";
const merged = (detail) => new StageFailure("common-law", "merged half-grids failed the canonical validator",
  undefined, { detail });

// ── the channel can see the token ───────────────────────────────────────────────────────────────────

test("#1279 the remedy token is found in `detail`, which is the only place a merge failure puts it", () => {
  assert.equal(connotationRemedyToken(merged(R1_DETAIL)), R1_DETAIL,
    "the remedy channel cannot see a call_partial — the repair that recovers it never opens");
  assert.match(connotationRemedyToken(merged(R2_DETAIL)) ?? "", /^connotation_quote_unbound/);
});

test("#1279 VOID CONTROL — a merge failure's MESSAGE carries no token, which is why this was dead", () => {
  // If this ever stops being true the outage's mechanism has changed, and the test above stops
  // distinguishing the fix from the bug it replaced.
  const e = merged(R1_DETAIL);
  assert.equal(e.message, "common-law: merged half-grids failed the canonical validator");
  assert.equal(connotationRemedyToken({ message: e.message }), null,
    "the message now carries a token — the pre-#614 shape is back and this guard is measuring nothing");
});

test("#1279 the message is still read, so an archived or re-thrown failure keeps opening the channel", () => {
  assert.match(connotationRemedyToken({ message: `common-law: ${R1_DETAIL}` }) ?? "", /^connotation_call_partial/);
});

test("#1279 a failure with no connotation token opens nothing", () => {
  assert.equal(connotationRemedyToken(new StageFailure("fan-in", "band artifact malformed")), null);
  assert.equal(connotationRemedyToken(undefined), null);
  assert.equal(connotationRemedyToken({ detail: "quote_unbound" }), null,
    "a bare reason word without the connotation_ prefix is not a token — it would open the channel for anything");
});

// ── the class comes from what the validator said ────────────────────────────────────────────────────

test("#1279 a recoverable token does NOT classify as deterministic", () => {
  // deterministic is parkBudget 0 — "never parked at all". That is the value that turned a recoverable
  // half-level complaint into a terminal merge death, and the one thing this must never produce for a
  // complaint the engine has a lane for.
  for (const detail of [R1_DETAIL, R2_DETAIL]) {
    const c = classifyFailureReason(detail);
    assert.notEqual(c, "deterministic",
      `${detail.slice(0, 40)} classified deterministic — parkBudget 0, and the recovery question is closed again`);
    assert.equal(c, "unknown", "the structured-token catch-all moved; #849's one park is what this relies on");
  }
});

test("#1279 the merge derives its class from the validator's reason, and only after the validator runs", () => {
  // The behaviour tests above pass against the broken pipeline: they call the helper and the router
  // directly. Only this reads the call site, and the ORDER is half the defect — the class was computed
  // two lines before the validator spoke. Anchored to code, because the comment beside the fix quotes
  // the old expression and an unanchored grep would match the explanation of the bug.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const iValidator = src.indexOf("validators.commonLaw(P.commonLaw");
  const iClass = src.indexOf("const clFailClass");
  assert.ok(iValidator > 0 && iClass > 0, "the merge's validator call or its fail class could not be found");
  assert.ok(iClass > iValidator,
    "clFailClass is computed BEFORE the validator runs — v.reason cannot reach it, which is #1279 exactly");
  const expr = /const clFailClass = ([^;]+);/.exec(src);
  assert.ok(expr, "clFailClass is no longer a single expression — re-read this guard against the new shape");
  assert.match(expr[1], /classifyFailureReason\(\s*v\.reason\s*\)/,
    `the class is not derived from the validator's reason (found: ${expr[1].trim()})`);
  assert.match(expr[1], /anyQuarantined/,
    "quarantine stopped being an input — a quarantined half is re-run fresh and must stay transient");
});

test("#1279 the remedy call site uses the exported reader, not a private message match", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.match(src, /const tok = connotationRemedyToken\(e\);/,
    "the remedy is extracting its token inline again — the tested reader is not the one that runs");
});
