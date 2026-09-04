// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The on/off idiom, and what happens to a switch after it is retired.
//
// Seven bugs have shipped in this codebase where an absence was read as a pass. This file pins the two
// shapes of that bug that live in the ENVIRONMENT, because both had shipped and neither was visible:
//
//   1. A flag written as a bare truthiness test ARMS on `X=0`. `"0"` is a non-empty string, so the
//      operator who followed the documented `0`-disables idiom turned the feature ON. That was live in
//      CLEAROTRON_SELFTEST_PATHS_ONLY and CLEAROTRON_DUMP_JSON, and CLEAROTRON_PLAN_DISPATCH — documented as a kill
//      switch, second in governance's own "`0` disables" list — honoured only the literal "off", so
//      rolling back plan dispatch by the documented idiom left the lane fully armed.
//
//   2. A retired variable goes SILENT. It is deleted from the code, the operator's env file keeps the
//      line, and nothing anywhere says the setting stopped meaning something.
//
// Both are tested against the real predicates rather than a restatement of them: a test that spells out
// its own copy of the rule passes when the rule and the copy drift apart together, which is the failure
// mode this whole file exists to catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { envOn, envGateOn } from "../driver.config.mjs";
import { retiredEnvWarnings } from "../pipeline.mjs";
import { RETIRED_NEW_SPELLINGS, warnRetiredEnv } from "../../shared/env-aliases.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const NAME = "CLEAROTRON_TEST_IDIOM_PROBE";
const withVal = (v, fn) => {
  const had = Object.hasOwn(process.env, NAME), prev = process.env[NAME];
  if (v === undefined) delete process.env[NAME]; else process.env[NAME] = v;
  try { return fn(); } finally { if (had) process.env[NAME] = prev; else delete process.env[NAME]; }
};

test("envOn (default-OFF opt-in): only a real value arms it — every off-word and empty read as off", () => {
  for (const off of [undefined, "", "0", "off", "false", "no", "OFF", " 0 ", "False"])
    assert.equal(withVal(off, () => envOn(NAME)), false, `envOn must be false for ${JSON.stringify(off)}`);
  for (const on of ["1", "on", "true", "yes", "enforce", "anything"])
    assert.equal(withVal(on, () => envOn(NAME)), true, `envOn must be true for ${JSON.stringify(on)}`);
});

test("envGateOn (default-ON gate): unset is ON, and BOTH `0` and `off` disable it", () => {
  for (const on of [undefined, "", "1", "on", "true", "yes"])
    assert.equal(withVal(on, () => envGateOn(NAME)), true, `envGateOn must be true for ${JSON.stringify(on)}`);
  for (const off of ["0", "off", "false", "no", "OFF", " off "])
    assert.equal(withVal(off, () => envGateOn(NAME)), false, `envGateOn must be false for ${JSON.stringify(off)}`);
});

// The bug, stated as the property it violated: for a default-ON gate the two idioms must AGREE. Any
// value that one spelling treats as "off" the other must too, or the operator's rollback arms the lane.
test("the `=0` bug cannot come back: `0` and `off` are never in disagreement on a gate", () => {
  for (const spelling of ["0", "off"]) {
    assert.equal(withVal(spelling, () => envGateOn(NAME)), false, `${spelling} must disable a gate`);
    assert.equal(withVal(spelling, () => envOn(NAME)), false, `${spelling} must not arm an opt-in`);
  }
});

test("retired env vars WARN rather than vanish, and name the file to edit", () => {
  assert.deepEqual(retiredEnvWarnings({}), [], "a clean environment produces no noise");
  assert.deepEqual(retiredEnvWarnings({ CLEAROTRON_KNOCKOUT_MODE: "" }), [], "an empty value is not 'set'");

  const w = retiredEnvWarnings({ CLEAROTRON_KNOCKOUT_MODE: "1", CLEAROTRON_JX_LANES: "1", CLEAROTRON_RECIPES_MODE: "1" });
  assert.equal(w.length, 3, "one line per retired variable still set");
  for (const line of w) {
    assert.match(line, /RETIRED 2026-07-27/, "the line dates the retirement");
    assert.match(line, /does nothing/, "…says plainly that the setting has no effect");
    assert.match(line, /Delete the line/, "…and tells the operator what to do about it");
  }
  assert.match(w.join("\n"), /CLEAROTRON_KNOCKOUT_MODE/);

  // WARN, not refuse, and deliberately: these are dead, so a stale line changes nothing about the run,
  // and the env files carrying it are outside this repo. Refusing would turn a line nobody has opened in
  // months into a failure to run at all. The warning goes to stderr — the ops-MCP speaks JSON-RPC over
  // stdio, and a stray stdout line corrupts the protocol.
  assert.equal(typeof retiredEnvWarnings, "function");
});

