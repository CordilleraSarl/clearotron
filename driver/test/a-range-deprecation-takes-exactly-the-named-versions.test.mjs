// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A range deprecation takes exactly the named versions.
//
// The deprecate job could only warn "everything below a stable". Warning a stretch of betas and stables
// with one version held out, because an install still runs it, needed a range: inclusive at both ends in
// npm's order, the exceptions named one by one, and one fixed sentence on every version it takes. These
// arms pin the selection, what it refuses before anything is written, the sentence, and the workflow step
// that hands a range to the script as data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRangeSpec, selectRange, RANGE_MESSAGE } from "../../scripts/deprecate-below.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The registry's shape: a first placeholder, stables, betas below and above them, and a newer beta.
const ALL = ["0.0.0", "0.2.0", "0.2.4", "0.3.0-beta.0", "0.3.0-beta.2", "0.3.0-beta.10", "0.3.0",
  "0.3.3-beta.1", "0.3.3", "0.4.0-beta.0", "0.4.0-beta.1"];

test("the range is inclusive at both ends, in npm's order, with the exception held out", () => {
  const picked = selectRange(ALL, parseRangeSpec("0.2.0..0.4.0-beta.0 except 0.3.3"), { latest: "0.3.3", beta: "0.4.0-beta.1" });
  assert.deepEqual(picked, ["0.2.0", "0.2.4", "0.3.0-beta.0", "0.3.0-beta.2", "0.3.0-beta.10", "0.3.0", "0.3.3-beta.1", "0.4.0-beta.0"]);
  assert.ok(!picked.includes("0.0.0"), "below the range");
  assert.ok(!picked.includes("0.4.0-beta.1"), "above the range");
});

test("several exceptions are named one by one", () => {
  const picked = selectRange(ALL, parseRangeSpec("0.3.0-beta.0..0.3.0 except 0.3.0-beta.2,0.3.0-beta.10"));
  assert.deepEqual(picked, ["0.3.0-beta.0", "0.3.0"]);
});

test("a spec that is not a range is refused, whatever it resembles", () => {
  for (const bad of ["", "0.3.1", "0.2.0..", "..0.4.0", "0.2.0..0.4.0-beta.0 except", "0.2.0...0.3.0",
    "0.2.0..0.3.0; npm publish", "0.2.0..0.3.0 except 0.3.3; echo", "0.4.0..0.2.0"]) {
    assert.throws(() => parseRangeSpec(bad), undefined, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a bound or an exception that is not published, or an exception outside the range, is refused", () => {
  assert.throws(() => selectRange(ALL, parseRangeSpec("0.1.0..0.3.0")), /0\.1\.0 is not a published version/);
  assert.throws(() => selectRange(ALL, parseRangeSpec("0.2.0..0.3.0 except 0.2.9")), /0\.2\.9 is not a published version/);
  assert.throws(() => selectRange(ALL, parseRangeSpec("0.2.0..0.3.0 except 0.3.3")), /lies outside/);
});

test("a version a dist-tag points at is never taken: the range is refused, not trimmed", () => {
  assert.throws(() => selectRange(ALL, parseRangeSpec("0.2.0..0.4.0-beta.1"), { beta: "0.4.0-beta.1" }),
    /0\.4\.0-beta\.1 \(beta\)/);
  assert.throws(() => selectRange(ALL, parseRangeSpec("0.2.0..0.4.0-beta.0"), { latest: "0.3.3" }),
    /0\.3\.3 \(latest\)/, "holding it out is the caller's decision, written as an exception");
});

test("the sentence is the approved one, word for word, and gives no reason", () => {
  assert.equal(RANGE_MESSAGE, "This version is no longer supported. Please upgrade to the latest version of clearotron.");
});

test("the workflow hands a range to the script whole, as data, and a dry run writes nothing", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const job = wf.slice(wf.indexOf("\n  deprecate:"));
  assert.match(job, /node scripts\/deprecate-below\.mjs --range "\$DEPRECATE_BELOW" "\$\{DRY\[@\]\}"/,
    "the range reaches the script as one quoted argument");
  assert.match(job, /DEPRECATE_BELOW: \$\{\{ inputs\.deprecate-below \}\}/, "through env, never pasted into the shell line");
  assert.match(job, /DEPRECATE_DRY_RUN: \$\{\{ inputs\.deprecate-dry-run \}\}/);
  assert.match(job, /if \[ "\$DEPRECATE_DRY_RUN" = "true" \]; then DRY=\(--dry-run\); fi/);
  assert.doesNotMatch(job, /\$\{\{ inputs\.deprecate-below \}\}[^\n]*\n?[^\n]*run:/, "no input interpolated into run:");
  const inputs = wf.slice(wf.indexOf("    inputs:"), wf.indexOf("\njobs:"));
  assert.match(inputs, /deprecate-dry-run:[\s\S]*?type: boolean[\s\S]*?default: false/);
});
