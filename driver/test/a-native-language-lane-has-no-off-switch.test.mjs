// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NATIVE-LANGUAGE LANE HAS NO OFF SWITCH.
//
// `CLEAROTRON_NATIVE_LANGUAGE_<CODE>` was the last switch on the native-language lanes: fail-open, read in
// one place, and set by no deployment. The owner ruled it removed. A lane in the run's frozen lane decision
// runs, and the slice statement says what it did from durable state, never from the environment.
//
// What this holds:
// 1. SOURCE — nothing in product code reads a `CLEAROTRON_NATIVE_LANGUAGE_*` name, so the switch cannot
//    come back as a private reader with its own default. That was how it once disagreed with itself: three
//    readers armed an unset lane, a fourth reported the same lane "off in this run's own environment",
//    and the false one reached a delivered coverage statement.
// 2. A BOX THAT STILL SETS ONE is told it is retired and does nothing, as for every retired variable.
// 3. BEHAVIOUR — setting it changes nothing the run says or does, and a slice whose unit record exists
//    is reported from that record.
//
// Invented values only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";
import { deriveJxSliceStatement } from "../jx.mjs";

const { retiredEnvWarnings } = await import("../pipeline.mjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "a native-language lane has no off switch (nothing reads CLEAROTRON_NATIVE_LANGUAGE_*)";
// A READ is an env lookup: `env[...CLEAROTRON_NATIVE_LANGUAGE_...]` or `process.env.CLEAROTRON_NATIVE_LANGUAGE_X`.
// Naming the variable in a comment or a message is not a read: the retirement has to be able to name it.
const READS = /(?:process\.)?env\s*(?:\?\.)?\[\s*[`'"][^`'"]*CLEAROTRON_NATIVE_LANGUAGE_|(?:process\.)?env\s*\.\s*CLEAROTRON_NATIVE_LANGUAGE_[A-Z]/;
const LANES = ["ZH", "JA", "KO"];

test("nothing in product code reads a CLEAROTRON_NATIVE_LANGUAGE_* name", (t) => {
  const all = trackedCorpus(GUARD, { root: ROOT, pathspec: ["driver", "shared", "mcp-server", "providers"] });
  if (all === null) return t.skip(skipReason(GUARD));
  const files = all.filter((f) => f.endsWith(".mjs") && !/(^|\/)test\//.test(f));
  assert.ok(files.length > 50, `expected the corpus, enumerated ${files.length}`);
  const offenders = [];
  for (const f of files) {
    readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (READS.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [], "the per-language off switch is retired; nothing may read it again:\n  " + offenders.join("\n  "));
});

test("the pattern catches a read and spares a message", () => {
  assert.match('if (String(env[`CLEAROTRON_NATIVE_LANGUAGE_${lane.toUpperCase()}`] ?? "1").trim() === "0") return false;', READS);
  assert.match("const on = process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH;", READS);
  assert.doesNotMatch('CLEAROTRON_NATIVE_LANGUAGE_ZH: ["2026-11-11", "a native-language lane runs ..."],', READS);
});

test("a box that still sets one is told it is retired and does nothing, for every lane", () => {
  for (const code of LANES) {
    const name = `CLEAROTRON_NATIVE_LANGUAGE_${code}`;
    const w = retiredEnvWarnings({ [name]: "0" });
    assert.equal(w.length, 1, `${name}: no retirement warning`);
    assert.match(w[0], new RegExp(`^warning: ${name} is set but was RETIRED 2026-11-11 and does nothing`));
  }
  assert.deepEqual(retiredEnvWarnings({}), [], "an environment without them is warned about nothing");
});

test("setting it changes nothing the slice statement says, and a slice with a unit record is reported from it", () => {
  const sidecar = { lanes: { zh: {} }, fold: { lanes: { zh: { degraded: false } } } };
  const units = { units: { "serp-grid:zh": { degraded: true, attempts: 1,
    degradedCause: "42/42 cells gapped — below the coverage floor. Dominant cause (42/42): an invented provider's quota refusal" } } };
  const plain = deriveJxSliceStatement({ sidecar, units });
  const withOldSwitch = deriveJxSliceStatement({ sidecar, units, env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "0" } });
  assert.deepEqual(withOldSwitch, plain, "the retired switch still moved the statement");
  assert.ok(!Object.values(plain.slices).some((sl) => sl.state === "not-armed"), "a slice reads as switched off, and nothing switches it");
  const grid = Object.values(plain.slices).find((sl) => sl.unit === "serp-grid:zh");
  assert.equal(grid.state, "gapped", "it ran and degraded — the honest state");
  assert.match(grid.why, /quota refusal/, "and it carries the provider's own cause, not an environment guess");
});
