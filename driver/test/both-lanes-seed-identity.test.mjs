// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — EVERY LANE'S STATUS SEED CARRIES THE IDENTITY, WHATEVER STEPPER IT WALKS.
//
// The knockout lane wrote its own status seed because it legitimately does not want the clearance
// STEPPER, and in opting out of the stepper it silently lost the BUILD RECEIPT and the LIVENESS RECORD
// that lived in the same call. Measured on two delivered runs, one per lane: the knockout run carried
// 32 keys and none of `engineCommit`/`pid`/`pidStarttime`; the clearance run carried 34 and all three.
//
// So the population is "every place that seeds a run status", derived rather than listed — a future
// lane that writes a third seed is caught by the same arm that would have caught this one.
//
// THE SELECTOR IS NOT THE PAYOFF. Seeds are selected on `schema: 1` — the fresh-seed marker, which has
// nothing to do with identity — and the assertion is that each spreads `identitySeed()`. Selecting on
// the spread and then asserting it can never fail. The floor below is the other half: a selector that
// silently matched nothing would otherwise pass by finding no work to do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { identitySeed } from "../progress.mjs";
import { classifyRun } from "../reconcile-runs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The text of every `writeRunStatus(` argument list in `src`, brace-balanced rather than regexed. */
export function writeRunStatusCalls(src) {
  const out = [];
  const CALL = "writeRunStatus(";
  for (let i = src.indexOf(CALL); i !== -1; i = src.indexOf(CALL, i + 1)) {
    let depth = 0, j = i + CALL.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") { depth--; if (depth === 0) break; }
    }
    if (depth === 0) out.push(src.slice(i + CALL.length, j));
  }
  return out;
}

/** A seed is a `writeRunStatus` call that stamps the schema — the mark of a FIRST write, not a patch. */
const isSeed = (argText) => /\bschema:\s*1\b/.test(argText);

test("Refs tracker issue 1995 — every run-status seed in the tree spreads identitySeed()", (t) => {
  // THE WHOLE TREE, not `driver/` — a lane that seeds a run status from `scripts/` or `mcp-server/`
  // would be outside a driver-scoped walk by construction, which is the shape of narrowing this file is
  // written against. Test files are excluded because they BUILD seed literals as fixtures and are not
  // lanes; that exclusion is the only one, and it is by path rather than by filename pattern so a
  // helper under a test directory cannot slip back in.
  const files = trackedFiles("both-lanes-seed-identity", { root: ROOT, pathspec: ["*.mjs"] })
    ?.filter((f) => !f.split("/").includes("test") && !f.split("/").includes("node_modules"));
  if (!files) return t.skip(skipReason("both-lanes-seed-identity"));
  // A null from trackedFiles is "no checkout" and skips above. An empty ARRAY is different and worse:
  // the corpus read SUCCEEDED and found nothing, so the loop below would walk nothing, derive no seeds,
  // and the floor further down would report the absence as though a lane had lost its identity. Name it
  // here, where it is still a failure to look rather than a finding about the tree.
  assert.ok(files.length > 0, "no non-test .mjs files were collected — this is a SKIP dressed as a pass");

  const seeds = [];
  for (const rel of files) {
    for (const call of writeRunStatusCalls(readFileSync(join(ROOT, rel), "utf8"))) {
      if (isSeed(call)) seeds.push({ rel, call });
    }
  }

  // THE FLOOR. Two lanes seed a run today — clearance (driver/progress.mjs seedRunStatus) and knockout
  // (driver/pipeline-knockout.mjs). A derivation that found fewer than two has stopped seeing one of
  // them, and an empty population asserting nothing is the pass this whole file exists to refuse.
  // Three today: clearance (progress.mjs seedRunStatus) and knockout's TWO — the early one above every
  // refusal, and the full one further down. The issue named only the second.
  assert.ok(seeds.length >= 3,
    `expected at least the clearance seed and knockout's two, derived ${seeds.length}: `
    + `${seeds.map((s) => s.rel).join(", ") || "(none)"} — the selector has stopped seeing a lane, `
    + "which reads as a pass and is not one");

  const missing = seeds.filter((s) => !/\.\.\.identitySeed\(\)/.test(s.call));
  assert.deepEqual(missing.map((s) => s.rel), [],
    "a lane seeds a run status without the identity: it will produce runs that cannot be attributed to "
    + "a commit and that reconcile-runs can only judge by the weaker quiet-window test");
});

test("Refs tracker issue 1995 — the identity seed carries the three fields, and names its evidence", () => {
  const seed = identitySeed();
  assert.equal(typeof seed.pid, "number");
  assert.ok(seed.pid > 0, "a seed with no pid leaves the run ineligible for the exact liveness test");
  assert.ok("pidStarttime" in seed, "pidStarttime is what stops a recycled pid impersonating the run");
  assert.ok("engineCommit" in seed, "the build receipt — read from the run's OWN record, never inferred "
    + "from the box's current checkout");
  // — a sha attested by a shipped build-info.json is a weaker claim than one
  // read from a live checkout, and this field is the only place a later reader can tell them apart.
  assert.ok(["git", "build-info", null].includes(seed.engineCommitSource ?? null),
    `engineCommitSource must name the evidence or be null, got ${JSON.stringify(seed.engineCommitSource)}`);
});

test("Refs tracker issue 1995 — a knockout-shaped status reaches the EXACT liveness branch, not the weaker one", () => {
  // Built from the real seed rather than from hand-written literals, so this cannot keep passing after
  // the seed's shape moves. `state: "running"` is what both lanes write; `updatedAt` is deliberately
  // FRESH, so the quiet-window fallback would answer "unknown" and the exact branch is the only route
  // to a `dead` verdict — that is what makes this arm discriminating rather than decorative.
  const status = { ...identitySeed(), state: "running", updatedAt: new Date().toISOString(), lane: "knockout" };

  const dead = classifyRun(status, { now: Date.now(), isAlive: () => false });
  assert.equal(dead.verdict, "dead");
  assert.match(dead.why, /^pid \d+ is gone/,
    "the verdict must come from claimerIsAlive, not from the updatedAt quiet window that reconcile-runs "
    + "itself labels THE WEAKER TEST");

  const live = classifyRun(status, { now: Date.now(), isAlive: () => true });
  assert.equal(live.verdict, "live");

  // THE CONTROL: strip the identity and the same run falls back to the weaker test — which is exactly
  // what every knockout run did before this change.
  const { pid, pidStarttime, ...withoutIdentity } = status;
  const weak = classifyRun(withoutIdentity, { now: Date.now(), isAlive: () => false });
  assert.notEqual(weak.verdict, "dead",
    "without a pid the exact branch is unreachable — if this now says `dead`, the control is broken and "
    + "the arm above proves nothing");
  assert.match(weak.why, /no pid recorded/);
});
