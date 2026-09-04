// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the corrective synthesis pass carries the depth rung the fresh pass carries.
//
// The depth ladder tells the synthesis seat WHICH conflicts earn a prose account. That directive was in
// the fresh dispatch — once — and in the corrective dispatch zero times. The corrective pass re-emits
// the WHOLE narrative and writes the file that ships, so the rung governed a draft and not the delivery:
// the delivered narrative carried full prose accounts for conflicts the rung excludes.
//
// A re-emission that is not told the rung is not a repair of the rung's output. It is a fresh write
// under the default contract, wearing the corrective pass's name.
//
// SCOPE. This is the BUG half of and it stands whatever the design lane rules. The other half —
// how LONG each account may run, per product — is held: the fresh dispatch did carry the rung and the
// prose still grew 19.5% (accounts 141 → 236 words, paragraph count flat at 4.0 → 4.1), and the owner
// has reopened the per-product design. No bound is asserted here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correctionsExtra } from "../pipeline.mjs";
import { proseRungDirective } from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";

const WORLDWIDE = "global-preliminary-search", ONE = "full-country-search";
const depth = (p) => depthFor({ product: p });

function fixtureP() {
  const dir = mkdtempSync(join(tmpdir(), "corrective-rung-"));
  const P = { seniorEyeReview: join(dir, "review.md"), narrative: join(dir, "narrative.md"),
    findings: join(dir, "findings.json"), placement: join(dir, "placement.md") };
  writeFileSync(P.seniorEyeReview, "## Corrections\n\n1. [kind: fact] [on: 1] Something to fix.\n");
  writeFileSync(P.narrative, "# Narrative\n");
  writeFileSync(P.findings, "{}");
  writeFileSync(P.placement, "# Placement\n");
  return P;
}

test("#1503 the corrective dispatch carries the rung BYTE-IDENTICALLY with the fresh one", () => {
  const P = fixtureP();
  const fresh = proseRungDirective(depth(WORLDWIDE));
  assert.ok(fresh.length > 100,
    "the fixture built no fresh directive, so the comparison below would hold over an empty string");
  assert.ok(correctionsExtra(P, depth(WORLDWIDE)).includes(fresh),
    "the corrective dispatch does not carry the depth rung — it re-emits the whole narrative, so the "
    + "rung governs a draft and not the delivery");
});

test("#1503 the UNGRADED product adds nothing — the corrective pass stays byte-identical there", () => {
  const P = fixtureP();
  assert.equal(correctionsExtra(P, depth(ONE)), correctionsExtra(P, null),
    "the one-country corrective dispatch grew a directive it never had");
});

test("#1503 THE CALL SITE passes the depth — a composer arm cannot see a dispatch that never asked", () => {
  // 's lesson applied to its own fix. The arms above hand `correctionsExtra` a depth and check what
  // it builds, which is true of a function nobody calls that way. The defect was never in the composer:
  // it was a dispatch calling it WITHOUT a depth, so the composer answered correctly for the argument it
  // got and the rung still never shipped. This reads the call site instead.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const calls = [...src.matchAll(/(?<!function )correctionsExtra\(([^)]*)\)/g)]
    .map((m) => m[1].trim())
    .filter((a) => !/^P,\s*depth = null/.test(a));    // the declaration, not a call
  assert.ok(calls.length >= 1, "no correctionsExtra call site found — this arm reads nothing");
  for (const args of calls)
    assert.match(args, /^P\s*,\s*ctx\.depth\b/,
      `a corrective dispatch calls correctionsExtra(${args}). Without the depth it re-emits the whole `
      + "narrative under the DEFAULT contract, which is how prose accounts for rung-excluded conflicts "
      + "reached a client.");
});
