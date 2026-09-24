// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: A PATH IN A TOOL CALL THE ENGINE DICTATES IS WRITTEN AS JSON, NOT PASTED IN.
//
// The register stages tell the model the exact call to make, as JSON: `{"plan_path": "…", "output_path":
// "…"}`. The paths were pasted between the quotes as they stood. On Linux and macOS that is valid JSON; on
// Windows a path is `C:\Users\…`, and a backslash inside a JSON string must be escaped, so the call the
// model was handed was not JSON at all. Found on the Windows runner, 2026-09-23, when the plan-join
// follow-up arm could not parse the call the run dispatched. Every such value is now written with
// JSON.stringify, which on Linux and macOS gives the same bytes as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composerFor } from "../repair-composers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WIN_PLAN = "C:\\Users\\lawyer\\AppData\\Local\\clearotron\\runs\\r1\\_driver\\register-plan.json";
const WIN_BAND = "C:\\Users\\lawyer\\AppData\\Local\\clearotron\\runs\\r1\\register-bands\\primary-sweep.md";

test("no prompt pastes a path into a JSON literal: every *_path value is written as JSON", () => {
  const offenders = [];
  for (const rel of ["driver/stages.mjs", "driver/repair-composers.mjs", "driver/gateway.mjs"]) {
    readFileSync(join(ROOT, rel), "utf8").split("\n").forEach((line, i) => {
      if (/"[a-z_]*path": "\$\{/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "a path pasted between quotes is not JSON on Windows; write it with JSON.stringify");
});

test("the plan-join repairs hand the model a call that parses, with the Windows paths intact", () => {
  for (const key of ["register-unit:plan-join-fresh", "register-unit:plan-join"]) {
    const c = composerFor(key);
    assert.ok(c, `no composer is registered as ${key}`);
    const text = String(c.compose({ axis: "primary-sweep", registerPlan: WIN_PLAN, bandPath: WIN_BAND,
      entries: [{ qid: "primary-sweep+merch" }], missing: [{ qid: "primary-sweep+merch" }] }));
    const m = text.match(/register_execute_plan ONCE with (\{[^\n]*?\}) /);
    assert.ok(m, `${key}: no call in the prompt:\n${text.slice(0, 600)}`);
    const call = JSON.parse(m[1]);
    assert.equal(call.plan_path, WIN_PLAN, `${key}: the plan path did not survive`);
    assert.equal(call.output_path, WIN_BAND, `${key}: the band path did not survive`);
  }
});
