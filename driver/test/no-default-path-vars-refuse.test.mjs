// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A PATH VARIABLE WITH NO SAFE DEFAULT MUST REFUSE, AND THAT MUST BE A RULE RATHER THAN ONE
// VARIABLE'S HABIT.
//
// `config.poolRoot` refuses when its variable is unset or blank, and 's own test pins that. But
// poolRoot is a POPULATION OF ONE. Nothing here made the next author of a no-default path accessor
// write the same refusal, and a single-member population exercises none of the interaction that lets a
// rule be got wrong. That is the gap this file closes.
//
// WHY A DECLARED TABLE AND NOT A BEHAVIOURAL RULE. The tempting version — "no path accessor may resolve
// to nothing when its variable is unset" — is wrong, and reds shipped-correct code. `skillsOverlayDir`
// returns `null` on unset because "no overlay configured" is its documented answer and resolveSkillPath
// falls back to the base; `poolRootOrNull` returns `null` because a READ-only surface must degrade
// rather than throw. Whether an accessor HAS a safe default is a semantic fact about what the path
// means, and no probe can derive it. So the table below states it, and the assertions hold each class
// to its own behaviour.
//
// This is a total classification, NOT an exception list. Every path-class accessor appears. A new one
// fails until someone classifies it — the point is to force the decision, not to excuse a defect. (An
// excuse row naming the thing it forgives is the shape that rewards the defect; there is none here.)
//
// SCOPE, STATED ON ITS FACE: this sweeps the getters of `driver/driver.config.mjs` whose names end in a
// path-class suffix. A no-default path variable read anywhere ELSE in the tree, or named without one of
// those suffixes, walks straight past this guard. It is a tripwire on one file's accessors, and it must
// not be cited as proof that the rule holds tree-wide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { config } from "../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_SRC = join(HERE, "..", "driver.config.mjs");

/** Accessor names ending in one of these are treated as path-class and MUST be classified below. */
const PATH_SUFFIX = /(Root|Roots|Dir|Dirs|Path|Bin|OrNull)$/;

/**
 * REFUSES  — no safe default exists; unset or blank must THROW, naming the variable.
 * DEFAULTS — a safe default exists; unset or blank must still resolve to something non-empty.
 * OPTIONAL — "not configured" is a legitimate answer; unset or blank must be exactly `null`.
 * DERIVED  — reads no environment variable of its own; must be non-empty whatever the env says.
 */
const CLASS = {
  workspaceRoot:    "DEFAULTS",
  skillsDir:        "DEFAULTS",
  skillsBaseDir:    "DERIVED",
  skillsOverlayDir: "OPTIONAL",
  skillsGrantRoots: "DERIVED",
  skillsRoot:       "DERIVED",
  queueDirs:        "DEFAULTS",
  studioRoot:       "DERIVED",
  queueDir:         "DERIVED",
  archiveRoot:      "DERIVED",
  poolRoot:         "REFUSES",
  poolRootOrNull:   "OPTIONAL",
  runLockDir:       "DEFAULTS",
  outboxDir:        "DEFAULTS",
};

/** Every path-ish variable the config reads, cleared together so one probe cannot mask another. */
// step 4.0 — DERIVED, never listed. Naming one spelling to clear it is correct only while the
// accessor reads that same spelling raw: convert the read and the OTHER spelling, which every real
// machine has set, satisfies it — the precondition is never established and this whole file passes
// while testing nothing. Measured both ways on `poolRoot`: raw read refuses; alias-aware read with the
// current name in the environment does not. `spellingsOf` is the write-side rule's missing half.
const PATH_VARS = ["CLEAROTRON_WORK_DIR", "CLEAROTRON_INSTRUCTIONS_DIR", "CLEAROTRON_REPORTS_DIR",
  "CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_OUTBOX_DIR", "CLEAROTRON_QUEUE_DIR"].flatMap((n) => [n]);

/** Run `fn` with `vars` applied exactly (undefined = deleted), then restore. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/** The path-class accessors as the SOURCE declares them — this is what makes it a growth tripwire. */
function pathAccessorsInSource() {
  const src = readFileSync(CONFIG_SRC, "utf8");
  const found = [];
  for (const line of src.split("\n")) {
    const m = /^\s*get ([A-Za-z][A-Za-z0-9]*)\(\)/.exec(line);
    if (m && PATH_SUFFIX.test(m[1])) found.push(m[1]);
  }
  return [...new Set(found)].sort();
}

const nonEmpty = (v) =>
  Array.isArray(v) ? v.length > 0 && v.every((x) => String(x ?? "").trim() !== "")
    : String(v ?? "").trim() !== "";

// ── the tripwire ────────────────────────────────────────────────────────────────────────────────────

