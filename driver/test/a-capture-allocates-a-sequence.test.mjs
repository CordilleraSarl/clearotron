// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-capture-allocates-a-sequence.test.mjs — no transport writes its forensic capture to a fixed path.
//
//, acceptance 4: "A fix that lands on one transport and leaves the class is the defect
// this repo keeps paying for." Thirteen recording transports captured the payload BEFORE their decision,
// each to a path derived from something that does not change between calls — a literal `call-001.json`,
// an axis name, a finding's ordinal. A second call to the same subject destroyed the first's evidence.
//
// The overwrite was MEASURED on synthesis (a preserved run in the 2026-08-27 round: two refusals logged, one payload
// on disk, and it was the accepted third call) and INFERRED for the other twelve from a fixed capture
// path. This guard is what keeps the class closed after the fix: a new transport that writes its capture
// to a fixed path reds on the commit that adds it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, GUARD_OK_MARKER, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const GUARD = "capture-allocates-a-sequence";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("1964 every recording transport allocates a capture sequence — none writes a fixed path", (ctx) => {
  const files = trackedFiles(GUARD, { root: ROOT, pathspec: ["driver/*-record.mjs"] });
  // A VISIBLE, COUNTABLE SKIP — never a bare return. node:test counts `return;` as a PASS, so a
  // guard that bails that way reports its whole subject clean having measured none of it.
  if (files === null) return ctx.skip(skipReason(GUARD));
  const capturing = [], fixed = [];
  // The wrapper AT THE SITE, which is the form 's guard asks for: it reads in the loop head where
  // the next person meets it, and it cannot drift away from the loop it protects.
  for (const rel of nonEmpty(files, `${GUARD}: tracked driver/*-record.mjs files`)) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    // A transport CAPTURES if it names a payload path at all.
    if (!/payload:\s*join\(/.test(src)) continue;
    capturing.push(rel);
    // It is FIXED if it still writes straight at that path instead of allocating a sequence.
    const writesFixed = /writeFileSync\((?:paths\.)?payload,/.test(src);
    const allocates = /captureCall\(\{/.test(src);
    if (writesFixed || !allocates) fixed.push(`${rel}${writesFixed ? " (writes payload directly)" : " (no captureCall)"}`);
  }
  nonEmpty(capturing, `${GUARD}: transports that capture a payload`);
  assert.deepEqual(fixed, [],
    "these transports write their forensic capture to a path that does not change between calls, so a "
    + "second call destroys the first's evidence:\n  " + fixed.join("\n  ")
    + "\nAllocate with captureCall({ nameFor }) from driver/call-capture.mjs. Sequence 1 must keep the "
    + "transport's existing name so today's readers are unmoved.");
  console.log(`${GUARD_OK_MARKER} — ${GUARD}: ${capturing.length} capturing transport(s), all allocating`);
});

test("1964 the guard can FAIL — a fixed-path transport is caught", () => {
  // The live table is all-clean, which is exactly when a census stops proving anything. This drives the
  // detecting branch with a planted member the real population does not contain.
  const planted = [
    { rel: "driver/planted-record.mjs", src: 'export function p(){ const paths = { payload: join(d,"call-001.json") }; writeFileSync(paths.payload, "x"); }' },
    { rel: "driver/good-record.mjs", src: 'const x = { payload: join(d,"call-001.json") }; captureCall({ nameFor });' },
  ];
  const caught = planted.filter(({ src }) =>
    /payload:\s*join\(/.test(src) && (/writeFileSync\((?:paths\.)?payload,/.test(src) || !/captureCall\(\{/.test(src)));
  assert.deepEqual(caught.map((c) => c.rel), ["driver/planted-record.mjs"],
    "the guard does not catch a transport that writes its capture to a fixed path");
});
