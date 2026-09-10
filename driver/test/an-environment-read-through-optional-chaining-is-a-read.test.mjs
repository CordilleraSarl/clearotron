// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An environment variable read through optional chaining is a read, and the catalogue sees it.
//
// `namesRead` in scripts/env-audit.mjs is the scanner every environment-catalogue check reads from. It
// saw `env.X` and `process.env.X` and did not see `env?.X` or `process.env?.X`, so a variable read that
// way needed no governance row, no catalogue row and no effect declaration, and every catalogue check
// stayed green about it. Three product names were read only that way.
//
// What the tests hold:
//   - every spelling of a read is seen, optionally chained or not;
//   - a `?.` read that is compared or defaulted is still a read;
//   - what the scanner refuses stays refused with a `?.` in it: an `env` reached through another object,
//     an identifier that merely ends in `env`, a comment line, and an assignment;
//   - a computed read through a bound constant resolves through `?.[` as it does through `[`;
//   - on this tree, the three names read only through `?.` are product reads, and each is documented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namesRead, envNameBindings, mergeEnvNameBindings, auditEnv } from "../../scripts/env-audit.mjs";

const seen = (code, bindings = null) => [...namesRead(code, bindings)].sort();

test("a read is seen whether or not it is optionally chained", () => {
  const SPELLINGS = [
    "const a = env.CLEAROTRON_PROBE;",
    "const a = process.env.CLEAROTRON_PROBE;",
    "const a = env?.CLEAROTRON_PROBE;",
    "const a = process.env?.CLEAROTRON_PROBE;",
    "const a = process?.env?.CLEAROTRON_PROBE;",
    'const a = env?.["CLEAROTRON_PROBE"];',
    'const a = process.env?.["CLEAROTRON_PROBE"];',
  ];
  for (const code of SPELLINGS) assert.deepEqual(seen(code), ["CLEAROTRON_PROBE"], code);
});

test("a `?.` read that is compared or defaulted is still a read", () => {
  assert.deepEqual(seen("if (env?.CODEX_HOME === x) go();"), ["CODEX_HOME"]);
  assert.deepEqual(seen("const s = String(env?.CLEAROTRON_DATABASE ?? '');"), ["CLEAROTRON_DATABASE"]);
});

test("what was not a read is still not one with a `?.` in it", () => {
  // THE CONTROLS. A widening that matched every `?.` would pass both arms above and invent rows here.
  assert.deepEqual(seen("const a = cfg?.env?.CLEAROTRON_PROBE;"), [], "an env reached through another object");
  assert.deepEqual(seen("const a = myenv?.CLEAROTRON_PROBE;"), [], "an identifier that merely ends in env");
  assert.deepEqual(seen("  // reads env?.CLEAROTRON_PROBE when set"), [], "a comment line");
  assert.deepEqual(seen("env.CLEAROTRON_PROBE = '1';"), [], "an assignment is a write");
});

test("a computed read through a bound constant resolves through `?.[` as through `[`", () => {
  const bindings = mergeEnvNameBindings([envNameBindings('export const PROBE_VAR = "CLEAROTRON_PROBE";')]);
  assert.deepEqual(seen("const a = env[PROBE_VAR];", bindings), ["CLEAROTRON_PROBE"]);
  assert.deepEqual(seen("const a = env?.[PROBE_VAR] === '1';", bindings), ["CLEAROTRON_PROBE"]);
  assert.deepEqual(seen("const a = env?.[PROBE_VAR];"), [], "with no binding map, that half is off");
});

test("on this tree, the names read only through `?.` are product reads, and each is documented", () => {
  const audit = auditEnv();
  assert.ok(audit, "the audit read no corpus: this tree is not a git checkout");
  // A FLOOR, so an audit that read almost nothing cannot pass the lines below by absence.
  assert.ok(audit.rows.length > 300, `the audit saw only ${audit.rows.length} names`);
  const rows = new Map(audit.rows.map((r) => [r.name, r]));
  for (const [name, file] of [
    ["CLEAROTRON_INVOKED_AS", "shared/invocation.mjs"],
    ["CLEAROTRON_REQUIRE_EXPLICIT_PORTS", "shared/listen.mjs"],
    ["CLEAROTRON_UPDATER_STAMP", "driver/updater-identity.mjs"],
  ]) {
    const r = rows.get(name);
    assert.ok(r, `${name} is not seen as read anywhere`);
    assert.ok([...r.files].includes(file), `${name} is read by ${file}; the audit has ${[...r.files].join(", ")}`);
    assert.equal(r.product, true, `${name} is read by ${file}, which ships`);
    assert.equal(r.documented, true, `${name} has no row in either governance document`);
  }
});