// ──: THE TWO RETIREMENT LISTS MUST NOT ROT APART ───────────────────────────────────────────────
//
// Two lists in two files, and this arm is what keeps them saying the same thing. `pipeline.mjs`'s
// `RETIRED_ENV` is what an operator's stale line is matched against; `shared/env-aliases.mjs` carries
// `RETIRED_NEW_SPELLINGS` and the sentence the operator reads. A name retired in one and not the other
// warns half the estate.
//
// ── WHAT THE 2026-09-04 RENAME TOOK OUT OF THIS ARM, SAID PLAINLY ───────────────────────────────────
//
// This used to assert a variable warned in BOTH spellings, deriving the old one from the new. That
// premise was real while two prefixes existed: `retiredEnvWarnings` keyed on the old spelling because
// forbade pipeline.mjs from learning the new one, and the arm crossed the two lists.
//
// The global rename left ONE spelling, and the derivation with it. The sweep rewrote the line to
// `now.replace(/^CLEAROTRON_/, "CLEAROTRON_")` — a no-op that still passed, still read like a
// cross-spelling check, and asserted the same thing twice. That is worse than a red: an arm whose name
// promises two spellings while its body can only see one.
//
// So the derivation is GONE rather than repaired to a dead prefix. Warning on the old names is not a
// gap this arm should cover — the owner ruled in August that a pre-rename name is "not translated, not
// warned about, and not looked for", because a box reaches this code through the install and the two
// boxes that predated the rename are rebuilt. There is no population holding those lines. What is left
// to check is the thing that can still rot: the two lists agreeing, in the one spelling there is.
test("#1014 every retired variable is live in BOTH lists, in the one spelling there is", () => {
  nonEmpty(Object.keys(RETIRED_NEW_SPELLINGS), "no retired variable was checked — the loop would pass over an empty list");
  for (const [now, why] of Object.entries(RETIRED_NEW_SPELLINGS)) {
    assert.ok(retiredEnvWarnings({ [now]: "x" }).length === 1,
      `${now} is not in pipeline.mjs's RETIRED_ENV, so an operator carrying that line is not warned`);
    assert.ok(why.trim().length > 80 && /Delete|waiting|nothing/.test(why),
      `${now}: the reason must tell the operator what changed and what to do`);
  }

  // And the new spelling actually produces a line. `warnRetiredEnv` is the emitter; a note that never
  // fires is the same silence in a different file.
  const notes = [];
  warnRetiredEnv({ env: { CLEAROTRON_DELIVERY: "stage" }, note: (l) => notes.push(l) });
  assert.equal(notes.length, 1, "the new spelling produced no warning");
  assert.match(notes[0], /RETIRED and does nothing/);
  assert.match(notes[0], /Delete the line/);
  warnRetiredEnv({ env: {}, note: (l) => notes.push(l) });
  assert.equal(notes.length, 1, "a clean environment produces no noise");
});

// WHERE the warning fires is the whole point of it. prelim-driver.service runs runner.mjs, so the
// EnvironmentFile carrying a stale line is read by THAT process. Warning only from the pipeline.mjs CLI —
// a tool an operator invokes by hand — would have put the notice everywhere except the process that sees
// the file. Asserted against the source of both entrypoints rather than by spawning them, because a spawn
// would need a queue, a workspace and a job to get far enough to prove anything.
test("both entrypoints emit the retired-env warning: the systemd runner AND the manual CLI", () => {
  for (const [file, why] of [["runner.mjs", "prelim-driver.service ExecStart — the process that reads the EnvironmentFile"],
                             ["pipeline.mjs", "the manual CLI"]]) {
    const src = readFileSync(join(HERE, "..", file), "utf8");
    assert.match(src, /for \(const w of retiredEnvWarnings\(\)\) console\.error\(w\);/,
      `${file} must emit the warning (${why})`);
    assert.doesNotMatch(src, /for \(const w of retiredEnvWarnings\(\)\) console\.log\(/,
      `${file} must use stderr — the ops-MCP speaks JSON-RPC over stdout`);
  }
});

test("the retired admission switches have no reader left: setting them changes no gate", () => {
  const gate = (name) => {
    const prev = process.env[name];
    process.env[name] = "0";
    try { return envGateOn(name); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
  };
  // These three are not gates any more — nothing reads them — but if one were ever re-introduced by
  // accident, it would have to come back through the shared predicate, where `0` means off.
  for (const n of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"])
    assert.equal(gate(n), false, `${n} would still honour the 0-disables idiom if it returned`);
});
