// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE VERSION SETUP INSTALLS CAN RUN THE CURRENT TOP-TIER MODEL.
//
// The engine table names the oldest version of the vendor's program setup will install, and setup passes
// it to npm as "this version or newer". A floor chosen only so the program starts is not enough: the
// program carries its own list of the models it will accept, and one too old to know the current
// generation of the top tier refuses that model at the API with a 400 while the tier alias goes on
// serving the previous generation. Nothing in a run reads as wrong — the older model answers.
//
// Measured on the vendor's program 2.1.263, 2026-09-22:
//   --model claude-opus-5-5  →  400, "Claude Code 2.1.263 does not support this model;
//                                     version 2.1.280 or newer is required"
//   --model opus             →  served, canonicalModel "claude-opus-5"
//
// So the floor is the oldest version that can run the current top tier, and this arm fails if it is ever
// lowered past that. It is a constant compared against a constant on purpose: the number came from the
// vendor's own refusal, and the refusal is not something a test can ask for without a paid call.
import test from "node:test";
import assert from "node:assert/strict";
import { ENGINE_BINARIES, engineInstallArgs } from "../driver.config.mjs";

// The version the program's own refusal named. Raise this only with a fresh measurement beside it.
const RUNS_THE_CURRENT_TOP_TIER = [2, 1, 280];
const parse = (v) => String(v).split(".").map(Number);

test("the anthropic engine's floor is a version that can run the current top-tier model", () => {
  const spec = ENGINE_BINARIES["anthropic-agent"];
  const floor = parse(spec.floor);
  assert.equal(floor.length, 3, `the floor "${spec.floor}" is not a three-part version`);
  assert.ok(floor.every(Number.isFinite), `the floor "${spec.floor}" is not numeric`);
  // Compared part by part rather than as a string: "2.1.99" sorts above "2.1.280" as text.
  const [a, b, c] = floor;
  const [x, y, z] = RUNS_THE_CURRENT_TOP_TIER;
  assert.ok(a > x || (a === x && (b > y || (b === y && c >= z))),
    `the floor is ${spec.floor}; a program older than ${RUNS_THE_CURRENT_TOP_TIER.join(".")} refuses the current top-tier model and serves the previous generation in silence`);
});

test("setup asks npm for that version or newer, so a fresh install cannot land under the floor", () => {
  const spec = ENGINE_BINARIES["anthropic-agent"];
  const args = engineInstallArgs(spec, "/tmp/engines");
  assert.ok(args.includes(`${spec.package}@>=${spec.floor}`),
    `the install spec does not carry the floor: ${args.join(" ")}`);
  // THE CONTROL: no ceiling. A caret or a pinned version would hold the program at today's release and
  // the next generation of the tier would be unreachable for the same reason this floor moved.
  assert.ok(!args.some((a) => /[@^~]\d|@\d/.test(a) && !a.includes(">=")),
    `the install spec pins a version rather than a floor: ${args.join(" ")}`);
});