test("#1216 every path-class accessor in driver.config.mjs is classified — a new one must be ruled on", () => {
  const inSource = pathAccessorsInSource();
  const declared = Object.keys(CLASS).sort();

  const unclassified = inSource.filter((n) => !(n in CLASS));
  assert.deepEqual(unclassified, [],
    "these path-class accessors are new and unclassified:\n  " + unclassified.join("\n  ")
    + "\n\nDecide what the path MEANS when its variable is unset or blank, then add it to CLASS:\n"
    + "  REFUSES  — there is no safe default (any fallback would be somebody's real directory). Throw, and name the variable.\n"
    + "  DEFAULTS — a safe default exists; resolve to it.\n"
    + "  OPTIONAL — 'not configured' is a legitimate answer; return null.\n"
    + "  DERIVED  — reads no variable of its own.\n"
    + "This test failing is the rule working: #1216 exists because a path resolved to something nobody watched.");

  const stale = declared.filter((n) => !inSource.includes(n));
  assert.deepEqual(stale, [],
    "these are classified but no longer exist in driver.config.mjs — the table is describing code that is "
    + "gone, which is how a guard quietly stops sweeping anything: " + stale.join(", "));

  // A population of one is what this file exists to prevent becoming invisible again. If the count ever
  // collapses, the sweep has stopped covering the surface even though every assertion still passes.
  // 16 -> 14: the gateway binary accessor and `turnLockDir` were both deleted with the
  // gateway they served.
  // Lowered deliberately rather than left standing — a floor above the population passes nothing and
  // reds everything, and a floor left high after a real removal is a ratchet that has stopped turning.
  assert.ok(inSource.length >= 14,
    `only ${inSource.length} path-class accessors found — the sweep has lost sight of the surface`);
});

test("#1216 a no-default path accessor REFUSES on unset and on blank, and names its variable", () => {
  const refusing = Object.entries(CLASS).filter(([, k]) => k === "REFUSES").map(([n]) => n);
  assert.ok(refusing.length > 0, "no accessor is classified REFUSES — the rule has no live member left");

  for (const name of refusing) {
    for (const value of [undefined, "", "   ", "\t"]) {
      const env = Object.fromEntries(PATH_VARS.map((v) => [v, undefined]));
      withEnv({ ...env, CLEAROTRON_REPORTS_DIR: value }, () => {
        assert.throws(() => config[name],
          (e) => {
            // A refusal that does not name the variable leaves the operator guessing, which is how the
            // original defect survived: the failure was silent about WHAT was unconfigured.
            // step 4.0 — EITHER spelling. This demanded the refusal name a RETIRED one, so
            // re-aiming the message at the name in force made the arm reject the right answer.
            assert.match(e.message, /(?:PRELIM|CLEAROTRON)_[A-Z_]+/,
              `${name} refused without naming an environment variable`);
            return true;
          },
          `${name} must refuse for ${JSON.stringify(value)} — blank is not a configured path`);
      });
    }
  }
});

test("#1216 each other class behaves as its classification says, with every path variable cleared", () => {
  const cleared = Object.fromEntries(PATH_VARS.map((v) => [v, undefined]));
  const home = join(tmpdir(), "n1216-home");

  for (const [name, kind] of Object.entries(CLASS)) {
    if (kind === "REFUSES") continue;
    // — WHITESPACE IS UNSET, by owner ruling 2026-08-19. This arm previously probed only
    // `undefined` and `""`, because "   " is TRUTHY in JavaScript and so `process.env.X || default`
    // returned the spaces AS THE PATH rather than falling through. Eight of sixteen accessors behaved
    // that way; poolRoot alone trimmed. Asserting either side then would have frozen a decision that
    // was not this test's to make. It has since been made, so the assertion is here rather than in a
    // comment explaining its absence.
    for (const value of [undefined, "", "   ", "\t"]) {
      // Apply the blank to every variable at once: a class that only holds because some OTHER variable
      // happened to be set is not holding.
      const env = { ...cleared, HOME: home };
      if (value !== undefined) for (const v of PATH_VARS) env[v] = value;

      withEnv(env, () => {
        const got = config[name];
        if (kind === "OPTIONAL") {
          assert.equal(got, null,
            `${name} is classified OPTIONAL, so unset/blank must be exactly null — got ${JSON.stringify(got)}`);
        } else {
          assert.ok(nonEmpty(got),
            `${name} is classified ${kind}, so it must still resolve to something for `
            + `${JSON.stringify(value)} — got ${JSON.stringify(got)}. An accessor that resolves to nothing `
            + `is the #1216 shape: it does not refuse and it does not default, it just quietly points nowhere.`);
        }
      });
    }
  }
});
