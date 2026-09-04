// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The fail-open lane switch has ONE reader, and a slice cannot be "not-armed" while its unit record
// exists.
//
// ── WHAT WAS ────────────────────────────────────────────────────────────────────────────────
//
// `CLEAROTRON_NATIVE_LANGUAGE_<CODE>` had FOUR readers. Three defaulted an unset flag ON (fail-open, which is the
// doctrine: kill switches are retired, availability is BUILT-only, the switches that remain fail
// open). The fourth — the slice-statement path — read it through `envOn`, the default-OFF opt-in
// reader used for the `CLEAROTRON_JX_*` arms.
//
// CLEAROTRON_NATIVE_LANGUAGE_ZH is unset on every box. So on a delivered clearance the executor armed the zh lane,
// dispatched 42 SERP cells and took a provider quota refusal, while the coverage statement said the
// lane was "off in this run's own environment when the statement was minted". A disclosed degradation
// became a silent absence, on a client-facing artefact. A missing claim prompts a question; a false
// one closes it.
//
// ── TWO ASSERTIONS, AND NEITHER SUBSUMES THE OTHER ───────────────────────────────────────────────
//
// 1. SOURCE — nothing outside driver.config.mjs reads the variable directly. Stops a fifth reader
//    landing with its own default. This is the class fix; the one-line correction was the instance.
//
// 2. BEHAVIOUR — the contradiction e2e-gobaby named, which is detectable WITHOUT knowing which
//    artefact is right: a slice whose unit record exists in _driver/jx/units.json cannot be reported
//    "not-armed". Something that never armed cannot have left a unit record behind. That assertion
//    would have caught this bug through any of its four readers, including ones nobody has written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";
import { laneArmed } from "../driver.config.mjs";
import { deriveJxSliceStatement } from "../jx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "lane-switch-one-reader (CLEAROTRON_NATIVE_LANGUAGE_* has a single reader)";
// A READ is an env lookup: `env[...CLEAROTRON_NATIVE_LANGUAGE_...]` or `process.env.CLEAROTRON_NATIVE_LANGUAGE_X`. Naming the
// variable inside a message string is not a read and must stay allowed — the operator needs to be
// told which switch to set.
const READS = /(?:process\.)?env\s*(?:\?\.)?\[\s*[`'"][^`'"]*CLEAROTRON_NATIVE_LANGUAGE_|(?:process\.)?env\s*\.\s*CLEAROTRON_NATIVE_LANGUAGE_[A-Z]/;

// TWO VARIABLES SHARE THE PREFIX AND ARE NOT LANE SWITCHES. They are numeric tunables for the
// lane-wedge retry ladder — read once at module load, defaulted with `|| 2` / `|| 60000`, never a
// per-lane on/off. laneArmed would be meaningless for them.
//
// Named individually rather than loosened out of the pattern: a regex relaxed to "CLEAROTRON_NATIVE_LANGUAGE_ but
// not WEDGE" silently forgives the next tunable somebody adds, and the whole point of this guard is
// that one more reader with its own default is what caused. The list is self-invalidating —
// an entry that no longer appears in the tree fails, so it cannot outlive what it excuses.
// EMPTY since step 3 deleted both tunables. An empty exemption list is the end state this guard
// wants, not a broken one: nothing outside driver.config.mjs reads a CLEAROTRON_NATIVE_LANGUAGE_* name at all now.
const NOT_LANE_SWITCHES = [];

/**
 * Every name this list has EVER held. Not history for its own sake: the arm below asserts that a name
 * which has left the list has not quietly come back, which is the only assertion left to make once the
 * list is empty — and an empty list is the end state this guard is working towards.
 */
const EVER_EXCLUDED = ["CLEAROTRON_NATIVE_LANGUAGE_WEDGE_CHAIN_RETRIES", "CLEAROTRON_NATIVE_LANGUAGE_WEDGE_BACKOFF_MS"];
const isTunable = (line) => NOT_LANE_SWITCHES.some((n) => line.includes(n));

test("#552 nothing outside driver.config.mjs reads CLEAROTRON_NATIVE_LANGUAGE_* directly", (t) => {
  const all = trackedCorpus(GUARD, { root: ROOT, pathspec: ["driver", "shared", "mcp-server"] });
  if (all === null) return t.skip(skipReason(GUARD));
  const files = all.filter((f) => f.endsWith(".mjs") && !f.includes("/test/") && f !== "driver/driver.config.mjs");
  assert.ok(files.length > 50, `expected the corpus, enumerated ${files.length}`);

  const offenders = [];
  for (const f of files) {
    readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      if (READS.test(line) && !isTunable(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [],
    "a second reader of a fail-open switch is a second default waiting to disagree — import laneArmed "
    + "from driver.config.mjs:\n  " + offenders.join("\n  "));
});

test("#552 the tunable exclusions still exist — an allowlist may not outlive what it excuses", (t) => {
  const all = trackedCorpus(GUARD, { root: ROOT, pathspec: ["driver", "shared", "mcp-server"] });
  if (all === null) return t.skip(skipReason(GUARD));
  // TEST FILES ARE NOT THE TREE THIS EXEMPTION IS ABOUT. The corpus used to include driver/test/, so an
  // exemption stayed "still in the tree" on the strength of the line that DECLARES it and the arms that
  // mention it — the licence keeping itself alive. Measured on step 3: both entries were deleted
  // from product code and this arm still passed.
  const corpus = all.filter((f) => f.endsWith(".mjs") && !/(^|\/)test\//.test(f))
    .map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  // A READ, not a mention. This guard's subject is who RESOLVES a CLEAROTRON_NATIVE_LANGUAGE_* value; a comment
  // recording that a knob was deleted has to name it, or it records nothing. Asserting on the bare
  // name would forbid the very sentence that explains the deletion.
  const isRead = (n) => new RegExp(`(?:process\\.)?env\\s*(?:\\?\\.)?(?:\\[\\s*["'\`]${n}["'\`]\\s*\\]|\\.${n}\\b)`).test(corpus);

  // FILTERED, THEN ASSERTED ONCE — never an assertion inside a loop. An `assert` in a loop over an
  // EMPTY list is an assert site that never runs, and the coverage census counts SITES, not arms:
  // emptying NOT_LANE_SWITCHES in step 3 left a dead site here even after the arm itself was
  // given something real to check. Both assertions below execute whatever the two lists hold, which
  // is the property that makes them worth having.
  const excusedButGone = NOT_LANE_SWITCHES.filter((n) => !isRead(n));
  assert.deepEqual(excusedButGone, [],
    "these are excluded from the lane-switch guard and are no longer read anywhere in PRODUCT code — "
    + "remove the exclusion rather than leaving a licence nobody re-reads");

  const retiredButBack = EVER_EXCLUDED.filter((n) => !NOT_LANE_SWITCHES.includes(n) && isRead(n));
  assert.deepEqual(retiredButBack, [],
    "these were retired from the exemption list because nothing read them any more, and they are read "
    + "again in product code. Either each is a real lane switch and belongs in driver.config.mjs, or it "
    + "is a tunable and belongs in NOT_LANE_SWITCHES with a reason. It may not be neither.");
});

test("#552 the pattern catches a read and spares a message", () => {
  assert.match('if (String(env[`CLEAROTRON_NATIVE_LANGUAGE_${lane.toUpperCase()}`] ?? "1").trim() === "0") return false;', READS);
  assert.match('const on = process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH;', READS);
  // the `cause` and `why` strings NAME the switch and must not be flagged — the operator needs it
  assert.doesNotMatch('return { ran: false, cause: `CLEAROTRON_NATIVE_LANGUAGE_${lane.toUpperCase()} off` };', READS);
  assert.doesNotMatch('why: `${s.arm} (or CLEAROTRON_NATIVE_LANGUAGE_${x}) off in this run\'s own environment` };', READS);
});

test("#552 laneArmed is fail-OPEN: unset arms, only an explicit off silences", () => {
  assert.equal(laneArmed("zh", {}), true, "unset ⇒ armed. This is the doctrine, not a default nobody chose");
  assert.equal(laneArmed("zh", { CLEAROTRON_NATIVE_LANGUAGE_ZH: "" }), true, "empty is not 'off'");
  assert.equal(laneArmed("zh", { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1" }), true);
  assert.equal(laneArmed("zh", { CLEAROTRON_NATIVE_LANGUAGE_ZH: "0" }), false);
  assert.equal(laneArmed("zh", { CLEAROTRON_NATIVE_LANGUAGE_ZH: "off" }), false);
});

test("#552 a slice whose UNIT RECORD exists is never reported not-armed", () => {
  // The contradiction, asserted without deciding which artefact is right: a lane that never armed
  // cannot have left a unit record. This is the shape of the delivered run — arm on, CLEAROTRON_NATIVE_LANGUAGE_ZH
  // unset, and a units.json carrying the degraded serp-grid with its provider cause.
  const sidecar = { lanes: { zh: {} }, fold: { lanes: { zh: { degraded: false } } } };
  const units = { units: { "serp-grid:zh": { degraded: true, attempts: 1,
    degradedCause: '42/42 cells gapped — below the coverage floor. Dominant cause (42/42): SerpAPI 429' } } };
  // item 8 deleted the two per-slice arms this line used to set. They were never what armed the
  // slice — `laneArmed` reads CLEAROTRON_NATIVE_LANGUAGE_ZH and fails OPEN — so an empty environment is the same setup
  // with the noise removed, and it states 's property directly: unset is ARMED, not not-armed.
  const env = {};   // CLEAROTRON_NATIVE_LANGUAGE_ZH deliberately unset — and unset must read as armed

  const { slices } = deriveJxSliceStatement({ sidecar, units, env });
  for (const [name, sl] of Object.entries(slices)) {
    if (!sl.unit || !units.units[sl.unit]) continue;
    assert.notEqual(sl.state, "not-armed",
      `${name}: a unit record exists for ${sl.unit}, so the lane armed and dispatched — `
      + `"not-armed" is a false coverage claim (#552). why was: ${sl.why}`);
  }
  const grid = Object.values(slices).find((sl) => sl.unit === "serp-grid:zh");
  assert.ok(grid, "the serp-grid slice is in the statement");
  assert.equal(grid.state, "gapped", "it ran and degraded — the honest state");
  assert.match(grid.why, /SerpAPI 429/, "and it carries the provider's own cause, not an env guess");
});
