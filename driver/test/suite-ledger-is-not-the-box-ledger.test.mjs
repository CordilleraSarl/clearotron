// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// #1269 — A SUITE RUN'S FIXTURE TRAFFIC MUST NOT LAND IN THE BOX'S REAL CALL LEDGER.
//
// The call ledger is box-global by design (#743): the billing tally reads it across runs, and it is the
// independent witness that a run made record fetches at all. The cost nobody had costed is that a
// full-suite run appended MOCK calls to that same file. Measured on this box before the fix — 2,005
// rows, 1,280 corsearch and 725 uspto-local, and ZERO of them carrying anything that marked them as
// synthetic, so no reader could have filtered them out even knowing they were there.
//
// The redirect is asserted here; the diff across a real suite run is in the PR, because a test that
// writes to the box's own ledger to prove it is not written to would be its own defect.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveLedger, ledgerPath, SUITE_TELEMETRY_DIR_ENV, LEDGERS, ledgerDeprecationNotice, _resetLedgerNotices }
  from "../../providers/_shared/ledger-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUITE = "/tmp/a-suite-run-root/telemetry";

test("#1269 with a suite dir in force, BOTH ledgers resolve under it and never under the home dir", () => {
  for (const which of Object.keys(LEDGERS)) {
    const r = resolveLedger(which, { [SUITE_TELEMETRY_DIR_ENV]: SUITE });
    assert.equal(r.path, join(SUITE, LEDGERS[which].file));
    assert.equal(r.source, "suite");
    assert.ok(!r.path.startsWith(homedir()), `${which} resolved inside the home directory: ${r.path}`);
  }
  // ONE directory, not a path per ledger: a ledger added later is contained without editing the harness.
  assert.equal(dirname(ledgerPath("call", { [SUITE_TELEMETRY_DIR_ENV]: SUITE })),
    dirname(ledgerPath("record", { [SUITE_TELEMETRY_DIR_ENV]: SUITE })));
});

test("#1269 a test that names its OWN ledger file still wins — the redirect sits below the explicit var", () => {
  // That test is being deliberate about a path it then asserts on. The redirect exists for the runs
  // that name nothing, which are exactly the ones that used to land on the box.
  const r = resolveLedger("call", { [SUITE_TELEMETRY_DIR_ENV]: SUITE, CLEAROTRON_REGISTER_CALL_LOG: "/tmp/mine.jsonl" });
  assert.equal(r.path, "/tmp/mine.jsonl");
  assert.equal(r.source, "env");
});

test("#1269 the existence ladder is UNTOUCHED when no suite dir is set — production resolves as before", () => {
  // Read from the passed env, so every ladder test that drives this with `{}` is unaffected by
  // construction. If this ever reads process.env instead, the ladder tests start answering about the
  // box that happens to be running them.
  const r = resolveLedger("call", {});
  assert.notEqual(r.source, "suite");
  assert.ok(["default", "legacy-default", "default-fresh"].includes(r.source), `unexpected source ${r.source}`);
  assert.ok(r.path.startsWith(homedir()), "the box ladder stopped resolving under the home directory");
});

test("#1269 a suite run gets NO legacy notice — it is not writing to the machine those notices describe", () => {
  // `legacy` is null by construction because the ladder is never consulted. A notice about the box's
  // unread files, printed by a run that is writing somewhere else entirely, sends a reader to a file
  // that has nothing to do with what just happened.
  _resetLedgerNotices();
  const env = { [SUITE_TELEMETRY_DIR_ENV]: SUITE };
  assert.equal(resolveLedger("call", env).legacy, null);
  assert.equal(ledgerDeprecationNotice("call", env), null);
});

test("#1269 an empty or whitespace suite dir is NOT a redirect — it falls through to the ladder", () => {
  // `X=` in an EnvironmentFile means "not configured". An empty string reaching a join() would send
  // every ledger to a relative "register-calls.jsonl" in whatever the cwd happens to be, which is the
  // #1216 defect shape: a value that looks set and resolves to somewhere nobody chose.
  for (const v of ["", "   "]) {
    const r = resolveLedger("call", { [SUITE_TELEMETRY_DIR_ENV]: v });
    assert.notEqual(r.source, "suite");
    assert.ok(r.path.startsWith(homedir()), `an empty suite dir resolved to ${r.path}`);
  }
});

// ── the half that would otherwise rot: is the harness actually exporting it? ────────────────────────

test("#1269 the test wrapper exports the suite dir, UNCONDITIONALLY and inside its own run root", () => {
  const src = readFileSync(join(ROOT, "scripts", "test-run.mjs"), "utf8");
  assert.match(src, new RegExp(`process\\.env\\.${SUITE_TELEMETRY_DIR_ENV}\\s*=\\s*join\\(root, "telemetry"\\)`),
    "the wrapper stopped exporting the suite telemetry dir — the suite writes to the box again");
  // NOT via `containedDefaults`, which fills only what is UNSET. The harm lands exactly on boxes that
  // HAVE a real ledger configured or inherited, so an unset-only redirect would step aside for the
  // case it was written for. Asserted because "make it consistent with the block above" is the obvious
  // and wrong tidy-up.
  const contained = src.slice(src.indexOf("const containedDefaults"), src.indexOf("if (applied.length)"));
  assert.ok(!contained.includes(SUITE_TELEMETRY_DIR_ENV),
    "the suite telemetry dir moved into containedDefaults — it would then honour a box's real ledger, "
    + "which is the one setting this exists to override");
});

test("#1269 the #743 design comment says what the code does — they cannot disagree", () => {
  // Acceptance 3. The block said "The CALL ledger does NOT move", flat, and that is now true only of a
  // real run. A design comment that describes the behaviour before the change is worse than none: it is
  // the sentence the next reader trusts instead of reading the ladder.
  const src = readFileSync(join(ROOT, "providers", "_shared", "ledger-path.mjs"), "utf8");
  const block = src.slice(src.indexOf("#743 — THE RECORD LOG'S ADDRESS"));
  assert.match(block, /#1269/, "the #743 block never mentions the suite redirect that qualifies it");
  assert.match(block, /does NOT move, for a REAL run/,
    "the flat 'the CALL ledger does NOT move' is back, and a suite run now contradicts it");
});
